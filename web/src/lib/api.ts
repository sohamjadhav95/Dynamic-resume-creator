// Talks to our FastAPI backend (/api/*). Streaming endpoints use Server-Sent Events over fetch.

import { getAccessToken } from "./supabase";
import { loadPrefs } from "./prefs";
import type { Sheet } from "./source";

export interface PublicConfig {
  supabase: { url: string; anonKey: string } | null;
  ai: { gemini: boolean; groq: boolean };
}

let configPromise: Promise<PublicConfig> | null = null;

export function getConfig(): Promise<PublicConfig> {
  if (!configPromise) {
    configPromise = fetch("/api/config")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .catch(() => {
        configPromise = null; // try again next time
        const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
        const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
        return { supabase: url && anonKey ? { url, anonKey } : null, ai: { gemini: false, groq: false } };
      });
  }
  return configPromise;
}

async function headers(): Promise<Record<string, string>> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  const token = await getAccessToken();
  if (token) h.Authorization = `Bearer ${token}`;
  const ownKey = loadPrefs().geminiKey;
  if (ownKey) h["x-gemini-key"] = ownKey;
  return h;
}

export class ApiError extends Error {}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return body.error ?? body.detail ?? `Request failed (${res.status})`;
  } catch {
    return res.status >= 500 ? "Our server is having trouble. Please try again." : `Request failed (${res.status})`;
  }
}

export type StreamEvent =
  | { type: "stage"; data: { provider: string; label: string; model?: string; retry?: boolean } }
  | { type: "thought"; data: { text: string } }
  | { type: "progress"; data: { chars: number } }
  | { type: "result"; data: { engine: "gemini" | "groq"; model: string; seconds: number; data: any } }
  | { type: "fallback"; data: { reasons?: string[] } }
  | { type: "limit"; data: { message: string; limit: number } };

/**
 * POST and read the SSE stream. Resolves with the final event (result / fallback / limit).
 * Network failure or server error resolves as a fallback, so callers always get an answer.
 */
export async function streamAi(
  path: "/api/tailor" | "/api/parse",
  body: unknown,
  onEvent: (e: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<StreamEvent> {
  let res: Response;
  try {
    res = await fetch(path, { method: "POST", headers: await headers(), body: JSON.stringify(body), signal });
  } catch (err) {
    if (signal?.aborted) throw err;
    return { type: "fallback", data: { reasons: ["Could not reach the server."] } };
  }
  if (!res.ok || !res.body) {
    const message = await errorMessage(res);
    if (res.status === 422) throw new ApiError(message);
    return { type: "fallback", data: { reasons: [message] } };
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let final: StreamEvent | null = null;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const event = parseBlock(block);
        if (!event) continue;
        onEvent(event);
        if (event.type === "result" || event.type === "fallback" || event.type === "limit") final = event;
      }
    }
  } catch (err) {
    if (signal?.aborted) throw err;
  }
  return final ?? { type: "fallback", data: { reasons: ["The connection closed early."] } };
}

function parseBlock(block: string): StreamEvent | null {
  let type = "";
  let data = "";
  for (const line of block.split("\n")) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) type = line.slice(6).trim();
    else if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  if (!type) return null;
  try {
    return { type, data: data ? JSON.parse(data) : {} } as StreamEvent;
  } catch {
    return null;
  }
}

export async function rewriteBullet(input: {
  text: string;
  mode: "shorter" | "impact" | "keyword" | "fix" | "retry";
  keyword?: string;
  context?: string;
  job_description?: string;
}): Promise<string[]> {
  let res: Response;
  try {
    res = await fetch("/api/rewrite", { method: "POST", headers: await headers(), body: JSON.stringify(input) });
  } catch {
    throw new ApiError("You seem to be offline. Rewriting needs a connection.");
  }
  if (!res.ok) throw new ApiError(await errorMessage(res));
  return (await res.json()).options as string[];
}

/** Wake the serverless function early so the first AI request is fast. */
export function warmUp(): void {
  fetch("/api/health").catch(() => {});
}

// ------------------------------------------------------------------ uploaded PDFs (edited in place)

/** One text block of an uploaded PDF: a bullet, a paragraph, a "Label: ..." line or a title. */
export interface FileBlock {
  id: string;
  page: number;
  kind: "heading" | "bullet" | "labeled" | "summary" | "text";
  section: string;
  text: string; // without the bullet sign or "Label:" in front
  prefix: string;
  lines: number[][]; // [x0, y0, x1, y1] of each line, in PDF points from the top left
}

export interface ExtractedFile {
  pages: { width: number; height: number }[];
  text: string;
  blocks: FileBlock[];
}

export interface RenderResult {
  id: string;
  status: "applied" | "unchanged" | "too_long" | "missing";
  lines?: number; // lines the block has
  used?: number; // lines the new text took
  over?: number; // too long: about how many characters to cut
}

async function postJson<T>(path: string, body: unknown, offlineMessage: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { method: "POST", headers: await headers(), body: JSON.stringify(body) });
  } catch {
    throw new ApiError(offlineMessage);
  }
  if (!res.ok) throw new ApiError(await errorMessage(res));
  return (await res.json()) as T;
}

/** Reads an uploaded PDF on the server: its text and its blocks. */
export function extractFile(filename: string, fileBase64: string): Promise<ExtractedFile> {
  return postJson("/api/file/extract", { filename, file_base64: fileBase64 }, "Could not reach the server to read this file.");
}

/** Writes changed blocks into the original PDF. */
export function renderFile(
  fileBase64: string,
  edits: Record<string, string>,
  paper?: "A4" | "Letter",
  fit: "shrink" | "pages" = "shrink",
): Promise<{ file_base64: string; results: RenderResult[]; sheets: Sheet[] | null }> {
  return postJson(
    "/api/file/render",
    { file_base64: fileBase64, edits: Object.entries(edits).map(([id, text]) => ({ id, text })), paper: paper ?? null, fit },
    "Could not reach the server to update your PDF.",
  );
}

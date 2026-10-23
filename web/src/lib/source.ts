// An uploaded PDF, shown and edited as itself ("your PDF").
//
// The page on screen is the original file. Every text block of it (a bullet, a paragraph, a
// "Skills:" line, a title) is clickable. Resume fields the AI tailors (summary, bullets, skills lines)
// are matched to the blocks that show them, so tailoring rewrites those blocks in place. The server
// writes changed blocks into the original PDF (backend/fileedit), so everything else stays exactly
// as it was: fonts, photo, columns, colours, lines.

import { renderFile, type ExtractedFile, type FileBlock, type RenderResult } from "./api";
import { getPath, normalizeResume, resumeText, setPath, type Resume } from "./schema";
import type { Insights } from "./tailor";
import { getSupabase } from "./supabase";

export interface SourceBlock extends FileBlock {
  path?: string; // the resume field this block shows (e.g. "experience.0.bullets.2")
  sep?: string; // for skills lines: what separates the items
}

export interface Source {
  file: string; // id of the original PDF (a hash of its bytes)
  name: string;
  pages: { width: number; height: number }[];
  blocks: SourceBlock[];
  edits: Record<string, string>; // block id -> new text, for blocks not tied to a resume field
  paper?: Paper; // show and download on this paper instead of the file's own page size
  fit?: "shrink" | "pages"; // on that paper: scale each page onto one sheet, or keep the size and add sheets
}

export type Paper = "A4" | "Letter";
const PAPER: Record<Paper, { width: number; height: number }> = {
  A4: { width: 595.28, height: 841.89 },
  Letter: { width: 612, height: 792 },
};

/** "A4", "Letter", "Legal", or the size in millimetres. */
export function paperName(page: { width: number; height: number }): string {
  const named = { ...PAPER, Legal: { width: 612, height: 1008 } };
  for (const [name, p] of Object.entries(named)) if (Math.abs(page.width - p.width) < 4 && Math.abs(page.height - p.height) < 4) return name;
  const mm = (pt: number) => Math.round((pt / 72) * 25.4);
  return `${mm(page.width)} × ${mm(page.height)} mm`;
}

/** One sheet of the shown PDF: which part (y0..y1) of which uploaded page it shows, and how it is placed. */
export interface Sheet {
  page: number;
  y0: number;
  y1: number;
  scale: number;
  dx: number;
  top: number;
  width: number;
  height: number;
}

/** The uploaded pages as they are: one sheet each. */
export const sheetsAsUploaded = (src: Source): Sheet[] =>
  src.pages.map((p, page) => ({ page, y0: 0, y1: p.height, scale: 1, dx: 0, top: 0, width: p.width, height: p.height }));

/** Where a line of an uploaded page lands: on which sheet, and where on it (null if on no sheet). */
export function place(sheets: Sheet[], page: number, [x0, y0, x1, y1]: number[]) {
  const mid = (y0 + y1) / 2;
  const i = sheets.findIndex((s) => s.page === page && mid >= s.y0 && mid < s.y1);
  if (i < 0) return null;
  const s = sheets[i];
  return { sheet: i, x: s.dx + x0 * s.scale, y: s.top + (y0 - s.y0) * s.scale, w: (x1 - x0) * s.scale, h: (y1 - y0) * s.scale };
}

/** On a page taller than A4 (at A4 width): where an A4 sheet would end, in the page's own units. */
export function a4Limit(page: { width: number; height: number }): number | null {
  if (paperName(page) === "A4") return null;
  const limit = PAPER.A4.height / Math.min(PAPER.A4.width / page.width, 1);
  return limit < page.height - 2 ? limit : null;
}

export const sourceOf = (r: Resume): Source | null => r.layout.source ?? null;

/** The text a block should show now. */
export function blockText(r: Resume, b: SourceBlock): string {
  if (b.path) {
    const v = getPath(r, b.path);
    if (Array.isArray(v)) return v.join(b.sep ?? ", ");
    if (typeof v === "string") return v;
  }
  return r.layout.source?.edits[b.id] ?? b.text;
}

/** Blocks whose text differs from the original file: what the server has to write. */
export function pendingEdits(r: Resume): Record<string, string> {
  const out: Record<string, string> = {};
  for (const b of sourceOf(r)?.blocks ?? []) {
    const now = blockText(r, b);
    if (norm(now) !== norm(b.text)) out[b.id] = now;
  }
  return out;
}

// ------------------------------------------------------------------ matching fields to blocks

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function bigrams(s: string): Map<string, number> {
  const t = norm(s);
  const out = new Map<string, number>();
  for (let i = 0; i < t.length - 1; i++) out.set(t.slice(i, i + 2), (out.get(t.slice(i, i + 2)) ?? 0) + 1);
  return out;
}

/** 0..1: how alike two texts are (Dice coefficient on letter pairs). */
export function similarity(a: string, b: string): number {
  const x = bigrams(a);
  const y = bigrams(b);
  let both = 0;
  let total = 0;
  for (const [k, n] of x) {
    both += Math.min(n, y.get(k) ?? 0);
    total += n;
  }
  for (const n of y.values()) total += n;
  return total ? (2 * both) / total : 0;
}

function separator(text: string): string {
  for (const sep of [" • ", " | ", " · ", "; "]) if (text.includes(sep.trim()) && text.split(sep.trim()).length > 2) return sep;
  return ", ";
}

/** Ties resume fields to the PDF blocks that show them (best text match first, each block once). */
export function mapBlocks(r: Resume, blocks: SourceBlock[]): SourceBlock[] {
  const fields: { path: string; text: string; list?: boolean }[] = [];
  if (r.summary.trim()) fields.push({ path: "summary", text: r.summary });
  r.experience.forEach((e, i) => e.bullets.forEach((b, k) => fields.push({ path: `experience.${i}.bullets.${k}`, text: b })));
  r.projects.forEach((p, i) => p.bullets.forEach((b, k) => fields.push({ path: `projects.${i}.bullets.${k}`, text: b })));
  r.custom_sections.forEach((s, i) =>
    s.items.forEach((it, j) => it.bullets.forEach((b, k) => fields.push({ path: `custom_sections.${i}.items.${j}.bullets.${k}`, text: b }))),
  );
  r.skills.forEach((g, i) => fields.push({ path: `skills.${i}.items`, text: g.items.join(" "), list: true }));

  const pairs: { f: number; b: number; score: number }[] = [];
  fields.forEach((f, fi) =>
    blocks.forEach((b, bi) => {
      if (b.kind === "heading" || f.text.length < 8) return;
      const score = similarity(f.text, b.text);
      if (score >= 0.8) pairs.push({ f: fi, b: bi, score });
    }),
  );
  pairs.sort((a, b) => b.score - a.score);
  const out = blocks.map((b) => ({ ...b, path: undefined, sep: undefined }) as SourceBlock);
  const usedF = new Set<number>();
  const usedB = new Set<number>();
  for (const p of pairs) {
    if (usedF.has(p.f) || usedB.has(p.b)) continue;
    usedF.add(p.f);
    usedB.add(p.b);
    out[p.b].path = fields[p.f].path;
    if (fields[p.f].list) out[p.b].sep = separator(out[p.b].text);
  }
  return out;
}

/**
 * After tailoring: the page can only show what has a block, in the file's order. Fields without a
 * block go back to the master's text and projects keep the master's order.
 */
export function keepMapped(tailored: Resume, master: Resume): Resume {
  const src = sourceOf(master);
  if (!src) return tailored;
  const mapped = new Set(src.blocks.map((b) => b.path).filter(Boolean));
  const out = normalizeResume(structuredClone(tailored));
  const byId = new Map(out.projects.map((p) => [p.id, p]));
  out.projects = master.projects.map((p) => byId.get(p.id) ?? p);
  if (!mapped.has("summary")) out.summary = master.summary;
  out.experience.forEach((e, i) => (e.bullets = e.bullets.map((b, k) => (mapped.has(`experience.${i}.bullets.${k}`) ? b : master.experience[i]?.bullets[k] ?? b))));
  out.projects.forEach((p, i) => (p.bullets = p.bullets.map((b, k) => (mapped.has(`projects.${i}.bullets.${k}`) ? b : master.projects[i]?.bullets[k] ?? b))));
  out.skills = out.skills.map((g, i) => (mapped.has(`skills.${i}.items`) ? g : master.skills[i] ?? g));
  out.layout.source = src;
  return out;
}

// ------------------------------------------------------------------ the file itself

/** A short id for a file: the first 32 hex digits of its SHA-256. */
async function fileId(bytes: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("tailor", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("files");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(id: string): Promise<string | null> {
  try {
    const db = await idb();
    return await new Promise((resolve) => {
      const req = db.transaction("files").objectStore("files").get(id);
      req.onsuccess = () => resolve((req.result as string) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null; // private window or storage blocked
  }
}

async function idbPut(id: string, b64: string): Promise<void> {
  try {
    const db = await idb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction("files", "readwrite");
      tx.objectStore("files").put(b64, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    /* storage blocked: the file stays in memory for this visit */
  }
}

const memory = new Map<string, string>();

/** Keeps the file in this browser and, for a signed-in person, in their account. */
export async function putFile(id: string, b64: string, name: string, userId: string | null): Promise<void> {
  memory.set(id, b64);
  await idbPut(id, b64);
  if (userId) await uploadFile(id, b64, name, userId);
}

export async function getFile(id: string, userId: string | null): Promise<string | null> {
  const hit = memory.get(id) ?? (await idbGet(id));
  if (hit) {
    memory.set(id, hit);
    return hit;
  }
  if (!userId) return null;
  const sb = await getSupabase();
  const { data } = (await sb?.from("resume_files").select("data").eq("user_id", userId).eq("id", id).maybeSingle()) ?? {};
  if (!data?.data) return null;
  memory.set(id, data.data);
  await idbPut(id, data.data);
  return data.data;
}

const uploaded = new Set<string>(); // saved to the account (or tried and failed: tried once per visit)

async function uploadFile(id: string, b64: string, name: string, userId: string): Promise<void> {
  const key = `${userId}:${id}`;
  if (uploaded.has(key)) return;
  uploaded.add(key);
  const sb = await getSupabase();
  const res = await sb?.from("resume_files").upsert({ id, user_id: userId, name, data: b64 }, { onConflict: "user_id,id" });
  if (res?.error) console.warn("Could not save the PDF to your account; it stays in this browser.", res.error);
}

/** Makes sure every PDF the workspace uses is in the account (after signing in, or offline edits). */
export async function syncFiles(resumes: Resume[], userId: string): Promise<void> {
  for (const r of resumes) {
    const src = sourceOf(r);
    if (!src || uploaded.has(`${userId}:${src.file}`)) continue;
    const b64 = memory.get(src.file) ?? (await idbGet(src.file));
    if (b64) await uploadFile(src.file, b64, src.name, userId);
  }
}

// ------------------------------------------------------------------ rendering

type Rendered = { bytes: Uint8Array; results: RenderResult[]; sheets: Sheet[] };
const rendered = new Map<string, Rendered>();

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The PDF with the resume's current text written in (cached: the same edits are rendered once). */
export async function renderSource(r: Resume, fileB64: string): Promise<Rendered> {
  const src = sourceOf(r)!;
  const edits = pendingEdits(r);
  const fit = src.fit ?? "shrink";
  if (!Object.keys(edits).length && !src.paper) return { bytes: b64ToBytes(fileB64), results: [], sheets: sheetsAsUploaded(src) };
  const key = `${src.file}:${src.paper ?? ""}:${fit}:${JSON.stringify(edits)}`;
  const hit = rendered.get(key);
  if (hit) return hit;
  const res = await renderFile(fileB64, edits, src.paper, fit);
  const out = { bytes: b64ToBytes(res.file_base64), results: res.results, sheets: res.sheets ?? sheetsAsUploaded(src) };
  rendered.set(key, out);
  if (rendered.size > 40) rendered.delete(rendered.keys().next().value!);
  return out;
}

/** An imported resume that came from a PDF: the page shows the PDF, its blocks tied to the fields. */
export async function attachPdf(r: Resume, pdf: { b64: string; name: string; info: ExtractedFile }): Promise<Resume> {
  const bytes = b64ToBytes(pdf.b64);
  const file = await fileId(bytes.buffer as ArrayBuffer);
  memory.set(file, pdf.b64);
  const source: Source = { file, name: pdf.name, pages: pdf.info.pages, blocks: mapBlocks(r, pdf.info.blocks), edits: {} };
  return normalizeResume({ ...r, layout: { ...r.layout, source } });
}

/** How many characters fill a block's lines: at least (reaching the last line) and at most. */
export function room(b: SourceBlock): [number, number] {
  const widths = b.lines.map(([x0, , x1]) => x1 - x0);
  const perLine = (Math.max(...widths) * b.text.length) / Math.max(widths.reduce((a, w) => a + w, 0), 1);
  const n = b.lines.length;
  const min = Math.ceil((n - 1) * perLine + perLine * 0.15);
  const max = Math.floor(n * perLine * 0.97);
  return [Math.min(min, b.text.length), Math.max(max, b.text.length)];
}

/** For the AI: the room of every summary and bullet the PDF shows ("summary" / "<item id>.<bullet>"). */
export function lineLimits(r: Resume): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  for (const b of sourceOf(r)?.blocks ?? []) {
    const m = b.path?.match(/^(experience|projects)\.(\d+)\.bullets\.(\d+)$/);
    if (b.path === "summary") out.summary = room(b);
    else if (m) {
      const item = r[m[1] as "experience" | "projects"][Number(m[2])];
      if (item) out[`${item.id}.${m[3]}`] = room(b);
    }
  }
  return out;
}

/**
 * After tailoring an uploaded PDF: write the new text in and check it fits. A rewrite that needs more
 * lines than its block has, or would leave an empty line, goes back to the master's text and is listed
 * (with the reason) so it can get one more AI try.
 */
export async function fitToPdf(
  outcome: { resume: Resume; insights: Insights },
  master: Resume,
  userId: string | null,
): Promise<{ resume: Resume; insights: Insights }> {
  const src = sourceOf(master);
  if (!src) return outcome;
  const resume = keepMapped(outcome.resume, master);
  const file = await getFile(src.file, userId);
  if (!file) return { ...outcome, resume };
  const { results } = await renderSource(resume, file);
  const kept = [...(outcome.insights.kept ?? [])];
  let out = resume;
  for (const r of results) {
    const b = src.blocks.find((x) => x.id === r.id);
    if (!b?.path || r.status === "unchanged" || r.status === "missing") continue;
    const short = r.status === "applied" && (r.used ?? 0) < (r.lines ?? 0);
    if (r.status !== "too_long" && !short) continue;
    const before = getPath(master, b.path);
    const tried = blockText(out, b);
    out = setPath(out, b.path, before);
    const lines = `${b.lines.length} line${b.lines.length > 1 ? "s" : ""}`;
    const [min, max] = room(b);
    kept.push({
      old: Array.isArray(before) ? before.join(b.sep ?? ", ") : String(before),
      suggested: tried,
      reason: short
        ? `was too short for its ${lines} on your PDF (it needs ${min}-${max} characters, it had ${tried.length})`
        : `didn't fit its ${lines} on your PDF (about ${r.over} characters too long; it needs ${min}-${max})`,
    });
  }
  // Skills from the job post count only if they made it onto the page.
  const shown = resumeText(out);
  const added = (outcome.insights.added ?? []).filter((x) => shown.includes(x));
  return { resume: out, insights: { ...outcome.insights, kept, added } };
}

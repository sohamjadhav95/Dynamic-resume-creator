// The file a person sees and downloads: their original upload, or the original with the tailored
// text written into it. Tailored files are built on the server (/api/file/render) and kept in
// memory only, so storage holds just the original file plus a short list of text changes.

import { useEffect, useState } from "react";
import { renderFile } from "./api";
import { activeEdits, base64ToBytes, type Resume } from "./schema";

const cache = new Map<string, string>();
const MAX_CACHED = 12;

/** Cheap fingerprint of a long base64 string (length + a sample of characters). */
function fingerprint(data: string): string {
  let h = 2166136261;
  const step = Math.max(1, Math.floor(data.length / 4000));
  for (let i = 0; i < data.length; i += step) {
    h ^= data.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${data.length}.${(h >>> 0).toString(36)}`;
}

export function fileKey(r: Resume): string | null {
  if (!r.source) return null;
  return `${fingerprint(r.source.data)}|${JSON.stringify(activeEdits(r.file_changes))}`;
}

export function rememberFile(r: Resume, fileBase64: string): void {
  const key = fileKey(r);
  if (!key) return;
  cache.delete(key);
  cache.set(key, fileBase64);
  while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value as string);
}

/** Returns the file for this resume, building the tailored version on the server when needed. */
export function useResumeFile(r: Resume): { data: string | null; loading: boolean; error: string } {
  const key = fileKey(r);
  const plain = !!r.source && activeEdits(r.file_changes).length === 0;
  const cached = key ? cache.get(key) : undefined;
  const [state, setState] = useState<{ key: string | null; data: string | null; error: string }>({
    key: null,
    data: null,
    error: "",
  });

  useEffect(() => {
    if (!r.source || plain || cached || !key) return;
    let cancelled = false;
    renderFile(r.source.type, r.source.data, activeEdits(r.file_changes))
      .then((res) => {
        if (cancelled) return;
        rememberFile(r, res.file_base64);
        setState({ key, data: res.file_base64, error: "" });
      })
      .catch((err: Error) => !cancelled && setState({ key, data: null, error: err.message }));
    return () => {
      cancelled = true;
    };
    // `r` is read through `key`, which changes whenever the file or its changes change.
  }, [key, plain, cached]);

  if (!r.source) return { data: null, loading: false, error: "" };
  if (plain) return { data: r.source.data, loading: false, error: "" };
  if (cached) return { data: cached, loading: false, error: "" };
  if (state.key === key) return { data: state.data, loading: false, error: state.error };
  return { data: null, loading: true, error: "" };
}

export function downloadBase64(data: string, filename: string, type: "pdf" | "docx"): void {
  const mime =
    type === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const url = URL.createObjectURL(new Blob([base64ToBytes(data) as BlobPart], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

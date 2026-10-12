// Where the workspace lives: the browser (guests) or Supabase (signed-in users).

import { getSupabase } from "./supabase";
import { normalizeResume, type Resume } from "./schema";
import type { Insights } from "./tailor";

export interface Version {
  id: string;
  job_title: string;
  company: string;
  job_description: string;
  data: Resume;
  insights: Insights;
  match_score: number | null;
  engine: string;
  created_at: string;
  updated_at: string;
}

export interface Workspace {
  master: Resume;
  versions: Version[];
}

// ------------------------------------------------------------------ browser (guest)

export const LOCAL_KEY = "tailor.workspace.v2";

/** Signed-in users also keep a copy in the browser, so the app works if the cloud is unreachable. */
export const userCacheKey = (userId: string) => `${LOCAL_KEY}:${userId}`;

export function loadLocal(key = LOCAL_KEY): Workspace | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const ws = JSON.parse(raw);
    return {
      master: normalizeResume(ws.master),
      versions: (ws.versions ?? []).map((v: Version) => ({ ...v, data: normalizeResume(v.data) })),
    };
  } catch {
    return null;
  }
}

export function saveLocal(ws: Workspace, key = LOCAL_KEY): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(ws));
    return true;
  } catch {
    return false; // storage full or blocked
  }
}

export function clearLocal(key = LOCAL_KEY): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* nothing stored */
  }
}

// ------------------------------------------------------------------ cloud (signed in)

export async function loadCloud(userId: string): Promise<Workspace | null> {
  const sb = await getSupabase();
  if (!sb) return null;
  const [m, v] = await Promise.all([
    sb.from("master_resumes").select("data").eq("user_id", userId).maybeSingle(),
    sb.from("tailored_resumes").select("*").eq("user_id", userId).order("updated_at", { ascending: false }).limit(200),
  ]);
  if (m.error) throw m.error;
  if (v.error) throw v.error;
  if (!m.data) return null;
  return {
    master: normalizeResume(m.data.data),
    versions: (v.data ?? []).map((row: any) => ({ ...row, data: normalizeResume(row.data) })),
  };
}

export async function saveCloudMaster(userId: string, master: Resume): Promise<void> {
  const sb = await getSupabase();
  if (!sb) return;
  const { error } = await sb.from("master_resumes").upsert({ user_id: userId, data: master }, { onConflict: "user_id" });
  if (error) throw error;
}

export async function saveCloudVersion(userId: string, v: Version): Promise<void> {
  const sb = await getSupabase();
  if (!sb) return;
  const { error } = await sb.from("tailored_resumes").upsert({
    id: v.id,
    user_id: userId,
    job_title: v.job_title,
    company: v.company,
    job_description: v.job_description,
    data: v.data,
    insights: v.insights,
    match_score: v.match_score,
    engine: v.engine,
    created_at: v.created_at,
  });
  if (error) throw error;
}

export async function deleteCloudVersion(id: string): Promise<void> {
  const sb = await getSupabase();
  if (!sb) return;
  const { error } = await sb.from("tailored_resumes").delete().eq("id", id);
  if (error) throw error;
}

export async function deleteAllCloud(userId: string): Promise<void> {
  const sb = await getSupabase();
  if (!sb) return;
  await sb.from("tailored_resumes").delete().eq("user_id", userId);
  await sb.from("master_resumes").delete().eq("user_id", userId);
}

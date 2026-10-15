// Turns a master resume + job into a tailored resume.
// - applyAiResult(): merges AI output for the in-app template. Rewrites REPLACE text, never add:
//   same bullets, about the same length, every number kept (see acceptRewrite).
// - applyFileChanges() / updateFileChange(): tailored versions of an uploaded PDF/Word file.
// - offlineTailor(): the no-AI engine. Reorders, never writes or removes text.

import { aliasesFor, containsTerm, extractKeywords, guessJob, type Keyword } from "./keywords";
import { clone, resumeText, splitList, type FileChange, type Resume } from "./schema";

export type Engine = "gemini" | "groq" | "offline";

export interface ProjectIdea {
  title: string;
  stack: string[];
  pitch: string;
}

export interface Insights {
  job: { title: string; company: string };
  keywords: Keyword[];
  project_ideas: ProjectIdea[];
  advice: string[];
  removed: string[]; // skills the truth check removed
  engine: Engine;
  model?: string;
}

export interface TailorOptions {
  bullets_per_role: number;
  bullets_per_project: number;
  max_words_per_bullet: number;
  one_page: boolean;
  tone: "balanced" | "technical" | "leadership" | "concise";
  instructions: string;
}

export const DEFAULT_OPTIONS: TailorOptions = {
  bullets_per_role: 3,
  bullets_per_project: 2,
  max_words_per_bullet: 30,
  one_page: true,
  tone: "balanced",
  instructions: "",
};

/** Shape returned by /api/tailor (see backend/schemas.py TailorOutput). */
export interface AiTailorOutput {
  job: { title: string; company: string };
  summary: string;
  skills: { category: string; items: string[] }[];
  experience: { id: string; bullets: string[] }[];
  projects: { id: string; stack: string[]; bullets: string[] }[];
  project_order: string[];
  keywords: Keyword[];
  project_ideas: ProjectIdea[];
  advice: string[];
}

const STOP = new Set(
  "and or the of for in on with to a an & using via based tools tool skills systems system development".split(" "),
);

/** A skill is believable if the resume mentions it, or mentions at least one of its meaningful words. */
export function isSupported(skill: string, sourceText: string): boolean {
  if (containsTerm(sourceText, skill)) return true;
  const words = skill
    .replace(/[()/,]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 1 && !STOP.has(w.toLowerCase()));
  return words.some((w) => containsTerm(sourceText, w));
}

function relevance(text: string, keywords: Keyword[]): number {
  let score = 0;
  for (const k of keywords) {
    if (aliasesFor(k.term).length && containsTerm(text, k.term)) score += k.importance === "must" ? 2 : 1;
  }
  return score;
}

function orderBy<T>(list: T[], score: (item: T) => number): T[] {
  return list
    .map((item, i) => ({ item, i, s: score(item) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.item);
}

// ------------------------------------------------------------------ honesty + size checks

const NUMBER = /\d+(?:[.,]\d+)*/g;
const numbers = (text: string) => new Set((text.match(NUMBER) ?? []).map((n) => n.replace(/,/g, "")));

/**
 * Tailoring replaces text, it never adds to it. A rewrite is accepted only when it keeps every
 * number of the original, adds no number that isn't somewhere in the resume, and stays about the
 * same length. Otherwise the original line is kept.
 */
export function acceptRewrite(old: string, next: string | undefined, wholeResume: string): { text: string; ok: boolean } {
  const candidate = (next ?? "").trim().replace(/^[-•*]\s+/, "");
  if (!old.trim() || !candidate || candidate === old.trim()) return { text: old, ok: true };
  const after = numbers(candidate);
  for (const n of numbers(old)) if (!after.has(n)) return { text: old, ok: false };
  const known = numbers(wholeResume);
  for (const n of after) if (!known.has(n)) return { text: old, ok: false };
  if (candidate.length > old.length * 1.15 + 4 || candidate.length < old.length * 0.75) return { text: old, ok: false };
  return { text: candidate, ok: true };
}

export function applyAiResult(master: Resume, ai: AiTailorOutput, engine: Engine, model?: string): {
  resume: Resume;
  insights: Insights;
} {
  const out = clone(master);
  const source = resumeText(master);
  const removed: string[] = [];
  let refused = 0;
  const take = (old: string, next: string | undefined) => {
    const r = acceptRewrite(old, next, source);
    if (!r.ok) refused++;
    return r.text;
  };
  // Same bullets, same order: bullet 1 replaces bullet 1. A missing rewrite keeps the original.
  const rewriteAll = (olds: string[], news: string[] | undefined) => olds.map((o, i) => take(o, news?.[i]));

  out.summary = take(master.summary, ai.summary);

  // Same skill groups with the same names; each keeps about its original number of items.
  if (ai.skills?.length) {
    const byName = new Map(ai.skills.map((g) => [g.category.trim().toLowerCase(), g]));
    out.skills = master.skills.map((g, gi) => {
      const match = byName.get(g.category.trim().toLowerCase()) ?? ai.skills[gi];
      if (!match) return g;
      const items = match.items.map((x) => x.trim()).filter(Boolean);
      const kept = items.filter((x) => {
        const ok = isSupported(x, source);
        if (!ok) removed.push(x);
        return ok;
      });
      const capped = kept.slice(0, Math.max(g.items.length, 1));
      return capped.length >= Math.max(1, Math.ceil(g.items.length * 0.7)) ? { ...g, items: capped } : g;
    });
  }

  const expById = new Map(ai.experience?.map((e) => [e.id, e]) ?? []);
  out.experience = out.experience.map((e) => ({ ...e, bullets: rewriteAll(e.bullets, expById.get(e.id)?.bullets) }));

  const projById = new Map(ai.projects?.map((p) => [p.id, p]) ?? []);
  out.projects = out.projects.map((p) => {
    const t = projById.get(p.id);
    if (!t) return p;
    // The stack may be reordered for the job, but keeps exactly the same tools.
    const stack = t.stack.map((x) => x.trim()).filter((x) => p.stack.some((y) => y.toLowerCase() === x.toLowerCase()));
    return { ...p, bullets: rewriteAll(p.bullets, t.bullets), stack: stack.length === p.stack.length ? stack : p.stack };
  });
  if (ai.project_order?.length) {
    const rank = new Map(ai.project_order.map((id, i) => [id, i]));
    out.projects = orderBy(out.projects, (p) => -(rank.get(p.id) ?? 999));
  }

  const advice = (ai.advice ?? []).slice(0, 3);
  if (refused) {
    advice.push(
      refused === 1
        ? "1 AI rewrite was longer than the original or changed a number, so the original line was kept."
        : `${refused} AI rewrites were longer than the original or changed a number, so the original lines were kept.`,
    );
  }

  return {
    resume: out,
    insights: {
      job: ai.job ?? { title: "", company: "" },
      keywords: ai.keywords ?? [],
      project_ideas: (ai.project_ideas ?? []).slice(0, 3),
      advice,
      removed: [...new Set(removed)],
      engine,
      model,
    },
  };
}

// ------------------------------------------------------------------ uploaded files

/** What /api/file/tailor returns (see backend/app.py). */
export interface FileTailorResult {
  job: { title: string; company: string };
  keywords: Keyword[];
  project_ideas: ProjectIdea[];
  advice: string[];
  edits: { id: string; text: string }[];
  results: FileChange[];
  file_base64: string;
}

const wordSet = (t: string) => new Set(t.toLowerCase().match(/[a-z0-9+#]{3,}/g) ?? []);

function similarity(a: string, b: string): number {
  const A = wordSet(a);
  const B = wordSet(b);
  if (!A.size || !B.size) return 0;
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  return both / (A.size + B.size - both);
}

/**
 * Mirrors one file change into the structured resume (used for the match score and the template
 * view). The matching line is found by word overlap with the change's old or new text.
 */
function mirrorChange(r: Resume, change: FileChange, on: boolean): void {
  const target = on ? change.new : change.old;
  type Slot = { get: () => string; set: (t: string) => void };
  const slots: Slot[] = [{ get: () => r.summary, set: (t) => (r.summary = t) }];
  const addList = (list: string[]) => list.forEach((_, i) => slots.push({ get: () => list[i], set: (t) => (list[i] = t) }));
  r.experience.forEach((e) => addList(e.bullets));
  r.projects.forEach((p) => addList(p.bullets));
  r.custom_sections.forEach((s) => s.items.forEach((i) => addList(i.bullets)));
  r.skills.forEach((g) => slots.push({ get: () => g.items.join(", "), set: (t) => (g.items = splitList(t)) }));
  let best: Slot | null = null;
  let score = 0;
  for (const slot of slots) {
    const s = Math.max(similarity(slot.get(), change.old), similarity(slot.get(), change.new));
    if (s > score) {
      score = s;
      best = slot;
    }
  }
  if (best && score >= 0.45) best.set(target);
}

/** A tailored version of an uploaded file: the original file plus the list of changes. */
export function applyFileChanges(master: Resume, results: FileChange[]): Resume {
  const out = clone(master);
  out.file_changes = results.filter((c) => c.status !== "unchanged" && c.status !== "not_allowed");
  for (const c of out.file_changes) if (c.status === "applied") mirrorChange(out, c, true);
  return out;
}

/** Turns one change on or off, or replaces its text, keeping the structured resume in step. */
export function updateFileChange(r: Resume, id: string, patch: Partial<FileChange>): Resume {
  const out = clone(r);
  const change = out.file_changes?.find((c) => c.id === id);
  if (!change) return r;
  const before = { ...change };
  Object.assign(change, patch);
  if (!change.off) delete change.off;
  if (before.status === "applied" && !before.off) mirrorChange(out, before, false);
  if (change.status === "applied" && !change.off) mirrorChange(out, change, true);
  return out;
}

// ------------------------------------------------------------------ offline engine

/** The no-AI engine: put the most relevant content first. Never rewrites or removes anything. */
export function offlineTailor(master: Resume, jd: string, _options: TailorOptions = DEFAULT_OPTIONS): {
  resume: Resume;
  insights: Insights;
} {
  const keywords = extractKeywords(jd);
  const out = clone(master);

  out.skills = orderBy(
    out.skills.map((g) => ({ ...g, items: orderBy(g.items, (s) => relevance(s, keywords)) })),
    (g) => relevance(g.items.join(", ") + " " + g.category, keywords),
  );

  out.experience = out.experience.map((e) => ({
    ...e,
    bullets: orderBy(e.bullets, (b) => relevance(b, keywords)),
  }));

  out.projects = orderBy(
    out.projects.map((p) => ({
      ...p,
      stack: orderBy(p.stack, (s) => relevance(s, keywords)),
      bullets: orderBy(p.bullets, (b) => relevance(b, keywords)),
    })),
    (p) => relevance([p.name, ...p.stack, ...p.bullets].join(" "), keywords),
  );

  const missingMust = keywords.filter((k) => k.importance === "must" && !k.soft && !containsTerm(resumeText(out), k.term));
  const advice = [
    "Quick version: your content was reordered so the most relevant parts come first. No text was rewritten.",
  ];
  if (missingMust.length) {
    advice.push(
      `The job asks for ${missingMust
        .slice(0, 3)
        .map((k) => k.term)
        .join(", ")}. If you have used ${missingMust.length > 1 ? "them" : "it"}, add a bullet that shows it.`,
    );
  }

  return {
    resume: out,
    insights: { job: guessJob(jd), keywords, project_ideas: [], advice, removed: [], engine: "offline" },
  };
}

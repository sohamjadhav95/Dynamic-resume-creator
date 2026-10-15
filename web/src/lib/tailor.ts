// Turns a master resume + job into a tailored resume.
// - applyAiResult(): merges AI output for the in-app template. Rewrites REPLACE text, never add:
//   same bullets, about the same length, every number kept (see acceptRewrite).
// - offlineTailor(): the no-AI engine. Reorders, never writes or removes text.

import { aliasesFor, containsTerm, extractKeywords, guessJob, type Keyword } from "./keywords";
import { clone, resumeText, type Resume } from "./schema";

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
  removed: string[]; // skills the AI made up (not in the resume, not in the job post): dropped
  added?: string[]; // skills taken from the job post: shown so the person can remove any they haven't used
  kept?: { old: string; suggested: string; reason: string }[]; // AI rewrites refused by the checks
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
export function acceptRewrite(
  old: string,
  next: string | undefined,
  wholeResume: string,
  allowedNames?: string, // names (tools, places) the rewrite may use; default: the whole resume
): { text: string; ok: boolean; reason?: string } {
  const candidate = (next ?? "").trim().replace(/^[-•*]\s+/, "");
  if (!old.trim() || !candidate || candidate === old.trim()) return { text: old, ok: true };
  const after = numbers(candidate);
  const dropped = [...numbers(old)].filter((n) => !after.has(n));
  if (dropped.length) return { text: old, ok: false, reason: `dropped ${dropped.join(", ")}` };
  const known = numbers(wholeResume);
  const invented = [...after].filter((n) => !known.has(n));
  if (invented.length) return { text: old, ok: false, reason: `added ${invented.join(", ")}, which is not in your resume` };
  if (candidate.length > old.length * 1.15 + 4) return { text: old, ok: false, reason: "longer than the original" };
  if (candidate.length < old.length * 0.75) return { text: old, ok: false, reason: "much shorter than the original" };
  const names = newNames(old, candidate, allowedNames ?? wholeResume);
  if (names.length) return { text: old, ok: false, reason: `mentions ${names.join(", ")}, not shown here in your resume` };
  return { text: candidate, ok: true };
}

const wordsOf = (text: string) => {
  const out = new Set<string>();
  for (const raw of text.replace(/(\w)- (\w)/g, "$1-$2").match(/[A-Za-z0-9][A-Za-z0-9+#.-]*/g) ?? []) {
    const w = raw.toLowerCase().replace(/[.-]+$/, "");
    out.add(w);
    for (const part of w.split(/[/-]/)) if (part) out.add(part);
  }
  return out;
};

/**
 * Names in `next` (tools, products, places: "PyTorch", "MRI", "C++", or a capitalised word in the
 * middle of a sentence) that appear neither in `old` nor in `allowed`. Used so a rewrite cannot
 * claim experience the resume doesn't show.
 */
export function newNames(old: string, next: string, allowed: string): string[] {
  const known = wordsOf(old + " " + allowed);
  const found: string[] = [];
  let sentenceStart = true;
  for (const raw of next.split(/\s+/)) {
    const token = raw.replace(/^[(["']+|[)\]"',;:.!?]+$/g, "").replace(/^[-/]+|[-/]+$/g, "");
    const startsHere = sentenceStart;
    sentenceStart = /[.;:!?]$/.test(raw);
    if (token.length < 2 || !/^[A-Za-z]/.test(token)) continue;
    const term = /[A-Z]/.test(token.slice(1)) || /[A-Za-z][+#./][A-Za-z+]|\+\+|#$/.test(token);
    const named = /^[A-Z]/.test(token) && !startsHere;
    if (!term && !named) continue;
    const parts = token.split(/[/-]/).filter(Boolean);
    if (known.has(token.toLowerCase()) || parts.every((x) => known.has(x.toLowerCase()))) continue;
    if (!found.includes(token)) found.push(token);
  }
  return found;
}

export function applyAiResult(master: Resume, ai: AiTailorOutput, engine: Engine, model?: string, jd = ""): {
  resume: Resume;
  insights: Insights;
} {
  const out = clone(master);
  const source = resumeText(master);
  const removed: string[] = [];
  const added: string[] = [];
  let refused = 0;
  const kept: { old: string; suggested: string; reason: string }[] = [];
  const take = (old: string, next: string | undefined, allowedNames?: string) => {
    const r = acceptRewrite(old, next, source, allowedNames);
    if (!r.ok) {
      refused++;
      kept.push({ old, suggested: (next ?? "").trim(), reason: r.reason ?? "" });
    }
    return r.text;
  };
  // Same bullets, same order: bullet 1 replaces bullet 1. A missing rewrite keeps the original.
  // A bullet may only name tools from its own job or project (its title, stack and other bullets).
  const rewriteAll = (olds: string[], news: string[] | undefined, own: string) =>
    olds.map((o, i) => take(o, news?.[i], own + " " + olds.join(" ")));

  out.summary = take(master.summary, ai.summary);

  // Skills: same number of lines. The job's keywords may replace less relevant skills and a line's
  // category may be renamed for the role (like the original app). Each line keeps about its length,
  // so the page does not grow. Skills from the job post are listed so the person can check them.
  if (ai.skills?.length) {
    out.skills = master.skills.map((g, gi) => {
      const match = ai.skills[gi];
      if (!match) return g;
      const items = match.items.map((x) => x.trim()).filter(Boolean);
      const accepted = items.filter((x) => {
        if (isSupported(x, source)) return true;
        if (jd && containsTerm(jd, x)) {
          added.push(x);
          return true;
        }
        removed.push(x); // neither in the resume nor in the job post: made up
        return false;
      });
      // Keep the line about as long as before: drop the least relevant skills (not in the job post)
      // from the end first, so the job's keywords survive.
      const budget = g.items.join(", ").length * 1.1 + 6;
      const capped = accepted.slice(0, g.items.length + 2);
      while (capped.length > 1 && capped.join(", ").length > budget) {
        let drop = -1;
        for (let k = capped.length - 1; k >= 0; k--) {
          if (!(jd && containsTerm(jd, capped[k]))) {
            drop = k;
            break;
          }
        }
        capped.splice(drop === -1 ? capped.length - 1 : drop, 1);
      }
      const category = match.category.trim();
      return capped.length >= Math.max(1, Math.ceil(g.items.length * 0.7))
        ? { ...g, category: category && category.length <= 40 ? category : g.category, items: capped }
        : g;
    });
  }

  const expById = new Map(ai.experience?.map((e) => [e.id, e]) ?? []);
  out.experience = out.experience.map((e) => ({
    ...e,
    bullets: rewriteAll(e.bullets, expById.get(e.id)?.bullets, `${e.role} ${e.company}`),
  }));

  const projById = new Map(ai.projects?.map((p) => [p.id, p]) ?? []);
  out.projects = out.projects.map((p) => {
    const t = projById.get(p.id);
    if (!t) return p;
    // The stack may be reordered for the job, but keeps exactly the same tools.
    const stack = t.stack.map((x) => x.trim()).filter((x) => p.stack.some((y) => y.toLowerCase() === x.toLowerCase()));
    return {
      ...p,
      bullets: rewriteAll(p.bullets, t.bullets, `${p.name} ${p.stack.join(", ")}`),
      stack: stack.length === p.stack.length ? stack : p.stack,
    };
  });
  if (ai.project_order?.length) {
    const rank = new Map(ai.project_order.map((id, i) => [id, i]));
    out.projects = orderBy(out.projects, (p) => -(rank.get(p.id) ?? 999));
  }

  const advice = (ai.advice ?? []).slice(0, 3);

  return {
    resume: out,
    insights: {
      job: ai.job ?? { title: "", company: "" },
      keywords: ai.keywords ?? [],
      project_ideas: (ai.project_ideas ?? []).slice(0, 3),
      advice,
      removed: [...new Set(removed)],
      added: [...new Set(added)].filter((x) => resumeText(out).includes(x)),
      kept,
      engine,
      model,
    },
  };
}

// ------------------------------------------------------------------ second try for refused lines

type Rewriter = (input: {
  text: string;
  mode: "retry";
  keyword: string;
  context: string;
  job_description: string;
}) => Promise<string[]>;

/** Where a line lives, and which names it may use (bullets: only its own job or project). */
function locate(r: Resume, line: string): { set: (t: string) => void; context: string; allowed: string } | null {
  if (r.summary === line) return { set: (t) => (r.summary = t), context: "professional summary", allowed: resumeText(r) };
  for (const e of r.experience) {
    const i = e.bullets.indexOf(line);
    if (i >= 0)
      return {
        set: (t) => (e.bullets[i] = t),
        context: `${e.role} at ${e.company}`,
        allowed: `${e.role} ${e.company} ${e.bullets.join(" ")}`,
      };
  }
  for (const p of r.projects) {
    const i = p.bullets.indexOf(line);
    if (i >= 0)
      return {
        set: (t) => (p.bullets[i] = t),
        context: `project ${p.name} (${p.stack.join(", ")})`,
        allowed: `${p.name} ${p.stack.join(" ")} ${p.bullets.join(" ")}`,
      };
  }
  return null;
}

/**
 * Lines the checks refused get one more AI try, told exactly why. The first suggestion that passes
 * every check is used; otherwise the original stays. Runs in parallel, a few seconds in total.
 */
export async function retryRefused(
  outcome: { resume: Resume; insights: Insights },
  master: Resume,
  jd: string,
  rewrite: Rewriter,
): Promise<{ resume: Resume; insights: Insights }> {
  const kept = outcome.insights.kept ?? [];
  if (!kept.length) return outcome;
  const resume = clone(outcome.resume);
  const source = resumeText(master);
  const still: typeof kept = [];
  await Promise.all(
    kept.slice(0, 6).map(async (k) => {
      const where = locate(resume, k.old);
      if (!where) return still.push(k);
      try {
        const options = await rewrite({ text: k.old, mode: "retry", keyword: k.reason, context: where.context, job_description: jd });
        for (const option of options) {
          const r = acceptRewrite(k.old, option, source, where.allowed);
          if (r.ok && r.text !== k.old) {
            where.set(r.text);
            return;
          }
        }
      } catch {
        /* AI busy: keep the original line */
      }
      still.push(k);
    }),
  );
  return { resume, insights: { ...outcome.insights, kept: [...still, ...kept.slice(6)] } };
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

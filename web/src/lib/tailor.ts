// Turns a master resume + job into a tailored resume.
// - applyAiResult(): merges AI output safely (only known ids, a "truth check" on skills).
// - offlineTailor(): the no-AI engine. Reorders and trims, never writes new text.

import { aliasesFor, containsTerm, extractKeywords, guessJob, type Keyword } from "./keywords";
import { clone, resumeText, uid, type Resume } from "./schema";

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

export function applyAiResult(master: Resume, ai: AiTailorOutput, engine: Engine, model?: string): {
  resume: Resume;
  insights: Insights;
} {
  const out = clone(master);
  const source = resumeText(master);
  const removed: string[] = [];

  if (ai.summary?.trim()) out.summary = ai.summary.trim();

  if (ai.skills?.length) {
    const groups = ai.skills
      .map((g, gi) => {
        const items = g.items.map((s) => s.trim()).filter(Boolean);
        const kept = items.filter((s) => {
          const ok = isSupported(s, source);
          if (!ok) removed.push(s);
          return ok;
        });
        const originalCap = master.skills[gi]?.items?.length ?? items.length;
        return { id: uid("sk"), category: g.category.trim(), items: kept.slice(0, Math.max(originalCap, 1)) };
      })
      .filter((g) => g.category && g.items.length);
    if (groups.length) out.skills = groups;
  }

  const expById = new Map(ai.experience?.map((e) => [e.id, e]) ?? []);
  out.experience = out.experience.map((e) => {
    const t = expById.get(e.id);
    let bullets = t?.bullets.map((b) => b.trim()).filter(Boolean);
    if (bullets?.length && e.bullets?.length) {
      bullets = bullets.slice(0, e.bullets.length);
    }
    return bullets?.length ? { ...e, bullets } : e;
  });

  const projById = new Map(ai.projects?.map((p) => [p.id, p]) ?? []);
  out.projects = out.projects.map((p) => {
    const t = projById.get(p.id);
    if (!t) return p;
    let bullets = t.bullets.map((b) => b.trim()).filter(Boolean);
    if (bullets?.length && p.bullets?.length) {
      bullets = bullets.slice(0, p.bullets.length);
    }
    const stack = t.stack.map((s) => s.trim()).filter((s) => s && isSupported(s, source));
    return { ...p, bullets: bullets.length ? bullets : p.bullets, stack: stack.length ? stack : p.stack };
  });
  if (ai.project_order?.length) {
    const rank = new Map(ai.project_order.map((id, i) => [id, i]));
    out.projects = orderBy(out.projects, (p) => -(rank.get(p.id) ?? 999));
  }

  return {
    resume: out,
    insights: {
      job: ai.job ?? { title: "", company: "" },
      keywords: ai.keywords ?? [],
      project_ideas: (ai.project_ideas ?? []).slice(0, 3),
      advice: (ai.advice ?? []).slice(0, 3),
      removed: [...new Set(removed)],
      engine,
      model,
    },
  };
}

/** The no-AI engine: put the most relevant content first and trim to the requested length. */
export function offlineTailor(master: Resume, jd: string, options: TailorOptions = DEFAULT_OPTIONS): {
  resume: Resume;
  insights: Insights;
} {
  const keywords = extractKeywords(jd);
  const out = clone(master);
  const hidden = new Set(out.layout.hidden);

  out.skills = orderBy(
    out.skills.map((g) => ({ ...g, items: orderBy(g.items, (s) => relevance(s, keywords)) })),
    (g) => relevance(g.items.join(", ") + " " + g.category, keywords),
  );

  out.experience = out.experience.map((e) => ({
    ...e,
    bullets: orderBy(e.bullets, (b) => relevance(b, keywords)).slice(0, Math.max(options.bullets_per_role, 1)),
  }));

  out.projects = orderBy(
    out.projects.map((p) => ({
      ...p,
      stack: orderBy(p.stack, (s) => relevance(s, keywords)),
      bullets: orderBy(p.bullets, (b) => relevance(b, keywords)).slice(0, Math.max(options.bullets_per_project, 1)),
    })),
    (p) => relevance([p.name, ...p.stack, ...p.bullets].join(" "), keywords),
  );

  // With 4+ projects, hide the ones that have nothing to do with this job (you can show them again).
  const visibleProjects = out.projects.filter((p) => !hidden.has(p.id));
  if (options.one_page && visibleProjects.length > 3) {
    for (const p of visibleProjects.slice(3)) {
      if (relevance([p.name, ...p.stack, ...p.bullets].join(" "), keywords) === 0) out.layout.hidden.push(p.id);
    }
  }

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

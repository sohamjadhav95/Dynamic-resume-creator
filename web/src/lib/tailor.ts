// Turns a master resume + job into a tailored resume.
// - applyAiResult(): merges AI output for the in-app template. Rewrites REPLACE text, never add:
//   same bullets, about the same length, every number kept (see acceptRewrite).
// - offlineTailor(): the no-AI engine. Reorders, never writes or removes text.

import EVERYDAY_TEXT from "../data/common-words.txt?raw";
import { CASE_SENSITIVE, SKILL_ENTRIES, SOFT_SKILLS } from "../data/skills";
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
  tone: "balanced" | "technical" | "leadership" | "concise";
  instructions: string;
}

export const DEFAULT_OPTIONS: TailorOptions = {
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
  other_sections?: { id: string; bullets: string[] }[]; // items of the other sections, by item id
  project_order: string[];
  keywords: Keyword[];
  project_ideas: ProjectIdea[];
  advice: string[];
}

const STOP = new Set(
  "and or the of for in on with to a an & using via based tools tool skills systems system development".split(" "),
);

/**
 * A skill is believable if the resume mentions it, or every one of its meaningful words. One shared word
 * is not enough: "monitoring" in the resume doesn't make "Hemodynamic monitoring" true.
 */
export function isSupported(skill: string, sourceText: string): boolean {
  if (containsTerm(sourceText, skill)) return true;
  const words = skill
    .replace(/[()/,]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 1 && !STOP.has(w.toLowerCase()));
  const known = new Set([...wordsOf(sourceText)].map(stem));
  return words.length > 0 && words.every((w) => containsTerm(sourceText, w) || known.has(stem(w.toLowerCase())));
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
const LETTER = /[A-Za-z]/;
// A digit between letters ("B2B", "P2P", "W3C") is part of a name, not a number.
const numbers = (text: string) =>
  new Set(
    [...text.matchAll(NUMBER)]
      .filter((m) => !(LETTER.test(text[m.index - 1] ?? "") && LETTER.test(text[m.index + m[0].length] ?? "")))
      .map((m) => m[0].replace(/,/g, "")),
  );

/** The longest a rewrite may be on the app's page: a short line may grow to the end of its last line
 * (about 110 characters a line), a long one by 15%. */
const maxLength = (old: number) => Math.max(old * 1.15 + 4, Math.min(old * 1.3, Math.ceil(old / 110) * 110));

// Words that make a line read as AI-written. Refused unless the person's own resume already uses them
// ("end-to-end" also when the job post does).
const AI_WORDS =
  /\b(leverag\w*|spearhead\w*|orchestrat\w*|synerg\w*|cutting-edge|state-of-the-art|robust\w*|seamless\w*|utili[sz]\w*|facilitat\w*|passionate\w*|dynamic|innovative|results-driven|best-in-class|world-class|holistic\w*|paradigm\w*|empower\w*|streamlin\w*|revolutioni[sz]\w*|meticulous\w*|adept|proficient\w*|delv\w*|foster\w*|pivotal|showcas\w*|transformative|harness\w*|bolster\w*|architected|end-to-end|game-chang\w*|unparalleled|groundbreaking)\b/gi;

export function aiWords(next: string, mine: string): string[] {
  const own = mine.toLowerCase();
  const out: string[] = [];
  for (const [w] of next.matchAll(AI_WORDS)) {
    const key = w.toLowerCase();
    if (!own.includes(key.slice(0, 6)) && !out.includes(key)) out.push(key);
  }
  return out;
}

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
  jd = "", // the job post: its words may not be put into a line unless the resume uses them too
  room?: [number, number], // uploaded PDF: the characters this line's space holds
): { text: string; ok: boolean; reason?: string } {
  let candidate = (next ?? "").trim().replace(/^[-•*]\s+/, "");
  // A long dash is a typical AI habit; the person's own resume decides whether it uses one.
  if (!old.includes("—")) candidate = candidate.replace(/\s*—\s*/g, ", ");
  if (!old.trim() || !candidate || candidate === old.trim()) return { text: old, ok: true };
  const after = numbers(candidate);
  const dropped = [...numbers(old)].filter((n) => !after.has(n));
  if (dropped.length) return { text: old, ok: false, reason: `dropped ${dropped.join(", ")}` };
  const known = numbers(wholeResume);
  const invented = [...after].filter((n) => !known.has(n));
  if (invented.length) return { text: old, ok: false, reason: `added ${invented.join(", ")}, which is not in your resume` };
  const lost = numberLabels(old).filter((w) => !wordsOf(candidate).has(w.toLowerCase()));
  if (lost.length) return { text: old, ok: false, reason: `dropped "${lost.join('", "')}" next to a number` };
  // Every other problem is listed (so a second try can fix them all), each read as "the AI's version ...".
  const problems: string[] = [];
  if (room && (candidate.length > room[1] + 2 || candidate.length < room[0] - 2))
    problems.push(`doesn't fill its space on your PDF (it needs ${room[0]}-${room[1]} characters, it had ${candidate.length})`);
  if (!room && candidate.length > maxLength(old.length)) problems.push("is longer than the original");
  if (candidate.length < old.length * 0.65) problems.push("is much shorter than the original");
  const allowed = allowedNames ?? wholeResume;
  const implied = impliedNames(`${old} ${allowed}`);
  const names = newNames(old, candidate, `${allowed} ${implied}`);
  if (names.length) problems.push(`mentions ${names.join(", ")}, not shown here in your resume`);
  const borrowed = jobOnlyWords(candidate, wholeResume, jd).filter((w) => !names.some((n) => n.toLowerCase() === w));
  if (borrowed.length) problems.push(`uses "${borrowed.join('", "')}" from the job post, but your resume never mentions it`);
  const kept = keyTerms(candidate);
  const terms = keyTerms(old);
  const gone = [...terms].filter(([k]) => !kept.has(k)).map(([, w]) => w);
  if (terms.size >= 3 && gone.length * 2 > terms.size) problems.push(`drops what the line is about ("${gone.join('", "')}")`);
  const padding = newWords(candidate, `${wholeResume} ${implied} ${jd}`);
  if (padding.length) problems.push(`adds words found nowhere in your resume (${padding.join(", ")})`);
  const fancy = aiWords(candidate, `${wholeResume} ${/end-to-end/i.test(jd) ? "end-to-end" : ""}`);
  if (fancy.length) problems.push(`uses "${fancy.join('", "')}", which sounds AI-written`);
  return problems.length ? { text: old, ok: false, reason: problems.join(" and ") } : { text: candidate, ok: true };
}

/** What a line is about: its names ("LLM", "Kafka") and specialist words ("multimodal", "inference"), by stem. */
function keyTerms(text: string): Map<string, string> {
  const out = new Map(newNames("", text, "").map((n) => [stem(n.toLowerCase()), n]));
  for (const w of wordsOf(text)) {
    if (w.length >= 5 && !/\d/.test(w) && !w.includes("-") && !w.includes("/") && !everyday(w) && !out.has(stem(w))) out.set(stem(w), w);
  }
  return out;
}

/** Uncommon words in a rewrite that appear neither in the resume nor in the job post: new claims. */
function newWords(next: string, known: string): string[] {
  const seen = new Set([...wordsOf(known)].map(stem));
  return [...wordsOf(next)].filter(
    (w) => w.length >= 5 && !/\d/.test(w) && !w.includes("-") && !w.includes("/") && !everyday(w) && !seen.has(stem(w)),
  );
}

// Tools that come with another tool: a bullet about FastAPI may say Python, one about React may say UI.
const IMPLIES: [RegExp, string][] = [
  [/\b(fastapi|flask|django|pandas|numpy|scikit-learn|pytorch|tensorflow|keras|jupyter|pyspark|matplotlib|airflow)\b/i, "Python"],
  [/\b(react|vue|angular|node\.?js|express|next\.js|jquery|typescript)\b/i, "JavaScript JS"],
  [/\b(spring boot|hibernate)\b/i, "Java"],
  [/\b(rails)\b/i, "Ruby"],
  [/\b(laravel)\b/i, "PHP"],
  [/\b(fastapi|flask|django|express|endpoints?|spring boot)\b/i, "API APIs REST"],
  [/\b(react|vue|angular|html|css|tailwind|figma)\b/i, "UI"],
  [/\b(dbt|postgresql|postgres|mysql|sqlite|snowflake|bigquery|redshift)\b/i, "SQL"],
  [/\b(ec2|s3|lambda|dynamodb|cloudwatch)\b/i, "AWS"],
  [/\b(tableau|power bi|looker)\b/i, "BI"],
  [/\b(pytorch|tensorflow|keras|scikit-learn)\b/i, "ML"],
  [/\b(epic|cerner|meditech)\b/i, "EHR EMR"],
];

/** Names implied by the tools a text mentions. */
export function impliedNames(text: string): string {
  return IMPLIES.filter(([re]) => re.test(text))
    .map(([, names]) => names)
    .join(" ");
}

// Everyday English (wordfreq Zipf frequency 3.5 or more, 5+ letters, stored stemmed). Such a word in a
// rewrite ("growth", "leaders", "streaming") claims nothing; a rare job-post word ("vasoactive") does.
const EVERYDAY = new Set(EVERYDAY_TEXT.split(/\s+/).filter(Boolean));
// Skill names from the dictionary ("agile", "kubernetes"): a claim even when they are everyday words.
const SKILL_WORDS = new Set(
  SKILL_ENTRIES.flatMap((line) => {
    const [canonical, ...aliases] = line.split("|");
    if (SOFT_SKILLS.has(canonical)) return [];
    return [canonical, ...aliases].filter((a) => !/\s/.test(a) && !CASE_SENSITIVE.has(a)).map((a) => a.toLowerCase());
  }),
);
const everyday = (w: string) => COMMON.has(w) || (EVERYDAY.has(stem(w)) && !SKILL_WORDS.has(w));

// Words any resume and job post share; using them claims nothing new.
const COMMON = new Set(
  (
    "about above across after again along among around because before below between could during either every first " +
    "further other their there these thing those though through under until using where which while within without " +
    "would years daily weekly monthly clear strong simple quickly closely better faster higher lower smaller larger " +
    "build built building create created design designed develop developed deliver delivered drive drove ensure " +
    "improve improved increase increased reduce reduced launch launched manage managed maintain maintained partner " +
    "partnered support supported working worked collaborate collaborated coordinate coordinated owned mentor mentored " +
    "shipped wrote helped skills experience including include"
  ).split(" "),
);
const stem = (w: string) => w.replace(/(ations|ation|ating|ated|ates|ate|ments|ment|ings|ing|edly|ers|ed|er|es|ly|e)$|(?<!s)s$/, "");

/**
 * Words in a rewrite that come from the job post and appear nowhere in the resume ("vasoactive",
 * "blameless"): the AI borrowing the job's words for work the person never described.
 */
export function jobOnlyWords(next: string, resume: string, jd: string): string[] {
  if (!jd.trim()) return [];
  const mine = new Set([...wordsOf(resume)].map(stem));
  const job = new Set([...wordsOf(jd)].map(stem));
  const out: string[] = [];
  for (const w of wordsOf(next)) {
    if (w.length < 5 || /\d/.test(w) || everyday(w) || w.includes("-") || w.includes("/")) continue;
    const s = stem(w);
    if (!mine.has(s) && job.has(s) && !out.includes(w)) out.push(w);
  }
  return out;
}

/** Names right after a number ("0.9416 Dice score", "25 Power BI dashboards"): what the number measures. */
function numberLabels(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\d[\d.,]*\s*[%xX+KMB]?\s+([A-Za-z][A-Za-z0-9-]*)/g)) if (/[A-Z]/.test(m[1])) out.push(m[1]);
  return out;
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

const MAX_ADDED_SKILLS = 4;

/** Uploaded PDF: the characters each line's space holds ("summary" / "<item id>.<bullet index>" -> [min, max]). */
export type LineRoom = Record<string, [number, number]>;

export function applyAiResult(
  master: Resume,
  ai: AiTailorOutput,
  engine: Engine,
  model?: string,
  jd = "",
  room: LineRoom = {},
): {
  resume: Resume;
  insights: Insights;
} {
  const out = clone(master);
  const source = resumeText(master);
  const removed: string[] = [];
  const added: string[] = [];
  const kept: { old: string; suggested: string; reason: string }[] = [];
  const take = (old: string, next: string | undefined, key: string, allowedNames?: string) => {
    const r = acceptRewrite(old, next, source, allowedNames, jd, room[key]);
    if (!r.ok) {
      kept.push({ old, suggested: (next ?? "").trim(), reason: r.reason ?? "" });
    }
    return r.text;
  };
  // Same bullets, same order: bullet 1 replaces bullet 1. A missing rewrite keeps the original.
  // A bullet may only name tools from its own job or project (its title, stack and other bullets).
  const rewriteAll = (id: string, olds: string[], news: string[] | undefined, own: string) =>
    olds.map((o, i) => take(o, news?.[i], `${id}.${i}`, own + " " + olds.join(" ")));

  out.summary = take(master.summary, ai.summary, "summary");

  // Skills: same number of lines. The job's keywords may replace less relevant skills and a line's
  // category may be renamed for the role (like the original app). Each line keeps about its length,
  // so the page does not grow. Skills from the job post are listed so the person can check them.
  if (ai.skills?.length === master.skills.length) {
    out.skills = master.skills.map((g, gi) => {
      const match = ai.skills[gi];
      if (!match) return g;
      const items = match.items.map((x) => x.trim()).filter(Boolean);
      const accepted = items.filter((x) => {
        if (isSupported(x, source)) return true;
        if (jd && containsTerm(jd, x)) {
          if (new Set(added).size >= MAX_ADDED_SKILLS) return false; // a few keywords, not a new profile
          added.push(x);
          return true;
        }
        removed.push(x); // neither in the resume nor in the job post: made up
        return false;
      });
      // Keep the line about as long as before (on an uploaded PDF: within its lines' room): drop the
      // least relevant skills (not in the job post) from the end first, so the job's keywords survive.
      const fit = room[`skills.${gi}`];
      const budget = fit ? fit[1] : g.items.join(", ").length * 1.1 + 6;
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
      // On a PDF a line must still reach its last line: top it up with the person's own skills it dropped.
      for (const x of fit ? g.items : []) {
        if (capped.join(", ").length >= fit![0]) break;
        if (!capped.some((y) => y.toLowerCase() === x.toLowerCase()) && [...capped, x].join(", ").length <= fit![1]) capped.push(x);
      }
      const category = match.category.trim();
      return capped.length >= Math.max(1, Math.ceil(g.items.length * 0.7))
        ? { ...g, category: category && category.length <= 40 ? category : g.category, items: capped }
        : g;
    });
    // A skill listed twice (moved to another line by the AI) stays only in its first line.
    const seen = new Set<string>();
    out.skills = out.skills.map((g) => {
      const items = g.items.filter((x) => !seen.has(x.toLowerCase()));
      for (const x of items) seen.add(x.toLowerCase());
      return items.length ? { ...g, items } : g;
    });
  }

  const expById = new Map(ai.experience?.map((e) => [e.id, e]) ?? []);
  out.experience = out.experience.map((e) => ({
    ...e,
    bullets: rewriteAll(e.id, e.bullets, expById.get(e.id)?.bullets, `${e.role} ${e.company}`),
  }));

  const projById = new Map(ai.projects?.map((p) => [p.id, p]) ?? []);
  out.projects = out.projects.map((p) => {
    const t = projById.get(p.id);
    if (!t) return p;
    // The stack may be reordered for the job, but keeps exactly the same tools.
    const stack = t.stack.map((x) => x.trim()).filter((x) => p.stack.some((y) => y.toLowerCase() === x.toLowerCase()));
    return {
      ...p,
      bullets: rewriteAll(p.id, p.bullets, t.bullets, `${p.name} ${p.stack.join(", ")}`),
      stack: stack.length === p.stack.length ? stack : p.stack,
    };
  });
  // Other sections (research, volunteering...): bullets rewritten like a job's, by item id.
  const otherById = new Map(ai.other_sections?.map((o) => [o.id, o]) ?? []);
  out.custom_sections = out.custom_sections.map((s) => ({
    ...s,
    items: s.items.map((it) => ({
      ...it,
      bullets: rewriteAll(it.id, it.bullets, otherById.get(it.id)?.bullets, `${s.title} ${it.title} ${it.subtitle}`),
    })),
  }));

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

type Where = { set: (t: string) => void; context: string; allowed: string; key: string };

/** Where a line lives, and which names it may use (bullets: only its own job, project or item). */
function locate(r: Resume, line: string): Where | null {
  if (r.summary === line) return { set: (t) => (r.summary = t), context: "professional summary", allowed: resumeText(r), key: "summary" };
  for (const e of r.experience) {
    const i = e.bullets.indexOf(line);
    if (i >= 0)
      return {
        set: (t) => (e.bullets[i] = t),
        context: `${e.role} at ${e.company}`,
        allowed: `${e.role} ${e.company} ${e.bullets.join(" ")}`,
        key: `${e.id}.${i}`,
      };
  }
  for (const p of r.projects) {
    const i = p.bullets.indexOf(line);
    if (i >= 0)
      return {
        set: (t) => (p.bullets[i] = t),
        context: `project ${p.name} (${p.stack.join(", ")})`,
        allowed: `${p.name} ${p.stack.join(" ")} ${p.bullets.join(" ")}`,
        key: `${p.id}.${i}`,
      };
  }
  for (const s of r.custom_sections) {
    for (const it of s.items) {
      const i = it.bullets.indexOf(line);
      if (i >= 0)
        return {
          set: (t) => (it.bullets[i] = t),
          context: `${s.title}: ${it.title}`,
          allowed: `${s.title} ${it.title} ${it.subtitle} ${it.bullets.join(" ")}`,
          key: `${it.id}.${i}`,
        };
    }
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
  room: LineRoom = {},
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
          const r = acceptRewrite(k.old, option, source, where.allowed, jd, room[where.key]);
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
export function offlineTailor(master: Resume, jd: string): {
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

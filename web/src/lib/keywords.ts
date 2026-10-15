// Offline keyword engine: finds what a job asks for and checks the resume for it.
// Runs in the browser — instant, free, and works even when every AI service is down.

import { CASE_SENSITIVE, SKILL_ENTRIES, SOFT_SKILLS } from "../data/skills";

export type Importance = "must" | "nice";

export interface Keyword {
  term: string;
  importance: Importance;
  count?: number;
  soft?: boolean;
}

export interface KeywordMatch extends Keyword {
  found: boolean;
}

interface Entry {
  canonical: string;
  aliases: string[];
}

const ENTRIES: Entry[] = SKILL_ENTRIES.map((line) => {
  const [canonical, ...rest] = line.split("|");
  return { canonical, aliases: [canonical, ...rest] };
});

const BY_ALIAS = new Map<string, Entry>();
for (const e of ENTRIES) for (const a of e.aliases) BY_ALIAS.set(a.toLowerCase(), e);

const WORD = "A-Za-z0-9+#";
const escapeRe = (s: string) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");

function aliasPattern(alias: string): string {
  const body = escapeRe(alias).replace(/\\ |\s+/g, "[\\s-]+");
  // Very short case-sensitive names (C, R, Go…) must not be part of "C-suite", "R&D", "Go-to-market".
  const strict = CASE_SENSITIVE.has(alias) && alias.length <= 2;
  const before = strict ? `(?<![${WORD}\\-'&./])` : `(?<![${WORD}])`;
  const after = strict ? `(?![${WORD}\\-'&]|\\.[a-z])` : `(?![${WORD}])`;
  return `${before}${body}${after}`;
}

const regexCache = new Map<string, RegExp>();
function aliasRegex(alias: string): RegExp {
  let re = regexCache.get(alias);
  if (!re) {
    re = new RegExp(aliasPattern(alias), CASE_SENSITIVE.has(alias) ? "g" : "gi");
    regexCache.set(alias, re);
  }
  re.lastIndex = 0;
  return re;
}

function countMatches(text: string, aliases: string[]): number {
  let n = 0;
  for (const a of aliases) n += (text.match(aliasRegex(a)) ?? []).length;
  return n;
}

/** Aliases to look for when checking a term (dictionary aliases + simple plural/singular). */
export function aliasesFor(term: string): string[] {
  const entry = BY_ALIAS.get(term.toLowerCase());
  if (entry) return entry.aliases;
  const t = term.trim();
  const variants = new Set([t]);
  if (/s$/i.test(t) && t.length > 4) variants.add(t.slice(0, -1));
  else if (t.length > 3) variants.add(`${t}s`);
  return [...variants];
}

function canonical(term: string): string {
  return BY_ALIAS.get(term.toLowerCase())?.canonical ?? term.trim();
}

export function containsTerm(text: string, term: string): boolean {
  return countMatches(text, aliasesFor(term)) > 0;
}

const NICE_HEADING = /(prefer|nice[\s-]to[\s-]have|bonus|plus|desired|good to have|optional)/i;
const MUST_HEADING = /(require|must|qualifications|what you('| wi)ll need|you have|skills|experience|responsibilit|about you)/i;
const NICE_INLINE = /(preferred|nice[\s-]to[\s-]have|is a plus|a bonus|bonus points|desirable|ideally)/i;

// Acronyms that look like skills but almost never are.
const ACRONYM_STOP = new Set(
  "US USA UK EU EEO EOE PTO CEO CTO CFO COO VP HR IT ID OK FAQ NA TBD ETA ASAP AM PM USD INR EUR LLC INC LTD THE AND OR WE OUR YOU FOR WITH YOUR ALL NEW ANY JOB PHD BS BA MS MBA BE BTECH MTECH SR JR II III IV".split(
    " ",
  ),
);

/** Extract the important skills/keywords from a job description. */
export function extractKeywords(jd: string, max = 24): Keyword[] {
  const found = new Map<string, Keyword>();
  const lines = jd.split(/\r?\n/);
  let section: Importance = "must";
  const importanceOf: { line: string; imp: Importance }[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const isHeading = line.length < 70 && !/[.]$/.test(line) && (/:$/.test(line) || /^[#*]*\s*[A-Z]/.test(line));
    if (isHeading && NICE_HEADING.test(line)) section = "nice";
    else if (isHeading && MUST_HEADING.test(line)) section = "must";
    importanceOf.push({ line, imp: NICE_INLINE.test(line) ? "nice" : section });
  }

  for (const entry of ENTRIES) {
    let total = 0;
    let imp: Importance = "nice";
    for (const { line, imp: lineImp } of importanceOf) {
      const n = countMatches(line, entry.aliases);
      if (n) {
        total += n;
        if (lineImp === "must") imp = "must";
      }
    }
    if (total) {
      found.set(entry.canonical.toLowerCase(), {
        term: entry.canonical,
        importance: imp,
        count: total,
        soft: SOFT_SKILLS.has(entry.canonical),
      });
    }
  }

  // Unknown acronyms and product-like names (e.g. "HIPAA", "Node.js", "S3", "ServiceNow").
  const extra = jd.match(/\b(?:[A-Z]{2,6}\d?|[A-Z][a-z]+[A-Z][A-Za-z]+|[A-Za-z]+\.(?:js|io|ai|net))\b/g) ?? [];
  const extraCounts = new Map<string, number>();
  for (const t of extra) {
    if (ACRONYM_STOP.has(t.toUpperCase()) || BY_ALIAS.has(t.toLowerCase())) continue;
    extraCounts.set(t, (extraCounts.get(t) ?? 0) + 1);
  }
  for (const [term, count] of extraCounts) {
    if (found.has(term.toLowerCase())) continue;
    const line = importanceOf.find((l) => l.line.includes(term));
    found.set(term.toLowerCase(), { term, importance: line?.imp ?? "nice", count });
  }

  return [...found.values()]
    .sort(
      (a, b) =>
        Number(!!a.soft) - Number(!!b.soft) ||
        (a.importance === b.importance ? 0 : a.importance === "must" ? -1 : 1) ||
        (b.count ?? 0) - (a.count ?? 0),
    )
    .slice(0, max);
}

/** Merge AI-extracted keywords (better at unusual terms) with the local ones. */
export function mergeKeywords(local: Keyword[], ai: Keyword[] | undefined): Keyword[] {
  if (!ai?.length) return local;
  const out = new Map<string, Keyword>();
  for (const k of ai) out.set(canonical(k.term).toLowerCase(), { ...k, term: canonical(k.term) });
  for (const k of local) {
    const key = k.term.toLowerCase();
    if (!out.has(key)) out.set(key, k);
    else out.set(key, { ...out.get(key)!, count: k.count, soft: k.soft });
  }
  return [...out.values()].slice(0, 30);
}

export function matchKeywords(keywords: Keyword[], resume: string): KeywordMatch[] {
  return keywords.map((k) => ({ ...k, found: containsTerm(resume, k.term) }));
}

/** 0-100. Requirements count double; soft skills count half. */
export function matchScore(matches: KeywordMatch[]): number {
  if (!matches.length) return 0;
  let total = 0;
  let got = 0;
  for (const m of matches) {
    const w = (m.importance === "must" ? 2 : 1) * (m.soft ? 0.5 : 1);
    total += w;
    if (m.found) got += w;
  }
  return Math.round((100 * got) / total);
}

export interface Segment {
  text: string;
  match?: KeywordMatch;
}

/** Split text into plain and highlighted parts (for showing the job post with keywords marked). */
export function highlight(text: string, matches: KeywordMatch[]): Segment[] {
  const pairs: { alias: string; m: KeywordMatch }[] = [];
  for (const m of matches) for (const a of aliasesFor(m.term)) pairs.push({ alias: a, m });
  pairs.sort((a, b) => b.alias.length - a.alias.length);
  const ranges: { start: number; end: number; m: KeywordMatch }[] = [];
  for (const { alias, m } of pairs) {
    const re = aliasRegex(alias);
    let hit: RegExpExecArray | null;
    while ((hit = re.exec(text))) {
      const start = hit.index;
      const end = start + hit[0].length;
      if (!ranges.some((r) => start < r.end && end > r.start)) ranges.push({ start, end, m });
      if (hit[0].length === 0) re.lastIndex++;
    }
  }
  ranges.sort((a, b) => a.start - b.start);
  const out: Segment[] = [];
  let pos = 0;
  for (const r of ranges) {
    if (r.start > pos) out.push({ text: text.slice(pos, r.start) });
    out.push({ text: text.slice(r.start, r.end), match: r.m });
    pos = r.end;
  }
  if (pos < text.length) out.push({ text: text.slice(pos) });
  return out;
}

/** Best-effort job title / company from the first lines of a job post. */
export function guessJob(jd: string): { title: string; company: string } {
  const lines = jd.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const titleLine =
    lines.find((l) =>
      /(engineer|developer|analyst|manager|designer|scientist|specialist|associate|intern|lead|director|consultant|coordinator|nurse|teacher|accountant|officer|administrator|architect|representative|executive|assistant)/i.test(
        l,
      ) && l.length < 90,
    ) ?? "";
  const title = titleLine.replace(/^(job title|role|position)\s*[:-]\s*/i, "").replace(/\s+[-–—|@].*$/, "").trim();
  const companyMatch =
    jd.match(/\b[Aa]bout\s+([A-Z][\w&.\- ]{1,40}?)(?:\s*[:\n]|\s+is\b)/) ??
    jd.match(/\b(?:at|join)\s+([A-Z][\w&.\-]+(?:\s+[A-Z][\w&.\-]+){0,3})/) ??
    jd.match(/^([A-Z][\w&.\- ]{1,40}?)\s+is (?:hiring|looking|seeking)/m);
  const company = companyMatch?.[1]?.trim().replace(/[.,]$/, "") ?? "";
  return { title: title.slice(0, 80), company: /^(us|our team|the team)$/i.test(company) ? "" : company.slice(0, 60) };
}

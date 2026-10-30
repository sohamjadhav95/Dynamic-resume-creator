import { useMemo } from "react";
import { containsTerm, extractKeywords, matchKeywords, matchScore, mergeKeywords, type Keyword, type KeywordMatch } from "./keywords";
import { resumeText, visibleResume, type Resume } from "./schema";

export interface MatchInfo {
  keywords: Keyword[];
  matches: KeywordMatch[];
  score: number;
  base: number | null; // master's score for the same job (to show "62 → 85")
  sections: { name: string; found: number }[]; // how many of the job's skills each part of the resume shows
}

/** The resume by part, for checking where a keyword is used. */
function parts(resume: Resume): { name: string; text: string; shows: boolean }[] {
  const v = visibleResume(resume);
  return [
    { name: "Summary", text: [v.basics.headline, v.summary].join("\n"), shows: true },
    { name: "Experience", text: v.experience.flatMap((e) => [e.role, e.company, ...e.bullets]).join("\n"), shows: true },
    { name: "Projects", text: v.projects.flatMap((p) => [p.name, ...p.stack, ...p.bullets]).join("\n"), shows: true },
    {
      name: "Other",
      text: [
        ...v.education.flatMap((e) => [e.degree, e.institution, e.details]),
        ...v.certifications,
        ...v.custom_sections.flatMap((s) => s.items.flatMap((i) => [i.title, i.subtitle, ...i.bullets])),
      ].join("\n"),
      shows: true,
    },
    { name: "Skills", text: v.skills.flatMap((s) => [s.category, ...s.items]).join("\n"), shows: false },
  ];
}

/** Keywords found anywhere, and whether the resume shows them in use (not only in the skills list). */
function matchWhole(keywords: Keyword[], resume: Resume): KeywordMatch[] {
  const used = parts(resume)
    .filter((p) => p.shows)
    .map((p) => p.text)
    .join("\n");
  return matchKeywords(keywords, resumeText(resume)).map((m) => ({ ...m, shown: m.found && containsTerm(used, m.term) }));
}

export function computeMatch(resume: Resume, jd: string, aiKeywords?: Keyword[], master?: Resume): MatchInfo | null {
  if (jd.trim().length < 30) return null;
  const keywords = mergeKeywords(extractKeywords(jd), aiKeywords);
  if (!keywords.length) return null;
  const matches = matchWhole(keywords, resume);
  const base = master && master !== resume ? matchScore(matchWhole(keywords, master)) : null;
  const hard = keywords.filter((k) => !k.soft);
  const sections = parts(resume)
    .map((p) => ({ name: p.name, found: hard.filter((k) => containsTerm(p.text, k.term)).length }))
    .filter((s) => s.found > 0 || s.name !== "Other");
  return { keywords, matches, score: matchScore(matches), base, sections };
}

export function useMatch(resume: Resume, jd: string, aiKeywords?: Keyword[], master?: Resume): MatchInfo | null {
  return useMemo(() => computeMatch(resume, jd, aiKeywords, master), [resume, jd, aiKeywords, master]);
}

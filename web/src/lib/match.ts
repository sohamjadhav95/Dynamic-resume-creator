import { useMemo } from "react";
import { extractKeywords, matchKeywords, matchScore, mergeKeywords, type Keyword, type KeywordMatch } from "./keywords";
import { matchText, type Resume } from "./schema";

export interface MatchInfo {
  keywords: Keyword[];
  matches: KeywordMatch[];
  score: number;
  base: number | null; // master's score for the same job (to show "62 → 85")
}

export function computeMatch(resume: Resume, jd: string, aiKeywords?: Keyword[], master?: Resume): MatchInfo | null {
  if (jd.trim().length < 30) return null;
  const keywords = mergeKeywords(extractKeywords(jd), aiKeywords);
  if (!keywords.length) return null;
  const matches = matchKeywords(keywords, matchText(resume));
  const base = master && master !== resume ? matchScore(matchKeywords(keywords, matchText(master))) : null;
  return { keywords, matches, score: matchScore(matches), base };
}

export function useMatch(resume: Resume, jd: string, aiKeywords?: Keyword[], master?: Resume): MatchInfo | null {
  return useMemo(() => computeMatch(resume, jd, aiKeywords, master), [resume, jd, aiKeywords, master]);
}

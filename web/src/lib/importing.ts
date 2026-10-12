// Getting an existing resume into the app: file -> text -> structured resume.
// Text extraction runs in the browser. Structuring uses AI, with a heuristic parser as backup.

import { emptyResume, normalizeResume, splitList, uid, type Resume } from "./schema";

export async function fileToText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (file.size > 5 * 1024 * 1024) throw new Error("That file is over 5 MB. Try exporting a smaller PDF.");
  if (name.endsWith(".pdf") || file.type === "application/pdf") return pdfToText(file);
  if (name.endsWith(".docx")) return docxToText(file);
  if (name.endsWith(".json")) return await file.text();
  if (name.endsWith(".txt") || name.endsWith(".md") || file.type.startsWith("text/")) return await file.text();
  throw new Error("Please upload a PDF, Word (.docx) or text file.");
}

async function pdfToText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: string[] = [];
  for (let p = 1; p <= Math.min(doc.numPages, 6); p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    // Rebuild lines from item positions so bullets and headings stay on their own lines.
    let lastY: number | null = null;
    let line = "";
    const lines: string[] = [];
    for (const item of content.items as { str: string; transform: number[]; hasEOL?: boolean }[]) {
      const y = Math.round(item.transform[5]);
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        lines.push(line);
        line = "";
      }
      line += (line && !line.endsWith(" ") && item.str && !item.str.startsWith(" ") ? " " : "") + item.str;
      lastY = y;
      if (item.hasEOL) {
        lines.push(line);
        line = "";
        lastY = null;
      }
    }
    if (line) lines.push(line);
    pages.push(lines.map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n"));
  }
  const text = pages.join("\n");
  if (text.replace(/\s/g, "").length < 50) {
    throw new Error("This PDF looks like a scanned image, so its text can't be read. Paste the text instead.");
  }
  return text;
}

async function docxToText(file: File): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return result.value;
}

/** If the text is our own JSON export (or the old app's), use it directly. */
export function tryJson(text: string): Resume | null {
  const t = text.trim();
  if (!t.startsWith("{")) return null;
  try {
    const data = JSON.parse(t);
    return normalizeResume(data.master ?? data);
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ heuristic parser (no AI)

const HEADINGS: [RegExp, string][] = [
  [/^(professional\s+)?(summary|profile|about( me)?|objective|career objective)$/i, "summary"],
  [/^(technical\s+|core\s+|key\s+)?(skills|competencies|technologies|tech stack|tools)(\s*&\s*\w+)?$/i, "skills"],
  [/^(professional\s+|work\s+|relevant\s+)?(experience|employment( history)?|work history|career history)$/i, "experience"],
  [/^(academic\s+|personal\s+|selected\s+|key\s+)?projects$/i, "projects"],
  [/^(education|academics|academic background|qualifications)$/i, "education"],
  [/^(certifications?|licenses?( & certifications)?|courses)$/i, "certifications"],
];

const BULLET = /^[•●▪◦‣\-–*·]\s*/;
const DATE_RANGE =
  /((jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+)?(19|20)\d{2}\s*(–|-|—|to)\s*((jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+)?((19|20)\d{2}|present|current|now)/i;
const YEAR = /\b(19|20)\d{2}\b/;

export function heuristicParse(text: string): Resume {
  const r = emptyResume();
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  // Contact details anywhere near the top
  const top = lines.slice(0, 8).join(" | ");
  r.basics.email = top.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0] ?? "";
  r.basics.phone = top.match(/\+?\d[\d\s().-]{7,}\d/)?.[0]?.trim() ?? "";
  r.basics.links = [...new Set(top.match(/(https?:\/\/)?(www\.)?(linkedin\.com|github\.com|[\w-]+\.(dev|io|me|app))\/?[\w\-./]*/gi) ?? [])];
  r.basics.name = lines[0] && lines[0].length < 50 && !/@|\d{4}/.test(lines[0]) ? lines[0] : "";
  if (lines[1] && lines[1].length < 90 && !/@|\+?\d{6,}/.test(lines[1]) && !headingOf(lines[1])) r.basics.headline = lines[1];

  let section = "";
  const summary: string[] = [];
  for (const line of lines.slice(1)) {
    const h = headingOf(line);
    if (h) {
      section = h;
      continue;
    }
    const isBullet = BULLET.test(line);
    const content = line.replace(BULLET, "");
    switch (section) {
      case "summary":
        summary.push(content);
        break;
      case "skills": {
        const [cat, rest] = content.includes(":") ? content.split(/:(.+)/) : ["Skills", content];
        r.skills.push({ id: uid("sk"), category: cat.trim(), items: splitList(rest ?? "") });
        break;
      }
      case "experience": {
        const cur = r.experience[r.experience.length - 1];
        if (isBullet && cur) cur.bullets.push(content);
        else if (!isBullet && (DATE_RANGE.test(line) || !cur || cur.bullets.length)) {
          const dates = line.match(DATE_RANGE)?.[0] ?? "";
          const head = line.replace(dates, "").replace(/[|,–-]\s*$/, "").trim();
          const [role, company] = head.split(/\s+(?:at|@|\||–|-|,)\s+/);
          r.experience.push({ id: uid("ex"), role: role ?? head, company: company ?? "", location: "", dates, bullets: [] });
        } else if (cur && !cur.company) cur.company = content;
        else if (cur) cur.bullets.push(content);
        break;
      }
      case "projects": {
        const cur = r.projects[r.projects.length - 1];
        if (isBullet && cur) cur.bullets.push(content);
        else if (!cur || cur.bullets.length || !isBullet) {
          if (cur && !cur.bullets.length && !YEAR.test(line) && content.length > 60) cur.bullets.push(content);
          else r.projects.push({ id: uid("pr"), name: content.replace(YEAR, "").replace(/[|–-]\s*$/, "").trim(), link: "", dates: content.match(YEAR)?.[0] ?? "", stack: [], bullets: [] });
        }
        break;
      }
      case "education": {
        const cur = r.education[r.education.length - 1];
        if (!cur || (cur.degree && cur.institution)) {
          r.education.push({ id: uid("ed"), degree: content.replace(DATE_RANGE, "").trim(), institution: "", location: "", dates: line.match(DATE_RANGE)?.[0] ?? line.match(YEAR)?.[0] ?? "", details: "" });
        } else cur.institution = content;
        break;
      }
      case "certifications":
        r.certifications.push(content);
        break;
      default:
        break;
    }
  }
  r.summary = summary.join(" ");
  return r;
}

function headingOf(line: string): string | null {
  const clean = line.replace(/[:\s]+$/, "").trim();
  if (clean.length > 40) return null;
  for (const [re, key] of HEADINGS) if (re.test(clean)) return key;
  return null;
}

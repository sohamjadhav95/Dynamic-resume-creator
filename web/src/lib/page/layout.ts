// The page engine: turns a resume into exact positions for every word, in PDF points.
// The same layout is drawn on screen (PageView) and written to the PDF (pdf.ts), so what you see
// is exactly what you download, in every browser, with no print dialog involved.
// It also keeps the resume on one page: when content is too long it tightens the spacing step by
// step, then the text size (to 92% at most), and only then spills onto a second page.

import { visibleResume, type Resume, type SectionKey, type TemplateId } from "../schema";
import { pdfSafe, textWidth, type FontKey } from "./metrics";

export const PAGE_PT = { A4: { w: 595.28, h: 841.89 }, Letter: { w: 612, h: 792 } } as const;

export interface TextItem {
  kind: "text";
  x: number;
  y: number; // baseline, from the top of the page
  text: string;
  font: FontKey;
  size: number;
  color: string;
  width: number;
  path?: string;
  placeholder?: boolean; // screen only: a hint for an empty field
}
export interface RuleItem {
  kind: "rule";
  x1: number;
  x2: number;
  y: number;
  thickness: number;
  color: string;
}
export type Item = TextItem | RuleItem;

export type FieldKind = "text" | "list" | "bullet" | "paragraph";
export interface Rect {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Field {
  path: string;
  kind: FieldKind;
  label: string;
  rects: Rect[];
}

export interface PageLayout {
  width: number;
  height: number;
  pages: Item[][];
  fields: Record<string, Field>;
  fits: boolean; // everything on one page
  overflowLines: number;
  tightened: boolean; // spacing or text size was reduced to fit one page
  spacing: number;
  fontScale: number;
}

// ------------------------------------------------------------------ styles (sizes in points)

interface Style {
  margin: { top: number; bottom: number; side: number };
  headerAlign: "center" | "left";
  name: number;
  contact: number;
  badge: number;
  title: number;
  titleUpper: boolean;
  longTitles: boolean;
  rule: number; // thickness of the line under section titles (0 = none)
  body: number;
  heading: number; // entry titles, dates
  role: number;
  stack: number;
  skills: number;
  lineHeight: number;
  ink: string;
  nameInAccent: boolean;
  gaps: { header: number; section: number; afterTitle: number; entry: number; bullet: number };
  bulletIndent: number;
  textIndent: number;
}

// "original" reproduces the owner's PDF (Word export, Arial): measured from the file.
const STYLES: Record<TemplateId, Style> = {
  original: {
    margin: { top: 26.9, bottom: 24, side: 42.5 },
    headerAlign: "center",
    name: 17,
    contact: 7.6,
    badge: 9,
    title: 9,
    titleUpper: true,
    longTitles: true,
    rule: 0.75,
    body: 8.5,
    heading: 9,
    role: 8.5,
    stack: 8,
    skills: 9,
    lineHeight: 1.28,
    ink: "#000000",
    nameInAccent: false,
    gaps: { header: 6.9, section: 5.8, afterTitle: 2.2, entry: 5.5, bullet: 2.4 },
    bulletIndent: 6,
    textIndent: 15,
  },
  classic: {
    margin: { top: 34, bottom: 30, side: 40 },
    headerAlign: "center",
    name: 20,
    contact: 8.5,
    badge: 9.5,
    title: 9.5,
    titleUpper: true,
    longTitles: false,
    rule: 0.5,
    body: 9.2,
    heading: 9.6,
    role: 9.2,
    stack: 8.6,
    skills: 9.2,
    lineHeight: 1.3,
    ink: "#16150f",
    nameInAccent: false,
    gaps: { header: 8, section: 10, afterTitle: 5, entry: 6, bullet: 2.4 },
    bulletIndent: 4,
    textIndent: 13,
  },
  modern: {
    margin: { top: 34, bottom: 30, side: 40 },
    headerAlign: "left",
    name: 21,
    contact: 8.5,
    badge: 10,
    title: 9.5,
    titleUpper: true,
    longTitles: false,
    rule: 0.6,
    body: 9.2,
    heading: 9.6,
    role: 9.2,
    stack: 8.6,
    skills: 9.2,
    lineHeight: 1.3,
    ink: "#16150f",
    nameInAccent: true,
    gaps: { header: 8, section: 10, afterTitle: 5, entry: 6, bullet: 2.4 },
    bulletIndent: 4,
    textIndent: 13,
  },
  compact: {
    margin: { top: 26, bottom: 24, side: 32 },
    headerAlign: "left",
    name: 16,
    contact: 7.8,
    badge: 8.8,
    title: 8.6,
    titleUpper: true,
    longTitles: false,
    rule: 0.75,
    body: 8.3,
    heading: 8.7,
    role: 8.3,
    stack: 7.9,
    skills: 8.3,
    lineHeight: 1.25,
    ink: "#000000",
    nameInAccent: false,
    gaps: { header: 5, section: 7.5, afterTitle: 4, entry: 4.5, bullet: 2 },
    bulletIndent: 4,
    textIndent: 12,
  },
};

const SHORT_TITLES: Record<Exclude<SectionKey, "custom">, string> = {
  summary: "Summary",
  skills: "Skills",
  experience: "Experience",
  projects: "Projects",
  certifications: "Certifications",
  education: "Education",
};
const LONG_TITLES: Record<Exclude<SectionKey, "custom">, string> = {
  summary: "Professional Summary",
  skills: "Technical Skills",
  experience: "Professional Experience",
  projects: "Projects",
  certifications: "Certifications & Achievements",
  education: "Education",
};

const HINT = "#a39e93";

// ------------------------------------------------------------------ text flow

interface Run {
  text: string;
  font: FontKey;
  size: number;
  color: string;
  path?: string;
  kind?: FieldKind;
  label?: string;
  placeholder?: boolean;
}
interface Word {
  text: string;
  run: Run;
  width: number;
  space: number;
}
interface Line {
  words: Word[];
  natural: number;
}
interface Block {
  top: number;
  bottom: number;
  items: Item[];
  rects: { path: string; rect: Omit<Rect, "page"> }[];
  keepWithNext?: boolean;
}

function words(runs: Run[]): Word[] {
  const out: Word[] = [];
  for (const run of runs) {
    const text = pdfSafe(run.text);
    for (const w of text.split(/\s+/)) {
      if (!w) continue;
      out.push({ text: w, run, width: textWidth(w, run.font, run.size), space: textWidth(" ", run.font, run.size) });
    }
  }
  return out;
}

/** Split a word that is wider than the line (long URLs) into pieces that fit. */
function hardBreak(word: Word, avail: number): Word[] {
  const parts: Word[] = [];
  let cur = "";
  for (const ch of word.text) {
    const next = cur + ch;
    if (cur && textWidth(next, word.run.font, word.run.size) > avail) {
      parts.push({ ...word, text: cur, width: textWidth(cur, word.run.font, word.run.size) });
      cur = ch;
    } else cur = next;
  }
  if (cur) parts.push({ ...word, text: cur, width: textWidth(cur, word.run.font, word.run.size) });
  return parts;
}

function breakLines(ws: Word[], firstAvail: number, restAvail: number): Line[] {
  const lines: Line[] = [];
  let line: Word[] = [];
  let used = 0;
  const avail = () => (lines.length === 0 ? firstAvail : restAvail);
  const queue = [...ws];
  while (queue.length) {
    const w = queue.shift()!;
    if (w.width > avail() && !line.length) {
      const pieces = hardBreak(w, avail());
      queue.unshift(...pieces.slice(1));
      line.push(pieces[0]);
      used = pieces[0].width;
      continue;
    }
    const need = line.length ? used + line[line.length - 1].space + w.width : w.width;
    if (need <= avail() + 0.01 || !line.length) {
      line.push(w);
      used = need;
    } else {
      lines.push({ words: line, natural: used });
      line = [w];
      used = w.width;
    }
  }
  if (line.length) lines.push({ words: line, natural: used });
  return lines;
}

// ------------------------------------------------------------------ the builder

class Builder {
  blocks: Block[] = [];
  y: number;
  readonly left: number;
  readonly right: number;
  readonly width: number;
  readonly fields: Record<string, { kind: FieldKind; label: string }> = {};

  constructor(
    readonly page: { w: number; h: number },
    readonly st: Style,
    readonly s: number, // spacing factor
    readonly f: number, // font scale
    readonly accent: string,
    readonly placeholders: boolean,
  ) {
    this.y = st.margin.top;
    this.left = st.margin.side;
    this.right = page.w - st.margin.side;
    this.width = this.right - this.left;
  }

  size(pt: number) {
    return pt * this.f;
  }
  gap(pt: number) {
    this.y += pt * this.s;
  }
  pitch(size: number) {
    return size * Math.max(1.14, this.st.lineHeight - (1 - this.s) * 0.18);
  }

  run(text: string, font: FontKey, size: number, path?: string, kind: FieldKind = "text", label = "", hint = ""): Run | null {
    if (path) this.fields[path] = { kind, label };
    if (text.trim()) return { text, font, size: this.size(size), color: this.st.ink, path, kind, label };
    if (this.placeholders && hint)
      return { text: hint, font, size: this.size(size), color: HINT, path, kind, label, placeholder: true };
    return null;
  }

  /** Lay out a paragraph made of runs; returns the lines' top positions. */
  paragraph(
    runs: (Run | null)[],
    opts: { x?: number; width?: number; indent?: number; align?: "left" | "center" | "right" | "justify"; keep?: boolean } = {},
  ): number {
    const rs = runs.filter((r): r is Run => !!r);
    if (!rs.length) return 0;
    const x0 = opts.x ?? this.left;
    const width = opts.width ?? this.right - x0;
    const indent = opts.indent ?? 0;
    const align = opts.align ?? "left";
    const size = Math.max(...rs.map((r) => r.size));
    const pitch = this.pitch(size);
    const lines = breakLines(words(rs), width - indent, width);
    lines.forEach((line, li) => {
      const lx = x0 + (li === 0 ? indent : 0);
      const avail = width - (li === 0 ? indent : 0);
      const last = li === lines.length - 1;
      let x = lx;
      let extra = 0;
      if (align === "center") x = lx + (avail - line.natural) / 2;
      else if (align === "right") x = lx + avail - line.natural;
      else if (align === "justify" && !last && line.words.length > 1 && line.natural > avail * 0.7)
        extra = (avail - line.natural) / (line.words.length - 1);
      const top = this.y;
      const baseline = top + size * 0.86 + (pitch - size) / 2;
      const block: Block = { top, bottom: top + pitch, items: [], rects: [], keepWithNext: opts.keep };
      line.words.forEach((w, wi) => {
        block.items.push({
          kind: "text",
          x,
          y: baseline,
          text: w.text,
          font: w.run.font,
          size: w.run.size,
          color: w.run.color,
          width: w.width,
          path: w.run.path,
          placeholder: w.run.placeholder,
        });
        if (w.run.path) {
          const end = x + w.width;
          const prev = block.rects[block.rects.length - 1];
          if (prev && prev.path === w.run.path) prev.rect.w = end - prev.rect.x;
          else block.rects.push({ path: w.run.path, rect: { x, y: top, w: w.width, h: pitch } });
        }
        x += w.width + (wi < line.words.length - 1 ? w.space + extra : 0);
      });
      this.blocks.push(block);
      this.y += pitch;
    });
    return lines.length;
  }

  /** Left text that may wrap, with right-aligned text (dates) on its first line. */
  row(left: (Run | null)[], right: Run | null, keep = true) {
    const rightText = right ? pdfSafe(right.text) : "";
    const rw = right ? textWidth(rightText, right.font, right.size) : 0;
    const startBlock = this.blocks.length;
    const startY = this.y;
    const leftRuns = left.filter((r): r is Run => !!r);
    if (leftRuns.length) this.paragraph(leftRuns, { width: this.width - (rw ? rw + 10 : 0), keep });
    else if (right) {
      const pitch = this.pitch(right.size);
      this.blocks.push({ top: this.y, bottom: this.y + pitch, items: [], rects: [], keepWithNext: keep });
      this.y += pitch;
    }
    if (right && this.blocks[startBlock]) {
      const b = this.blocks[startBlock];
      const firstText = b.items.find((i): i is TextItem => i.kind === "text");
      const pitch = b.bottom - b.top;
      const baseline = firstText ? firstText.y : startY + right.size * 0.86 + (pitch - right.size) / 2;
      const x = this.right - rw;
      b.items.push({
        kind: "text",
        x,
        y: baseline,
        text: rightText,
        font: right.font,
        size: right.size,
        color: right.color,
        width: rw,
        path: right.path,
        placeholder: right.placeholder,
      });
      if (right.path) b.rects.push({ path: right.path, rect: { x, y: b.top, w: rw, h: pitch } });
    }
  }

  title(text: string, path?: string) {
    const st = this.st;
    this.gap(st.gaps.section);
    const label = st.titleUpper ? text.toUpperCase() : text;
    const r = this.run(label, "bold", st.title, path, "text", "Section title", "SECTION");
    if (r) r.color = this.accent;
    this.paragraph([r], { keep: true });
    const block = this.blocks[this.blocks.length - 1];
    if (st.rule && block) {
      const y = this.y + 0.6;
      block.items.push({ kind: "rule", x1: this.left, x2: this.right, y, thickness: st.rule, color: this.accent });
      block.bottom = y + st.rule;
      this.y = y + st.rule;
    }
    this.gap(st.gaps.afterTitle);
  }

  bullets(list: string[], path: string) {
    const st = this.st;
    list.forEach((b, i) => {
      const r = this.run(b, "regular", st.body, `${path}.${i}`, "bullet", "Bullet", "Describe what you did and the result");
      if (!r) return;
      if (i > 0) this.gap(st.gaps.bullet);
      const start = this.blocks.length;
      this.paragraph([r], { x: this.left + st.textIndent, align: "justify" });
      const first = this.blocks[start];
      const t = first?.items.find((it): it is TextItem => it.kind === "text");
      if (first && t) {
        const size = this.size(st.body);
        first.items.unshift({
          kind: "text",
          x: this.left + st.bulletIndent,
          y: t.y,
          text: "•",
          font: "regular",
          size,
          color: st.ink,
          width: textWidth("•", "regular", size),
        });
      }
    });
  }
}

// ------------------------------------------------------------------ sections

function build(r: Resume, b: Builder) {
  const st = b.st;
  const v = visibleResume(r);
  const titles = st.longTitles ? LONG_TITLES : SHORT_TITLES;
  const align = st.headerAlign;

  // Header
  const name = b.run(v.basics.name, "bold", st.name, "basics.name", "text", "Name", "Your name");
  if (name && st.nameInAccent) name.color = b.accent;
  b.paragraph([name], { align });
  b.gap(1.3);
  const contactRuns: (Run | null)[] = [];
  if (v.basics.contact_line) {
    contactRuns.push(b.run(v.basics.contact_line, "regular", st.contact, "basics.contact_line", "text", "Contact line"));
  } else {
    const parts: [string, string, FieldKind, string][] = [
      [v.basics.email, "basics.email", "text", "Email"],
      [v.basics.phone, "basics.phone", "text", "Phone"],
      [v.basics.location, "basics.location", "text", "Location"],
    ];
    for (const [text, path, kind, label] of parts) {
      const run = b.run(text, "regular", st.contact, path, kind, label);
      if (!run) continue;
      if (contactRuns.length) contactRuns.push({ ...run, text: "|", path: undefined });
      contactRuns.push(run);
    }
    if (v.basics.links.length) {
      const run = b.run(v.basics.links.join("  |  "), "regular", st.contact, "basics.links", "list", "Links");
      if (run) {
        if (contactRuns.length) contactRuns.push({ ...run, text: "|", path: undefined });
        contactRuns.push(run);
      }
    } else if (!contactRuns.length) {
      contactRuns.push(b.run("", "regular", st.contact, "basics.email", "text", "Email", "email · phone · links"));
    }
  }
  // The contact line stays on one line when possible: shrink it a little before wrapping.
  const cr = contactRuns.filter((x): x is Run => !!x);
  if (cr.length) {
    const total = () => words(cr).reduce((s, w, i, a) => s + w.width + (i < a.length - 1 ? w.space : 0), 0);
    while (total() > b.width && cr[0].size > st.contact * 0.8) for (const x of cr) x.size *= 0.97;
    b.paragraph(cr, { align });
  }
  b.gap(2.9);
  const badge = v.basics.sub_badge
    ? b.run(v.basics.sub_badge, "bold", st.badge, "basics.sub_badge", "text", "Highlights line")
    : b.run(v.basics.headline, "bold", st.badge, "basics.headline", "text", "Headline", "Headline, e.g. Data Analyst");
  b.paragraph([badge], { align });
  b.gap(st.gaps.header - st.gaps.section);

  const sections: Record<SectionKey, () => void> = {
    summary: () => {
      const run = b.run(v.summary, "regular", st.body, "summary", "paragraph", "Summary", "A short summary of what you do best");
      if (!run) return;
      b.title(titles.summary);
      b.paragraph([run], { align: "justify" });
    },
    skills: () => {
      if (!v.skills.length) return;
      b.title(titles.skills);
      v.skills.forEach((g) => {
        const i = r.skills.findIndex((x) => x.id === g.id);
        const cat = b.run(g.category ? `${g.category}:` : "", "bold", st.skills, `skills.${i}.category`, "text", "Skill group", "Group:");
        const items = b.run(g.items.join(", "), "regular", st.skills, `skills.${i}.items`, "list", "Skills", "Skill, skill, skill");
        b.paragraph([cat, items]);
        b.gap(st.gaps.bullet * 0.8);
      });
    },
    experience: () => {
      if (!v.experience.length) return;
      b.title(titles.experience);
      v.experience.forEach((e, n) => {
        const i = r.experience.findIndex((x) => x.id === e.id);
        if (n > 0) b.gap(st.gaps.entry);
        const dates = b.run(e.dates, "bold", st.heading, `experience.${i}.dates`, "text", "Dates", "Dates");
        if (st.longTitles) {
          b.row([b.run(e.company, "bold", st.heading, `experience.${i}.company`, "text", "Company", "Company")], dates);
          b.paragraph([b.run(e.role, "bold", st.role, `experience.${i}.role`, "text", "Job title", "Job title")], { keep: true });
        } else {
          const role = b.run(e.role, "bold", st.heading, `experience.${i}.role`, "text", "Job title", "Job title");
          const company = b.run(e.company, "regular", st.heading, `experience.${i}.company`, "text", "Company", "Company");
          b.row([role, role && company ? { ...role, text: "·", path: undefined } : null, company], dates);
        }
        if (e.location)
          b.paragraph([b.run(e.location, "italic", st.stack, `experience.${i}.location`, "text", "Location")], { keep: true });
        b.gap(1);
        b.bullets(e.bullets, `experience.${i}.bullets`);
      });
    },
    projects: () => {
      if (!v.projects.length) return;
      b.title(titles.projects);
      v.projects.forEach((p, n) => {
        const i = r.projects.findIndex((x) => x.id === p.id);
        if (n > 0) b.gap(st.gaps.entry);
        const name = b.run(p.name, "bold", st.heading, `projects.${i}.name`, "text", "Project name", "Project name");
        const link = p.link ? b.run(p.link, "regular", st.stack, `projects.${i}.link`, "text", "Link") : null;
        b.row([name, link && name ? { ...link, text: "|", path: undefined } : null, link], b.run(p.dates, "bold", st.heading, `projects.${i}.dates`, "text", "Year", "Year"));
        const stack = b.run(p.stack.join(", "), "italic", st.stack, `projects.${i}.stack`, "list", "Tech stack", "Tools used");
        if (stack) b.paragraph([stack], { keep: true });
        b.gap(1);
        b.bullets(p.bullets, `projects.${i}.bullets`);
      });
    },
    custom: () => {
      v.custom_sections.forEach((sec) => {
        const si = r.custom_sections.findIndex((x) => x.id === sec.id);
        if (!sec.items.length && !sec.title) return;
        b.title(sec.title || "Section", `custom_sections.${si}.title`);
        sec.items.forEach((it, n) => {
          const ii = r.custom_sections[si].items.findIndex((x) => x.id === it.id);
          const base = `custom_sections.${si}.items.${ii}`;
          if (n > 0) b.gap(st.gaps.entry);
          const title = b.run(it.title, "bold", st.heading, `${base}.title`, "text", "Title", "Title");
          const sub = it.subtitle ? b.run(it.subtitle, "bold", st.heading, `${base}.subtitle`, "text", "Detail") : null;
          b.row(
            [title, title && sub ? { ...title, text: "|", path: undefined } : null, sub],
            b.run(it.dates, "bold", st.heading, `${base}.dates`, "text", "Date"),
          );
          b.gap(1);
          b.bullets(it.bullets, `${base}.bullets`);
        });
      });
    },
    certifications: () => {
      if (!v.certifications.length) return;
      b.title(titles.certifications);
      b.paragraph([b.run(v.certifications.join(" • "), "regular", st.body, "certifications", "list", "Certifications")]);
    },
    education: () => {
      if (!v.education.length) return;
      b.title(titles.education);
      v.education.forEach((e, n) => {
        const i = r.education.findIndex((x) => x.id === e.id);
        if (n > 0) b.gap(st.gaps.entry);
        b.row(
          [b.run(e.degree, "bold", st.heading, `education.${i}.degree`, "text", "Degree", "Degree")],
          b.run(e.dates, "bold", st.heading, `education.${i}.dates`, "text", "Dates", "Dates"),
        );
        b.paragraph([b.run(e.institution, "regular", st.body, `education.${i}.institution`, "text", "School", "School")]);
        if (e.details) b.paragraph([b.run(e.details, "regular", st.body, `education.${i}.details`, "text", "Details")]);
      });
    },
  };

  const hidden = new Set(r.layout.hidden);
  for (const key of r.layout.order) if (!hidden.has(key)) sections[key]();
}

// ------------------------------------------------------------------ pages and fitting

function paginate(b: Builder): { pages: Item[][]; fields: Record<string, Field>; height: number } {
  const st = b.st;
  const bottomLimit = b.page.h - st.margin.bottom;
  const pages: Item[][] = [[]];
  const fields: Record<string, Field> = {};
  for (const [path, f] of Object.entries(b.fields)) fields[path] = { path, kind: f.kind, label: f.label, rects: [] };
  let page = 0;
  let offset = 0;
  b.blocks.forEach((block, i) => {
    const next = b.blocks[i + 1];
    const needsRoom = block.keepWithNext && next ? next.bottom : block.bottom;
    if (needsRoom - offset > bottomLimit + 0.5 && block.top - offset > st.margin.top + 1) {
      page += 1;
      pages.push([]);
      offset = block.top - st.margin.top;
    }
    for (const item of block.items) pages[page].push(item.kind === "text" ? { ...item, y: item.y - offset } : { ...item, y: item.y - offset });
    for (const { path, rect } of block.rects) fields[path]?.rects.push({ page, ...rect, y: rect.y - offset });
  });
  const last = b.blocks[b.blocks.length - 1];
  return { pages, fields, height: last ? last.bottom + st.margin.bottom : 0 };
}

function layoutOnce(r: Resume, s: number, f: number, placeholders: boolean) {
  const page = PAGE_PT[r.layout.page] ?? PAGE_PT.A4;
  const style = STYLES[r.layout.template] ?? STYLES.original;
  const accent = r.layout.template === "original" && r.layout.accent.toLowerCase() === "#1b1a17" ? style.ink : r.layout.accent;
  const b = new Builder(page, style, s, f, accent, placeholders);
  build(r, b);
  const { pages, fields, height } = paginate(b);
  return { page, b, pages, fields, height };
}

/** The spacing / text size steps tried, roomiest first, until the resume fits on one page. */
function steps(density: number): { s: number; f: number }[] {
  const preferred = Math.max(0.55, Math.min(1.3, 1 - density * 0.07));
  const out: { s: number; f: number }[] = [{ s: preferred, f: 1 }];
  for (let s = preferred - 0.05; s >= 0.55; s -= 0.05) out.push({ s, f: 1 });
  for (const f of [0.98, 0.96, 0.94, 0.92]) out.push({ s: 0.55, f });
  return out;
}

function toLayout(r: Resume, s: number, f: number, placeholders: boolean, tightened: boolean): PageLayout {
  const res = layoutOnce(r, s, f, placeholders);
  const fits = res.pages.length === 1;
  const overflow = res.height - res.page.h;
  return {
    width: res.page.w,
    height: res.page.h,
    pages: res.pages,
    fields: res.fields,
    fits,
    overflowLines: fits ? 0 : Math.max(1, Math.ceil(overflow / (res.b.st.body * res.b.st.lineHeight))),
    tightened,
    spacing: s,
    fontScale: f,
  };
}

/**
 * Lays out the resume for the PDF (no hints) and for the screen (with hints for empty fields),
 * using the same spacing and text size so both look the same.
 */
export function layoutResume(r: Resume): { print: PageLayout; screen: PageLayout } {
  const tries = steps(r.layout.density);
  let chosen = tries[tries.length - 1];
  for (const t of tries) {
    const res = layoutOnce(r, t.s, t.f, false);
    if (res.pages.length === 1) {
      chosen = t;
      break;
    }
  }
  const tightened = chosen !== tries[0];
  const print = toLayout(r, chosen.s, chosen.f, false, tightened);
  const screen = toLayout(r, chosen.s, chosen.f, true, tightened);
  return { print, screen };
}

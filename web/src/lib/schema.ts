// The resume data model. Everything in the app reads and writes this shape.

export type SectionKey =
  | "summary"
  | "skills"
  | "experience"
  | "projects"
  | "custom"
  | "certifications"
  | "education";

export const SECTION_LABELS: Record<SectionKey, string> = {
  summary: "Summary",
  skills: "Skills",
  experience: "Experience",
  projects: "Projects",
  custom: "Other sections",
  certifications: "Certifications",
  education: "Education",
};

export const DEFAULT_ORDER: SectionKey[] = [
  "summary",
  "skills",
  "experience",
  "projects",
  "custom",
  "certifications",
  "education",
];

export type TemplateId = "classic" | "modern" | "compact";
export type PageSize = "A4" | "Letter";

export interface Basics {
  name: string;
  headline: string;
  email: string;
  phone: string;
  location: string;
  links: string[];
}
export interface SkillGroup {
  id: string;
  category: string;
  items: string[];
}
export interface Experience {
  id: string;
  company: string;
  role: string;
  location: string;
  dates: string;
  bullets: string[];
}
export interface Project {
  id: string;
  name: string;
  link: string;
  dates: string;
  stack: string[];
  bullets: string[];
}
export interface Education {
  id: string;
  degree: string;
  institution: string;
  location: string;
  dates: string;
  details: string;
}
export interface CustomItem {
  id: string;
  title: string;
  subtitle: string;
  dates: string;
  bullets: string[];
}
export interface CustomSection {
  id: string;
  title: string;
  items: CustomItem[];
}
export interface Layout {
  order: SectionKey[];
  hidden: string[]; // section keys and/or item ids
  template: TemplateId;
  page: PageSize;
  density: number; // -3 (roomy) … 0 … +4 (tight)
  accent: string;
}

export interface Resume {
  version: 2;
  basics: Basics;
  summary: string;
  skills: SkillGroup[];
  experience: Experience[];
  projects: Project[];
  education: Education[];
  certifications: string[];
  custom_sections: CustomSection[];
  layout: Layout;
}

// --------------------------------------------------------------- helpers

export function uid(prefix = "id"): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${rand}`;
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function defaultLayout(): Layout {
  return { order: [...DEFAULT_ORDER], hidden: [], template: "classic", page: "A4", density: 0, accent: "#1B1A17" };
}

export function emptyResume(): Resume {
  return {
    version: 2,
    basics: { name: "", headline: "", email: "", phone: "", location: "", links: [] },
    summary: "",
    skills: [],
    experience: [],
    projects: [],
    education: [],
    certifications: [],
    custom_sections: [],
    layout: defaultLayout(),
  };
}

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const strList = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map(str).map((s) => s.trim()).filter(Boolean);
  if (typeof v === "string") return splitList(v);
  return [];
};

/** "Python, SQL; Docker" -> ["Python", "SQL", "Docker"] (keeps commas inside parentheses) */
export function splitList(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if ((ch === "," || ch === ";" || ch === "•" || ch === "|") && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * Accepts anything that looks like a resume (current format, the original app's
 * `master_resume.json` format, or AI parse output) and returns a valid Resume.
 */
export function normalizeResume(input: unknown): Resume {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, any>;
  const base = emptyResume();
  const b = raw.basics ?? {};

  // Legacy format: one "contact_line" string with " | " separators and a "sub_badge".
  let links = strList(b.links);
  let email = str(b.email);
  let phone = str(b.phone);
  if (b.contact_line && !links.length) {
    for (const part of str(b.contact_line).split("|").map((s: string) => s.trim()).filter(Boolean)) {
      if (!email && /@/.test(part)) email = part;
      else if (!phone && /^\+?[\d\s().-]{7,}$/.test(part)) phone = part;
      else links.push(part);
    }
  }
  base.basics = {
    name: str(b.name),
    headline: str(b.headline || b.sub_badge || b.label),
    email,
    phone,
    location: str(b.location),
    links,
  };
  base.summary = str(raw.summary);

  // Skills: legacy object {category: "a, b"} or array of {category|category_name, items|skills}
  if (raw.skills && !Array.isArray(raw.skills) && typeof raw.skills === "object") {
    base.skills = Object.entries(raw.skills).map(([category, items]) => ({
      id: uid("sk"),
      category,
      items: strList(items),
    }));
  } else if (Array.isArray(raw.skills)) {
    base.skills = raw.skills.map((s: any) => ({
      id: str(s.id) || uid("sk"),
      category: str(s.category ?? s.category_name ?? s.name),
      items: strList(s.items ?? s.skills ?? s.keywords),
    }));
  }

  base.experience = (raw.experience ?? raw.work ?? []).map((e: any) => ({
    id: str(e.id) || uid("ex"),
    company: str(e.company ?? e.name),
    role: str(e.role ?? e.position ?? e.title),
    location: str(e.location),
    dates: str(e.dates ?? e.timeline ?? joinDates(e.startDate, e.endDate)),
    bullets: strList(e.bullets ?? e.highlights),
  }));

  base.projects = (raw.projects ?? [])
    .filter((p: any) => str(p.name) !== "DYNAMIC_TARGET_PROJECT")
    .map((p: any) => ({
      id: str(p.id) || uid("pr"),
      name: str(p.name ?? p.title),
      link: str(p.link ?? p.url),
      dates: str(p.dates ?? p.timeline),
      stack: strList(p.stack ?? p.keywords),
      bullets: strList(p.bullets ?? p.highlights ?? p.description),
    }));

  base.education = (raw.education ?? []).map((e: any) => ({
    id: str(e.id) || uid("ed"),
    degree: str(e.degree ?? joinDates(e.studyType, e.area, " in ")),
    institution: str(e.institution ?? e.school),
    location: str(e.location),
    dates: str(e.dates ?? e.timeline ?? joinDates(e.startDate, e.endDate)),
    details: str(e.details ?? e.score),
  }));

  base.certifications = Array.isArray(raw.certifications)
    ? raw.certifications.map((c: any) => (typeof c === "string" ? c : str(c.name ?? c.title))).filter(Boolean)
    : typeof raw.certifications === "string"
      ? raw.certifications.split(/\s*[•|;]\s*/).filter(Boolean)
      : [];

  const custom: CustomSection[] = (raw.custom_sections ?? []).map((s: any) => ({
    id: str(s.id) || uid("cs"),
    title: str(s.title),
    items: (s.items ?? []).map(customItem),
  }));
  if (Array.isArray(raw.research_and_open_source) && raw.research_and_open_source.length) {
    custom.push({ id: uid("cs"), title: "Research & Open Source", items: raw.research_and_open_source.map(customItem) });
  }
  base.custom_sections = custom;

  const l = raw.layout ?? {};
  const order: SectionKey[] = Array.isArray(l.order)
    ? (l.order as string[]).filter((k): k is SectionKey => (DEFAULT_ORDER as string[]).includes(k))
    : [...DEFAULT_ORDER];
  for (const key of DEFAULT_ORDER) if (!order.includes(key)) order.push(key);
  base.layout = {
    order,
    hidden: strList(l.hidden),
    template: ["classic", "modern", "compact"].includes(l.template) ? l.template : "classic",
    page: l.page === "Letter" ? "Letter" : "A4",
    density: Number.isFinite(l.density) ? Math.max(-3, Math.min(4, l.density)) : 0,
    accent: typeof l.accent === "string" && /^#[0-9a-f]{6}$/i.test(l.accent) ? l.accent : "#1B1A17",
  };
  return base;
}

function customItem(i: any): CustomItem {
  return {
    id: str(i.id) || uid("ci"),
    title: str(i.title ?? i.name),
    subtitle: str(i.subtitle),
    dates: str(i.dates ?? i.timeline ?? i.date),
    bullets: strList(i.bullets ?? i.highlights),
  };
}

function joinDates(a: unknown, b: unknown, sep = " – "): string {
  return [str(a), str(b)].filter(Boolean).join(sep);
}

/** The resume with hidden sections/items removed (what gets printed and sent to the AI). */
export function visibleResume(r: Resume): Resume {
  const hidden = new Set(r.layout.hidden);
  const show = <T extends { id: string }>(list: T[]) => list.filter((x) => !hidden.has(x.id));
  const out = clone(r);
  out.summary = hidden.has("summary") ? "" : out.summary;
  out.skills = hidden.has("skills") ? [] : show(out.skills);
  out.experience = hidden.has("experience") ? [] : show(out.experience);
  out.projects = hidden.has("projects") ? [] : show(out.projects);
  out.education = hidden.has("education") ? [] : show(out.education);
  out.certifications = hidden.has("certifications") ? [] : out.certifications;
  out.custom_sections = hidden.has("custom")
    ? []
    : show(out.custom_sections).map((s) => ({ ...s, items: show(s.items) }));
  return out;
}

/** All text of the resume, for keyword matching. */
export function resumeText(r: Resume): string {
  const v = visibleResume(r);
  return [
    v.basics.headline,
    v.summary,
    ...v.skills.flatMap((s) => [s.category, ...s.items]),
    ...v.experience.flatMap((e) => [e.role, e.company, ...e.bullets]),
    ...v.projects.flatMap((p) => [p.name, ...p.stack, ...p.bullets]),
    ...v.education.flatMap((e) => [e.degree, e.institution, e.details]),
    ...v.certifications,
    ...v.custom_sections.flatMap((s) => s.items.flatMap((i) => [i.title, i.subtitle, ...i.bullets])),
  ].join("\n");
}

// --------------------------------------------------------------- path editing (inline editor)

export function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<any>((o, k) => (o == null ? o : o[k]), obj);
}

/** Returns a new object with `path` set to `value` (structural sharing, no mutation). */
export function setPath<T>(obj: T, path: string, value: unknown): T {
  const keys = path.split(".");
  const walk = (node: any, i: number): any => {
    if (i === keys.length) return value;
    const key = keys[i];
    const copy = Array.isArray(node) ? [...node] : { ...(node ?? {}) };
    copy[key] = walk(node?.[key], i + 1);
    return copy;
  };
  return walk(obj, 0);
}

export function isEmptyResume(r: Resume): boolean {
  return !r.basics.name && !r.summary && !r.experience.length && !r.projects.length && !r.education.length;
}

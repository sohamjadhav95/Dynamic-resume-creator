import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import sample from "../data/sample-resume.json";
import { SAMPLE_JOB } from "../data/sample-job";
import { heuristicParse, tryJson } from "./importing";
import { containsTerm, extractKeywords, guessJob, highlight, matchKeywords, matchScore } from "./keywords";
import { activeEdits, normalizeResume, resumeText, setPath, splitList, uuid, visibleResume, type FileChange } from "./schema";
import { _reducerForTests as reducer, initialState, activeResume } from "./store";
import {
  acceptRewrite,
  applyAiResult,
  applyFileChanges,
  isSupported,
  offlineTailor,
  updateFileChange,
  type AiTailorOutput,
} from "./tailor";

const legacy = JSON.parse(readFileSync(new URL("../../../examples/legacy_master_resume.json", import.meta.url), "utf8"));

describe("schema", () => {
  it("migrates the original app's master_resume.json", () => {
    const r = normalizeResume(legacy);
    expect(r.basics.name).toBe("Soham Jadhav");
    expect(r.basics.email).toContain("@");
    expect(r.basics.links.length).toBeGreaterThan(1);
    expect(r.skills.length).toBe(3);
    expect(r.skills[0].items).toContain("Python");
    expect(r.experience[0].dates).toBe("May 2026 - Present");
    // the old fake "DYNAMIC_TARGET_PROJECT" placeholder is dropped
    expect(r.projects.map((p) => p.name)).not.toContain("DYNAMIC_TARGET_PROJECT");
    expect(r.projects.length).toBe(3);
    expect(r.custom_sections[0].title).toBe("Research & Open Source");
    expect(r.certifications.length).toBe(4);
    expect(new Set([...r.experience, ...r.projects].map((x) => x.id)).size).toBe(5);
  });

  it("makes UUIDs even where crypto.randomUUID is missing (plain http pages)", () => {
    const original = crypto.randomUUID;
    Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
    try {
      expect(uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    } finally {
      Object.defineProperty(crypto, "randomUUID", { value: original, configurable: true });
    }
  });

  it("splits lists but keeps commas inside parentheses", () => {
    expect(splitList("Python, SQL (Postgres, MySQL); Docker")).toEqual(["Python", "SQL (Postgres, MySQL)", "Docker"]);
  });

  it("setPath does not mutate", () => {
    const r = normalizeResume(sample);
    const next = setPath(r, "experience.0.bullets.1", "changed");
    expect(next.experience[0].bullets[1]).toBe("changed");
    expect(r.experience[0].bullets[1]).not.toBe("changed");
    expect(next.projects).toBe(r.projects);
  });

  it("hides hidden sections and items", () => {
    const r = normalizeResume(sample);
    r.layout.hidden = ["projects", r.experience[1].id];
    const v = visibleResume(r);
    expect(v.projects).toEqual([]);
    expect(v.experience.length).toBe(1);
  });
});

describe("keywords", () => {
  it("finds requirements and nice-to-haves in a job post", () => {
    const kws = extractKeywords(SAMPLE_JOB);
    const terms = kws.map((k) => k.term);
    expect(terms).toEqual(expect.arrayContaining(["Go", "Python", "Kafka", "Kubernetes", "PostgreSQL", "Terraform"]));
    expect(kws.find((k) => k.term === "gRPC")?.importance).toBe("nice");
    expect(kws.find((k) => k.term === "Kafka")?.importance).toBe("must");
    expect(terms).not.toContain("C");
  });

  it("does not match short names inside other words", () => {
    expect(containsTerm("Go-to-market strategy for the C-suite", "Go")).toBe(false);
    expect(containsTerm("Go-to-market strategy for the C-suite", "C")).toBe(false);
    expect(containsTerm("Built services in Go and Python", "Go")).toBe(true);
    expect(containsTerm("gRPC and GraphQL", "C")).toBe(false);
    expect(containsTerm("Wrote firmware in C and C++", "C")).toBe(true);
    expect(containsTerm("Using Node.js and k8s", "Kubernetes")).toBe(true);
  });

  it("scores and highlights", () => {
    const r = normalizeResume(sample);
    const matches = matchKeywords(extractKeywords(SAMPLE_JOB), resumeText(r));
    const score = matchScore(matches);
    expect(score).toBeGreaterThan(40);
    expect(score).toBeLessThanOrEqual(100);
    const segs = highlight(SAMPLE_JOB, matches);
    expect(segs.map((s) => s.text).join("")).toBe(SAMPLE_JOB);
    expect(segs.some((s) => s.match?.term === "Kafka")).toBe(true);
  });

  it("guesses title and company", () => {
    expect(guessJob(SAMPLE_JOB)).toEqual({ title: "Senior Backend Engineer", company: "Acme Freight" });
  });
});

describe("tailoring", () => {
  const master = normalizeResume(sample);

  it("offline engine reorders but never writes new text", () => {
    const { resume, insights } = offlineTailor(master, SAMPLE_JOB);
    expect(insights.engine).toBe("offline");
    const before = new Set(resumeText(master).split("\n"));
    for (const line of resumeText(resume).split("\n")) expect(before.has(line)).toBe(true);
    // same bullets, most relevant first (the mentoring bullet matches the least)
    expect([...resume.experience[0].bullets].sort()).toEqual([...master.experience[0].bullets].sort());
    expect(resume.experience[0].bullets[0]).toMatch(/Kafka|AWS/);
    expect(resume.experience[0].bullets[2]).toMatch(/Mentored/);
  });

  it("truth check drops skills the master never mentions", () => {
    expect(isSupported("Kubernetes", resumeText(master))).toBe(true);
    expect(isSupported("Rust", resumeText(master))).toBe(false);
    const first = master.experience[0].bullets;
    const ai: AiTailorOutput = {
      job: { title: "Backend Engineer", company: "Acme" },
      summary: "New summary.",
      skills: [{ category: master.skills[0].category, items: ["Go", "Kafka", "Rust", "PostgreSQL"] }],
      experience: [{ id: master.experience[0].id, bullets: ["Rewritten bullet"] }, { id: "made-up", bullets: ["x"] }],
      projects: [{ id: master.projects[1].id, stack: ["Go", "Haskell"], bullets: ["Proj bullet"] }],
      project_order: [master.projects[1].id, master.projects[0].id],
      keywords: [{ term: "Kafka", importance: "must" }],
      project_ideas: [{ title: "Idea", stack: ["Go"], pitch: "p" }],
      advice: [],
    };
    const { resume, insights } = applyAiResult(master, ai, "gemini");
    expect(insights.removed).toEqual(["Rust"]);
    expect(resume.skills[0].items).not.toContain("Rust");
    expect(resume.experience.length).toBe(master.experience.length); // unknown ids ignored
    // replace, never add or drop: same number of bullets; a much shorter rewrite keeps the original
    expect(resume.experience[0].bullets).toEqual(first);
    expect(resume.experience[0].company).toBe(master.experience[0].company);
    expect(resume.projects[0].id).toBe(master.projects[1].id);
    expect(resume.projects[0].stack).toEqual(master.projects[1].stack); // a made-up tool is not allowed in
  });

  it("accepts same-size rewrites that keep every number, refuses the rest", () => {
    const old = "Cut AWS spend by 30% by moving batch jobs from always-on EC2 to scheduled Airflow tasks on spot instances.";
    const whole = resumeText(master);
    const good = "Cut AWS costs by 30% by moving batch jobs off always-on EC2 servers onto scheduled Airflow tasks on spot.";
    expect(acceptRewrite(old, good, whole)).toEqual({ text: good, ok: true });
    const dropped = "Cut AWS costs a lot by moving batch jobs off always-on EC2 servers onto scheduled Airflow spot tasks.";
    expect(acceptRewrite(old, dropped, whole).ok).toBe(false);
    const invented = "Cut AWS spend by 30% for 12 teams by moving batch jobs from EC2 to scheduled Airflow tasks on spot.";
    expect(acceptRewrite(old, invented, whole).ok).toBe(false);
    const longer = good + " This also made the nightly reports finish much faster for everyone on the data team.";
    expect(acceptRewrite(old, longer, whole)).toEqual({ text: old, ok: false });
  });

  it("file changes can be switched off and back on", () => {
    const bullet = master.experience[0].bullets[1];
    const change: FileChange = {
      id: "p0-9",
      section: "EXPERIENCE",
      kind: "bullet",
      old: bullet,
      new: "Cut AWS costs by 30% by moving batch jobs off always-on EC2 servers onto scheduled Airflow tasks on spot.",
      status: "applied",
      note: "",
    };
    const tailored = applyFileChanges(master, [change, { ...change, id: "p0-10", status: "unchanged" }]);
    expect(tailored.file_changes?.length).toBe(1);
    expect(tailored.experience[0].bullets[1]).toBe(change.new);
    expect(activeEdits(tailored.file_changes)).toEqual([{ id: "p0-9", text: change.new }]);
    const off = updateFileChange(tailored, "p0-9", { off: true });
    expect(off.experience[0].bullets[1]).toBe(bullet);
    expect(activeEdits(off.file_changes)).toEqual([]);
    const back = updateFileChange(off, "p0-9", { off: false });
    expect(back.experience[0].bullets[1]).toBe(change.new);
  });
});

describe("store", () => {
  it("undo / redo and coalesced typing", () => {
    let s = initialState({ master: normalizeResume(sample), versions: [] });
    const r0 = activeResume(s);
    s = reducer(s, { type: "edit", resume: setPath(r0, "summary", "a"), coalesceKey: "summary" });
    s = reducer(s, { type: "edit", resume: setPath(activeResume(s), "summary", "ab"), coalesceKey: "summary" });
    expect(s.past.length).toBe(1);
    s = reducer(s, { type: "undo" });
    expect(activeResume(s).summary).toBe(r0.summary);
    s = reducer(s, { type: "redo" });
    expect(activeResume(s).summary).toBe("ab");
  });
});

describe("importing", () => {
  it("parses plain resume text without AI", () => {
    const text = `Jane Doe
Product Designer
jane@example.com | +1 555 123 4567 | linkedin.com/in/janedoe

Summary
Designer with 5 years of experience.

Experience
Senior Designer at Figment Jan 2021 - Present
• Led the redesign of the checkout, raising conversion 12%
• Built the design system

Education
B.A. Design
State University

Skills
Design: Figma, Prototyping, User research`;
    const r = heuristicParse(text);
    expect(r.basics.name).toBe("Jane Doe");
    expect(r.basics.email).toBe("jane@example.com");
    expect(r.experience[0].role).toBe("Senior Designer");
    expect(r.experience[0].company).toBe("Figment");
    expect(r.experience[0].bullets.length).toBe(2);
    expect(r.skills[0].items).toContain("Figma");
    expect(r.education[0].institution).toBe("State University");
  });

  it("accepts JSON exports", () => {
    expect(tryJson(JSON.stringify({ master: sample }))?.basics.name).toBe("Alex Rivera");
    expect(tryJson("not json")).toBeNull();
  });
});

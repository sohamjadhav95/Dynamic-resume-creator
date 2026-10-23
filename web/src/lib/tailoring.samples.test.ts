import { describe, expect, it } from "vitest";
import { SAMPLES } from "./fixtures/samples";
import { containsTerm } from "./keywords";
import { normalizeResume, type Resume } from "./schema";
import { lineLimits } from "./source";
import { acceptRewrite, applyAiResult, type AiTailorOutput } from "./tailor";

/** Every rewritable line: its text in the master, in the AI answer and after tailoring. */
function lines(master: Resume, ai: AiTailorOutput, out: Resume) {
  const rows = [{ where: "summary", old: master.summary, ai: ai.summary, now: out.summary }];
  const add = (where: string, olds: string[], news: string[] | undefined, nows: string[]) =>
    olds.forEach((old, k) => rows.push({ where: `${where}.${k}`, old, ai: news?.[k] ?? old, now: nows[k] }));
  for (const e of master.experience)
    add(e.id, e.bullets, ai.experience.find((x) => x.id === e.id)?.bullets, out.experience.find((x) => x.id === e.id)!.bullets);
  for (const p of master.projects)
    add(p.id, p.bullets, ai.projects.find((x) => x.id === p.id)?.bullets, out.projects.find((x) => x.id === p.id)!.bullets);
  master.custom_sections.forEach((s, i) =>
    s.items.forEach((it, j) =>
      add(it.id, it.bullets, ai.other_sections?.find((x) => x.id === it.id)?.bullets, out.custom_sections[i].items[j].bullets),
    ),
  );
  return rows;
}

describe("tailoring sample resumes from many fields", () => {
  for (const s of SAMPLES) {
    it(s.name, () => {
      const master = normalizeResume(s.resume);
      const { resume, insights } = applyAiResult(master, s.ai, "gemini", undefined, s.jd);
      // Every section is tuned to the job: summary, skills and the descriptions.
      if (!s.refuse?.includes(master.summary)) expect(resume.summary).not.toBe(master.summary);
      expect(resume.skills).not.toEqual(master.skills);
      const rows = lines(master, s.ai, resume);
      for (const r of rows) {
        if (r.ai === r.old) expect(r.now, r.where).toBe(r.old);
        else if (s.refuse?.includes(r.old)) expect(r.now, `${r.where} must be refused`).toBe(r.old);
        else expect(r.now, `${r.where} was refused: ${insights.kept?.find((k) => k.old === r.old)?.reason}`).toBe(r.ai);
      }
      // Skills taken from the job post really are in it, and are listed so the person can check them.
      for (const x of insights.added ?? []) expect(containsTerm(s.jd, x)).toBe(true);
      expect(insights.added?.length ?? 0).toBeLessThanOrEqual(4);
    });
  }

  it("tailors most lines across all samples", () => {
    let changed = 0;
    let total = 0;
    for (const s of SAMPLES) {
      const master = normalizeResume(s.resume);
      for (const r of lines(master, s.ai, applyAiResult(master, s.ai, "gemini", undefined, s.jd).resume)) {
        total++;
        if (r.now !== r.old) changed++;
      }
    }
    expect(changed / total).toBeGreaterThan(0.65);
  });
});

describe("what a model gets wrong is refused", () => {
  const kafka = "Built a Kafka-based event pipeline in Go that processes 2M+ shipment updates a day with 99.95% uptime.";
  const jd = "We use Kafka, microservices and Rust. You work in agile sprints and track CAC and ROAS.";
  const cases: [string, string, string, string][] = [
    [kafka, "Leveraged Kafka and Go to build a robust pipeline handling 2M+ shipment updates a day at 99.95% uptime.", kafka, "AI-written"],
    [kafka, "Built a Kafka and Rust event pipeline that processes 2M+ shipment updates a day with 99.95% uptime.", kafka, "mentions Rust"],
    [kafka, "Built a Kafka pipeline of Go microservices that processes 2M+ shipment updates a day with 99.95% uptime.", kafka, '"microservices"'],
    [kafka, "Built a Kafka-based event pipeline in Go that processes 3M+ shipment updates a day with 99.95% uptime.", kafka, "dropped 2"],
    [
      "Mentored 3 junior engineers through code reviews and weekly pairing sessions.",
      "Mentored 3 junior engineers in agile sprints through code reviews and pairing sessions.",
      "Mentored 3 junior engineers through code reviews and weekly pairing sessions.",
      '"agile"',
    ],
    [
      "Managed a $40k monthly Google Ads budget, lowering cost per order by 22%.",
      "Managed a $40k monthly Google Ads budget, lowering CAC by 22%.",
      "Managed a $40k monthly Google Ads budget, lowering cost per order by 22%.",
      "mentions CAC",
    ],
  ];
  for (const [old, bad, own, why] of cases) {
    it(why, () => {
      const r = acceptRewrite(old, bad, `${old} Python SQL`, own, jd);
      expect(r.ok).toBe(false);
      expect(r.reason).toContain(why);
    });
  }

  it("a bullet may not borrow a tool from another job", () => {
    const old = "Designed FastAPI services for patient scheduling used by 40 clinics, reducing booking errors by 25%.";
    const other = "Designed FastAPI services fed by Kafka for patient scheduling used by 40 clinics, cutting booking errors by 25%.";
    const resume = `${old} Built a Kafka pipeline.`;
    expect(acceptRewrite(old, other, resume, old, jd).reason).toContain("mentions Kafka");
    // ...but may name what its own tools imply: FastAPI is Python.
    const python = "Built Python services with FastAPI for patient scheduling used by 40 clinics, cutting booking errors by 25%.";
    expect(acceptRewrite(old, python, resume, old, jd).ok).toBe(true);
  });

  it("lists every problem, so a second try can fix them all", () => {
    const old = "Managed a $40k monthly Google Ads budget, lowering cost per order by 22%.";
    const bad = "Spearheaded a $40k monthly paid acquisition budget across Google Ads, lowering CAC by 22% for the whole team.";
    const reason = acceptRewrite(old, bad, old, old, jd).reason ?? "";
    expect(reason).toContain("is longer than the original");
    expect(reason).toContain("mentions CAC");
    expect(reason).toContain('"spearheaded"');
  });

  it("everyday words from the job post are fine, and a long dash becomes a comma", () => {
    const r = acceptRewrite(kafka, "Built an event-driven Kafka pipeline in Go — 2M+ shipment updates a day at 99.95% uptime.", kafka, kafka, "Event-driven systems.");
    expect(r).toEqual({ ok: true, text: "Built an event-driven Kafka pipeline in Go, 2M+ shipment updates a day at 99.95% uptime." });
  });

  it("a digit inside a name is not a number", () => {
    const old = "Sold B2B software to 40 clinics, with a 95% renewal rate.";
    const next = "Sold B2B software to 40 clinics and kept a 95% renewal rate.";
    expect(acceptRewrite(old, next, old, old, "").ok).toBe(true);
    expect(acceptRewrite(old, "Sold B2B software to 45 clinics, with a 95% renewal rate.", old, old, "").reason).toContain("dropped 40");
  });

  it("words the person already uses are their own voice", () => {
    const old = "Architected a pre-delivery framework validating text and audio in under 3 seconds.";
    const next = "Architected a framework that checks text and audio before delivery in under 3 seconds.";
    expect(acceptRewrite(old, next, old, old, "").ok).toBe(true);
  });
});

describe("tailoring an uploaded PDF", () => {
  const master = normalizeResume(SAMPLES[0].resume);
  const ex = master.experience[0];
  const pdfBlock = (path: string, text: string, room: [number, number]) => ({
    id: path,
    page: 0,
    kind: "bullet" as const,
    section: "",
    text,
    prefix: "",
    lines: [[60, 100, 300, 112]],
    room,
    path,
  });

  it("each line may use the room its lines have, but no more", () => {
    const old = ex.bullets[2]; // "Mentored 3 junior engineers through code reviews and weekly pairing sessions."
    const fuller = "Mentored 3 junior engineers through weekly pairing sessions and code reviews of their Go and Kafka work.";
    const resume = `${old} Go Kafka`;
    expect(acceptRewrite(old, fuller, resume, resume, "", [60, 110]).ok).toBe(true);
    const r = acceptRewrite(old, fuller, resume, resume, "", [60, 90]);
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining("it needs 60-90 characters") });
  });

  it("a skills line that would leave an empty line is topped up with the person's own skills", () => {
    const skills = master.skills[1]; // FastAPI, PostgreSQL, Redis, Kafka, Airflow, dbt
    const withPdf: Resume = {
      ...master,
      layout: {
        ...master.layout,
        source: { file: "0123456789abcdef0123", name: "cv.pdf", pages: [{ width: 595, height: 842 }], edits: {}, blocks: [pdfBlock("skills.1.items", skills.items.join(", "), [40, 60])] },
      },
    };
    const room = lineLimits(withPdf);
    expect(room["skills.1"]).toEqual([40, 60]);
    const ai = { ...SAMPLES[0].ai, skills: master.skills.map((g, i) => (i === 1 ? { category: g.category, items: ["PostgreSQL", "Kafka", "gRPC"] } : g)) };
    const line = applyAiResult(master, ai, "gemini", undefined, SAMPLES[0].jd, room).resume.skills[1].items.join(", ");
    expect(line.startsWith("PostgreSQL, Kafka, gRPC, FastAPI")).toBe(true);
    expect(line.length).toBeGreaterThanOrEqual(40);
    expect(line.length).toBeLessThanOrEqual(60);
  });
});

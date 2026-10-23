import { readFileSync, writeFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import sample from "../../data/sample-resume.json";
import { normalizeResume, setPath } from "../schema";
import { layoutResume, type TextItem } from "./layout";
import { pdfSafe } from "./metrics";
import { buildPdf } from "./pdf";

const legacy = normalizeResume(
  JSON.parse(readFileSync(new URL("../../../../examples/legacy_master_resume.json", import.meta.url), "utf8")),
);

function texts(items: unknown[]): TextItem[] {
  return items.filter((i): i is TextItem => (i as TextItem).kind === "text");
}

describe("page engine", () => {
  it("fits the owner's resume on one A4 page, inside the margins", () => {
    const { print } = layoutResume(legacy);
    expect(print.pages.length).toBe(1);
    expect(print.fits).toBe(true);
    for (const t of texts(print.pages[0])) {
      expect(t.x).toBeGreaterThanOrEqual(42.5 - 0.01);
      expect(t.x + t.width).toBeLessThanOrEqual(print.width - 42.5 + 0.05);
      expect(t.y).toBeLessThan(print.height - 20);
    }
  });

  it("maps every visible word to the field it came from (for click-to-edit)", () => {
    const { screen } = layoutResume(legacy);
    expect(screen.fields["summary"].rects.length).toBeGreaterThan(1);
    expect(screen.fields["experience.0.bullets.1"].kind).toBe("bullet");
    expect(screen.fields["skills.0.items"].kind).toBe("list");
    const words = texts(screen.pages[0]).filter((t) => t.path === "experience.0.bullets.0").map((t) => t.text);
    expect(words.join(" ")).toBe(legacy.experience[0].bullets[0]);
  });

  it("tightens spacing, then text size, to keep long content on one page", () => {
    const long = setPath(legacy, "summary", Array(6).fill(legacy.summary).join(" "));
    const { print } = layoutResume(long);
    expect(print.fits).toBe(true);
    expect(print.tightened).toBe(true);
    const huge = setPath(legacy, "summary", Array(20).fill(legacy.summary).join(" "));
    const over = layoutResume(huge).print;
    expect(over.pages.length).toBe(2);
    expect(over.overflowLines).toBeGreaterThan(0);
    // Two pages anyway: keep the normal look instead of squeezing it.
    expect(over.fontScale).toBe(1);
    expect(over.tightened).toBe(false);
  });

  it("shows hints for empty fields on screen but never in the PDF", () => {
    const blank = normalizeResume({ basics: { name: "" }, experience: [{ company: "Acme", bullets: [""] }] });
    const { print, screen } = layoutResume(blank);
    expect(texts(screen.pages[0]).some((t) => t.placeholder)).toBe(true);
    expect(texts(print.pages[0]).some((t) => t.placeholder)).toBe(false);
  });

  it("writes a one-page PDF with the same words", async () => {
    const { print } = layoutResume(normalizeResume(sample));
    const bytes = await buildPdf(print, { title: "Resume", author: "Test" });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    if (process.env.PAGE_OUT) {
      writeFileSync(`${process.env.PAGE_OUT}/engine_sample.pdf`, bytes);
      const own = await buildPdf(layoutResume(legacy).print, { title: "Resume", author: "Owner" });
      writeFileSync(`${process.env.PAGE_OUT}/engine_owner.pdf`, own);
    }
  });

  it("swaps characters the PDF font cannot draw", () => {
    expect(pdfSafe("Latency → 40ms, naïve ≥ 2x")).toBe("Latency -> 40ms, naïve >= 2x");
    expect(pdfSafe("你好")).toBe("??");
  });

  it("draws an uploaded resume in its own design (\"Your format\")", async () => {
    const r = normalizeResume({
      ...legacy,
      layout: {
        ...legacy.layout,
        template: "custom",
        page: "Letter",
        titles: { experience: "Work History", skills: "Toolbox" },
        custom: { family: "serif", headerAlign: "left", name: 22, body: 10.5, title: 12, accent: "#1f3a5f", rule: 0 },
      },
    });
    const { print } = layoutResume(r);
    const items = texts(print.pages[0]);
    expect(print.width).toBe(612);
    expect(items.every((t) => t.family === "serif")).toBe(true);
    const words = items.map((t) => t.text).join(" ");
    expect(words).toContain("Work History");
    expect(words).toContain("Toolbox");
    const name = items.find((t) => t.path === "basics.name")!;
    expect(name.size).toBeCloseTo(22 * print.fontScale, 5); // may be scaled down a little to fit one page
    expect(name.x).toBeLessThan(80); // left-aligned header
    expect(items.find((t) => t.text === "Toolbox")!.color).toBe("#1f3a5f");
    expect(print.pages[0].some((i) => i.kind === "rule")).toBe(false);
    const doc = await PDFDocument.load(await buildPdf(print, { title: "t", author: "a" }));
    expect(doc.getPageCount()).toBe(1);
  });

  it("follows the uploaded file's entry lines, header order and plain skills list", () => {
    const base = normalizeResume(legacy);
    const r = normalizeResume({
      ...base,
      skills: [{ category: "Clinical Skills", items: ["IV therapy", "Wound care"] }],
      layout: {
        ...base.layout,
        template: "custom",
        titles: { skills: "CLINICAL SKILLS" },
        custom: {
          badgeFirst: true,
          datesBold: false,
          entry: { line: "one", first: "a", join: " — " },
          edu: { line: "one", first: "a", join: ", " },
        },
      },
    });
    const items = texts(layoutResume(r).print.pages[0]);
    const y = (path: string) => items.find((t) => t.path === path)!.y;
    const badge = items.find((t) => t.path === "basics.sub_badge" || t.path === "basics.headline")!;
    const contact = items.find((t) => /^basics\.(contact_line|email|phone)$/.test(t.path ?? ""))!;
    expect(badge.y).toBeLessThan(contact.y); // headline above the contact line
    expect(y("experience.0.role")).toBe(y("experience.0.company")); // "Job title — Company" on one line
    expect(items.some((t) => t.text === "—" && t.y === y("experience.0.role"))).toBe(true);
    expect(items.find((t) => t.path === "experience.0.dates")!.font).toBe("regular");
    expect(y("education.0.degree")).toBe(y("education.0.institution"));
    expect(items.some((t) => t.path === "skills.0.category")).toBe(false); // no "Clinical Skills:" under CLINICAL SKILLS
  });
});

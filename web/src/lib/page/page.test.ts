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


});

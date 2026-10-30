import { describe, expect, it } from "vitest";
import type { FileBlock } from "./api";
import { normalizeResume, setPath } from "./schema";
import {
  a4Limit,
  blockText,
  keepMapped,
  lineLimits,
  mapBlocks,
  paperName,
  pendingEdits,
  place,
  replaceProject,
  room,
  sheetsAsUploaded,
  similarity,
  type Source,
} from "./source";

const resume = normalizeResume({
  summary: "Data analyst with 3 years of experience turning sales data into dashboards.",
  skills: [{ category: "Tools", items: ["SQL", "Python", "Power BI"] }],
  experience: [
    {
      company: "Zestmart",
      role: "Data Analyst",
      bullets: ["Built 25 Power BI dashboards used by 300+ store managers.", "Automated weekly demand forecasts in Python."],
    },
  ],
  projects: [{ name: "Basket", stack: ["pandas"], bullets: ["Found product pairs that lifted cross-sell by 7%."] }],
});

const blk = (id: string, text: string, kind: FileBlock["kind"] = "bullet", prefix = "•"): FileBlock => ({
  id,
  page: 0,
  kind,
  section: "",
  text,
  prefix,
  lines: [[50, 100, 500, 110]],
});

const blocks: FileBlock[] = [
  blk("p0-0", "EXPERIENCE", "heading", ""),
  blk("p0-1", "Data analyst with 3 years of experience turning sales data into dashboards.", "summary", ""),
  blk("p0-2", "Built 25 Power BI dashboards used by 300+ store managers."),
  blk("p0-3", "Automated weekly demand forecasts in Python."),
  blk("p0-4", "SQL • Python • Power BI", "labeled", "Tools:"),
  blk("p0-5", "Zestmart · Data Analyst", "text", ""),
];

function withSource() {
  const mapped = mapBlocks(resume, blocks);
  const source: Source = { file: "a".repeat(32), name: "cv.pdf", pages: [{ width: 612, height: 792 }], blocks: mapped, edits: {} };
  return normalizeResume({ ...resume, layout: { ...resume.layout, source } });
}

describe("your PDF", () => {
  it("ties each field to the block that shows it", () => {
    const paths = Object.fromEntries(mapBlocks(resume, blocks).map((b) => [b.id, b.path]));
    expect(paths["p0-1"]).toBe("summary");
    expect(paths["p0-2"]).toBe("experience.0.bullets.0");
    expect(paths["p0-3"]).toBe("experience.0.bullets.1");
    expect(paths["p0-4"]).toBe("skills.0.items");
    expect(paths["p0-0"]).toBeUndefined(); // headings are never fields
    expect(paths["p0-5"]).toBeUndefined();
    expect(mapBlocks(resume, blocks).find((b) => b.id === "p0-4")?.sep).toBe(" • ");
    expect(similarity("Built 25 dashboards", "built 25 dashboards!")).toBe(1);
  });

  it("knows which blocks changed: fields and direct edits", () => {
    const r = withSource();
    expect(pendingEdits(r)).toEqual({});
    const edited = setPath(setPath(r, "experience.0.bullets.1", "Automated weekly forecasts in Python and SQL."), "layout.source.edits.p0-5", "Zestmart · Senior Analyst");
    expect(pendingEdits(edited)).toEqual({ "p0-3": "Automated weekly forecasts in Python and SQL.", "p0-5": "Zestmart · Senior Analyst" });
    const skills = setPath(r, "skills.0.items", ["Python", "SQL", "Power BI"]);
    expect(blockText(skills, skills.layout.source!.blocks.find((b) => b.id === "p0-4")!)).toBe("Python • SQL • Power BI");
  });

  it("after tailoring, keeps only what the page can show, in the file's order", () => {
    const master = withSource();
    const tailored = structuredClone(master);
    tailored.projects[0].bullets[0] = "Found product pairs for cross-sell (7% lift)."; // the project has no block
    tailored.experience[0].bullets[0] = "Built 25 Power BI dashboards for 300+ store managers.";
    const kept = keepMapped(tailored, master);
    expect(kept.projects[0].bullets[0]).toBe(master.projects[0].bullets[0]);
    expect(kept.experience[0].bullets[0]).toBe("Built 25 Power BI dashboards for 300+ store managers.");
    expect(kept.layout.source?.file).toBe(master.layout.source?.file);
  });

  it("names paper sizes, places lines on sheets and marks where A4 ends", () => {
    expect(paperName({ width: 595.28, height: 841.89 })).toBe("A4");
    expect(paperName({ width: 612, height: 792 })).toBe("Letter");
    expect(paperName({ width: 630, height: 810 })).toBe("222 × 286 mm");
    expect(paperName({ width: 612, height: 1008 })).toBe("Legal");
    // A Legal page (612 x 1008) on A4, same size: two sheets, the second continues at y = 853.87.
    const sheets = [
      { page: 0, y0: 0, y1: 853.87, scale: 0.97268, dx: 0, top: 0, width: 595.28, height: 841.89 },
      { page: 0, y0: 853.87, y1: 1008, scale: 0.97268, dx: 0, top: 19.13, width: 595.28, height: 841.89 },
    ];
    expect(place(sheets, 0, [50, 100, 300, 110])?.sheet).toBe(0);
    const later = place(sheets, 0, [50, 900, 300, 910])!;
    expect(later.sheet).toBe(1);
    expect(later.y).toBeCloseTo(19.13 + (900 - 853.87) * 0.97268, 2);
    expect(a4Limit({ width: 612, height: 1008 })).toBeCloseTo(841.89 / (595.28 / 612), 1);
    expect(a4Limit({ width: 595.28, height: 841.89 })).toBeNull();
    expect(a4Limit({ width: 612, height: 792 })).toBeNull(); // Letter fits within an A4 page's length
    const src: Source = { file: "a".repeat(32), name: "", pages: [{ width: 612, height: 792 }], blocks: [], edits: {} };
    expect(sheetsAsUploaded(src)).toEqual([{ page: 0, y0: 0, y1: 792, scale: 1, dx: 0, top: 0, width: 612, height: 792 }]);
  });

  it("tells the AI how many characters fill each line of the PDF", () => {
    const two = { ...blk("x", "a".repeat(90)), lines: [[50, 100, 450, 110], [50, 112, 250, 122]] };
    expect(room(two)).toEqual([69, 116]); // 60 characters a line: reach the 2nd line, fit in 2 lines
    const r = withSource();
    const limits = lineLimits(r);
    expect(Object.keys(limits)).toEqual(expect.arrayContaining(["summary", `${r.experience[0].id}.0`, `${r.experience[0].id}.1`]));
  });

  it("puts a project idea in place of a project, in that project's own lines", () => {
    const cv = normalizeResume({
      ...resume,
      projects: [
        { name: "Basket: Market Basket Analysis", stack: ["pandas", "mlxtend"], bullets: ["Found product pairs that lifted cross-sell by 7% in a pilot."] },
      ],
    });
    const pblocks: FileBlock[] = [
      blk("p1-0", "PROJECTS", "heading", ""),
      blk("p1-1", "Basket: Market Basket Analysis", "text", ""),
      blk("p1-2", "2024", "text", ""),
      blk("p1-3", "pandas, mlxtend", "text", ""),
      blk("p1-4", "Found product pairs that lifted cross-sell by 7% in a pilot."),
    ];
    const source: Source = { file: "a".repeat(32), name: "cv.pdf", pages: [{ width: 612, height: 792 }], blocks: mapBlocks(cv, pblocks), edits: {} };
    const r = normalizeResume({ ...cv, layout: { ...cv.layout, source } });
    expect(source.blocks.find((b) => b.id === "p1-4")?.path).toBe("projects.0.bullets.0");
    const idea = { title: "Shelf Gap Detector: YOLO on store photos", stack: ["PyTorch", "YOLO", "OpenCV", "FastAPI"], bullet: "Trained a YOLO model to spot empty shelves in store photos." };
    const out = replaceProject(r, 0, idea);
    expect(out.projects[0].id).not.toBe(r.projects[0].id);
    expect(out.projects[0].bullets[0]).toBe(idea.bullet);
    // The title and tools lines hold only as many characters as before: cut at a natural break, and drop tools from the end.
    const edits = out.layout.source!.edits;
    expect(edits["p1-1"]).toBe("Shelf Gap Detector");
    expect(edits["p1-3"].length).toBeLessThanOrEqual("pandas, mlxtend".length);
    expect(edits["p1-3"]).toBe("PyTorch, YOLO");
    expect(edits["p1-2"]).toBeUndefined(); // dates stay
    expect(r.layout.source!.edits).toEqual({}); // the original is untouched
    // A template resume just gets the new project.
    expect(replaceProject(cv, 0, idea).projects[0]).toMatchObject({ name: idea.title, stack: idea.stack, bullets: [idea.bullet], dates: "" });
  });

  it("keeps the PDF details when a resume is saved and loaded", () => {
    const again = normalizeResume(JSON.parse(JSON.stringify(withSource())));
    expect(again.layout.source?.blocks.find((b) => b.id === "p0-2")?.path).toBe("experience.0.bullets.0");
    expect(normalizeResume({ layout: { source: { file: "not a hash", blocks: [], pages: [] } } }).layout.source).toBeUndefined();
  });
});

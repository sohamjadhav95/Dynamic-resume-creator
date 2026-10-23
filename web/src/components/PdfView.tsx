// Shows an uploaded PDF as the page, exactly as the file looks, and lets people edit any text on it.
// The PDF is drawn by pdf.js; clickable areas sit over every text block (from the server's reading of
// the file). Edits go to the resume, and Canvas asks the server to write them into the PDF.

import { useEffect, useMemo, useRef, useState } from "react";
import type { RenderResult } from "../lib/api";
import type { Field } from "../lib/page/layout";
import { loadPdfjs } from "../lib/pdfjs";
import type { Resume } from "../lib/schema";
import { useSelection } from "../lib/selection";
import { a4Limit, blockText, place, type Sheet, type Source, type SourceBlock } from "../lib/source";
import { FieldEditor } from "./PageView";

const PX_PER_PT = 96 / 72;

const LABEL: Record<string, string> = { heading: "Heading", bullet: "Bullet", labeled: "Line", summary: "Summary", text: "Text" };

/** A block as an editable field; its rects are on the sheets (rect.page = sheet index). */
function fieldOf(b: SourceBlock, sheets: Sheet[]): Field {
  const rects = b.lines.flatMap((line) => {
    const at = place(sheets, b.page, line);
    return at ? [{ page: at.sheet, x: at.x, y: at.y - 1, w: Math.max(at.w, 6), h: at.h + 2 }] : [];
  });
  return {
    path: b.path ?? `layout.source.edits.${b.id}`,
    kind: b.path?.endsWith(".items") ? "list" : b.kind === "bullet" ? "bullet" : "text",
    label: b.prefix.replace(/^[^\p{L}\p{N}]+|[\s:–|-]+$/gu, "") || (LABEL[b.kind] ?? "Text"),
    rects,
  };
}

type PdfDoc = { numPages: number; getPage: (n: number) => Promise<any> };

async function loadPdf(bytes: Uint8Array): Promise<{ doc: PdfDoc; close: () => void }> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: bytes.slice() });
  return { doc: (await task.promise) as unknown as PdfDoc, close: () => void task.destroy() };
}

export function PdfView({
  resume,
  source,
  bytes,
  sheets,
  results,
  zoom,
}: {
  resume: Resume;
  source: Source;
  bytes: Uint8Array | null;
  sheets: Sheet[];
  results: RenderResult[];
  zoom: number;
}) {
  const { editing, setEditing } = useSelection();
  const [hover, setHover] = useState<string | null>(null);
  const canvases = useRef<(HTMLCanvasElement | null)[]>([]);
  const scale = PX_PER_PT * zoom;

  // Draw the sheets. A new render is drawn off screen first, so the page never flashes blank.
  useEffect(() => {
    if (!bytes) return;
    let cancelled = false;
    let close = () => {};
    (async () => {
      const loaded = await loadPdf(bytes);
      close = loaded.close;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      for (let n = 1; n <= loaded.doc.numPages && !cancelled; n++) {
        const page = await loaded.doc.getPage(n);
        const viewport = page.getViewport({ scale: scale * dpr });
        const off = document.createElement("canvas");
        off.width = Math.ceil(viewport.width);
        off.height = Math.ceil(viewport.height);
        await page.render({ canvasContext: off.getContext("2d")!, viewport }).promise;
        const target = canvases.current[n - 1];
        if (cancelled || !target) continue;
        target.width = off.width;
        target.height = off.height;
        target.getContext("2d")!.drawImage(off, 0, 0);
      }
    })().catch((err) => console.error("Could not draw the PDF", err));
    return () => {
      cancelled = true;
      close();
    };
  }, [bytes, scale]);

  const fields = useMemo(() => source.blocks.map((b) => ({ block: b, field: fieldOf(b, sheets) })), [source.blocks, sheets]);
  const tooLong = useMemo(() => new Map(results.filter((r) => r.status === "too_long").map((r) => [r.id, r.over ?? 0])), [results]);
  const open = fields.find((f) => f.field.path === editing);
  const asUploaded = !source.paper;

  return (
    <div className="pages" onMouseLeave={() => setHover(null)}>
      {sheets.map((sheet, si) => {
        const W = sheet.width * scale;
        const H = sheet.height * scale;
        const limit = asUploaded ? a4Limit(source.pages[sheet.page]) : null;
        return (
          <div key={si} className="page pdf-page" style={{ width: W, height: H }}>
            <canvas
              ref={(el) => {
                canvases.current[si] = el;
              }}
              style={{ width: W, height: H }}
              aria-label={`Your PDF, page ${si + 1} of ${sheets.length}`}
            />
            <svg className="pdf-hits" viewBox={`0 0 ${sheet.width} ${sheet.height}`} width={W} height={H}>
              {source.paper && sheet.top === 0 && (
                // Where the uploaded page sits on this paper.
                <rect
                  className="paper-edge"
                  x={sheet.dx}
                  y={0}
                  width={source.pages[sheet.page].width * sheet.scale}
                  height={(sheet.y1 - sheet.y0) * sheet.scale}
                />
              )}
              {limit && (
                <g className="a4-limit" aria-hidden="true">
                  <line x1={0} x2={sheet.width} y1={limit} y2={limit} />
                  <text x={sheet.width - 6} y={limit - 4} textAnchor="end">
                    A4 page ends here
                  </text>
                </g>
              )}
              {fields.flatMap(({ block, field }) =>
                field.rects
                  .filter((r) => r.page === si)
                  .map((r, k) => (
                    <rect
                      key={`${block.id}:${k}`}
                      className={`hit ${hover === field.path || editing === field.path ? "on" : ""} ${tooLong.has(block.id) ? "bad" : ""}`}
                      x={r.x - 1.5}
                      y={r.y}
                      width={r.w + 3}
                      height={r.h}
                      rx={1.5}
                      role="button"
                      tabIndex={k === 0 ? 0 : -1}
                      aria-label={`Edit ${field.label.toLowerCase()}: ${blockText(resume, block).slice(0, 60)}`}
                      onMouseEnter={() => setHover(field.path)}
                      onFocus={() => setHover(field.path)}
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditing(field.path);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setEditing(field.path);
                        }
                      }}
                    />
                  )),
              )}
            </svg>
            {open && open.field.rects[0]?.page === si && (
              <FieldEditor
                key={editing}
                field={open.field}
                scale={scale}
                pageWidth={W}
                pageHeight={H}
                onClose={() => setEditing(null)}
                fallback={blockText(resume, open.block)}
                separator={open.block.sep}
                inPdf
                problem={
                  tooLong.has(open.block.id)
                    ? `Too long for its ${open.block.lines.length === 1 ? "line" : `${open.block.lines.length} lines`}: cut about ${tooLong.get(open.block.id)} characters. The page keeps the old text until it fits.`
                    : ""
                }
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

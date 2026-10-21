// Writes a page layout to a real PDF (selectable text, readable by applicant tracking systems).
// Every word is drawn at the position the layout engine computed, so the PDF matches the screen.

import { PDFDocument, rgb, type PDFFont } from "pdf-lib";
import { PDF_FONT, type FontKey } from "./metrics";
import type { PageLayout } from "./layout";

function color(hex: string) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export async function buildPdf(layout: PageLayout, meta: { title: string; author: string }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(meta.title);
  doc.setAuthor(meta.author);
  doc.setCreator("Tailor");
  doc.setProducer("Tailor");
  const fonts = {} as Record<FontKey, PDFFont>;
  for (const key of Object.keys(PDF_FONT) as FontKey[]) fonts[key] = await doc.embedFont(PDF_FONT[key]);

  for (const items of layout.pages) {
    const page = doc.addPage([layout.width, layout.height]);
    const H = layout.height;
    for (const item of items) {
      if (item.kind === "rule") {
        page.drawLine({
          start: { x: item.x1, y: H - item.y },
          end: { x: item.x2, y: H - item.y },
          thickness: item.thickness,
          color: color(item.color),
        });
      } else if (!item.placeholder) {
        page.drawText(item.text, { x: item.x, y: H - item.y, size: item.size, font: fonts[item.font], color: color(item.color) });
      }
    }
  }
  return doc.save();
}

export function downloadPdf(bytes: Uint8Array, filename: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".pdf") ? filename : `${filename}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

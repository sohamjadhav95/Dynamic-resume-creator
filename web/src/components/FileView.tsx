// Shows the person's own file. PDFs are drawn page by page with pdf.js, so what you see is
// exactly what you download. Word files use a browser preview (Word itself may differ slightly).

import { useEffect, useRef, useState } from "react";
import { base64ToBytes } from "../lib/schema";
import { DocxViewer } from "./DocxViewer";

export function FileView({ type, data, zoom, font }: { type: "pdf" | "docx"; data: string; zoom: number; font?: string }) {
  return type === "pdf" ? <PdfView data={data} zoom={zoom} /> : <DocxViewer docData={data} zoom={zoom} font={font} />;
}

function PdfView({ data, zoom }: { data: string; zoom: number }) {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    let destroy: (() => void) | undefined;
    (async () => {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      const task = pdfjs.getDocument({ data: base64ToBytes(data) });
      destroy = () => void task.destroy();
      const doc = await task.promise;
      const pages: HTMLCanvasElement[] = [];
      const ratio = Math.min(window.devicePixelRatio || 1, 3);
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const css = page.getViewport({ scale: (zoom * 96) / 72 });
        const viewport = page.getViewport({ scale: ((zoom * 96) / 72) * ratio });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(css.width)}px`;
        canvas.style.height = `${Math.floor(css.height)}px`;
        canvas.className = "file-page";
        canvas.setAttribute("role", "img");
        canvas.setAttribute("aria-label", `Page ${n} of ${doc.numPages}`);
        await page.render({ canvas, viewport }).promise;
        if (cancelled) return;
        pages.push(canvas);
      }
      if (cancelled || !host.current) return;
      host.current.replaceChildren(...pages);
      setStatus("ready");
    })().catch((err) => {
      if (cancelled) return;
      console.error("PDF preview failed", err);
      setStatus("error");
    });
    return () => {
      cancelled = true;
      destroy?.();
    };
  }, [data, zoom]);

  return (
    <div className="file-view">
      {status === "loading" && <div className="file-status">Loading your file…</div>}
      {status === "error" && (
        <div className="file-status error">Couldn't show the preview. You can still download the file.</div>
      )}
      <div ref={host} className="file-pages" />
    </div>
  );
}

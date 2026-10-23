// pdf.js, loaded only when a PDF is shown or read (it is large), with its worker bundled by Vite.

import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

export async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  return pdfjs;
}

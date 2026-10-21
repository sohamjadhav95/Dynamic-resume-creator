import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { layoutResume } from "../lib/page/layout";
import { buildPdf, downloadPdf } from "../lib/page/pdf";
import { loadPrefs, savePrefs } from "../lib/prefs";
import { useStore } from "../lib/store";
import { Icon } from "./Icon";
import { PageView } from "./PageView";
import { useToast } from "./ui";

const PX_PER_PT = 96 / 72;

export function Canvas({ title }: { title: string }) {
  const { resume } = useStore();
  const toast = useToast();
  const canvasRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(() => loadPrefs().zoom);
  const [fitZoom, setFitZoom] = useState(1);
  const [busy, setBusy] = useState(false);

  // One layout drives both the page on screen and the downloaded PDF.
  const { print, screen } = useMemo(() => layoutResume(resume), [resume]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const update = () => {
      const pageWpx = print.width * PX_PER_PT;
      setFitZoom(Math.max(0.35, Math.min(1.5, (el.clientWidth - 40) / pageWpx)));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [print.width]);

  const effectiveZoom = zoom || fitZoom;
  const setZoomPref = (z: number) => {
    setZoom(z);
    savePrefs({ zoom: z });
  };

  const baseName = useCallback(() => {
    const who = resume.basics.name || "Resume";
    const forJob = title.startsWith("Tailored for ") ? ` - ${title.slice(13)}` : "";
    return `${who}${forJob} Resume`.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  }, [resume.basics.name, title]);

  const downloadPdfFile = useCallback(async () => {
    setBusy(true);
    try {
      const bytes = await buildPdf(print, { title: baseName(), author: resume.basics.name || "" });
      downloadPdf(bytes, baseName());
    } catch (err) {
      console.error("PDF export failed", err);
      toast({ message: "Couldn't create the PDF. Please try again.", kind: "error" });
    } finally {
      setBusy(false);
    }
  }, [print, baseName, resume.basics.name, toast]);

  // Ctrl+P and other parts of the app ask for the PDF through this event.
  useEffect(() => {
    const onDownload = () => void downloadPdfFile();
    window.addEventListener("tailor:download-pdf", onDownload);
    return () => window.removeEventListener("tailor:download-pdf", onDownload);
  }, [downloadPdfFile]);

  const downloadWord = async () => {
    try {
      const { downloadDocxBlob, generateDocxBlob } = await import("../lib/docxExport");
      downloadDocxBlob(await generateDocxBlob(resume), baseName().replace(/[^a-zA-Z0-9_ -]/g, "_"));
    } catch (err) {
      console.error("Failed to create the Word file:", err);
    }
  };

  return (
    <main className="center" id="main" aria-label="Resume page">
      <div className="canvas-bar">
        <div className="doc-title grow" title={title}>
          {title}
        </div>
        <span className="meter" aria-live="polite">
          {print.fits ? (
            <span className="badge ok" title={print.tightened ? "Spacing was tightened a little to keep it on one page" : undefined}>
              <Icon name="check" size={13} /> 1 page{print.tightened ? " · tightened" : ""}
            </span>
          ) : (
            <>
              <span className={`badge ${print.pages.length > 2 ? "bad" : "warn"}`}>
                <Icon name="page" size={13} /> {print.pages.length} pages · over by ~{print.overflowLines} lines
              </span>
              <span className="hint hide-sm">Shorten a bullet or hide an item to fit one page.</span>
            </>
          )}
        </span>
        <div className="row hide-sm" role="group" aria-label="Zoom">
          <button className="icon-btn sm" aria-label="Zoom out" onClick={() => setZoomPref(Math.max(0.4, +(effectiveZoom - 0.1).toFixed(2)))}>
            −
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setZoomPref(0)} title="Fit to width" style={{ minWidth: 56 }}>
            {Math.round(effectiveZoom * 100)}%
          </button>
          <button className="icon-btn sm" aria-label="Zoom in" onClick={() => setZoomPref(Math.min(2, +(effectiveZoom + 0.1).toFixed(2)))}>
            +
          </button>
        </div>
        <button className="btn btn-sm hide-sm" onClick={downloadWord} title="Download as a Word file (.docx)">
          <Icon name="page" size={15} /> Word
        </button>
        <button className="btn btn-ink btn-sm" onClick={downloadPdfFile} disabled={busy} title="Download the PDF (Ctrl+P)">
          <Icon name="download" size={16} /> {busy ? "PDF…" : "PDF"}
        </button>
      </div>
      <div className="canvas" ref={canvasRef}>
        <PageView layout={screen} zoom={effectiveZoom} />
      </div>
      <p className="canvas-hint hide-sm">Click any text on the page to edit it. The PDF is exactly this page.</p>
    </main>
  );
}

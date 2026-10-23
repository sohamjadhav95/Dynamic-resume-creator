import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RenderResult } from "../lib/api";
import { layoutResume } from "../lib/page/layout";
import { buildPdf, downloadPdf } from "../lib/page/pdf";
import { loadPrefs, savePrefs } from "../lib/prefs";
import { getFile, paperName, renderSource, sheetsAsUploaded, sourceOf, type Sheet, type Source } from "../lib/source";
import { useStore } from "../lib/store";
import { Icon } from "./Icon";
import { PageView } from "./PageView";
import { PdfView } from "./PdfView";
import { Guard, useToast } from "./ui";

const PX_PER_PT = 96 / 72;

/** The uploaded PDF with the resume's current text written in (re-rendered shortly after each edit). */
function usePdf(source: ReturnType<typeof sourceOf>, resume: Parameters<typeof renderSource>[0], userId: string | null) {
  const [file, setFile] = useState<string | null | undefined>(undefined); // undefined = loading, null = missing
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [results, setResults] = useState<RenderResult[]>([]);
  const [sheets, setSheets] = useState<Sheet[]>(() => (source ? sheetsAsUploaded(source) : []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileIdRef = source?.file;

  useEffect(() => {
    if (!fileIdRef) return;
    let live = true;
    setFile(undefined);
    getFile(fileIdRef, userId).then((b64) => live && setFile(b64));
    return () => {
      live = false;
    };
  }, [fileIdRef, userId]);

  useEffect(() => {
    if (!source || !file) return;
    let live = true;
    const t = window.setTimeout(async () => {
      setBusy(true);
      try {
        const out = await renderSource(resume, file);
        if (!live) return;
        setBytes(out.bytes);
        setResults(out.results);
        setSheets(out.sheets);
        setError("");
      } catch (err) {
        if (live) setError((err as Error).message || "Couldn't update your PDF.");
      } finally {
        if (live) setBusy(false);
      }
    }, 350);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [source, resume, file]);

  return { file, bytes, results, sheets, busy, error };
}

export function Canvas({ title, userId }: { title: string; userId: string | null }) {
  const { resume, edit } = useStore();
  const toast = useToast();
  const canvasRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(() => loadPrefs().zoom);
  const [fitZoom, setFitZoom] = useState(1);
  const [busy, setBusy] = useState(false);

  const source = sourceOf(resume);
  const pdf = usePdf(source, resume, userId);
  // Template resumes: one layout drives both the page on screen and the downloaded PDF.
  const { print, screen } = useMemo(() => layoutResume(resume), [resume]);
  const pageWidth = source ? (pdf.sheets[0] ?? source.pages[0]).width : print.width;
  const original = source ? paperName(source.pages[0]) : "";
  // "": as uploaded; "A4:shrink" = scale onto one sheet; "A4:pages" = same size, more sheets.
  const paperChoice = source?.paper ? `${source.paper}:${source.fit ?? "shrink"}` : "";
  const setPaper = (choice: string) => {
    if (!source) return;
    const [paper, fit] = choice.split(":") as [Source["paper"], Source["fit"]];
    const { paper: _p, fit: _f, ...rest } = source;
    edit({ ...resume, layout: { ...resume.layout, source: choice ? { ...rest, paper, fit } : rest } }, "paper");
  };

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const update = () => setFitZoom(Math.max(0.35, Math.min(1.5, (el.clientWidth - 40) / (pageWidth * PX_PER_PT))));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pageWidth]);

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
      if (source) {
        if (!pdf.file) throw new Error("Your PDF isn't loaded yet.");
        downloadPdf((await renderSource(resume, pdf.file)).bytes, baseName());
      } else {
        downloadPdf(await buildPdf(print, { title: baseName(), author: resume.basics.name || "" }), baseName());
      }
    } catch (err) {
      console.error("PDF export failed", err);
      toast({ message: "Couldn't create the PDF. Please try again.", kind: "error" });
    } finally {
      setBusy(false);
    }
  }, [source, pdf.file, resume, print, baseName, toast]);

  // Ctrl+P and other parts of the app ask for the PDF through this event.
  useEffect(() => {
    const onDownload = () => void downloadPdfFile();
    window.addEventListener("tailor:download-pdf", onDownload);
    return () => window.removeEventListener("tailor:download-pdf", onDownload);
  }, [downloadPdfFile]);

  const misfits = pdf.results.filter((r) => r.status === "too_long").length;
  const meter = source ? (
    <span className="meter" aria-live="polite">
      <span className="badge ok" title="The page is your uploaded PDF; only the text you change is rewritten.">
        <Icon name="page" size={13} /> Your PDF · {pdf.sheets.length || source.pages.length} page
        {(pdf.sheets.length || source.pages.length) > 1 ? "s" : ""}
      </span>
      <select className="select select-sm" aria-label="Paper size" value={paperChoice} onChange={(e) => setPaper(e.target.value)}>
        <option value="">As uploaded ({original})</option>
        {(["A4", "Letter"] as const).map((p) => [
          <option key={`${p}:pages`} value={`${p}:pages`}>
            {p}: same size, more pages
          </option>,
          <option key={`${p}:shrink`} value={`${p}:shrink`}>
            {p}: shrink to fit each page
          </option>,
        ])}
      </select>
      {misfits > 0 && (
        <span className="badge warn" title="Red lines on the page: the new text needs more room than the old text had.">
          {misfits} change{misfits > 1 ? "s" : ""} too long
        </span>
      )}
      {pdf.busy && <span className="hint">Updating…</span>}
    </span>
  ) : (
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
  );

  const removeSource = () => {
    const { source: _source, ...layout } = resume.layout;
    edit({ ...resume, layout });
  };

  return (
    <main className="center" id="main" aria-label="Resume page">
      <div className="canvas-bar">
        <div className="doc-title grow" title={title}>
          {title}
        </div>
        {meter}
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
        <button className="btn btn-ink btn-sm" onClick={downloadPdfFile} disabled={busy} title="Download the PDF (Ctrl+P)">
          <Icon name="download" size={16} /> {busy ? "PDF…" : "PDF"}
        </button>
      </div>
      <div className="canvas" ref={canvasRef}>
        <Guard label="the page">
        {!source ? (
          <PageView layout={screen} zoom={effectiveZoom} />
        ) : pdf.file === null ? (
          <div className="empty-state">
            <p>
              Your original PDF (<strong>{source.name}</strong>) isn&apos;t saved in this browser.
            </p>
            <p className="hint">Upload it again from the resume menu, or show your content in a template.</p>
            <button className="btn btn-sm" onClick={removeSource}>
              Use a template instead
            </button>
          </div>
        ) : (
          <PdfView resume={resume} source={source} bytes={pdf.bytes} sheets={pdf.sheets} results={pdf.results} zoom={effectiveZoom} />
        )}
        </Guard>
      </div>
      {pdf.error && source && <p className="canvas-hint bad">{pdf.error}</p>}
      <p className="canvas-hint hide-sm">
        {source ? "Click any text on your PDF to change it. Everything else stays exactly as it is." : "Click any text on the page to edit it. The PDF is exactly this page."}
      </p>
    </main>
  );
}

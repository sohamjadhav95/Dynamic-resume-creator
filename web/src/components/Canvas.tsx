import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { downloadDocxBlob, generateDocxBlob } from "../lib/docxExport";
import { loadPrefs, savePrefs } from "../lib/prefs";
import type { Resume } from "../lib/schema";
import { useStore } from "../lib/store";
import { DocxViewer } from "./DocxViewer";
import { Icon } from "./Icon";
import { ResumePage } from "./ResumePage";

export const PAGE_MM = { A4: { w: 210, h: 297 }, Letter: { w: 215.9, h: 279.4 } };

export function marginMm(r: Resume): number {
  const d = r.layout.density;
  return r.layout.template === "compact" ? 10.5 - d * 1.0 : 13 - d * 1.2;
}

export interface PageInfo {
  pages: number;
  overflowLines: number;
  fits: boolean;
}

export function Canvas({ title, onPrint }: { title: string; onPrint: () => void }) {
  const { resume, edit } = useStore();
  const sheetRef = useRef<HTMLDivElement>(null);
  const pageProbe = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [info, setInfo] = useState<PageInfo>({ pages: 1, overflowLines: 0, fits: true });
  const [guides, setGuides] = useState<number[]>([]);
  const [zoom, setZoom] = useState(() => loadPrefs().zoom);
  const [fitZoom, setFitZoom] = useState(1);
  const fitting = useRef(false);
  const [viewMode, setViewMode] = useState<"template" | "doc">(() => (resume.doc_data ? "doc" : "template"));
  const [generatedDocBlob, setGeneratedDocBlob] = useState<Blob | null>(null);

  useEffect(() => {
    if (viewMode === "doc" && !resume.doc_data) {
      generateDocxBlob(resume).then(setGeneratedDocBlob);
    }
  }, [viewMode, resume]);

  const measure = useCallback(() => {
    const sheet = sheetRef.current;
    const probe = pageProbe.current;
    if (!sheet || !probe) return;
    const pageH = probe.offsetHeight;
    if (!pageH) return;
    const flow = Array.from(sheet.children).filter((c) => getComputedStyle(c).position !== "absolute") as HTMLElement[];
    const bottom = Math.max(0, ...flow.map((c) => c.offsetTop + c.offsetHeight));
    const contentH = bottom + parseFloat(getComputedStyle(sheet).paddingBottom);
    const lineH = parseFloat(getComputedStyle(sheet).lineHeight) || 16;
    const pages = Math.min(20, Math.max(1, Math.ceil((contentH - 2) / pageH)));
    const fits = contentH <= pageH + 2;
    setInfo({ pages, fits, overflowLines: fits ? 0 : Math.ceil((contentH - pageH) / lineH) });
    setGuides(Array.from({ length: pages - 1 }, (_, i) => (i + 1) * pageH));
  }, []);

  useLayoutEffect(measure, [resume, measure]);
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    const ro = new ResizeObserver(measure);
    ro.observe(sheet);
    document.fonts?.ready.then(measure);
    return () => ro.disconnect();
  }, [measure]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const update = () => {
      const pageWpx = (PAGE_MM[resume.layout.page].w / 25.4) * 96;
      const available = el.clientWidth - 32;
      setFitZoom(Math.max(0.35, Math.min(1.25, available / pageWpx)));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [resume.layout.page]);

  useEffect(() => {
    if (!fitting.current) return;
    if (info.fits || resume.layout.density >= 4) {
      fitting.current = false;
      return;
    }
    edit({ ...resume, layout: { ...resume.layout, density: resume.layout.density + 1 } }, "fit");
  }, [info, resume, edit]);

  const effectiveZoom = zoom || fitZoom;
  const setZoomPref = (z: number) => {
    setZoom(z);
    savePrefs({ zoom: z });
  };

  const handleDownloadDocx = async () => {
    try {
      const who = resume.basics.name || "Resume";
      const filename = `${who} Resume`.replace(/[^a-zA-Z0-9_-]/g, "_");

      if (resume.doc_data) {
        const binary = atob(resume.doc_data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        });
        downloadDocxBlob(blob, filename);
      } else {
        const blob = await generateDocxBlob(resume);
        downloadDocxBlob(blob, filename);
      }
    } catch (err) {
      console.error("Failed to download docx:", err);
    }
  };

  const page = PAGE_MM[resume.layout.page];
  const margin = marginMm(resume);

  return (
    <main className="center" id="main" aria-label="Resume preview">
      <style>{`@page { size: ${resume.layout.page === "A4" ? "A4" : "letter"}; margin: ${margin.toFixed(1)}mm; }
@media print { .sheet { padding: 0 !important; width: auto !important; min-height: 0 !important; } }`}</style>
      <div className="canvas-bar no-print">
        <div className="doc-title grow" title={title}>
          {title}
        </div>
        <div className="segmented" role="tablist" aria-label="Preview Mode" style={{ margin: "0 4px" }}>
          <button
            role="tab"
            aria-selected={viewMode === "doc"}
            onClick={() => setViewMode("doc")}
            className="sm"
            title="Read resume in exact Word document format"
          >
            Word (.docx) View
          </button>
          <button
            role="tab"
            aria-selected={viewMode === "template"}
            onClick={() => setViewMode("template")}
            className="sm"
            title="Interactive click-to-edit template"
          >
            Interactive Edit
          </button>
        </div>
        {viewMode === "template" && (
          <span className="meter" aria-live="polite">
            {info.fits ? (
              <span className="badge ok">
                <Icon name="check" size={13} /> 1 page
              </span>
            ) : (
              <>
                <span className={`badge ${info.pages > 2 ? "bad" : "warn"}`}>
                  <Icon name="page" size={13} /> {info.pages} pages · over by ~{info.overflowLines} lines
                </span>
                {resume.layout.density < 4 && (
                  <button
                    className="btn btn-sm"
                    onClick={() => {
                      fitting.current = true;
                      edit({ ...resume, layout: { ...resume.layout, density: resume.layout.density + 1 } }, "fit");
                    }}
                  >
                    Fit to 1 page
                  </button>
                )}
              </>
            )}
          </span>
        )}
        <div className="row hide-sm" role="group" aria-label="Zoom">
          <button className="icon-btn sm" aria-label="Zoom out" onClick={() => setZoomPref(Math.max(0.4, +(effectiveZoom - 0.1).toFixed(2)))}>
            −
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setZoomPref(0)} title="Fit to width" style={{ minWidth: 56 }}>
            {Math.round(effectiveZoom * 100)}%
          </button>
          <button className="icon-btn sm" aria-label="Zoom in" onClick={() => setZoomPref(Math.min(1.6, +(effectiveZoom + 0.1).toFixed(2)))}>
            +
          </button>
        </div>
        <button className="btn btn-sm" onClick={handleDownloadDocx} title="Download exact Word document (.docx)">
          <Icon name="page" size={15} /> Word (.docx)
        </button>
        <button className="btn btn-ink btn-sm" onClick={onPrint} title="Print or save as PDF">
          <Icon name="download" size={16} /> PDF
        </button>
      </div>
      <div className="canvas" ref={canvasRef}>
        {viewMode === "doc" ? (
          <div className="doc-preview-wrapper" style={{ width: "100%", padding: "20px 0", overflowY: "auto" }}>
            <DocxViewer
              docData={resume.doc_data || generatedDocBlob || ""}
              zoom={effectiveZoom}
            />
          </div>
        ) : (
          <div className="print-root" style={{ zoom: effectiveZoom }}>
            <div
              ref={sheetRef}
              className={`sheet tpl-${resume.layout.template} page-${resume.layout.page.toLowerCase()}`}
              style={{ ["--d" as string]: resume.layout.density, ["--accent-ink" as string]: resume.layout.accent }}
              lang="en"
            >
              <div ref={pageProbe} className="no-print" aria-hidden="true" style={{ position: "absolute", top: 0, left: 0, width: 1, height: `${page.h}mm`, visibility: "hidden", pointerEvents: "none" }} />
              <ResumePage resume={resume} />
              {guides.map((y, i) => (
                <div key={y} className="page-break-guide no-print" style={{ top: y }} aria-hidden="true">
                  <span>Page {i + 2}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

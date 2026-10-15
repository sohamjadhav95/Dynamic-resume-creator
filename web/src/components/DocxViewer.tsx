import { useEffect, useRef, useState } from "react";
import { base64ToBytes } from "../lib/schema";

/** Browser preview of a Word file (base64). Word's own layout can differ slightly. */
export function DocxViewer({ docData, zoom = 1, font }: { docData: string; zoom?: number; font?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let active = true;
    const container = containerRef.current;
    if (!container) return;
    setStatus("loading");
    container.innerHTML = "";
    const bytes = base64ToBytes(docData);
    import("docx-preview")
      .then(({ renderAsync }) =>
        renderAsync(bytes.buffer as ArrayBuffer, container, undefined, {
          className: "docx-page",
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          breakPages: true,
          useBase64URL: true,
        }),
      )
      .then(() => active && setStatus("ready"))
      .catch((err) => {
        console.error("Word preview failed", err);
        if (active) setStatus("error");
      });
    return () => {
      active = false;
    };
  }, [docData]);

  return (
    <div className="docx-viewer-root">
      {status === "loading" && <div className="file-status">Loading your file…</div>}
      {status === "error" && (
        <div className="file-status error">Couldn't show the preview. You can still download the file.</div>
      )}
      {font && (
        // The preview library ignores Word's default "Normal" font and falls back to the theme font,
        // which changes how lines wrap. Point the theme fonts at the document's real body font.
        <style>{`.docx-container .docx-wrapper { --docx-minorHAnsi-font: "${font}", Arial, sans-serif !important; }`}</style>
      )}
      <div
        ref={containerRef}
        className="docx-container"
        style={{ zoom, display: status === "error" ? "none" : "block" }}
      />
    </div>
  );
}

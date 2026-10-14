import { useEffect, useRef, useState } from "react";
import { renderAsync } from "docx-preview";

interface DocxViewerProps {
  docData: Blob | ArrayBuffer | string;
  zoom?: number;
}

export function DocxViewer({ docData, zoom = 1 }: DocxViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const render = async () => {
      const container = containerRef.current;
      if (!container) return;

      setLoading(true);
      setError(null);
      container.innerHTML = "";

      try {
        let buffer: ArrayBuffer;
        if (typeof docData === "string") {
          // base64 string
          const binary = atob(docData);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          buffer = bytes.buffer;
        } else if (docData instanceof Blob) {
          buffer = await docData.arrayBuffer();
        } else {
          buffer = docData;
        }

        if (!active) return;

        await renderAsync(buffer, container, undefined, {
          className: "docx-page",
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          breakPages: true,
          useBase64URL: true,
        });

        if (active) setLoading(false);
      } catch (err) {
        console.error("Error rendering docx:", err);
        if (active) {
          setError("Could not render Word preview. You can still download the document directly.");
          setLoading(false);
        }
      }
    };

    render();
    return () => {
      active = false;
    };
  }, [docData]);

  return (
    <div className="docx-viewer-root" style={{ width: "100%", display: "flex", justifyContent: "center" }}>
      {loading && (
        <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>
          Loading document preview…
        </div>
      )}
      {error && (
        <div style={{ padding: 30, textAlign: "center", color: "var(--accent-wine)" }}>
          {error}
        </div>
      )}
      <div
        ref={containerRef}
        className="docx-container"
        style={{
          transform: `scale(${zoom})`,
          transformOrigin: "top center",
          transition: "transform 0.15s ease",
          display: loading || error ? "none" : "block",
        }}
      />
    </div>
  );
}

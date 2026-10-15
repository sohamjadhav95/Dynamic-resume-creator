import { useRef, useState } from "react";
import { streamAi } from "../lib/api";
import { processResumeFile, heuristicParse, tryJson } from "../lib/importing";
import { normalizeResume, type Resume } from "../lib/schema";
import { Icon } from "./Icon";
import { Dialog, useToast } from "./ui";

export function ImportDialog({
  initialTab = "upload",
  onDone,
  onClose,
}: {
  initialTab?: "upload" | "paste";
  onDone: (resume: Resume) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [tab, setTab] = useState(initialTab);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const structure = async (raw: string) => {
    setError("");
    const finish = (r: Resume) => onDone(r);
    const json = tryJson(raw);
    if (json) {
      finish(json);
      return;
    }
    if (raw.trim().length < 40) {
      setError("That's too short to be a resume. Paste the whole thing.");
      return;
    }
    setBusy("Reading your resume with AI…");
    abort.current = new AbortController();
    try {
      const final = await streamAi(
        "/api/parse",
        { text: raw.slice(0, 30000) },
        (e) => {
          if (e.type === "stage") setBusy(`Reading your resume with ${e.data.label}…`);
        },
        abort.current.signal,
      );
      if (final.type === "result") {
        finish(normalizeResume(final.data.data));
        return;
      }
      toast({
        message:
          final.type === "limit" ? final.data.message : "AI is unavailable, so we used quick import. Please check each section.",
      });
      finish(heuristicParse(raw));
    } catch (e) {
      if (abort.current?.signal.aborted) {
        finish(heuristicParse(raw));
        return;
      }
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    setBusy("Reading your file…");
    try {
      const proc = await processResumeFile(file);
      setBusy(null);
      await structure(proc.text);
    } catch (e) {
      setBusy(null);
      setError((e as Error).message);
    }
  };

  return (
    <Dialog
      title="Bring in your resume"
      subtitle="Upload your resume or a JSON export. AI splits it into sections you can edit on the page. Nothing is invented."
      onClose={() => {
        abort.current?.abort();
        onClose();
      }}
    >
      <div className="segmented" role="tablist" aria-label="Import method" style={{ marginBottom: 14 }}>
        <button role="tab" aria-selected={tab === "upload"} onClick={() => setTab("upload")}>
          Upload file
        </button>
        <button role="tab" aria-selected={tab === "paste"} onClick={() => setTab("paste")}>
          Paste text
        </button>
      </div>

      {busy ? (
        <div className="progress-card" aria-live="polite" aria-busy="true">
          <strong>{busy}</strong>
          <div className="progress-bar" aria-hidden="true">
            <i />
          </div>
          <div className="row">
            <button className="btn btn-sm" onClick={() => abort.current?.abort()}>
              <Icon name="bolt" size={15} /> Use quick import instead
            </button>
          </div>
        </div>
      ) : tab === "upload" ? (
        <div
          className={`drop-zone ${over ? "over" : ""}`}
          role="button"
          tabIndex={0}
          onClick={() => fileInput.current?.click()}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileInput.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            onFile(e.dataTransfer.files[0]);
          }}
        >
          <Icon name="upload" size={28} />
          <p style={{ margin: "10px 0 4px", fontWeight: 600 }}>Drop your resume here, or click to choose</p>
          <p className="hint" style={{ margin: 0 }}>
            PDF, Word (.docx), text, or a JSON file (e.g. your master_resume.json) · max 3 MB
          </p>
          <input
            ref={fileInput}
            type="file"
            accept=".pdf,.docx,.txt,.md,.json,application/pdf"
            hidden
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </div>
      ) : (
        <div className="stack">
          <textarea
            className="textarea"
            rows={12}
            placeholder="Paste your full resume text here…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label="Resume text"
          />
          <button className="btn btn-primary" onClick={() => structure(text)} disabled={!text.trim()}>
            Continue
          </button>
        </div>
      )}
      {error && (
        <p role="alert" style={{ color: "var(--accent-strong)", marginBottom: 0 }}>
          {error}
        </p>
      )}
    </Dialog>
  );
}

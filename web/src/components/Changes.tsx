// The list of lines tailoring changed inside an uploaded file, plus a plain explanation of how
// tailoring works. Each change can be switched off or reworded; reworded text is checked on the
// server so it still fits in the same lines.

import { useState } from "react";
import { renderFile } from "../lib/api";
import { rememberFile } from "../lib/files";
import { activeEdits, type FileChange } from "../lib/schema";
import { useStore } from "../lib/store";
import { updateFileChange } from "../lib/tailor";
import { Icon } from "./Icon";
import { useToast } from "./ui";

function niceSection(section: string): string {
  const s = section.trim().toLowerCase();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Top";
}

function where(c: FileChange): string {
  if (c.kind === "summary") return "Summary";
  if (c.kind === "bullet") return `${niceSection(c.section)} · bullet`;
  return niceSection(c.section);
}

export function ChangesCard() {
  const { resume, edit } = useStore();
  const toast = useToast();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const changes = resume.file_changes ?? [];
  const applied = changes.filter((c) => c.status === "applied");
  const on = applied.filter((c) => !c.off).length;
  if (!resume.source || !changes.length) return null;

  const save = async (c: FileChange) => {
    const text = draft.replace(/\s+/g, " ").trim();
    if (!resume.source || !text) return;
    setBusy(true);
    try {
      const trial = updateFileChange(resume, c.id, { new: text, status: "applied", note: "", off: false });
      const res = await renderFile(resume.source.type, resume.source.data, activeEdits(trial.file_changes));
      const result = res.results.find((r) => r.id === c.id);
      if (result && result.status !== "applied") {
        const message =
          result.status === "too_long"
            ? "That's longer than the original, so it wouldn't fit in the same lines. Try a shorter version."
            : result.status === "too_short"
              ? "That's much shorter than the original and would leave an empty line. Add a few words."
              : result.note.replace(/^Kept the original: the new text/, "Your text") || "That text can't be used here.";
        toast({ message, kind: "error" });
        return;
      }
      rememberFile(trial, res.file_base64);
      edit(trial);
      setEditing(null);
    } catch (err) {
      toast({ message: (err as Error).message, kind: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card stack" style={{ padding: 16, gap: 12 }} aria-labelledby="changes-title">
      <div className="row">
        <Icon name="pen" size={16} />
        <strong id="changes-title" className="grow">
          Changes in your file
        </strong>
        <span className="hint">
          {on} of {applied.length} on
        </span>
      </div>
      <p className="hint" style={{ margin: 0 }}>
        Only words changed. Every line stays in the same place, so your design and page count stay exactly the same.
      </p>
      <ol className="changes">
        {changes.map((c) => {
          const active = c.status === "applied" && !c.off;
          const isEditing = editing === c.id;
          return (
            <li key={c.id} className={`change ${active ? "" : "is-off"}`}>
              <div className="change-head">
                <span className="change-where">{where(c)}</span>
                {c.status === "applied" ? (
                  <label className="check change-toggle">
                    <input
                      type="checkbox"
                      checked={!c.off}
                      onChange={() => edit(updateFileChange(resume, c.id, { off: !c.off }))}
                    />
                    Use
                  </label>
                ) : (
                  <span className="badge warn">Original kept</span>
                )}
              </div>
              {c.status === "applied" ? (
                <p className="change-old" aria-label="Before">
                  {c.old}
                </p>
              ) : (
                <p className="change-kept" aria-label="In your file">
                  {c.old}
                </p>
              )}
              {isEditing ? (
                <div className="stack" style={{ gap: 6 }}>
                  <textarea
                    className="textarea"
                    rows={4}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    aria-label="Your wording"
                    autoFocus
                  />
                  <div className="row">
                    <span className={`hint grow ${draft.length > c.old.length * 1.15 ? "warn-text" : ""}`}>
                      {draft.length} characters (original: {c.old.length})
                    </span>
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditing(null)} disabled={busy}>
                      Cancel
                    </button>
                    <button className="btn btn-primary btn-sm" onClick={() => save(c)} disabled={busy || !draft.trim()}>
                      {busy ? "Checking…" : "Save"}
                    </button>
                  </div>
                </div>
              ) : (
                <p className={c.status === "applied" ? "change-new" : "change-suggested"} aria-label="After">
                  {c.status !== "applied" && <span className="change-label">Suggested, not used: </span>}
                  {c.new}
                </p>
              )}
              {c.note && <p className="hint change-note">{c.note}</p>}
              {!isEditing && (
                <button
                  className="btn btn-ghost btn-sm change-edit"
                  onClick={() => {
                    setDraft(c.new);
                    setEditing(c.id);
                  }}
                >
                  <Icon name="pen" size={13} /> {c.status === "applied" ? "Edit wording" : "Write my own"}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function HowItWorks({ open = false }: { open?: boolean }) {
  return (
    <details className="card how" open={open}>
      <summary>
        <Icon name="info" size={15} /> How tailoring works
      </summary>
      <ol>
        <li>
          We find the lines that are safe to change: <strong>bullet points, your summary and skill lists</strong>. Your
          name, contact details, job titles, companies, dates, education and certificates are never touched.
        </li>
        <li>
          The AI reads the job post and <strong>rewrites those lines in plain words</strong>, using the job's keywords
          only where they are true for you. It replaces text; it never adds new lines.
        </li>
        <li>
          Every rewrite is checked: it must <strong>keep all your numbers</strong>, add no new facts, and{" "}
          <strong>fit in the same number of lines</strong>. If it doesn't, the AI gets one more try, and if that fails
          the original line stays.
        </li>
        <li>
          For an uploaded PDF or Word file, the new words go into <strong>your own file</strong> at the same spots, with
          the same font, size and colour. Nothing moves, so a one-page resume stays one page.
        </li>
        <li>You see every change here, and you can switch any of them off or reword it.</li>
      </ol>
    </details>
  );
}

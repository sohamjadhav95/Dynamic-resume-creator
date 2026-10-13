import { useState } from "react";
import { loadPrefs, savePrefs, type Theme } from "../lib/prefs";
import { normalizeResume, uuid, type Resume } from "../lib/schema";
import { signInWithEmail, signInWithGoogle } from "../lib/supabase";
import { MASTER, useStore } from "../lib/store";
import { Icon } from "./Icon";
import { versionTitle } from "./TopBar";
import { Dialog, useToast } from "./ui";

// ------------------------------------------------------------------ sign in

export function AuthDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      title="Save your work"
      subtitle="Sign in to keep your resumes in your account and use them on any device. Free."
      onClose={onClose}
    >
      {sent ? (
        <div className="stack">
          <p style={{ margin: 0 }}>
            Check <strong>{email}</strong> for a sign-in link. You can close this window.
          </p>
          <button className="btn" onClick={onClose}>
            Done
          </button>
        </div>
      ) : (
        <div className="stack">
          <button
            className="btn btn-block"
            style={{ minHeight: 46 }}
            onClick={async () => {
              try {
                await signInWithGoogle();
              } catch (e) {
                toast({ message: (e as Error).message, kind: "error" });
              }
            }}
          >
            <Icon name="google" size={18} /> Continue with Google
          </button>
          <div className="row" style={{ color: "var(--ink-3)", fontSize: 12.5 }}>
            <span className="grow" style={{ height: 1, background: "var(--line)" }} /> or use email{" "}
            <span className="grow" style={{ height: 1, background: "var(--line)" }} />
          </div>
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await signInWithEmail(email.trim());
                setSent(true);
              } catch (err) {
                toast({ message: (err as Error).message, kind: "error" });
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="field">
              <span className="label">Email</span>
              <input className="input" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </label>
            <button className="btn btn-ink" disabled={busy}>
              <Icon name="mail" size={16} /> {busy ? "Sending…" : "Email me a sign-in link"}
            </button>
          </form>
          <p className="hint" style={{ margin: 0 }}>
            Your resume in this browser will be copied to your account the first time you sign in.
          </p>
        </div>
      )}
    </Dialog>
  );
}

// ------------------------------------------------------------------ versions

export function VersionsDialog({ onClose, onDelete }: { onClose: () => void; onDelete: (id: string) => void }) {
  const { state, dispatch } = useStore();
  const [renaming, setRenaming] = useState<string | null>(null);
  const versions = state.ws.versions;
  return (
    <Dialog title="Your versions" subtitle="One tailored resume per job. Your master profile is never changed by tailoring." onClose={onClose} wide>
      {versions.length === 0 ? (
        <div className="empty-state">No tailored versions yet. Paste a job and press “Tailor my resume”.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="version-table">
            <thead>
              <tr>
                <th>Job</th>
                <th>Match</th>
                <th>Made with</th>
                <th>Updated</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id}>
                  <td style={{ minWidth: 200 }}>
                    {renaming === v.id ? (
                      <form
                        className="row"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const f = new FormData(e.currentTarget);
                          dispatch({ type: "updateVersion", id: v.id, patch: { job_title: String(f.get("t")), company: String(f.get("c")) } });
                          setRenaming(null);
                        }}
                      >
                        <input className="input" name="t" defaultValue={v.job_title} aria-label="Job title" />
                        <input className="input" name="c" defaultValue={v.company} aria-label="Company" />
                        <button className="btn btn-sm">Save</button>
                      </form>
                    ) : (
                      <strong>{versionTitle(v)}</strong>
                    )}
                  </td>
                  <td>{v.match_score != null ? `${v.match_score}%` : "—"}</td>
                  <td>{v.engine === "offline" ? "Quick version" : v.engine === "groq" ? "Backup AI" : "Gemini"}</td>
                  <td>{new Date(v.updated_at).toLocaleDateString()}</td>
                  <td>
                    <div className="row" style={{ justifyContent: "flex-end", gap: 2 }}>
                      <button
                        className="btn btn-sm"
                        onClick={() => {
                          dispatch({ type: "setActive", id: v.id });
                          onClose();
                        }}
                      >
                        Open
                      </button>
                      <button className="icon-btn sm" aria-label={`Rename ${versionTitle(v)}`} onClick={() => setRenaming(v.id)}>
                        <Icon name="pen" size={15} />
                      </button>
                      <button
                        className="icon-btn sm"
                        aria-label={`Duplicate ${versionTitle(v)}`}
                        onClick={() => {
                          const now = new Date().toISOString();
                          dispatch({
                            type: "addVersion",
                            version: { ...v, id: uuid(), job_title: `${v.job_title} (copy)`, created_at: now, updated_at: now },
                          });
                        }}
                      >
                        <Icon name="copy" size={15} />
                      </button>
                      <button
                        className="icon-btn sm"
                        aria-label={`Delete ${versionTitle(v)}`}
                        onClick={() => {
                          if (confirm(`Delete "${versionTitle(v)}"? This can't be undone.`)) onDelete(v.id);
                        }}
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="dialog-foot">
        <button
          className="btn"
          onClick={() => {
            dispatch({ type: "setActive", id: MASTER });
            onClose();
          }}
        >
          Open master profile
        </button>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ settings

export function SettingsDialog({
  theme,
  onTheme,
  onClose,
  onImport,
  onDeleteAll,
  signedIn,
}: {
  theme: Theme;
  onTheme: (t: Theme) => void;
  onClose: () => void;
  onImport: () => void;
  onDeleteAll: () => void;
  signedIn: boolean;
}) {
  const { state, dispatch } = useStore();
  const toast = useToast();
  const [key, setKey] = useState(loadPrefs().geminiKey);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ app: "tailor", version: 2, master: state.ws.master, versions: state.ws.versions }, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "tailor-resumes.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Dialog title="Settings" onClose={onClose}>
      <div className="stack" style={{ gap: 22 }}>
        <div className="row">
          <span className="label grow">Theme</span>
          <div className="segmented" role="group" aria-label="Theme">
            {(["system", "light", "dark"] as Theme[]).map((t) => (
              <button key={t} aria-pressed={theme === t} onClick={() => onTheme(t)}>
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label className="label" htmlFor="own-key">
            Your own Gemini API key (optional)
          </label>
          <div className="row">
            <input
              id="own-key"
              className="input"
              type="password"
              autoComplete="off"
              placeholder="AIza…"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <button
              className="btn"
              onClick={() => {
                savePrefs({ geminiKey: key.trim() });
                toast({ message: key.trim() ? "Saved. AI requests now use your key with no daily limit." : "Removed your key." });
              }}
            >
              Save
            </button>
          </div>
          <span className="hint">
            Removes the daily limit. Stored only in this browser and sent only with your own requests. Get one free at
            aistudio.google.com.
          </span>
        </div>

        <div className="field">
          <span className="label">Your data</span>
          <div className="row wrap">
            <button className="btn btn-sm" onClick={onImport}>
              <Icon name="upload" size={15} /> Import resume
            </button>
            <button className="btn btn-sm" onClick={exportJson}>
              <Icon name="download" size={15} /> Export everything (JSON)
            </button>
            <label className="btn btn-sm">
              <Icon name="file" size={15} /> Restore from JSON
              <input
                type="file"
                accept=".json"
                hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    const data = JSON.parse(await file.text());
                    const master: Resume = normalizeResume(data.master ?? data);
                    dispatch({ type: "load", ws: { master, versions: Array.isArray(data.versions) ? data.versions.map((v: any) => ({ ...v, data: normalizeResume(v.data) })) : state.ws.versions } });
                    toast({ message: "Restored." });
                    onClose();
                  } catch {
                    toast({ message: "That file isn't a valid export.", kind: "error" });
                  }
                }}
              />
            </label>
          </div>
        </div>

        <div className="field">
          <span className="label">Danger zone</span>
          <div>
            <button
              className="btn btn-sm"
              style={{ color: "var(--accent-strong)" }}
              onClick={() => {
                if (confirm(signedIn ? "Delete your master profile and all versions from your account?" : "Delete everything saved in this browser?")) onDeleteAll();
              }}
            >
              <Icon name="trash" size={15} /> Delete all my resumes
            </button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

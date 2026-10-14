// Right column: tailoring progress, match score, keywords, bullet rewriting, ideas.

import { useEffect, useState } from "react";
import { rewriteBullet } from "../lib/api";
import { highlight, type KeywordMatch } from "../lib/keywords";
import { useMatch } from "../lib/match";
import { clone, getPath, setPath, uid } from "../lib/schema";
import { useSelection } from "../lib/selection";
import { MASTER, useStore } from "../lib/store";
import { Icon } from "./Icon";
import { Dialog, useToast } from "./ui";

export interface TailorProgress {
  startedAt: number;
  stage: "sending" | "writing" | "switching" | "finishing";
  provider: string;
  thought: string;
  chars: number;
}

export function RightPanel({
  progress,
  onQuick,
  onCancel,
}: {
  progress: TailorProgress | null;
  onQuick: () => void;
  onCancel: () => void;
}) {
  const { state, resume, version } = useStore();
  const jd = version ? version.job_description : state.jobDraft;
  const match = useMatch(resume, jd, version?.insights.keywords, version ? state.ws.master : undefined);

  return (
    <div className="stack" style={{ padding: 18, gap: 16 }}>
      {progress && <ProgressCard progress={progress} onQuick={onQuick} onCancel={onCancel} />}
      <MatchCard match={match} jd={jd} />
      <RewriteCard jd={jd} missing={match?.matches.filter((m) => !m.found).map((m) => m.term) ?? []} />
      {version && version.insights.project_ideas.length > 0 && <IdeasCard />}
      {version && (version.insights.advice.length > 0 || version.insights.removed.length > 0) && <AdviceCard />}
      {state.activeId === MASTER && !jd.trim() && !progress && (
        <div className="empty-state">
          <Icon name="target" size={22} />
          <p style={{ margin: "8px 0 0" }}>Paste a job description to see how well you match and which keywords are missing.</p>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ progress

function ProgressCard({ progress, onQuick, onCancel }: { progress: TailorProgress; onQuick: () => void; onCancel: () => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const seconds = Math.max(0, Math.round((now - progress.startedAt) / 1000));
  const steps: { key: TailorProgress["stage"][]; label: string }[] = [
    { key: ["sending"], label: "Reading the job post" },
    {
      key: ["writing", "switching"],
      label:
        progress.stage === "switching"
          ? `${progress.provider} is busy — switching to backup AI`
          : `Writing with ${progress.provider || "AI"}${progress.chars ? ` · ${Math.round(progress.chars / 5)} words` : ""}`,
    },
    { key: ["finishing"], label: "Fact-checking and laying out your page" },
  ];
  const order: TailorProgress["stage"][] = ["sending", "writing", "finishing"];
  const current = order.indexOf(progress.stage === "switching" ? "writing" : progress.stage);
  return (
    <section className="progress-card" aria-live="polite" aria-busy="true">
      <div className="row">
        <strong className="grow">Tailoring your resume…</strong>
        <span className="hint">{seconds}s</span>
      </div>
      <div className="progress-bar" aria-hidden="true">
        <i />
      </div>
      <ol className="stage-list">
        {steps.map((s, i) => (
          <li key={s.label} className={i < current ? "done" : i === current ? "now" : ""}>
            <span className="stage-dot" aria-hidden="true">
              {i < current ? "✓" : ""}
            </span>
            {s.label}
          </li>
        ))}
      </ol>
      {progress.thought && <div className="thought">“{progress.thought}”</div>}
      {seconds > 20 && (
        <p className="hint" style={{ margin: 0 }}>
          Detailed resumes can take a minute or two. We'll wait as long as the AI is working.
        </p>
      )}
      <div className="row wrap">
        <button className="btn btn-sm" onClick={onQuick} title="Skip the AI and reorder your resume for this job instantly">
          <Icon name="bolt" size={15} /> Use quick version now
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ match

function Ring({ value }: { value: number }) {
  const r = 40;
  const c = 2 * Math.PI * r;
  const color = value >= 75 ? "var(--moss)" : value >= 50 ? "var(--amber)" : "var(--accent-strong)";
  return (
    <div className="ring" role="img" aria-label={`Match score ${value} out of 100`}>
      <svg width="92" height="92" viewBox="0 0 92 92" aria-hidden="true">
        <circle cx="46" cy="46" r={r} fill="none" stroke="var(--surface-sunk)" strokeWidth="8" />
        <circle
          cx="46"
          cy="46"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - value / 100)}
          style={{ transition: "stroke-dashoffset 0.6s ease" }}
        />
      </svg>
      <div className="val" aria-hidden="true">
        <span>
          {value}
          <small>%</small>
        </span>
      </div>
    </div>
  );
}

function MatchCard({ match, jd }: { match: ReturnType<typeof useMatch>; jd: string }) {
  const { resume, edit, state, dispatch } = useStore();
  const toast = useToast();
  const [asking, setAsking] = useState<KeywordMatch | null>(null);
  const [showJd, setShowJd] = useState(false);
  if (!match) return null;

  const hard = match.matches.filter((m) => !m.soft);
  const missing = hard.filter((m) => !m.found);
  const found = hard.filter((m) => m.found);
  const soft = match.matches.filter((m) => m.soft);
  const verdict =
    match.score >= 80 ? "Strong match" : match.score >= 60 ? "Good match" : match.score >= 40 ? "Partial match" : "Weak match";

  const [replaceTarget, setReplaceTarget] = useState<string>("");

  const allExistingSkills = resume.skills.flatMap((g) =>
    g.items.map((it) => ({ skill: it, category: g.category }))
  );

  const withSkill = (r: typeof resume, term: string) => {
    const next = clone(r);
    if (next.skills.length) next.skills[0].items.push(term);
    else next.skills.push({ id: uid("sk"), category: "Skills", items: [term] });
    return next;
  };

  const addSkill = (term: string) => {
    edit(withSkill(resume, term));
    if (state.activeId !== MASTER) dispatch({ type: "setMaster", resume: withSkill(state.ws.master, term) });
    setAsking(null);
    setReplaceTarget("");
    toast({ message: `Added “${term}” to your skills.` });
  };

  const replaceSkill = (oldSkill: string, newSkill: string) => {
    const next = clone(resume);
    let replaced = false;
    for (const g of next.skills) {
      const idx = g.items.indexOf(oldSkill);
      if (idx !== -1) {
        g.items[idx] = newSkill;
        replaced = true;
        break;
      }
    }
    if (replaced) {
      edit(next);
      setAsking(null);
      setReplaceTarget("");
      toast({ message: `Replaced “${oldSkill}” with “${newSkill}” (size & format kept intact).` });
    }
  };

  return (
    <section className="card" style={{ padding: 16 }} aria-labelledby="match-title">
      <div className="score-wrap">
        <Ring value={match.score} />
        <div className="score-copy">
          <h3 id="match-title">{verdict}</h3>
          <p>
            {match.base !== null && match.base !== match.score ? (
              <>
                Up from {match.base}% <span className="delta">+{match.score - match.base}</span> ·{" "}
              </>
            ) : null}
            {found.length} of {hard.length} key skills found
          </p>
          <button className="btn btn-ghost btn-sm" style={{ marginLeft: -10, marginTop: 4 }} onClick={() => setShowJd(true)}>
            View job post with highlights
          </button>
        </div>
      </div>

      {missing.length > 0 && (
        <div className="kw-group">
          <h4>Missing — click if you have it</h4>
          <div className="kw-list">
            {missing.map((m) => (
              <button
                key={m.term}
                className={`chip missing ${m.importance === "nice" ? "nice" : ""}`}
                aria-pressed={asking?.term === m.term}
                onClick={() => {
                  setAsking(asking?.term === m.term ? null : m);
                  setReplaceTarget("");
                }}
                title={m.importance === "nice" ? "Nice to have" : "Required"}
              >
                {m.term}
              </button>
            ))}
          </div>
          {asking && (
            <div className="rewrite-source" style={{ marginTop: 10 }}>
              <p style={{ margin: "0 0 8px", fontSize: "0.92em" }}>
                Add <strong>{asking.term}</strong> to your resume. To keep page size intact, replace an existing skill:
              </p>
              {allExistingSkills.length > 0 && (
                <div className="row" style={{ marginBottom: 8 }}>
                  <select
                    className="select grow"
                    value={replaceTarget}
                    onChange={(e) => setReplaceTarget(e.target.value)}
                    aria-label="Skill to replace"
                  >
                    <option value="">Select skill to replace…</option>
                    {resume.skills.map((g) => (
                      <optgroup key={g.id} label={g.category || "Skills"}>
                        {g.items.map((it) => (
                          <option key={it} value={it}>
                            {it}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <button
                    className="btn btn-sm btn-ink"
                    disabled={!replaceTarget}
                    onClick={() => replaceSkill(replaceTarget, asking.term)}
                  >
                    Replace
                  </button>
                </div>
              )}
              <div className="row wrap" style={{ gap: 6 }}>
                <button className="btn btn-sm btn-ghost" onClick={() => addSkill(asking.term)}>
                  Add without replacing
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => { setAsking(null); setReplaceTarget(""); }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {found.length > 0 && (
        <div className="kw-group">
          <h4>Found in your resume</h4>
          <div className="kw-list">
            {found.map((m) => (
              <span key={m.term} className="chip found">
                <Icon name="check" size={12} /> {m.term}
              </span>
            ))}
          </div>
        </div>
      )}
      {soft.length > 0 && (
        <div className="kw-group">
          <h4>Soft skills mentioned</h4>
          <div className="kw-list">
            {soft.map((m) => (
              <span key={m.term} className={`chip ${m.found ? "found" : ""}`}>
                {m.term}
              </span>
            ))}
          </div>
        </div>
      )}
      {showJd && (
        <Dialog title="Job post" subtitle="Green = in your resume · Red = missing" onClose={() => setShowJd(false)} wide>
          <div className="jd-view">
            {highlight(jd, match.matches).map((seg, i) =>
              seg.match ? (
                <mark key={i} className={seg.match.found ? "found" : "missing"}>
                  {seg.text}
                </mark>
              ) : (
                <span key={i}>{seg.text}</span>
              ),
            )}
          </div>
        </Dialog>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ rewrite

function RewriteCard({ jd, missing }: { jd: string; missing: string[] }) {
  const { selected, setSelected } = useSelection();
  const { resume, edit } = useStore();
  const toast = useToast();
  const [options, setOptions] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");

  useEffect(() => {
    setOptions(null);
  }, [selected?.path]);

  const text = selected ? String(getPath(resume, selected.path) ?? "") : "";
  if (!selected || !text.trim()) {
    return (
      <section className="card" style={{ padding: 16 }}>
        <div className="row" style={{ marginBottom: 6 }}>
          <Icon name="pen" size={16} />
          <strong>Improve a bullet</strong>
        </div>
        <p className="hint" style={{ margin: 0 }}>
          Click any bullet on the page to rewrite it with AI: stronger, shorter, or with a keyword.
        </p>
      </section>
    );
  }

  const run = async (mode: "impact" | "shorter" | "fix" | "keyword") => {
    setBusy(mode);
    try {
      const out = await rewriteBullet({
        text,
        mode,
        keyword: mode === "keyword" ? keyword : "",
        context: selected.context,
        job_description: jd,
      });
      setOptions(out);
    } catch (e) {
      toast({ message: (e as Error).message, kind: "error" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card stack" style={{ padding: 16, gap: 10 }} aria-labelledby="rw-title">
      <div className="row">
        <Icon name="pen" size={16} />
        <strong id="rw-title" className="grow">
          Improve this bullet
        </strong>
        <button className="icon-btn sm" aria-label="Close" onClick={() => setSelected(null)}>
          <Icon name="x" size={14} />
        </button>
      </div>
      <div className="rewrite-source">{text}</div>
      <div className="row wrap">
        <button className="btn btn-sm" disabled={!!busy} onClick={() => run("impact")}>
          {busy === "impact" ? "Working…" : "Stronger"}
        </button>
        <button className="btn btn-sm" disabled={!!busy} onClick={() => run("shorter")}>
          {busy === "shorter" ? "Working…" : "Shorter"}
        </button>
        <button className="btn btn-sm" disabled={!!busy} onClick={() => run("fix")}>
          {busy === "fix" ? "Working…" : "Fix grammar"}
        </button>
      </div>
      {missing.length > 0 && (
        <div className="row">
          <select className="select grow" value={keyword} onChange={(e) => setKeyword(e.target.value)} aria-label="Keyword to include">
            <option value="">Add a missing keyword…</option>
            {missing.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
          <button className="btn btn-sm" disabled={!keyword || !!busy} onClick={() => run("keyword")}>
            {busy === "keyword" ? "…" : "Add"}
          </button>
        </div>
      )}
      {options && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="hint">Click one to use it (Ctrl+Z to undo):</span>
          {options.map((o) => (
            <button
              key={o}
              className="rewrite-option"
              onClick={() => {
                edit(setPath(resume, selected.path, o));
                setOptions(null);
              }}
            >
              {o}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ ideas & advice

function IdeasCard() {
  const { version } = useStore();
  if (!version) return null;
  return (
    <section className="card stack" style={{ padding: 16, gap: 10 }} aria-labelledby="ideas-title">
      <div className="row">
        <Icon name="bulb" size={16} />
        <strong id="ideas-title">Project ideas for this job</strong>
      </div>
      <p className="hint" style={{ margin: 0 }}>
        Not added to your resume. Build one to close a gap, then add it for real.
      </p>
      {version.insights.project_ideas.map((idea) => (
        <div key={idea.title} className="idea">
          <h4>{idea.title}</h4>
          <p>{idea.pitch}</p>
          <div className="stack-line">{idea.stack.join(" · ")}</div>
        </div>
      ))}
    </section>
  );
}

function AdviceCard() {
  const { version } = useStore();
  if (!version) return null;
  const { advice, removed } = version.insights;
  return (
    <section className="card stack" style={{ padding: 16, gap: 10 }} aria-labelledby="advice-title">
      <div className="row">
        <Icon name="info" size={16} />
        <strong id="advice-title">Tips</strong>
      </div>
      <ul className="advice">
        {advice.map((a) => (
          <li key={a}>{a}</li>
        ))}
        {removed.length > 0 && (
          <li>
            <strong>Truth check:</strong> removed {removed.slice(0, 5).join(", ")} — the AI suggested{" "}
            {removed.length > 1 ? "them" : "it"}, but your master profile doesn't mention {removed.length > 1 ? "them" : "it"}.
          </li>
        )}
      </ul>
    </section>
  );
}

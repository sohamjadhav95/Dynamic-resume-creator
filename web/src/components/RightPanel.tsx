// Right column: tailoring progress, match score, keywords, bullet rewriting, ideas.

import { useEffect, useState } from "react";
import { rewriteBullet } from "../lib/api";
import { highlight, type KeywordMatch } from "../lib/keywords";
import { useMatch } from "../lib/match";
import { clone, getPath, setPath, uid } from "../lib/schema";
import { useSelection } from "../lib/selection";
import { bulletRoom, replaceProject } from "../lib/source";
import { MASTER, useStore } from "../lib/store";
import type { ProjectIdea } from "../lib/tailor";
import { HowItWorks } from "./HowItWorks";
import { Icon } from "./Icon";
import { Dialog, Panel, useToast } from "./ui";

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
      <RewriteCard jd={jd} missing={match?.matches.filter((m) => !m.found || m.shown === false).map((m) => m.term) ?? []} />
      {version &&
        (version.insights.advice.length > 0 ||
          version.insights.removed.length > 0 ||
          (version.insights.added?.length ?? 0) > 0 ||
          (version.insights.changes?.length ?? 0) > 0 ||
          (version.insights.kept ?? []).some((k) => k.at)) && <AdviceCard />}
      {version && version.insights.project_ideas.length > 0 && <IdeasCard />}
      <HowItWorks defaultOpen={state.activeId === MASTER && !version && !jd.trim()} />
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
  const [replaceTarget, setReplaceTarget] = useState<string>(""); // hooks must run before any early return
  if (!match) return null;

  const hard = match.matches.filter((m) => !m.soft);
  const missing = hard.filter((m) => !m.found);
  const found = hard.filter((m) => m.found);
  const shown = found.filter((m) => m.shown !== false);
  const listed = found.filter((m) => m.shown === false);
  const soft = match.matches.filter((m) => m.soft);
  const verdict =
    match.score >= 80 ? "Strong match" : match.score >= 60 ? "Good match" : match.score >= 40 ? "Partial match" : "Weak match";


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
    <Panel id="match" icon="target" title="Match with this job" extra={`${match.score}%`}>
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
            {found.length} of {hard.length} key skills found, {shown.length} shown in your work
          </p>
          <p className="score-parts">
            {match.sections.map((s, i) => (
              <span key={s.name}>
                {i > 0 && " · "}
                {s.name} <strong>{s.found}</strong>
              </span>
            ))}
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
      {shown.length > 0 && (
        <div className="kw-group">
          <h4>Shown in your summary, jobs or projects</h4>
          <div className="kw-list">
            {shown.map((m) => (
              <span key={m.term} className="chip found">
                <Icon name="check" size={12} /> {m.term}
              </span>
            ))}
          </div>
        </div>
      )}
      {listed.length > 0 && (
        <div className="kw-group">
          <h4>Only in your skills list — counts half</h4>
          <div className="kw-list">
            {listed.map((m) => (
              <span key={m.term} className="chip found listed" title="Show it in a bullet or your summary to count fully">
                {m.term}
              </span>
            ))}
          </div>
          <p className="hint" style={{ margin: "8px 0 0" }}>
            If you have used one, click a bullet on the page and add it with “Improve a bullet”.
          </p>
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
    </Panel>
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
      <Panel id="rewrite" icon="pen" title="Improve a bullet">
        <p className="hint" style={{ margin: 0 }}>
          Click any bullet on the page to rewrite it with AI: stronger, shorter, or with a keyword.
        </p>
      </Panel>
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
    <Panel id="rewrite" icon="pen" title="Improve this bullet">
      <div className="row">
        <span className="hint grow">Rewrite with AI, then click the version you like.</span>
        <button className="icon-btn sm" aria-label="Stop editing this bullet" onClick={() => setSelected(null)}>
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
    </Panel>
  );
}

// ------------------------------------------------------------------ ideas & advice

function IdeasCard() {
  const { version, resume, edit, dispatch } = useStore();
  const toast = useToast();
  const [target, setTarget] = useState<Record<string, string>>({}); // idea title -> id of the project it replaces
  const [busy, setBusy] = useState<string | null>(null);
  if (!version) return null;

  const replace = async (idea: ProjectIdea) => {
    const index = resume.projects.findIndex((p) => p.id === target[idea.title]);
    if (index < 0) return;
    const old = resume.projects[index];
    const [min, max] = bulletRoom(resume, index);
    setBusy(idea.title);
    let bullet = idea.pitch;
    try {
      // The idea's sentence, written as a resume bullet that fits the old bullet's room.
      const options = await rewriteBullet({
        text: idea.pitch,
        mode: "project",
        keyword: `Make it ${min}-${max} characters.`,
        context: `${idea.title} (${idea.stack.join(", ")})`,
        job_description: version.job_description,
      });
      const off = (o: string) => Math.max(0, min - o.length, o.length - max);
      bullet = [...options].sort((a, b) => off(a) - off(b))[0] ?? bullet;
    } catch {
      /* AI busy: use the idea's own sentence */
    }
    edit(replaceProject(resume, index, { title: idea.title, stack: idea.stack, bullet }));
    setBusy(null);
    setTarget((t) => ({ ...t, [idea.title]: "" }));
    toast({
      message: `“${old.name.split(/:\s/)[0]}” is now “${idea.title}”. Check its dates and wording on the page.`,
      action: { label: "Undo", run: () => dispatch({ type: "undo" }) },
    });
  };

  return (
    <Panel id="ideas" icon="bulb" title="Project ideas for this job" defaultOpen={false}>
      <p className="hint" style={{ margin: 0 }}>
        Ideas to close gaps for this job. Built one? Put it in place of a project that fits this job less. Only add what
        you have really built: a recruiter will ask about it.
      </p>
      {version.insights.project_ideas.map((idea) => (
        <div key={idea.title} className="idea">
          <h4>{idea.title}</h4>
          <p>{idea.pitch}</p>
          <div className="stack-line">{idea.stack.join(" · ")}</div>
          {resume.projects.length > 0 && (
            <div className="row" style={{ marginTop: 10 }}>
              <select
                className="select grow"
                value={target[idea.title] ?? ""}
                onChange={(e) => setTarget((t) => ({ ...t, [idea.title]: e.target.value }))}
                aria-label={`Project to replace with ${idea.title}`}
              >
                <option value="">Replace a project with this…</option>
                {resume.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name || "Untitled project"}
                  </option>
                ))}
              </select>
              <button className="btn btn-sm" disabled={!target[idea.title] || !!busy} onClick={() => replace(idea)}>
                {busy === idea.title ? "Writing…" : "Replace"}
              </button>
            </div>
          )}
        </div>
      ))}
    </Panel>
  );
}

function AdviceCard() {
  const { version } = useStore();
  if (!version) return null;
  const { advice, removed } = version.insights;
  const added = version.insights.added ?? [];
  const kept = (version.insights.kept ?? []).filter((k) => k.at && !k.at.startsWith("skills:") && k.suggested && k.suggested !== k.old);
  const changed = version.insights.changes?.length ?? 0;
  return (
    <Panel id="tips" icon="info" title="Tips">
      <ul className="advice">
        {(changed > 0 || kept.length > 0) && (
          <li>
            <strong>What changed:</strong> {changed} line{changed === 1 ? "" : "s"} rewritten for this job
            {kept.length > 0 && `, ${kept.length} more suggested`}. See each one, word by word, in “What changed for this
            job” in the Build panel, and undo any of them there.
          </li>
        )}
        {added.length > 0 && (
          <li>
            <strong>Skills added from the job post:</strong> {added.join(", ")}. Keep them only if you have really
            used them; click a skill on the page to change it.
          </li>
        )}
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
    </Panel>
  );
}

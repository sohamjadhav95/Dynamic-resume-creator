// Left column: 1 · Job  2 · Sections  3 · Design

import { useState } from "react";
import { guessJob } from "../lib/keywords";
import { SECTION_LABELS, clone, uid, type Resume, type SectionKey, type TemplateId } from "../lib/schema";
import { useSelection } from "../lib/selection";
import { MASTER, useStore } from "../lib/store";
import { Icon } from "./Icon";
import { Panel } from "./ui";

export function LeftPanel({ onTailor, busy }: { onTailor: () => void; busy: boolean }) {
  return (
    <>
      <JobCard onTailor={onTailor} busy={busy} />
      <SectionsCard />
      <DesignCard />
    </>
  );
}

// ------------------------------------------------------------------ 1 · Job

function JobCard({ onTailor, busy }: { onTailor: () => void; busy: boolean }) {
  const { state, dispatch, version } = useStore();
  const jd = state.jobDraft;
  const o = state.options;
  const words = jd.trim() ? jd.trim().split(/\s+/).length : 0;
  const guess = jd.length > 40 ? guessJob(jd) : null;
  const sameJob = version && version.job_description.trim() === jd.trim();
  const setOpt = (patch: Partial<typeof o>) => dispatch({ type: "setOptions", patch });

  return (
    <Panel
      flat
      id="step-job"
      title={
        <>
          <span className="step-num">1</span> The job
        </>
      }
    >
      <div className="stack">
        <div className="field">
          <label className="label" htmlFor="jd">
            Paste the job description
          </label>
          <textarea
            id="jd"
            className="textarea jd-box"
            placeholder="Paste the full job post here: title, responsibilities and requirements…"
            value={jd}
            onChange={(e) => dispatch({ type: "setJob", text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                onTailor();
              }
            }}
          />
          <div className="jd-meta">
            <span>
              {guess && (guess.title || guess.company)
                ? [guess.title, guess.company].filter(Boolean).join(" · ")
                : "Tip: include the requirements list"}
            </span>
            <span>{words} words</span>
          </div>
        </div>

        <details className="options">
          <summary>
            <Icon name="settings" size={15} /> AI options
          </summary>
          <div className="body">
            <label className="field">
              <span className="label">Tone</span>
              <select className="select" value={o.tone} onChange={(e) => setOpt({ tone: e.target.value as typeof o.tone })}>
                <option value="balanced">Balanced</option>
                <option value="technical">Technical — tools & systems first</option>
                <option value="leadership">Leadership — ownership & outcomes</option>
                <option value="concise">Concise — shortest phrasing</option>
              </select>
            </label>
            <label className="field">
              <span className="label">Anything else? (optional)</span>
              <input
                className="input"
                maxLength={600}
                placeholder="e.g. Emphasise my leadership at Northwind"
                value={o.instructions}
                onChange={(e) => setOpt({ instructions: e.target.value })}
              />
            </label>
          </div>
        </details>

        <button className="btn btn-primary btn-block" onClick={onTailor} disabled={busy} aria-keyshortcuts="Control+Enter">
          <Icon name="sparkle" size={17} />
          {busy ? "Tailoring…" : sameJob ? "Tailor again" : "Tailor my resume"}
          {!busy && <span className="kbd hide-sm">Ctrl ↵</span>}
        </button>
        <p className="hint" style={{ margin: 0 }}>
          Tailoring rewords your <strong>master profile</strong> into a new version for this job: same bullets, same
          length. Your master stays untouched.
        </p>
      </div>
    </Panel>
  );
}

// ------------------------------------------------------------------ 2 · Sections

type ListKey = "experience" | "projects" | "education" | "skills";

const ITEM_NAME: Record<ListKey, (x: any) => string> = {
  experience: (e) => [e.role, e.company].filter(Boolean).join(" · ") || "Untitled job",
  projects: (p) => p.name || "Untitled project",
  education: (e) => e.degree || e.institution || "Untitled",
  skills: (s) => s.category || "Untitled group",
};

const NEW_ITEM: Record<ListKey, () => any> = {
  experience: () => ({ id: uid("ex"), company: "", role: "", location: "", dates: "", bullets: [""] }),
  projects: () => ({ id: uid("pr"), name: "", link: "", dates: "", stack: [], bullets: [""] }),
  education: () => ({ id: uid("ed"), degree: "", institution: "", location: "", dates: "", details: "" }),
  skills: () => ({ id: uid("sk"), category: "", items: [] }),
};

const ADD_LABEL: Record<ListKey, string> = {
  experience: "Add job",
  projects: "Add project",
  education: "Add education",
  skills: "Add skill group",
};

const FIRST_FIELD: Record<ListKey, string> = { experience: "role", projects: "name", education: "degree", skills: "category" };

function SectionsCard() {
  const { resume, edit, state } = useStore();
  const { setEditing } = useSelection();
  const [open, setOpen] = useState<string | null>(null);
  const hidden = new Set(resume.layout.hidden);
  const L = resume.layout;

  const toggleHidden = (id: string) =>
    edit({ ...resume, layout: { ...L, hidden: hidden.has(id) ? L.hidden.filter((x) => x !== id) : [...L.hidden, id] } });

  const moveSection = (k: SectionKey, dir: -1 | 1) => {
    const order = [...L.order];
    const i = order.indexOf(k);
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    edit({ ...resume, layout: { ...L, order } });
  };

  const moveItem = (key: ListKey, i: number, dir: -1 | 1) => {
    const list = [...(resume[key] as any[])];
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    edit({ ...resume, [key]: list });
  };

  const removeItem = (key: ListKey, i: number) => {
    const list = (resume[key] as any[]).filter((_, j) => j !== i);
    edit({ ...resume, [key]: list });
  };

  const addItem = (key: ListKey) => {
    const item = NEW_ITEM[key]();
    const next = { ...resume, [key]: [...(resume[key] as any[]), item] } as Resume;
    next.layout = { ...L, hidden: L.hidden.filter((x) => x !== key) };
    edit(next);
    setEditing(`${key}.${(resume[key] as any[]).length}.${FIRST_FIELD[key]}`);
  };

  const addCustom = () => {
    const next = clone(resume);
    next.custom_sections.push({
      id: uid("cs"),
      title: "Awards",
      items: [{ id: uid("ci"), title: "", subtitle: "", dates: "", bullets: [] }],
    });
    next.layout.hidden = next.layout.hidden.filter((x) => x !== "custom");
    edit(next);
    setEditing(`custom_sections.${resume.custom_sections.length}.items.0.title`);
  };

  const count = (k: SectionKey): number | null => {
    if (k === "summary") return null;
    if (k === "custom") return resume.custom_sections.length;
    if (k === "certifications") return resume.certifications.length;
    return (resume[k] as unknown[]).length;
  };

  return (
    <Panel
      flat
      id="step-sections"
      title={
        <>
          <span className="step-num">2</span> Sections
        </>
      }
      extra={state.activeId === MASTER ? "Master profile" : "This version"}
    >
      <ContactDetails />

      <ul className="sec-list">
        {L.order.map((k, idx) => {
          const isHidden = hidden.has(k);
          const isList = k === "experience" || k === "projects" || k === "education" || k === "skills";
          const expanded = open === k;
          const n = count(k);
          return (
            <li key={k}>
              <div className={`sec-row ${isHidden ? "is-hidden" : ""}`}>
                {k !== "summary" ? (
                  <button className="icon-btn sm" aria-expanded={expanded} aria-label={`${expanded ? "Collapse" : "Expand"} ${SECTION_LABELS[k]}`} onClick={() => setOpen(expanded ? null : k)}>
                    <Icon name={expanded ? "chevron" : "chevronRight"} size={15} />
                  </button>
                ) : (
                  <span style={{ width: 28 }} />
                )}
                <button className="name" onClick={() => setOpen(expanded ? null : k)}>
                  {SECTION_LABELS[k]} {n !== null && <span className="count">{n}</span>}
                </button>
                <button className="icon-btn sm" aria-label={`Move ${SECTION_LABELS[k]} up`} disabled={idx === 0} onClick={() => moveSection(k, -1)}>
                  <Icon name="up" size={15} />
                </button>
                <button className="icon-btn sm" aria-label={`Move ${SECTION_LABELS[k]} down`} disabled={idx === L.order.length - 1} onClick={() => moveSection(k, 1)}>
                  <Icon name="down" size={15} />
                </button>
                <button
                  className="icon-btn sm"
                  aria-pressed={!isHidden}
                  aria-label={`${isHidden ? "Show" : "Hide"} ${SECTION_LABELS[k]}`}
                  title={isHidden ? "Hidden — click to show" : "Shown — click to hide"}
                  onClick={() => toggleHidden(k)}
                >
                  <Icon name={isHidden ? "eyeOff" : "eye"} size={16} />
                </button>
              </div>

              {expanded && isList && (
                <ul className="sec-items">
                  {(resume[k] as any[]).map((item, i, arr) => (
                    <li key={item.id}>
                      <div className={`sec-row ${hidden.has(item.id) ? "is-hidden" : ""}`}>
                        <span className="name" style={{ cursor: "default" }}>
                          {ITEM_NAME[k](item)}
                        </span>
                        <button className="icon-btn sm" aria-label="Move up" disabled={i === 0} onClick={() => moveItem(k, i, -1)}>
                          <Icon name="up" size={14} />
                        </button>
                        <button className="icon-btn sm" aria-label="Move down" disabled={i === arr.length - 1} onClick={() => moveItem(k, i, 1)}>
                          <Icon name="down" size={14} />
                        </button>
                        <button className="icon-btn sm" aria-pressed={!hidden.has(item.id)} aria-label={`${hidden.has(item.id) ? "Show" : "Hide"} ${ITEM_NAME[k](item)}`} onClick={() => toggleHidden(item.id)}>
                          <Icon name={hidden.has(item.id) ? "eyeOff" : "eye"} size={15} />
                        </button>
                        <button
                          className="icon-btn sm"
                          aria-label={`Delete ${ITEM_NAME[k](item)}`}
                          onClick={() => {
                            if (confirm(`Delete "${ITEM_NAME[k](item)}"? You can undo with Ctrl+Z.`)) removeItem(k, i);
                          }}
                        >
                          <Icon name="trash" size={15} />
                        </button>
                      </div>
                    </li>
                  ))}
                  <li className="add-row">
                    <button className="btn btn-sm" onClick={() => addItem(k)}>
                      <Icon name="plus" size={14} /> {ADD_LABEL[k]}
                    </button>
                  </li>
                </ul>
              )}

              {expanded && k === "custom" && (
                <ul className="sec-items">
                  {resume.custom_sections.map((s, i) => (
                    <li key={s.id}>
                      <div className={`sec-row ${hidden.has(s.id) ? "is-hidden" : ""}`}>
                        <span className="name" style={{ cursor: "default" }}>
                          {s.title || "Untitled section"} <span className="count">{s.items.length}</span>
                        </span>
                        <button
                          className="icon-btn sm"
                          aria-label={`Add item to ${s.title}`}
                          title="Add item"
                          onClick={() => {
                            const next = clone(resume);
                            next.custom_sections[i].items.push({ id: uid("ci"), title: "", subtitle: "", dates: "", bullets: [] });
                            edit(next);
                            setEditing(`custom_sections.${i}.items.${s.items.length}.title`);
                          }}
                        >
                          <Icon name="plus" size={14} />
                        </button>
                        <button className="icon-btn sm" aria-label={`${hidden.has(s.id) ? "Show" : "Hide"} ${s.title}`} onClick={() => toggleHidden(s.id)}>
                          <Icon name={hidden.has(s.id) ? "eyeOff" : "eye"} size={15} />
                        </button>
                        <button
                          className="icon-btn sm"
                          aria-label={`Delete ${s.title}`}
                          onClick={() => {
                            if (confirm(`Delete the "${s.title}" section?`)) edit({ ...resume, custom_sections: resume.custom_sections.filter((_, j) => j !== i) });
                          }}
                        >
                          <Icon name="trash" size={15} />
                        </button>
                      </div>
                    </li>
                  ))}
                  <li className="add-row">
                    <button className="btn btn-sm" onClick={addCustom}>
                      <Icon name="plus" size={14} /> Add section (awards, languages…)
                    </button>
                  </li>
                </ul>
              )}

              {expanded && k === "certifications" && (
                <div className="sec-items" style={{ padding: "6px 0 8px 10px" }}>
                  <label className="field">
                    <span className="label">One per line</span>
                    <textarea
                      className="textarea"
                      rows={3}
                      value={resume.certifications.join("\n")}
                      onChange={(e) => edit({ ...resume, certifications: e.target.value.split("\n") }, "certs")}
                      onBlur={(e) => edit({ ...resume, certifications: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) }, "certs")}
                    />
                  </label>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function ContactDetails() {
  const { resume, edit } = useStore();
  const b = resume.basics;
  const set = (patch: Partial<typeof b>, key: string) => edit({ ...resume, basics: { ...b, ...patch } }, key);
  return (
    <details className="options" style={{ marginBottom: 10 }}>
      <summary>
        <Icon name="user" size={15} /> Name & contact
      </summary>
      <div className="body">
        {(
          [
            ["name", "Full name"],
            ["headline", "Headline"],
            ["email", "Email"],
            ["phone", "Phone"],
            ["location", "City, Country"],
          ] as const
        ).map(([k, label]) => (
          <label className="field" key={k}>
            <span className="label">{label}</span>
            <input className="input" value={b[k]} onChange={(e) => set({ [k]: e.target.value }, `basics.${k}`)} />
          </label>
        ))}
        <label className="field">
          <span className="label">Links (one per line)</span>
          <textarea
            className="textarea"
            rows={3}
            placeholder={"linkedin.com/in/you\ngithub.com/you"}
            value={b.links.join("\n")}
            onChange={(e) => set({ links: e.target.value.split("\n") }, "basics.links")}
            onBlur={(e) => set({ links: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) }, "basics.links")}
          />
        </label>
      </div>
    </details>
  );
}

// ------------------------------------------------------------------ 3 · Design

const TEMPLATES: { id: TemplateId; name: string }[] = [
  { id: "original", name: "Original" },
  { id: "classic", name: "Classic" },
  { id: "modern", name: "Modern" },
  { id: "compact", name: "Compact" },
];

const ACCENTS = [
  { c: "#1B1A17", n: "Ink" },
  { c: "#1F3A5F", n: "Navy" },
  { c: "#2F5D46", n: "Forest" },
  { c: "#7A2836", n: "Wine" },
  { c: "#3D4A57", n: "Slate" },
];

function DesignCard() {
  const { resume, edit } = useStore();
  const L = resume.layout;
  const set = (patch: Partial<typeof L>, key?: string) => edit({ ...resume, layout: { ...L, ...patch } }, key);
  return (
    <Panel
      flat
      id="step-design"
      title={
        <>
          <span className="step-num">3</span> Design
        </>
      }
    >
      <div className="stack">
        <div className="tpl-picker" role="group" aria-label="Template">
          {(L.custom ? [{ id: "custom" as TemplateId, name: "Your format" }, ...TEMPLATES] : TEMPLATES).map((t) => (
            <button key={t.id} className="tpl-option" aria-pressed={L.template === t.id} onClick={() => set({ template: t.id })}>
              <span className={`tpl-thumb ${t.id}`} aria-hidden="true">
                <i className="h" />
                <i style={{ width: "80%", margin: t.id === "classic" || t.id === "original" || t.id === "custom" ? "0 auto" : undefined }} />
                <i className="s" />
                <i />
                <i style={{ width: "85%" }} />
                <i className="s" />
                <i style={{ width: "70%" }} />
              </span>
              {t.name}
            </button>
          ))}
        </div>
        <div className="row">
          <span className="label grow">Paper size</span>
          <div className="segmented" role="group" aria-label="Paper size">
            {(["A4", "Letter"] as const).map((p) => (
              <button key={p} aria-pressed={L.page === p} onClick={() => set({ page: p })}>
                {p}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span className="row">
            <span className="label grow">Spacing</span>
            <span className="hint">{L.density < 0 ? "Roomy" : L.density === 0 ? "Normal" : "Tight"}</span>
          </span>
          <input
            className="range"
            type="range"
            min={-3}
            max={4}
            step={1}
            value={L.density}
            onChange={(e) => set({ density: +e.target.value }, "density")}
            aria-valuetext={L.density < 0 ? "Roomy" : L.density === 0 ? "Normal" : "Tight"}
          />
        </label>
        <div className="row">
          <span className="label grow">Heading color</span>
          <div className="swatches" role="group" aria-label="Heading color">
            {ACCENTS.map((a) => (
              <button
                key={a.c}
                className="swatch"
                style={{ background: a.c }}
                aria-pressed={L.accent.toLowerCase() === a.c.toLowerCase()}
                aria-label={a.n}
                title={a.n}
                onClick={() => set({ accent: a.c })}
              />
            ))}
          </div>
        </div>
      </div>
    </Panel>
  );
}

// The resume sheet. Everything visible is editable in place; hidden items are skipped.

import { useRef } from "react";
import { getPath, setPath, splitList, type Resume, type SectionKey } from "../lib/schema";
import { useSelection } from "../lib/selection";
import { useStore } from "../lib/store";
import { Editable, focusPathSoon } from "./Editable";

const TITLES: Record<Exclude<SectionKey, "custom">, string> = {
  summary: "Summary",
  skills: "Skills",
  experience: "Experience",
  projects: "Projects",
  certifications: "Certifications",
  education: "Education",
};

// The "Original" template copies the layout of the owner's PDF: full section names, company on the
// first line and role on the second, "title | detail" for other entries.
const LONG_TITLES: Record<Exclude<SectionKey, "custom">, string> = {
  summary: "Professional Summary",
  skills: "Technical Skills",
  experience: "Professional Experience",
  projects: "Projects",
  certifications: "Certifications & Achievements",
  education: "Education",
};

export function ResumePage({ resume, editable = true }: { resume: Resume; editable?: boolean }) {
  const original = resume.layout.template === "original";
  const titles = original ? LONG_TITLES : TITLES;
  const { edit } = useStore();
  const { setSelected } = useSelection();
  const latest = useRef(resume);
  latest.current = resume;
  const hidden = new Set(resume.layout.hidden);

  const update = (path: string, value: unknown) => edit(setPath(latest.current, path, value), path);

  const text = (path: string, placeholder: string, className?: string, tag?: "span" | "div" | "h1" | "p") =>
    editable ? (
      <Editable
        path={path}
        value={String(getPath(resume, path) ?? "")}
        placeholder={placeholder}
        className={className}
        tag={tag}
        onChange={(t) => update(path, t)}
      />
    ) : (
      <span className={className}>{String(getPath(resume, path) ?? "")}</span>
    );

  const list = (path: string, placeholder: string, sep = ", ") => {
    const items = (getPath(resume, path) as string[]) ?? [];
    return editable ? (
      <Editable
        path={path}
        value={items.join(sep)}
        placeholder={placeholder}
        onChange={(t) => {
          // Only re-split when the text really changed, so typing a trailing comma is not lost.
          if (t !== items.join(sep)) update(path, splitList(t));
        }}
      />
    ) : (
      <span>{items.join(sep)}</span>
    );
  };

  const bullets = (path: string, items: string[], context: string) => (
    <>
      <ul className="r-bullets">
        {items.map((b, i) => (
          <li key={i} className="bullet-row">
            {editable ? (
              <>
                <Editable
                  path={`${path}.${i}`}
                  value={b}
                  placeholder="Describe what you did and the result"
                  label={`Bullet ${i + 1}, ${context}`}
                  onChange={(t) => update(`${path}.${i}`, t)}
                  onFocus={() => setSelected({ path: `${path}.${i}`, context })}
                  onEnter={() => {
                    const next = [...items];
                    next.splice(i + 1, 0, "");
                    update(path, next);
                    focusPathSoon(`${path}.${i + 1}`);
                  }}
                  onBackspaceEmpty={() => {
                    if (items.length <= 1) return;
                    update(
                      path,
                      items.filter((_, j) => j !== i),
                    );
                    if (i > 0) focusPathSoon(`${path}.${i - 1}`, true);
                  }}
                />
                <span className="bullet-tools no-print" contentEditable={false}>
                  <button
                    type="button"
                    aria-label="Move bullet up"
                    title="Move up"
                    disabled={i === 0}
                    onClick={() => {
                      const next = [...items];
                      [next[i - 1], next[i]] = [next[i], next[i - 1]];
                      update(path, next);
                    }}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label="Delete bullet"
                    title="Delete"
                    onClick={() =>
                      update(
                        path,
                        items.filter((_, j) => j !== i),
                      )
                    }
                  >
                    ×
                  </button>
                </span>
              </>
            ) : (
              b
            )}
          </li>
        ))}
      </ul>
      {editable && (
        <button
          type="button"
          className="add-bullet no-print"
          onClick={() => {
            update(path, [...items, ""]);
            focusPathSoon(`${path}.${items.length}`);
          }}
        >
          + Add bullet
        </button>
      )}
    </>
  );

  const b = resume.basics;
  const contact: { path: string; ph: string; show: boolean }[] = [
    { path: "basics.email", ph: "email", show: !!b.email },
    { path: "basics.phone", ph: "phone", show: !!b.phone },
    { path: "basics.location", ph: "city", show: !!b.location },
  ];

  const sections: Record<SectionKey, () => React.ReactNode> = {
    summary: () =>
      resume.summary || editable ? (
        <section className={`r-section ${resume.summary ? "" : "is-empty"}`} key="summary">
          <h2 className="r-section-title">{titles.summary}</h2>
          {text("summary", "A short summary of who you are and what you do best", "r-text", "p")}
        </section>
      ) : null,
    skills: () => {
      const groups = resume.skills.map((g, i) => ({ g, i })).filter(({ g }) => !hidden.has(g.id));
      if (!groups.length) return null;
      return (
        <section className="r-section" key="skills">
          <h2 className="r-section-title">{titles.skills}</h2>
          {groups.map(({ g, i }) => (
            <div className="r-skill-line" key={g.id}>
              <strong>{text(`skills.${i}.category`, "Category")}:</strong> {list(`skills.${i}.items`, "Skill, skill, skill")}
            </div>
          ))}
        </section>
      );
    },
    experience: () => {
      const items = resume.experience.map((e, i) => ({ e, i })).filter(({ e }) => !hidden.has(e.id));
      if (!items.length) return null;
      return (
        <section className="r-section" key="experience">
          <h2 className="r-section-title">{titles.experience}</h2>
          {items.map(({ e, i }) => (
            <div className="r-entry" key={e.id}>
              {original ? (
                <>
                  <div className="r-entry-head">
                    {text(`experience.${i}.company`, "Company", "r-entry-title")}
                    {text(`experience.${i}.dates`, "Dates", "r-dates")}
                  </div>
                  <div className="r-role">{text(`experience.${i}.role`, "Job title")}</div>
                </>
              ) : (
                <div className="r-entry-head">
                  <span>
                    {text(`experience.${i}.role`, "Job title", "r-entry-title")}
                    {(e.company || editable) && <span className="r-entry-title"> · </span>}
                    {text(`experience.${i}.company`, "Company", "r-entry-title")}
                  </span>
                  {text(`experience.${i}.dates`, "Dates", "r-dates")}
                </div>
              )}
              {(e.location || editable) && (
                <div className="r-entry-sub opt">{text(`experience.${i}.location`, "Location (optional)")}</div>
              )}
              {bullets(`experience.${i}.bullets`, e.bullets, `${e.role} at ${e.company}`)}
            </div>
          ))}
        </section>
      );
    },
    projects: () => {
      const items = resume.projects.map((p, i) => ({ p, i })).filter(({ p }) => !hidden.has(p.id));
      if (!items.length) return null;
      return (
        <section className="r-section" key="projects">
          <h2 className="r-section-title">{titles.projects}</h2>
          {items.map(({ p, i }) => (
            <div className="r-entry" key={p.id}>
              <div className="r-entry-head">
                <span>
                  {text(`projects.${i}.name`, "Project name", "r-entry-title")}
                  {(p.link || editable) && (
                    <span className="opt r-stack">
                      {" · "}
                      {text(`projects.${i}.link`, "link (optional)")}
                    </span>
                  )}
                </span>
                {text(`projects.${i}.dates`, "Year", "r-dates")}
              </div>
              {(p.stack.length > 0 || editable) && <div className="r-stack opt">{list(`projects.${i}.stack`, "Tools used")}</div>}
              {bullets(`projects.${i}.bullets`, p.bullets, `project ${p.name}`)}
            </div>
          ))}
        </section>
      );
    },
    custom: () => {
      const secs = resume.custom_sections.map((s, si) => ({ s, si })).filter(({ s }) => !hidden.has(s.id));
      return secs.map(({ s, si }) => {
        const items = s.items.map((it, ii) => ({ it, ii })).filter(({ it }) => !hidden.has(it.id));
        return (
          <section className="r-section" key={s.id}>
            <h2 className="r-section-title">{text(`custom_sections.${si}.title`, "Section title")}</h2>
            {items.map(({ it, ii }) => (
              <div className="r-entry" key={it.id}>
                <div className="r-entry-head">
                  <span>
                    {text(`custom_sections.${si}.items.${ii}.title`, "Title", "r-entry-title")}
                    {(it.subtitle || editable) && (
                      <span className={original ? "opt r-entry-title" : "opt r-entry-sub"}>
                        {original ? "  |  " : " · "}
                        {text(`custom_sections.${si}.items.${ii}.subtitle`, "detail (optional)")}
                      </span>
                    )}
                  </span>
                  {text(`custom_sections.${si}.items.${ii}.dates`, "Date", "r-dates")}
                </div>
                {bullets(`custom_sections.${si}.items.${ii}.bullets`, it.bullets, s.title)}
              </div>
            ))}
          </section>
        );
      });
    },
    certifications: () =>
      resume.certifications.length ? (
        <section className="r-section" key="certifications">
          <h2 className="r-section-title">{titles.certifications}</h2>
          <p className="r-text">{list("certifications", "Certification", " • ")}</p>
        </section>
      ) : null,
    education: () => {
      const items = resume.education.map((e, i) => ({ e, i })).filter(({ e }) => !hidden.has(e.id));
      if (!items.length) return null;
      return (
        <section className="r-section" key="education">
          <h2 className="r-section-title">{titles.education}</h2>
          {items.map(({ e, i }) => (
            <div className="r-entry" key={e.id}>
              {original ? (
                <>
                  <div className="r-entry-head">
                    {text(`education.${i}.degree`, "Degree", "r-entry-title")}
                    {text(`education.${i}.dates`, "Dates", "r-dates")}
                  </div>
                  <div className="r-school">{text(`education.${i}.institution`, "School")}</div>
                </>
              ) : (
                <div className="r-entry-head">
                  <span>
                    {text(`education.${i}.degree`, "Degree", "r-entry-title")}
                    <span> · </span>
                    {text(`education.${i}.institution`, "School")}
                  </span>
                  {text(`education.${i}.dates`, "Dates", "r-dates")}
                </div>
              )}
              {(e.details || editable) && <div className="r-entry-sub opt">{text(`education.${i}.details`, "Details (optional)")}</div>}
            </div>
          ))}
        </section>
      );
    },
  };

  return (
    <>
      <header className="r-header">
        {text("basics.name", "Your name", "r-name", "h1")}
        {b.contact_line ? (
          <div className="r-contact r-contact-line">
            {text("basics.contact_line", "email@example.com | linkedin... | +1 234...")}
          </div>
        ) : (
          <div className="r-contact">
            {contact
              .filter((c) => c.show)
              .map((c, i) => (
                <span key={c.path}>
                  {i > 0 && <span className="sep">|</span>} {text(c.path, c.ph)}
                </span>
              ))}
            {b.links.length > 0 && (
              <span>
                {contact.some((c) => c.show) && <span className="sep">|</span>} {list("basics.links", "links", "  |  ")}
              </span>
            )}
          </div>
        )}
        {b.sub_badge ? (
          <div className="r-badge-bar">
            {text("basics.sub_badge", "GSoC | Publications | Systems")}
          </div>
        ) : (
          (b.headline || editable) && <div className="r-headline opt">{text("basics.headline", "Headline, e.g. Data Analyst")}</div>
        )}
      </header>
      {resume.layout.order.filter((k) => !hidden.has(k)).map((k) => sections[k]())}
    </>
  );
}

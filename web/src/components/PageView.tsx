// Draws the page engine's layout on screen and lets people edit it in place.
// Every word sits exactly where it will be in the PDF (the same layout is written by pdf.ts).
// Click any text to open a small editor for that field; the page updates as you type.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Field, PageLayout } from "../lib/page/layout";
import { SCREEN_FONT } from "../lib/page/metrics";
import { getPath, setPath, splitList, type Resume } from "../lib/schema";
import { useSelection } from "../lib/selection";
import { useStore } from "../lib/store";
import { Icon } from "./Icon";

const PX_PER_PT = 96 / 72;

export function PageView({ layout, zoom }: { layout: PageLayout; zoom: number }) {
  const { editing, setEditing } = useSelection();
  const [hover, setHover] = useState<string | null>(null);
  const scale = PX_PER_PT * zoom;
  const W = layout.width * scale;
  const H = layout.height * scale;
  const field = editing ? layout.fields[editing] : undefined;
  const fields = Object.values(layout.fields).filter((f) => f.rects.length);

  return (
    <div className="pages" onMouseLeave={() => setHover(null)}>
      {layout.pages.map((items, pi) => (
        <div key={pi} className="page" style={{ width: W, height: H }}>
          <svg
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            width={W}
            height={H}
            aria-label={`Resume, page ${pi + 1} of ${layout.pages.length}`}
          >
            <rect width={layout.width} height={layout.height} fill="#fff" />
            {items.map((it, i) =>
              it.kind === "rule" ? (
                <line key={i} x1={it.x1} x2={it.x2} y1={it.y} y2={it.y} stroke={it.color} strokeWidth={it.thickness} />
              ) : (
                <text
                  key={i}
                  x={it.x}
                  y={it.y}
                  fontSize={it.size}
                  fontFamily={SCREEN_FONT[it.family]}
                  fontWeight={it.font.startsWith("bold") ? 700 : 400}
                  fontStyle={/talic/.test(it.font) ? "italic" : "normal"}
                  fill={it.color}
                  textLength={it.width}
                  lengthAdjust="spacingAndGlyphs"
                  xmlSpace="preserve"
                >
                  {it.text}
                </text>
              ),
            )}
            {fields.flatMap((f) =>
              f.rects
                .filter((r) => r.page === pi)
                .map((r, k) => (
                  <rect
                    key={`${f.path}:${k}`}
                    className={`hit ${hover === f.path || editing === f.path ? "on" : ""}`}
                    x={r.x - 1.5}
                    y={r.y}
                    width={r.w + 3}
                    height={r.h}
                    rx={1.5}
                    role="button"
                    tabIndex={k === 0 ? 0 : -1}
                    aria-label={`Edit ${f.label.toLowerCase()}`}
                    onMouseEnter={() => setHover(f.path)}
                    onFocus={() => setHover(f.path)}
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditing(f.path);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setEditing(f.path);
                      }
                    }}
                  />
                )),
            )}
          </svg>
          {field && editing && field.rects[0]?.page === pi && (
            <FieldEditor key={editing} field={field} scale={scale} pageWidth={W} pageHeight={H} onClose={() => setEditing(null)} />
          )}
        </div>
      ))}
    </div>
  );
}

function contextOf(r: Resume, path: string): string {
  const [section, index] = path.split(".");
  const i = Number(index);
  if (section === "experience") return `${r.experience[i]?.role} at ${r.experience[i]?.company}`;
  if (section === "projects") return `project ${r.projects[i]?.name} (${r.projects[i]?.stack.join(", ")})`;
  if (section === "custom_sections") return r.custom_sections[i]?.title ?? "";
  return "";
}

export function FieldEditor({
  field,
  scale,
  pageWidth,
  pageHeight,
  onClose,
  fallback = "",
  separator,
  inPdf = false,
  problem = "",
}: {
  field: Field;
  scale: number;
  pageWidth: number;
  pageHeight: number;
  onClose: () => void;
  fallback?: string; // text to start from when the field has no value yet (a PDF block's own text)
  separator?: string; // how list items are joined on the page
  inPdf?: boolean; // editing an uploaded PDF: text only, no adding or moving bullets
  problem?: string; // e.g. "too long for its lines"
}) {
  const { resume, edit } = useStore();
  const { setSelected, setEditing } = useSelection();
  const latest = useRef(resume);
  latest.current = resume;
  const path = field.path;
  const raw = getPath(resume, path) ?? fallback;
  const isList = Array.isArray(raw);
  const sep = separator ?? (path === "certifications" ? " • " : path === "basics.links" ? "  |  " : ", ");
  const initial = useRef(isList ? (raw as string[]).join(sep) : String(raw ?? ""));
  const [draft, setDraft] = useState(initial.current);
  const box = useRef<HTMLDivElement>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const bullet = path.match(/^(.*\.bullets)\.(\d+)$/);

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight + 2, 220)}px`;
  }, [draft]);
  useEffect(() => {
    const away = (e: MouseEvent) => {
      const t = e.target as Element;
      if (box.current?.contains(t) || t.closest?.(".hit")) return;
      onClose();
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [onClose]);

  const apply = (text: string) => {
    setDraft(text);
    edit(setPath(latest.current, path, isList ? splitList(text) : text), path);
  };
  const cancel = () => {
    edit(setPath(latest.current, path, isList ? splitList(initial.current) : initial.current), path);
    onClose();
  };

  const aiButton = (
    <button
      className="btn btn-ghost btn-sm"
      title="Rewrite this bullet with AI (right panel)"
      onClick={() => {
        setSelected({ path, context: contextOf(latest.current, path) });
        window.dispatchEvent(new CustomEvent("tailor:open-panel", { detail: "right" }));
        onClose();
      }}
    >
      <Icon name="sparkle" size={13} /> AI rewrite
    </button>
  );

  const listOps = () => {
    if (!bullet) return null;
    if (inPdf) return aiButton;
    const listPath = bullet[1];
    const idx = Number(bullet[2]);
    const list = [...((getPath(latest.current, listPath) as string[]) ?? [])];
    const move = (dir: -1 | 1) => {
      const j = idx + dir;
      if (j < 0 || j >= list.length) return;
      [list[idx], list[j]] = [list[j], list[idx]];
      edit(setPath(latest.current, listPath, list));
      setEditing(`${listPath}.${j}`);
    };
    return (
      <>
        <button className="icon-btn sm" title="Move up" aria-label="Move bullet up" disabled={idx === 0} onClick={() => move(-1)}>
          ↑
        </button>
        <button
          className="icon-btn sm"
          title="Move down"
          aria-label="Move bullet down"
          disabled={idx >= list.length - 1}
          onClick={() => move(1)}
        >
          ↓
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => {
            list.splice(idx + 1, 0, "");
            edit(setPath(latest.current, listPath, list));
            setEditing(`${listPath}.${idx + 1}`);
          }}
        >
          <Icon name="plus" size={13} /> Bullet below
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => {
            edit(setPath(latest.current, listPath, list.filter((_, j) => j !== idx)));
            onClose();
          }}
        >
          <Icon name="trash" size={13} /> Delete
        </button>
        {aiButton}
      </>
    );
  };

  const rects = field.rects.filter((r) => r.page === field.rects[0].page);
  const top = Math.max(...rects.map((r) => r.y + r.h)) * scale + 6;
  const above = top > pageHeight - 190;
  const width = Math.min(500, pageWidth - 16);
  const left = Math.max(8, Math.min(rects[0].x * scale - 8, pageWidth - width - 8));
  const style = above
    ? { left, width, bottom: pageHeight - Math.min(...rects.map((r) => r.y)) * scale + 6 }
    : { left, width, top };

  return (
    <div ref={box} className="field-editor" role="dialog" aria-label={`Edit ${field.label.toLowerCase()}`} style={style}>
      <div className="fe-head">
        <strong>{field.label}</strong>
        {isList && <span className="hint">separate with commas</span>}
        <span className="grow" />
        <span className="hint">{draft.length} characters</span>
      </div>
      {problem && (
        <p className="fe-problem" role="status">
          {problem}
        </p>
      )}
      <textarea
        ref={ta}
        className="textarea"
        value={draft}
        rows={1}
        spellCheck
        onChange={(e) => apply(e.target.value.replace(/\n/g, " "))}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          } else if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onClose();
          }
        }}
        aria-label={field.label}
      />
      <div className="fe-actions">
        {listOps()}
        <span className="grow" />
        <button className="btn btn-ghost btn-sm" onClick={cancel} title="Undo changes to this field (Esc)">
          Cancel
        </button>
        <button className="btn btn-primary btn-sm" onClick={onClose} title="Done (Enter)">
          Done
        </button>
      </div>
    </div>
  );
}

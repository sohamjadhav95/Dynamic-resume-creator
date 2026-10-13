// Click-to-edit text on the resume page. Plain text only; never re-renders while you type.

import { useEffect, useLayoutEffect, useRef } from "react";

let pendingFocus: { path: string; atEnd: boolean } | null = null;

/** Ask the Editable with this path to take focus once it is rendered. */
export function focusPathSoon(path: string, atEnd = false) {
  pendingFocus = { path, atEnd };
  window.setTimeout(() => {
    const el = document.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`);
    if (el && pendingFocus?.path === path) {
      placeCaret(el, pendingFocus.atEnd);
      pendingFocus = null;
    }
  }, 0);
}

function placeCaret(el: HTMLElement, atEnd: boolean) {
  el.focus();
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(!atEnd);
  sel.removeAllRanges();
  sel.addRange(range);
}

interface Props {
  path: string;
  value: string;
  placeholder: string;
  label?: string;
  className?: string;
  onChange: (text: string) => void;
  onEnter?: () => void;
  onBackspaceEmpty?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  tag?: "span" | "div" | "h1" | "p";
}

const clean = (s: string) => s.replace(/\s*\n+\s*/g, " ").replace(/ /g, " ");

export function Editable({
  path,
  value,
  placeholder,
  label,
  className,
  onChange,
  onEnter,
  onBackspaceEmpty,
  onFocus,
  onBlur,
  tag = "span",
}: Props) {
  const ref = useRef<HTMLElement>(null);

  // Only write the DOM when the value changed from outside (undo, AI, other panel) — keeps the caret stable.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && el.textContent !== value && document.activeElement !== el) el.textContent = value;
  }, [value]);

  useEffect(() => {
    if (pendingFocus?.path === path && ref.current) {
      placeCaret(ref.current, pendingFocus.atEnd);
      pendingFocus = null;
    }
  }, [path]);

  const Tag = tag as "span";
  return (
    <Tag
      ref={ref as React.RefObject<HTMLSpanElement>}
      className={className}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck
      role="textbox"
      aria-label={label ?? placeholder}
      data-path={path}
      data-placeholder={placeholder}
      onInput={(e) => onChange(clean(e.currentTarget.textContent ?? ""))}
      onFocus={onFocus}
      onBlur={(e) => {
        const text = clean(e.currentTarget.textContent ?? "").trim();
        if (text !== value) onChange(text);
        if (e.currentTarget.textContent !== text) e.currentTarget.textContent = text;
        onBlur?.();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          if (onEnter) onEnter();
          else e.currentTarget.blur();
        } else if (e.key === "Backspace" && onBackspaceEmpty && !(e.currentTarget.textContent ?? "").length) {
          e.preventDefault();
          onBackspaceEmpty();
        } else if (e.key === "Escape") {
          e.currentTarget.blur();
        }
      }}
      onPaste={(e) => {
        e.preventDefault();
        const text = clean(e.clipboardData.getData("text/plain"));
        document.execCommand("insertText", false, text);
      }}
    />
  );
}

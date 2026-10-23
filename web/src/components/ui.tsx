// Shared UI plumbing: toasts, dialogs, menus, media queries.

import {
  Component,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { loadPrefs, savePrefs } from "../lib/prefs";
import { Icon } from "./Icon";

// ------------------------------------------------------------------ collapsible panel

/** A titled section that can be collapsed and expanded; remembers its state on this device. */
export function Panel({
  id,
  title,
  icon,
  extra,
  defaultOpen = true,
  className = "",
  flat = false,
  children,
}: {
  id: string;
  title: ReactNode;
  icon?: Parameters<typeof Icon>[0]["name"];
  extra?: ReactNode; // shown on the right of the header (e.g. a count)
  defaultOpen?: boolean;
  className?: string;
  flat?: boolean; // a step in the left column (no card border)
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => {
    const closed = loadPrefs().closed;
    return closed.includes(id) ? false : closed.includes(`open:${id}`) ? true : defaultOpen;
  });
  const bodyId = useId();
  const toggle = () => {
    const next = !open;
    setOpen(next);
    const closed = loadPrefs().closed.filter((x) => x !== id && x !== `open:${id}`);
    savePrefs({ closed: next ? (defaultOpen ? closed : [...closed, `open:${id}`]) : [...closed, id] });
  };
  return (
    <section className={`${flat ? "panel-section flat" : "card"} panel ${open ? "is-open" : "is-closed"} ${className}`}>
      <button type="button" className="panel-head" aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
        {icon && <Icon name={icon} size={16} />}
        <span className="panel-title grow">{title}</span>
        {extra && <span className="panel-extra">{extra}</span>}
        <span className="panel-chevron" aria-hidden="true">
          <Icon name="chevron" size={14} />
        </span>
      </button>
      {open && (
        <div className="panel-body" id={bodyId}>
          {children}
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ toasts

export interface Toast {
  id: number;
  message: string;
  kind?: "info" | "error";
  action?: { label: string; run: () => void };
  ms?: number;
}

const ToastCtx = createContext<(t: Omit<Toast, "id">) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list.slice(-2), { ...t, id }]);
    window.setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), t.ms ?? (t.action ? 9000 : 5000));
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind === "error" ? "error" : ""}`}>
            <span className="grow">{t.message}</span>
            {t.action && (
              <button
                className="btn btn-sm"
                onClick={() => {
                  t.action!.run();
                  setToasts((list) => list.filter((x) => x.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            )}
            <button
              className="icon-btn sm"
              style={{ color: "inherit" }}
              aria-label="Dismiss"
              onClick={() => setToasts((list) => list.filter((x) => x.id !== t.id))}
            >
              <Icon name="x" size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

// ------------------------------------------------------------------ dialog

export function Dialog({
  title,
  subtitle,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const focusable = () =>
      Array.from(
        el?.querySelectorAll<HTMLElement>('button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])') ?? [],
      ).filter((x) => !x.hasAttribute("disabled"));
    (focusable()[1] ?? focusable()[0])?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const items = focusable();
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`dialog ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="dialog-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <div className="muted">{subtitle}</div>}
          </div>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        {children}
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ dropdown menu

export function Menu({
  button,
  children,
  align = "left",
  label,
}: {
  button: (props: { onClick: () => void; "aria-expanded": boolean; "aria-haspopup": "menu" }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>('[role="menu"] button')?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menu"] button') ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[next]?.focus();
  };
  return (
    <div className="doc-switch" ref={ref}>
      {button({ onClick: () => setOpen((o) => !o), "aria-expanded": open, "aria-haspopup": "menu" })}
      {open && (
        <div className={`menu ${align === "right" ? "right" : ""}`} role="menu" aria-label={label} onKeyDown={onMenuKey}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ layout mode

export type LayoutMode = "wide" | "medium" | "narrow";

export function useLayoutMode(): LayoutMode {
  const get = (): LayoutMode =>
    window.matchMedia("(max-width: 820px)").matches
      ? "narrow"
      : window.matchMedia("(max-width: 1240px)").matches
        ? "medium"
        : "wide";
  const [mode, setMode] = useState<LayoutMode>(get);
  useEffect(() => {
    const onResize = () => setMode(get());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return mode;
}

/** Keeps one broken part (e.g. the page) from blanking the whole app; shows a way back instead. */
export class Guard extends Component<{ children: ReactNode; label: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error(`${this.props.label} failed:`, error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="empty-state" role="alert">
        <p>Something went wrong showing {this.props.label}. Your work is saved.</p>
        <button className="btn btn-sm" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    );
  }
}

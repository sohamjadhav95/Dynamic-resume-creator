// Small inline icon set (stroke icons, 20px grid). Decorative unless given a label.

const PATHS: Record<string, string> = {
  sparkle: "M10 2.5l1.6 4.4 4.4 1.6-4.4 1.6L10 14.5l-1.6-4.4L4 8.5l4.4-1.6zM15.5 13l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z",
  undo: "M7.5 6.5L4 10l3.5 3.5M4.5 10H12a4 4 0 010 8h-2",
  redo: "M12.5 6.5L16 10l-3.5 3.5M15.5 10H8a4 4 0 000 8h2",
  eye: "M2.5 10s2.8-5.5 7.5-5.5S17.5 10 17.5 10s-2.8 5.5-7.5 5.5S2.5 10 2.5 10zM10 12.3a2.3 2.3 0 100-4.6 2.3 2.3 0 000 4.6z",
  eyeOff: "M3 3l14 14M8.3 8.4a2.3 2.3 0 003.3 3.2M6.2 5.5C3.9 6.9 2.5 10 2.5 10s2.8 5.5 7.5 5.5c1.4 0 2.6-.4 3.7-1M10 4.5c4.7 0 7.5 5.5 7.5 5.5s-.6 1.2-1.7 2.5",
  up: "M10 15V5M5.5 9.5L10 5l4.5 4.5",
  down: "M10 5v10M5.5 10.5L10 15l4.5-4.5",
  chevron: "M5.5 8l4.5 4.5L14.5 8",
  chevronRight: "M8 5.5l4.5 4.5L8 14.5",
  plus: "M10 4.5v11M4.5 10h11",
  trash: "M4.5 6h11M8 6V4.5h4V6M6 6l.7 9.5h6.6L14 6",
  x: "M5.5 5.5l9 9M14.5 5.5l-9 9",
  check: "M4.5 10.5l3.5 3.5 7.5-8",
  download: "M10 3.5v9M6 9l4 4 4-4M4 16h12",
  upload: "M10 13V4M6 7.5l4-4 4 4M4 16h12",
  file: "M5.5 2.5h6l3.5 3.5v11.5h-9.5zM11.5 2.5V6H15",
  paste: "M7 3.5h6v2H7zM6 4.5H4.5v13h11v-13H14M7 10h6M7 13h4",
  pen: "M13.5 3.5l3 3-9 9H4.5v-3zM11.5 5.5l3 3",
  sun: "M10 13.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM10 2v1.8M10 16.2V18M2 10h1.8M16.2 10H18M4.3 4.3l1.3 1.3M14.4 14.4l1.3 1.3M4.3 15.7l1.3-1.3M14.4 5.6l1.3-1.3",
  moon: "M16.5 12.5A7 7 0 017.5 3.5a7 7 0 109 9z",
  monitor: "M3 4.5h14v9H3zM7.5 16.5h5M10 13.5v3",
  user: "M10 10a3.3 3.3 0 100-6.6 3.3 3.3 0 000 6.6zM3.5 17c.8-3 3.4-4.8 6.5-4.8s5.7 1.8 6.5 4.8",
  settings: "M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM16 10l1.5-1-1.3-2.6-1.8.5a5.6 5.6 0 00-1.6-1L12.4 4h-2.9l-.4 1.9c-.6.2-1.1.6-1.6 1l-1.8-.5L4.4 9 6 10l-1.5 1 1.3 2.6 1.8-.5c.5.4 1 .8 1.6 1l.4 1.9h2.9l.4-1.9c.6-.2 1.1-.6 1.6-1l1.8.5 1.3-2.6z",
  history: "M3.5 10a6.5 6.5 0 106.5-6.5A6.6 6.6 0 004.6 6.5M4 3.5v3h3M10 6.5V10l2.5 1.5",
  copy: "M7 7h9v9.5H7zM13 7V3.5H3.5V13H7",
  target: "M10 17a7 7 0 100-14 7 7 0 000 14zM10 13.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM10 10.5a.5.5 0 100-1 .5.5 0 000 1z",
  bulb: "M7.5 14.5h5M8 17h4M10 2.5a5 5 0 00-3 9c.6.5 1 1.2 1 2h4c0-.8.4-1.5 1-2a5 5 0 00-3-9z",
  layout: "M3 3.5h14v13H3zM8 3.5v13M8 9h9",
  page: "M5 2.5h10v15H5zM7.5 6h5M7.5 9h5M7.5 12h3",
  bolt: "M11 2.5L4.5 11h5L9 17.5l6.5-8.5h-5z",
  shield: "M10 2.5l6 2.5v4.5c0 4-2.6 6.8-6 8-3.4-1.2-6-4-6-8V5z",
  lock: "M5.5 9h9v8h-9zM7.5 9V6.5a2.5 2.5 0 015 0V9",
  google: "",
  mail: "M3 5h14v10H3zM3.5 5.5L10 11l6.5-5.5",
  logout: "M8 4H4.5v12H8M12 6.5L15.5 10 12 13.5M15.5 10H8",
  more: "M5 10h.01M10 10h.01M15 10h.01",
  grip: "M7.5 5h.01M12.5 5h.01M7.5 10h.01M12.5 10h.01M7.5 15h.01M12.5 15h.01",
  info: "M10 17.5a7.5 7.5 0 100-15 7.5 7.5 0 000 15zM10 9v4.5M10 6.5h.01",
  warn: "M10 3l7.5 13.5h-15zM10 8.5v3.5M10 14.5h.01",
};

export function Icon({ name, size = 18, label, className }: { name: string; size?: number; label?: string; className?: string }) {
  if (name === "google") {
    return (
      <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden={!label} aria-label={label} className={className}>
        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
        <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
      </svg>
    );
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === "more" || name === "grip" ? 2.6 : 1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
      className={className}
    >
      <path d={PATHS[name] ?? ""} />
    </svg>
  );
}

export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="var(--ink)" />
      <path d="M10 8h9l4 4v12H10z" fill="var(--paper)" />
      <path d="M13 15h7M13 18h7M13 21h4" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

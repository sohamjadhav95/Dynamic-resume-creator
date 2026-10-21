// Per-device preferences (theme, own API key). Never synced to the cloud.

export type Theme = "system" | "light" | "dark";

export interface Prefs {
  theme: Theme;
  geminiKey: string;
  zoom: number; // 0 = fit to width
  closed: string[]; // ids of panel sections the person collapsed
  leftW: number; // width of the left column (px)
  rightW: number; // width of the right column (px)
  leftClosed: boolean;
  rightClosed: boolean;
}

const KEY = "tailor.prefs.v1";
const DEFAULTS: Prefs = {
  theme: "system",
  geminiKey: "",
  zoom: 0,
  closed: [],
  leftW: 330,
  rightW: 360,
  leftClosed: false,
  rightClosed: false,
};

export function loadPrefs(): Prefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(patch: Partial<Prefs>): Prefs {
  const next = { ...loadPrefs(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode: preferences last for this visit only */
  }
  return next;
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

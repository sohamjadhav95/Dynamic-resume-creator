// App state: the workspace (master + tailored versions), the active document and undo/redo.

import { createContext, useCallback, useContext, useMemo, useReducer, type ReactNode } from "react";
import { emptyResume, type Resume } from "./schema";
import type { Version, Workspace } from "./storage";
import { DEFAULT_OPTIONS, type TailorOptions } from "./tailor";

export const MASTER = "master";

export interface State {
  ws: Workspace;
  activeId: string; // MASTER or a version id
  jobDraft: string;
  options: TailorOptions;
  past: Resume[];
  future: Resume[];
  lastEdit: { at: number; key: string };
  revision: number; // bumps on every workspace change (drives autosave)
}

type Action =
  | { type: "load"; ws: Workspace; activeId?: string }
  | { type: "edit"; resume: Resume; coalesceKey?: string }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "setActive"; id: string }
  | { type: "addVersion"; version: Version }
  | { type: "updateVersion"; id: string; patch: Partial<Version> }
  | { type: "deleteVersion"; id: string }
  | { type: "setMaster"; resume: Resume }
  | { type: "setJob"; text: string }
  | { type: "setOptions"; patch: Partial<TailorOptions> };

const HISTORY_LIMIT = 100;
const COALESCE_MS = 1200;

export function activeResume(s: State): Resume {
  if (s.activeId === MASTER) return s.ws.master;
  return s.ws.versions.find((v) => v.id === s.activeId)?.data ?? s.ws.master;
}

export function activeVersion(s: State): Version | undefined {
  return s.ws.versions.find((v) => v.id === s.activeId);
}

function withResume(s: State, resume: Resume): Workspace {
  if (s.activeId === MASTER) return { ...s.ws, master: resume };
  return {
    ...s.ws,
    versions: s.ws.versions.map((v) =>
      v.id === s.activeId ? { ...v, data: resume, updated_at: new Date().toISOString() } : v,
    ),
  };
}

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "load":
      return {
        ...s,
        ws: a.ws,
        activeId: a.activeId && a.ws.versions.some((v) => v.id === a.activeId) ? a.activeId : MASTER,
        past: [],
        future: [],
        revision: s.revision + 1,
      };
    case "edit": {
      const now = Date.now();
      const current = activeResume(s);
      if (current === a.resume) return s;
      const coalesce = !!a.coalesceKey && a.coalesceKey === s.lastEdit.key && now - s.lastEdit.at < COALESCE_MS;
      return {
        ...s,
        ws: withResume(s, a.resume),
        past: coalesce ? s.past : [...s.past.slice(-HISTORY_LIMIT + 1), current],
        future: [],
        lastEdit: { at: now, key: a.coalesceKey ?? "" },
        revision: s.revision + 1,
      };
    }
    case "undo": {
      if (!s.past.length) return s;
      const prev = s.past[s.past.length - 1];
      return {
        ...s,
        ws: withResume(s, prev),
        past: s.past.slice(0, -1),
        future: [activeResume(s), ...s.future],
        lastEdit: { at: 0, key: "" },
        revision: s.revision + 1,
      };
    }
    case "redo": {
      if (!s.future.length) return s;
      const [next, ...rest] = s.future;
      return {
        ...s,
        ws: withResume(s, next),
        past: [...s.past, activeResume(s)],
        future: rest,
        lastEdit: { at: 0, key: "" },
        revision: s.revision + 1,
      };
    }
    case "setActive": {
      if (a.id === s.activeId) return s;
      const v = s.ws.versions.find((x) => x.id === a.id);
      return {
        ...s,
        activeId: v ? a.id : MASTER,
        jobDraft: v ? v.job_description : s.jobDraft,
        past: [],
        future: [],
      };
    }
    case "addVersion":
      return {
        ...s,
        ws: { ...s.ws, versions: [a.version, ...s.ws.versions.filter((v) => v.id !== a.version.id)] },
        activeId: a.version.id,
        past: [],
        future: [],
        revision: s.revision + 1,
      };
    case "updateVersion":
      return {
        ...s,
        ws: { ...s.ws, versions: s.ws.versions.map((v) => (v.id === a.id ? { ...v, ...a.patch } : v)) },
        revision: s.revision + 1,
      };
    case "deleteVersion":
      return {
        ...s,
        ws: { ...s.ws, versions: s.ws.versions.filter((v) => v.id !== a.id) },
        activeId: s.activeId === a.id ? MASTER : s.activeId,
        past: s.activeId === a.id ? [] : s.past,
        future: s.activeId === a.id ? [] : s.future,
        revision: s.revision + 1,
      };
    case "setMaster":
      return {
        ...s,
        ws: { ...s.ws, master: a.resume },
        past: s.activeId === MASTER ? [...s.past, s.ws.master] : s.past,
        future: s.activeId === MASTER ? [] : s.future,
        revision: s.revision + 1,
      };
    case "setJob":
      return { ...s, jobDraft: a.text };
    case "setOptions":
      return { ...s, options: { ...s.options, ...a.patch } };
  }
}

export function initialState(ws?: Workspace | null): State {
  return {
    ws: ws ?? { master: emptyResume(), versions: [] },
    activeId: MASTER,
    jobDraft: "",
    options: DEFAULT_OPTIONS,
    past: [],
    future: [],
    lastEdit: { at: 0, key: "" },
    revision: 0,
  };
}

interface Store {
  state: State;
  dispatch: React.Dispatch<Action>;
  resume: Resume;
  version: Version | undefined;
  edit: (resume: Resume, coalesceKey?: string) => void;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ initial, children }: { initial: State; children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const edit = useCallback((resume: Resume, coalesceKey?: string) => dispatch({ type: "edit", resume, coalesceKey }), []);
  const value = useMemo(
    () => ({ state, dispatch, resume: activeResume(state), version: activeVersion(state), edit }),
    [state, edit],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside StoreProvider");
  return s;
}

export { reducer as _reducerForTests };

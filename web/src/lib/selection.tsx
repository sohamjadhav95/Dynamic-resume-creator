// What the person is working on: the field open in the page editor, and the bullet the
// "Improve a bullet" card rewrites.

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export interface Selected {
  path: string; // e.g. "experience.0.bullets.2"
  context: string; // e.g. "Software Engineer at Northwind"
}

interface SelectionState {
  selected: Selected | null;
  setSelected: (s: Selected | null) => void;
  editing: string | null; // path of the field open in the page editor
  setEditing: (path: string | null) => void;
}

const Ctx = createContext<SelectionState>({
  selected: null,
  setSelected: () => {},
  editing: null,
  setEditing: () => {},
});

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<Selected | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const value = useMemo(() => ({ selected, setSelected, editing, setEditing }), [selected, editing]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useSelection = () => useContext(Ctx);

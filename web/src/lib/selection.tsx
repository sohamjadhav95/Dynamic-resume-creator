// Which bullet the person is working on (drives the "Rewrite" card).

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export interface Selected {
  path: string; // e.g. "experience.0.bullets.2"
  context: string; // e.g. "Software Engineer at Northwind"
}

const Ctx = createContext<{ selected: Selected | null; setSelected: (s: Selected | null) => void }>({
  selected: null,
  setSelected: () => {},
});

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<Selected | null>(null);
  const value = useMemo(() => ({ selected, setSelected }), [selected]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useSelection = () => useContext(Ctx);

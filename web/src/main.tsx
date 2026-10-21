import "@fontsource-variable/inter";
import "@fontsource-variable/fraunces";
import "./styles/tokens.css";
import "./styles/app.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ToastProvider } from "./components/ui";
import { applyTheme, loadPrefs } from "./lib/prefs";
import { SelectionProvider } from "./lib/selection";
import { loadLocal } from "./lib/storage";
import { initialState, StoreProvider } from "./lib/store";

applyTheme(loadPrefs().theme);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <StoreProvider initial={initialState(loadLocal())}>
        <SelectionProvider>
          <App />
        </SelectionProvider>
      </StoreProvider>
    </ToastProvider>
  </StrictMode>,
);

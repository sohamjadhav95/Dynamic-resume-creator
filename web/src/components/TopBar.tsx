import type { Session } from "@supabase/supabase-js";
import { MASTER, useStore } from "../lib/store";
import type { Theme } from "../lib/prefs";
import { BrandMark, Icon } from "./Icon";
import { Menu } from "./ui";

export type SaveState = "idle" | "saving" | "saved-local" | "saved-cloud" | "error" | "offline";

const SAVE_LABEL: Record<SaveState, string> = {
  idle: "",
  saving: "Saving…",
  "saved-local": "Saved in this browser",
  "saved-cloud": "Saved to your account",
  error: "Couldn't save — retrying",
  offline: "Offline — saved in this browser",
};

export function versionTitle(v: { job_title: string; company: string }): string {
  return [v.job_title, v.company].filter(Boolean).join(" · ") || "Untitled job";
}

export function TopBar({
  session,
  accountsEnabled,
  saveState,
  theme,
  onTheme,
  onSignIn,
  onSignOut,
  onVersions,
  onSettings,
  onImport,
}: {
  session: Session | null;
  accountsEnabled: boolean;
  saveState: SaveState;
  theme: Theme;
  onTheme: (t: Theme) => void;
  onSignIn: () => void;
  onSignOut: () => void;
  onVersions: () => void;
  onSettings: () => void;
  onImport: () => void;
}) {
  const { state, dispatch, version } = useStore();
  const nextTheme: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
  const themeIcon = theme === "system" ? "monitor" : theme === "light" ? "sun" : "moon";
  const current = version ? versionTitle(version) : "Master profile";

  return (
    <header className="topbar">
      <a className="skip-link" href="#main">
        Skip to resume
      </a>
      <span className="brand">
        <BrandMark /> <span>Tailor</span>
      </span>
      <span className="divider hide-sm" />

      <Menu
        label="Switch resume"
        button={(p) => (
          <button className="doc-switch-btn" {...p} aria-label={`Current resume: ${current}. Switch resume`}>
            <Icon name={version ? "target" : "user"} size={16} />
            <span className="title">{current}</span>
            <Icon name="chevron" size={14} />
          </button>
        )}
      >
        {(close) => (
          <>
            <button
              role="menuitem"
              className="menu-item"
              aria-current={state.activeId === MASTER}
              onClick={() => {
                dispatch({ type: "setActive", id: MASTER });
                close();
              }}
            >
              <Icon name="user" size={16} />
              <span className="grow">
                Master profile
                <div className="meta">Everything you've done. Tailoring starts here.</div>
              </span>
            </button>
            {state.ws.versions.length > 0 && <div className="menu-label">Tailored versions</div>}
            {state.ws.versions.slice(0, 8).map((v) => (
              <button
                role="menuitem"
                key={v.id}
                className="menu-item"
                aria-current={state.activeId === v.id}
                onClick={() => {
                  dispatch({ type: "setActive", id: v.id });
                  close();
                }}
              >
                <Icon name="target" size={16} />
                <span className="grow">
                  {versionTitle(v)}
                  <div className="meta">
                    {v.match_score != null ? `${v.match_score}% match · ` : ""}
                    {new Date(v.updated_at).toLocaleDateString()}
                  </div>
                </span>
              </button>
            ))}
            <hr />
            <button
              role="menuitem"
              className="menu-item"
              onClick={() => {
                onVersions();
                close();
              }}
            >
              <Icon name="history" size={16} /> All versions…
            </button>
            <button
              role="menuitem"
              className="menu-item"
              onClick={() => {
                onImport();
                close();
              }}
            >
              <Icon name="upload" size={16} /> Import a resume…
            </button>
          </>
        )}
      </Menu>

      <div className="row hide-sm" style={{ gap: 2 }}>
        <button
          className="icon-btn"
          aria-label="Undo"
          title="Undo (Ctrl+Z)"
          disabled={!state.past.length}
          onClick={() => dispatch({ type: "undo" })}
        >
          <Icon name="undo" />
        </button>
        <button
          className="icon-btn"
          aria-label="Redo"
          title="Redo (Ctrl+Shift+Z)"
          disabled={!state.future.length}
          onClick={() => dispatch({ type: "redo" })}
        >
          <Icon name="redo" />
        </button>
      </div>

      <span className="grow" />
      <span className="save-state hide-sm" aria-live="polite">
        {saveState === "saving" ? null : saveState === "saved-cloud" || saveState === "saved-local" ? <Icon name="check" size={14} /> : null}
        {SAVE_LABEL[saveState]}
      </span>

      <button
        className="icon-btn"
        aria-label={`Theme: ${theme}. Switch to ${nextTheme[theme]}`}
        title={`Theme: ${theme}`}
        onClick={() => onTheme(nextTheme[theme])}
      >
        <Icon name={themeIcon} />
      </button>

      {session ? (
        <Menu
          label="Account"
          align="right"
          button={(p) => (
            <button className="icon-btn" {...p} aria-label="Account menu" style={{ background: "var(--ink)", color: "var(--paper)", borderRadius: "50%" }}>
              <strong style={{ fontSize: 14 }}>{(session.user.email ?? "?").slice(0, 1).toUpperCase()}</strong>
            </button>
          )}
        >
          {(close) => (
            <>
              <div className="menu-label" style={{ textTransform: "none", letterSpacing: 0 }}>
                {session.user.email}
              </div>
              <button role="menuitem" className="menu-item" onClick={() => (onVersions(), close())}>
                <Icon name="history" size={16} /> Your versions
              </button>
              <button role="menuitem" className="menu-item" onClick={() => (onSettings(), close())}>
                <Icon name="settings" size={16} /> Settings
              </button>
              <hr />
              <button role="menuitem" className="menu-item" onClick={() => (onSignOut(), close())}>
                <Icon name="logout" size={16} /> Sign out
              </button>
            </>
          )}
        </Menu>
      ) : (
        <>
          <button className="icon-btn" aria-label="Settings" title="Settings" onClick={onSettings}>
            <Icon name="settings" />
          </button>
          {accountsEnabled && (
            <button className="btn btn-sm btn-ink" onClick={onSignIn}>
              Sign in
            </button>
          )}
        </>
      )}
    </header>
  );
}

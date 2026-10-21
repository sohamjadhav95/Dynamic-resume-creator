import type { Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { Canvas } from "./components/Canvas";
import { AuthDialog, SettingsDialog, VersionsDialog } from "./components/Dialogs";
import { Icon } from "./components/Icon";
import { ImportDialog } from "./components/ImportDialog";
import { LeftPanel } from "./components/LeftPanel";
import { RightPanel, type TailorProgress } from "./components/RightPanel";
import { TopBar, versionTitle, type SaveState } from "./components/TopBar";
import { useLayoutMode, useToast } from "./components/ui";
import { Welcome } from "./components/Welcome";
import sample from "./data/sample-resume.json";
import { SAMPLE_JOB } from "./data/sample-job";
import { ApiError, getConfig, rewriteBullet, streamAi, warmUp, type StreamEvent } from "./lib/api";
import { guessJob } from "./lib/keywords";
import { computeMatch } from "./lib/match";
import { applyTheme, loadPrefs, savePrefs, type Theme } from "./lib/prefs";
import { emptyResume, isEmptyResume, normalizeResume, uuid, visibleResume, type Resume } from "./lib/schema";
import {
  clearLocal,
  deleteAllCloud,
  deleteCloudVersion,
  loadCloud,
  loadLocal,
  saveCloudMaster,
  saveCloudVersion,
  saveLocal,
  userCacheKey,
  type Version,
  type Workspace,
} from "./lib/storage";
import { MASTER, useStore } from "./lib/store";
import { signOut, watchSession } from "./lib/supabase";
import { applyAiResult, offlineTailor, retryRefused, type Insights } from "./lib/tailor";

type Dialog = null | "auth" | "versions" | "settings" | "import-upload" | "import-paste";
type Mode = { kind: "guest" } | { kind: "cloud"; userId: string } | { kind: "cloud-offline"; userId: string };

const ENGINE_NAME: Record<string, string> = { gemini: "Gemini", groq: "Groq", offline: "the quick engine" };

/** Only what the AI needs: no name, email, phone or layout leaves the browser. */
function aiPayload(master: Resume) {
  const v = visibleResume(master);
  return {
    basics: { headline: v.basics.headline },
    summary: v.summary,
    skills: v.skills,
    experience: v.experience,
    projects: v.projects,
    education: v.education,
    certifications: v.certifications,
    custom_sections: v.custom_sections,
  };
}

export function App() {
  const { state, dispatch, version, edit } = useStore();
  const toast = useToast();
  const layout = useLayoutMode();

  const [theme, setTheme] = useState<Theme>(() => loadPrefs().theme);
  const [accountsEnabled, setAccountsEnabled] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: "guest" });
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [started, setStarted] = useState(false);
  const [progress, setProgress] = useState<TailorProgress | null>(null);
  const [sideTab, setSideTab] = useState<"build" | "insights">("build");
  const [mobileTab, setMobileTab] = useState<"build" | "page" | "insights">("page");
  const [retryTick, setRetryTick] = useState(0);

  const lastSaved = useRef<Workspace | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const quickRef = useRef(false);
  const userIdRef = useRef<string | null>(null);

  // ---------------------------------------------------------------- boot
  useEffect(() => applyTheme(theme), [theme]);
  useEffect(() => {
    warmUp();
    getConfig().then((c) => setAccountsEnabled(!!c.supabase));
  }, []);

  // ---------------------------------------------------------------- accounts
  useEffect(() => {
    let unsub = () => {};
    watchSession(async (s) => {
      setSession(s);
      const uid = s?.user.id ?? null;
      if (uid === userIdRef.current) return;
      const wasSignedIn = userIdRef.current !== null;
      userIdRef.current = uid;

      if (!uid) {
        if (wasSignedIn) {
          lastSaved.current = null;
          setMode({ kind: "guest" });
          dispatch({ type: "load", ws: loadLocal() ?? { master: emptyResume(), versions: [] } });
        }
        return;
      }
      try {
        const cloud = await loadCloud(uid);
        if (cloud) {
          lastSaved.current = cloud;
          setMode({ kind: "cloud", userId: uid });
          dispatch({ type: "load", ws: cloud });
        } else {
          // First sign-in: move this browser's resume into the account.
          const local = loadLocal() ?? { master: emptyResume(), versions: [] };
          lastSaved.current = null;
          setMode({ kind: "cloud", userId: uid });
          dispatch({ type: "load", ws: local });
          if (!isEmptyResume(local.master)) toast({ message: "Your resume is now saved to your account." });
        }
      } catch {
        const cached = loadLocal(userCacheKey(uid));
        setMode({ kind: "cloud-offline", userId: uid });
        if (cached) dispatch({ type: "load", ws: cached });
        setSaveState("offline");
        toast({ message: "Couldn't reach your account. You can keep working; changes are saved in this browser.", kind: "error" });
      }
    }).then((u) => (unsub = u));
    return () => unsub();
  }, [dispatch, toast]);

  // ---------------------------------------------------------------- autosave
  useEffect(() => {
    if (state.revision === 0) return;
    setSaveState("saving");
    const ws = state.ws;
    const t = window.setTimeout(async () => {
      if (mode.kind === "guest") {
        setSaveState(saveLocal(ws) ? "saved-local" : "error");
        return;
      }
      saveLocal(ws, userCacheKey(mode.userId));
      if (mode.kind === "cloud-offline") {
        setSaveState("offline");
        return;
      }
      try {
        const prev = lastSaved.current;
        if (!prev || prev.master !== ws.master) await saveCloudMaster(mode.userId, ws.master);
        const prevById = new Map(prev?.versions.map((v) => [v.id, v]) ?? []);
        for (const v of ws.versions) if (prevById.get(v.id) !== v) await saveCloudVersion(mode.userId, v);
        for (const v of prev?.versions ?? []) if (!ws.versions.some((x) => x.id === v.id)) await deleteCloudVersion(v.id);
        lastSaved.current = ws;
        setSaveState("saved-cloud");
      } catch {
        setSaveState("error");
        window.setTimeout(() => setRetryTick((n) => n + 1), 5000);
      }
    }, 700);
    return () => window.clearTimeout(t);
  }, [state.revision, state.ws, mode, retryTick]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (saveState === "saving" || saveState === "error") e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveState]);

  // ---------------------------------------------------------------- tailoring
  const tailor = useCallback(async () => {
    const jd = state.jobDraft.trim();
    const master = state.ws.master;
    if (jd.length < 30) {
      toast({ message: "Paste the job description first — a few sentences at least." });
      if (layout === "narrow") setMobileTab("build");
      window.setTimeout(() => document.getElementById("jd")?.focus(), 50);
      return;
    }
    if (isEmptyResume(master)) {
      toast({ message: "Your master profile is empty. Add your experience first, or import your resume." });
      return;
    }
    if (progress) return;
    const opts = state.options;
    setProgress({ startedAt: Date.now(), stage: "sending", provider: "", thought: "", chars: 0 });
    if (layout === "narrow") setMobileTab("insights");
    if (layout === "medium") setSideTab("insights");
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    quickRef.current = false;

    const onEvent = (e: StreamEvent) => {
      setProgress((p) => {
        if (!p) return p;
        if (e.type === "stage")
          return { ...p, stage: p.provider && p.provider !== e.data.label ? "switching" : "writing", provider: e.data.label, chars: 0 };
        if (e.type === "thought") {
          const sentence = e.data.text.replace(/\*\*/g, "").split(/\n+/).filter(Boolean).pop() ?? "";
          return { ...p, stage: "writing", thought: sentence.slice(0, 160) };
        }
        if (e.type === "progress") return { ...p, stage: "writing", chars: e.data.chars };
        return p;
      });
    };

    let outcome: { resume: Resume; insights: Insights };
    let note = "";
    const quick = () => offlineTailor(master, jd, opts);
    try {
      const final = await streamAi("/api/tailor", { resume: aiPayload(master), job_description: jd, options: opts }, onEvent, ctrl.signal);
      if (final.type === "result") {
        setProgress((p) => p && { ...p, stage: "finishing" });
        outcome = applyAiResult(master, final.data.data, final.data.engine, final.data.model, jd);
        outcome = await retryRefused(outcome, master, jd, rewriteBullet);
      } else {
        outcome = quick();
        note =
          final.type === "limit"
            ? `${final.data.message} We made a quick version for now.`
            : "AI is unavailable right now, so we made a quick version (your content reordered for this job). Try “Tailor again” later for full rewriting.";
      }
    } catch (err) {
      if (ctrl.signal.aborted && !quickRef.current) {
        setProgress(null);
        return; // cancelled
      }
      if (err instanceof ApiError) {
        toast({ message: err.message, kind: "error" });
        setProgress(null);
        return;
      }
      outcome = quick();
      note = quickRef.current ? "Quick version ready. You can tailor again with AI any time." : "Something went wrong with AI, so we made a quick version.";
    }

    try {
      saveVersion(outcome, jd, note);
    } catch {
      toast({ message: "Something went wrong while saving this version. Please try again.", kind: "error" });
    } finally {
      setProgress(null);
    }
  }, [state.jobDraft, state.ws.master, state.options, version, progress, layout, toast, edit, dispatch]);

  const saveVersion = (outcome: { resume: Resume; insights: Insights }, jd: string, note: string) => {
    const match = computeMatch(outcome.resume, jd, outcome.insights.keywords);
    const job = outcome.insights.job.title || outcome.insights.job.company ? outcome.insights.job : guessJob(jd);
    const now = new Date().toISOString();
    const meta = {
      job_title: job.title,
      company: job.company,
      insights: outcome.insights,
      match_score: match?.score ?? null,
      engine: outcome.insights.engine,
    };
    if (version && version.job_description.trim() === jd) {
      edit(outcome.resume);
      dispatch({ type: "updateVersion", id: version.id, patch: { ...meta, updated_at: now } });
    } else {
      const v: Version = { id: uuid(), job_description: jd, data: outcome.resume, created_at: now, updated_at: now, ...meta };
      dispatch({ type: "addVersion", version: v });
    }
    if (layout === "narrow") setMobileTab("page");
    toast({
      message: note || `Done with ${ENGINE_NAME[outcome.insights.engine]}${match ? ` · ${match.score}% match` : ""}. Click any text to edit it.`,
    });
  };

  const quickNow = () => {
    quickRef.current = true;
    abortRef.current?.abort();
  };
  const cancelTailor = () => {
    quickRef.current = false;
    abortRef.current?.abort();
  };

  // ---------------------------------------------------------------- PDF
  // The PDF is generated from the page engine (no browser print dialog), see Canvas.
  const print = useCallback(() => {
    if (layout === "narrow") setMobileTab("page");
    window.dispatchEvent(new Event("tailor:download-pdf"));
  }, [layout]);

  // ---------------------------------------------------------------- columns (resizable, collapsible)
  const [cols, setCols] = useState(() => {
    const p = loadPrefs();
    return { leftW: p.leftW, rightW: p.rightW, leftClosed: p.leftClosed, rightClosed: p.rightClosed };
  });
  const updateCols = useCallback((patch: Partial<typeof cols>, save = true) => {
    setCols((c) => {
      const next = { ...c, ...patch };
      if (save) savePrefs(next);
      return next;
    });
  }, []);
  const startResize = (side: "left" | "right") => (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = side === "left" ? cols.leftW : cols.rightW;
    let last = startW;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      last = Math.round(Math.max(260, Math.min(620, side === "left" ? startW + dx : startW - dx)));
      updateCols(side === "left" ? { leftW: last } : { rightW: last }, false);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("resizing");
      updateCols(side === "left" ? { leftW: last } : { rightW: last });
    };
    document.body.classList.add("resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  // "AI rewrite" on a bullet opens the Match & AI column wherever it lives.
  useEffect(() => {
    const open = () => {
      if (layout === "wide") updateCols({ rightClosed: false });
      else if (layout === "medium") {
        updateCols({ leftClosed: false });
        setSideTab("insights");
      } else setMobileTab("insights");
    };
    window.addEventListener("tailor:open-panel", open);
    return () => window.removeEventListener("tailor:open-panel", open);
  }, [layout, updateCols]);

  // ---------------------------------------------------------------- shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const target = e.target as HTMLElement;
      const typing = target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
      const k = e.key.toLowerCase();
      if (k === "p") {
        e.preventDefault();
        print();
      } else if (k === "enter") {
        e.preventDefault();
        tailor();
      } else if (!typing && k === "z") {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? "redo" : "undo" });
      } else if (!typing && k === "y") {
        e.preventDefault();
        dispatch({ type: "redo" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [print, tailor, dispatch]);

  // ---------------------------------------------------------------- onboarding actions
  const loadMaster = (r: Resume, message: string) => {
    dispatch({ type: "load", ws: { master: r, versions: state.ws.versions } });
    setStarted(true);
    setDialog(null);
    toast({ message });
  };

  const deleteVersion = (id: string) => dispatch({ type: "deleteVersion", id });

  const deleteAll = async () => {
    const empty = { master: emptyResume(), versions: [] };
    if (mode.kind !== "guest") {
      try {
        await deleteAllCloud(mode.userId);
      } catch {
        toast({ message: "Couldn't delete from your account. Try again.", kind: "error" });
        return;
      }
      clearLocal(userCacheKey(mode.userId));
      lastSaved.current = empty;
    } else clearLocal();
    dispatch({ type: "load", ws: empty });
    setStarted(false);
    setDialog(null);
  };

  const onTheme = (t: Theme) => {
    setTheme(t);
    savePrefs({ theme: t });
  };

  const dialogs = (
    <>
      {dialog === "auth" && <AuthDialog onClose={() => setDialog(null)} />}
      {dialog === "versions" && <VersionsDialog onClose={() => setDialog(null)} onDelete={deleteVersion} />}
      {dialog === "settings" && (
        <SettingsDialog
          theme={theme}
          onTheme={onTheme}
          onClose={() => setDialog(null)}
          onImport={() => setDialog("import-upload")}
          onDeleteAll={deleteAll}
          signedIn={mode.kind !== "guest"}
        />
      )}
      {(dialog === "import-upload" || dialog === "import-paste") && (
        <ImportDialog
          initialTab={dialog === "import-paste" ? "paste" : "upload"}
          onClose={() => setDialog(null)}
          onDone={(r) => {
            if (!isEmptyResume(state.ws.master) && !confirm("Replace your current master profile with the imported resume?")) return;
            dispatch({ type: "setActive", id: MASTER });
            loadMaster(r, "Imported. Check each section, then paste a job to tailor it.");
          }}
        />
      )}
    </>
  );

  // ---------------------------------------------------------------- render
  const showWelcome = !started && isEmptyResume(state.ws.master) && state.ws.versions.length === 0 && !progress;
  if (showWelcome) {
    return (
      <>
        <Welcome
          canSignIn={accountsEnabled}
          onSignIn={() => setDialog("auth")}
          onUpload={() => setDialog("import-upload")}
          onPaste={() => setDialog("import-paste")}
          onSample={() => {
            loadMaster(normalizeResume(sample), "This is a sample resume. A sample job post is ready too: press “Tailor my resume”.");
            dispatch({ type: "setJob", text: SAMPLE_JOB });
            setMobileTab("build");
          }}
          onBlank={() => {
            loadMaster(emptyResume(), "Click any grey text on the page to start writing.");
          }}
        />
        {dialogs}
      </>
    );
  }

  const title = version ? `Tailored for ${versionTitle(version)}` : "Master profile";
  const insightsPanel = <RightPanel progress={progress} onQuick={quickNow} onCancel={cancelTailor} />;

  return (
    <div className="app">
      <TopBar
        session={session}
        accountsEnabled={accountsEnabled}
        saveState={saveState}
        theme={theme}
        onTheme={onTheme}
        onSignIn={() => setDialog("auth")}
        onSignOut={async () => {
          if (mode.kind !== "guest") clearLocal(userCacheKey(mode.userId));
          await signOut();
        }}
        onVersions={() => setDialog("versions")}
        onSettings={() => setDialog("settings")}
        onImport={() => setDialog("import-upload")}
      />
      <div
        className="studio"
        data-side={sideTab}
        data-mobile={mobileTab}
        style={
          layout === "wide"
            ? {
                gridTemplateColumns: `${cols.leftClosed ? 44 : cols.leftW}px minmax(0, 1fr) ${cols.rightClosed ? 44 : cols.rightW}px`,
              }
            : layout === "medium"
              ? { gridTemplateColumns: `${cols.leftClosed ? 44 : cols.leftW}px minmax(0, 1fr)` }
              : undefined
        }
      >
        {layout !== "narrow" && cols.leftClosed ? (
          <aside className="side left rail" aria-label="Build your resume (collapsed)">
            <button className="rail-btn" onClick={() => updateCols({ leftClosed: false })} title="Show the Build panel">
              <Icon name="chevronRight" size={16} />
              <span>{layout === "medium" ? "Build · Match & AI" : "Build"}</span>
            </button>
          </aside>
        ) : (
        <aside className="side left" aria-label="Build your resume">
          {layout !== "narrow" && (
            <div className="col-head">
              <span className="grow">{layout === "medium" ? "Build · Match & AI" : "Build"}</span>
              <button className="icon-btn sm" onClick={() => updateCols({ leftClosed: true })} title="Collapse this panel" aria-label="Collapse the Build panel">
                <Icon name="chevron" size={14} className="rot90" />
              </button>
            </div>
          )}
          {layout === "medium" && (
            <div className="side-tabs">
              <div className="segmented" role="tablist" aria-label="Panel" style={{ width: "100%" }}>
                <button role="tab" aria-selected={sideTab === "build"} style={{ flex: 1 }} onClick={() => setSideTab("build")}>
                  Build
                </button>
                <button role="tab" aria-selected={sideTab === "insights"} style={{ flex: 1 }} onClick={() => setSideTab("insights")}>
                  Match & AI {progress ? "•" : ""}
                </button>
              </div>
            </div>
          )}
          <div className="build">
            {version && (
              <div className="panel-section" style={{ paddingBottom: 14 }}>
                <div className="rewrite-source" style={{ borderLeftColor: "var(--moss)" }}>
                  You're editing the version for <strong>{versionTitle(version)}</strong>. Changes here don't touch your master
                  profile.{" "}
                  <button className="btn btn-ghost btn-sm" style={{ padding: "0 4px", minHeight: 0, textDecoration: "underline" }} onClick={() => dispatch({ type: "setActive", id: MASTER })}>
                    Edit master instead
                  </button>
                </div>
              </div>
            )}
            <LeftPanel onTailor={tailor} busy={!!progress} />
          </div>
          {layout !== "wide" && <div className="insights">{insightsPanel}</div>}
        </aside>
        )}
        <Canvas title={title} />
        {layout === "wide" &&
          (cols.rightClosed ? (
            <aside className="side right rail" aria-label="Match and AI tools (collapsed)">
              <button className="rail-btn" onClick={() => updateCols({ rightClosed: false })} title="Show the Match & AI panel">
                <Icon name="chevron" size={16} className="rot90" />
                <span>Match & AI {progress ? "•" : ""}</span>
              </button>
            </aside>
          ) : (
            <aside className="side right" aria-label="Match and AI tools">
              <div className="col-head">
                <button className="icon-btn sm" onClick={() => updateCols({ rightClosed: true })} title="Collapse this panel" aria-label="Collapse the Match and AI panel">
                  <Icon name="chevronRight" size={14} />
                </button>
                <span className="grow">Match & AI</span>
              </div>
              {insightsPanel}
            </aside>
          ))}
        {layout !== "narrow" && !cols.leftClosed && (
          <div
            className="col-resizer"
            style={{ left: cols.leftW - 3 }}
            onPointerDown={startResize("left")}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the Build panel"
            title="Drag to resize"
          />
        )}
        {layout === "wide" && !cols.rightClosed && (
          <div
            className="col-resizer"
            style={{ right: cols.rightW - 3 }}
            onPointerDown={startResize("right")}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the Match and AI panel"
            title="Drag to resize"
          />
        )}
      </div>
      <nav className="mobile-tabs" role="tablist" aria-label="Sections">
        {(
          [
            ["build", "Build", "pen"],
            ["page", "Page", "page"],
            ["insights", "Match", "target"],
          ] as const
        ).map(([key, label, icon]) => (
          <button key={key} role="tab" aria-selected={mobileTab === key} onClick={() => setMobileTab(key)}>
            <Icon name={icon} size={20} />
            {label}
          </button>
        ))}
      </nav>
      {dialogs}
    </div>
  );
}

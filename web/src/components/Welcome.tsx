// First visit: get someone to a tailored resume in under a minute.

import { BrandMark, Icon } from "./Icon";

export function Welcome({
  onUpload,
  onPaste,
  onSample,
  onBlank,
  onSignIn,
  canSignIn,
}: {
  onUpload: () => void;
  onPaste: () => void;
  onSample: () => void;
  onBlank: () => void;
  onSignIn: () => void;
  canSignIn: boolean;
}) {
  return (
    <div className="welcome">
      <div className="welcome-inner">
        <header className="welcome-top">
          <span className="brand">
            <BrandMark /> <span>Tailor</span>
          </span>
          {canSignIn && (
            <button className="btn btn-ghost" onClick={onSignIn}>
              Sign in
            </button>
          )}
        </header>
        <main className="welcome-hero" id="main">
          <div>
            <h1>
              One resume.
              <br />
              <em>Tailored</em> to every job.
            </h1>
            <p className="lede">
              Paste a job post and get a version of your resume that speaks its language: honest rewrites, a live match score,
              and a clean one-page PDF that applicant tracking systems can read.
            </p>
            <div className="start-grid">
              <button className="start-card primary" onClick={onUpload}>
                <span className="ico">
                  <Icon name="upload" />
                </span>
                <strong>Upload my resume</strong>
                <span>PDF or Word. We turn it into editable sections.</span>
              </button>
              <button className="start-card" onClick={onPaste}>
                <span className="ico">
                  <Icon name="paste" />
                </span>
                <strong>Paste text</strong>
                <span>Copy from anywhere, e.g. LinkedIn.</span>
              </button>
              <button className="start-card" onClick={onSample}>
                <span className="ico">
                  <Icon name="sparkle" />
                </span>
                <strong>Try with a sample</strong>
                <span>See how it works in 30 seconds.</span>
              </button>
              <button className="start-card" onClick={onBlank}>
                <span className="ico">
                  <Icon name="pen" />
                </span>
                <strong>Start from scratch</strong>
                <span>Write it right on the page.</span>
              </button>
            </div>
            <div className="trust-row">
              <span>
                <Icon name="shield" size={16} /> Never invents experience
              </span>
              <span>
                <Icon name="bolt" size={16} /> Works even when AI is down
              </span>
              <span>
                <Icon name="lock" size={16} /> No account needed
              </span>
            </div>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="hero-sheet" style={{ left: 10, top: 30, transform: "rotate(-4deg)", opacity: 0.55 }}>
              <div className="t" />
              <div className="l" style={{ width: "80%" }} />
              <div className="sec" />
              <div className="l" />
              <div className="l" style={{ width: "90%" }} />
              <div className="l" style={{ width: "70%" }} />
              <div className="sec" />
              <div className="l" />
              <div className="l" style={{ width: "85%" }} />
            </div>
            <div className="hero-sheet" style={{ left: 90, top: 0 }}>
              <div className="t" />
              <div className="l" style={{ width: "70%" }} />
              <div className="sec" />
              <div className="l" />
              <div>
                <span className="k" style={{ width: 54 }} /> <span className="k" style={{ width: 40 }} />{" "}
                <span className="k" style={{ width: 62, background: "#d6ead9" }} />
              </div>
              <div className="sec" />
              <div className="l" style={{ width: "95%" }} />
              <div className="l" style={{ width: "88%" }} />
              <div className="l" style={{ width: "92%" }} />
              <div className="sec" />
              <div className="l" style={{ width: "80%" }} />
              <div className="l" style={{ width: "60%" }} />
              <div className="l" style={{ width: "75%" }} />
            </div>
            <div className="hero-score">
              <svg width="54" height="54" viewBox="0 0 54 54">
                <circle cx="27" cy="27" r="22" fill="none" stroke="var(--surface-sunk)" strokeWidth="6" />
                <circle cx="27" cy="27" r="22" fill="none" stroke="var(--moss)" strokeWidth="6" strokeLinecap="round" strokeDasharray="138" strokeDashoffset="20" transform="rotate(-90 27 27)" />
              </svg>
              <div>
                <strong style={{ fontFamily: "var(--font-display)", fontSize: 22 }}>86%</strong>
                <div className="hint">match · up from 58%</div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

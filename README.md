# Tailor — one resume, tailored to every job

Paste a job post and get a version of your resume that speaks its language: same design, same size, one page,
honest rewrites, and a live match score. Works like the original app: your resume is one JSON master, the page is a
template you edit by clicking any text, and **PDF** saves exactly what you see.

![Studio](docs/screenshots/studio.png)

## How tailoring works

1. **Master resume.** Import your resume (PDF, Word, text, or a JSON file such as the old `master_resume.json`). It
   becomes your master profile; tailoring never changes it, every job gets its own version.
2. **Rewrite.** The AI rewrites the summary and every bullet so the part each job or project shares with the job post
   comes first, in plain words. Same number of bullets, about the same length, so the page keeps its size.
3. **Skills (ATS keywords).** Like the original app, the job's important tools are added to the skills lines and the
   least relevant ones removed; categories may be renamed for the role. Added skills are listed under **Tips** so you
   can remove any you haven't used.
4. **Checks, in code.** Every rewrite must keep all numbers, add no new ones, stay about the same length, and not name
   tools or terms your resume doesn't show (bullets: only from that same job or project). A refused line gets one
   more AI try with the reason; otherwise the original stays. Refused lines are listed under Tips.
5. **Edit and export.** Click any text on the page to change it; click a missing keyword to swap it into your skills.
   **PDF** downloads exactly the page you see.

## The page engine (why the format never breaks)

The page is **not** HTML printed by the browser (that changes with the browser, print settings, installed fonts and
headers/footers, which is what used to push resumes to two pages). Instead `web/src/lib/page/`:

1. **measures** every word with the exact metrics of the PDF Helvetica family (the same widths as Arial), with no
   kerning, so measured width = drawn width;
2. **lays out** the resume itself: justified bullets with a hanging indent, bold "Category:" labels, dates on the
   right, a rule under each section title, and records which field every word belongs to;
3. **keeps it on one page**: if content is too long it tightens spacing step by step, then text size (to 92% at most),
   and only then flows onto a second page (the meter says by how many lines);
4. draws that one layout twice: as SVG on screen (click any word to edit its field) and as a real PDF with `pdf-lib`
   (selectable text in reading order, readable by applicant tracking systems).

The default **Original** style reproduces the owner's PDF (measured from the file: A4, 15 mm sides, 17 pt name,
7.6 pt contact line, 9 pt headings with a rule, 8.5 pt justified body). Classic, Modern and Compact are variations.

## What it does

- **Studio layout**: build on the left, the real page in the middle, match score and AI tools on the right.
  On tablets the right panel becomes a tab; on phones there is a bottom tab bar.
- **Master profile + versions**: you keep one master profile with everything you've done. Each job gets its own
  tailored version; the master is never changed by tailoring.
- **Honest by design**: the AI may rephrase and reorder, but never invent jobs, dates, numbers or projects. Numbers
  are checked by code, not just requested in the prompt.
  A **truth check** removes any skill the AI adds that your master profile doesn't mention.
  The old "invent a project for this job" slot is now **Project ideas**: suggestions you could build, shown on the side.
- **Instant match score** (runs in the browser, no AI needed): required vs nice-to-have keywords, found and missing,
  and the job post with highlights. Click a missing skill to add it, but only if you really have it.
- **Click-to-edit page**: click any text to open a small editor right there (the page updates as you type), with
  undo/redo, move / add / delete bullets and AI rewrite of any bullet (stronger, shorter, add a keyword, fix grammar).
- **Exact page meter** ("1 page" / "over by 3 lines") from the page engine, automatic fit to one page, 4 styles,
  A4/Letter, spacing and heading color.
- **Resizable, collapsible panels**: drag the edge of the side columns, or collapse them to a slim rail.
- **Import** a PDF, Word file, pasted text or JSON; AI splits it into sections (with a non-AI parser as backup).
- **Accounts are optional**: guests save in the browser; signing in (Google or email link) saves to the cloud.
  The first sign-in moves the guest resume into the account.
- **Accessible**: keyboard everywhere, visible focus, screen-reader labels, WCAG AA contrast, reduced motion, dark mode.

## Which AI models, and why (all free tiers)

```
Groq · qwen3.8-27b  ─▶  Gemini · 3.1-flash-lite  ─▶  Gemini · 3.5-flash-lite  ─▶  Groq · gpt-oss-20b  ─▶  Offline engine
```

The order was picked with `scripts/benchmark_models.py`, which sends every candidate model the real tailoring
task for your resume and grades the answers with the app's own checks (fits the lines, keeps numbers, no invented
skills), speed and rate limits:

```bash
python scripts/benchmark_models.py --file my_resume.pdf            # all candidates, in parallel
python scripts/benchmark_models.py --file my_resume.pdf --only groq --runs 2
```

Results (Oct 2026): Groq's Qwen was fastest (~5 s) with the most usable rewrites; Gemini's lite models came next and run
on another company's servers; the bigger Gemini models were "busy" most of the time and every free OpenRouter model
was blocked, rate-limited or took minutes. Change the order without code via the `AI_CHAIN` environment variable.

- **Slow is not a failure.** Answers stream in live, and a model is dropped only when it errors, returns bad JSON,
  or sends **nothing at all** for 45 s.
- **Busy models wait their turn.** A model that answers "503 busy" gets one retry after a few seconds; after that it is
  tried last for 90 seconds, so the next requests go straight to a model that works.
- **"Use quick version now"** skips the wait at any time.
- The **offline engine** reorders your skills, bullets and projects for the job and trims to length. It never writes new
  text, so it can't make anything up. It also kicks in automatically when the server can't be reached or the daily limit
  is reached.
- Usage limits fail **open**: if the database is down, people can still use the AI.

## Architecture

| Part | Tech | Where |
| --- | --- | --- |
| Web app | React 19 + TypeScript + Vite, plain CSS design tokens | `web/` → Vercel CDN |
| Page + PDF | Own layout engine (Helvetica metrics), SVG on screen, `pdf-lib` for the PDF | `web/src/lib/page/` |
| API | FastAPI (stateless), streaming Server-Sent Events | `backend/`, entry `api/index.py` → Vercel Python function |
| AI | Gemini (`google-genai`) → Groq (OpenAI-compatible HTTP), both free tiers | `backend/ai/` |
| File reading | PyMuPDF (PDF) and python-docx (Word) read uploaded resumes; `backend/fileedit/` can also edit a file in place (API only) | `backend/fileedit/` |
| Accounts & data | Supabase Auth + Postgres with Row Level Security | `supabase/migrations/` |

API endpoints: `POST /api/file/extract`, `POST /api/file/tailor` (stream), `POST /api/file/render`, `POST /api/tailor` (stream), `POST /api/parse` (stream), `POST /api/rewrite`, `GET /api/config`,
`GET /api/health`, docs at `/api/docs`.

The browser talks to Supabase directly for the user's own data (RLS ensures people only see their own rows).
The API only verifies who is calling (for daily limits) and runs AI. Name, email and phone are never sent to the AI.

## Run it locally

```bash
# API
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
cp .env.example .env        # add GEMINI_API_KEY / GROQ_API_KEY (optional: works without them)
uvicorn backend.app:app --reload --port 8000

# Web (second terminal)
cd web
npm install
npm run dev                 # http://localhost:5173 (proxies /api to :8000)
```

Without Supabase settings, everyone is a guest (saved in the browser). Without AI keys, the offline engine is used.

## Tests

```bash
pytest -q                               # API: fallback chain, stall handling, limits, endpoints
ruff check backend api tests
cd web && npm test && npm run typecheck # match engine, truth check, offline engine, import, undo
```

CI runs all of these on every push (`.github/workflows/ci.yml`).

## Deploy

Everything runs on **Vercel** (free Hobby plan) + **Supabase** (free plan). See [`DEPLOY_PROMPT.md`](DEPLOY_PROMPT.md)
for a step-by-step guide, written so a local Claude session can do it for you.

Environment variables are listed in [`.env.example`](.env.example).

## Your old resume

The original `master_resume.json` is in `examples/legacy_master_resume.json`. Import it from
**Settings → Import resume** (or the welcome screen) and it is converted to the new format automatically.

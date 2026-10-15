# Tailor — one resume, tailored to every job

Upload your resume (PDF or Word), paste a job post, and get a version that speaks the job's language, **in your own
file, with your own design**. Only the words change: same fonts, same layout, same page count.

![Studio](docs/screenshots/studio.png)

## How tailoring works

1. **Find the safe lines.** We read your file and find the lines that can change: bullet points, the summary and skill
   lists. Your name, contact details, job titles, companies, dates, education and certificates are never touched.
2. **Rewrite in plain words.** The AI reads the job post and rewrites those lines in simple, human language, using the
   job's keywords only where they are true for you. It **replaces** text; it never adds lines. Each line comes with a
   character range so the new text has the same size as the old one.
3. **Check every rewrite** (on the server, not trusted to the AI):
   - every number in the old line must still be there, and no new numbers may appear;
   - it must be about the same length (never more than ~15% longer);
   - it must fit in **the same number of lines** (measured with the real font metrics).
   Lines that fail go back to the AI once with the exact reason; if they fail again, the original line stays.
4. **Write it into your file.** PDF: the old characters are removed and the new words are drawn on the same baselines,
   with the same font (or one with identical widths), size and colour; justified text stays justified and bold keywords
   stay bold. Word: only the text inside the existing runs changes, so styles, bullets and indents stay as they are.
5. **You stay in control.** Every change is listed (before → after). Switch any change off, or reword it yourself; your
   wording gets the same fit check.

Code: `backend/fileedit/` (PDF via PyMuPDF, Word via python-docx), prompts in `backend/prompts.py`,
endpoints `/api/file/extract`, `/api/file/tailor` (streaming) and `/api/file/render` in `backend/app.py`.

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
- **Click-to-edit page** with undo/redo, Enter for a new bullet, AI rewrite of any bullet (stronger, shorter,
  add a keyword, fix grammar).
- **Page meter** ("1 page ✓" / "over by 3 lines") and **Fit to 1 page**. 3 ATS-safe templates, A4/Letter, spacing and
  heading color.
- **Keep your design**: upload a PDF or Word file and tailoring edits that file in place (see above). Download the
  tailored PDF or Word file directly. Text or pasted resumes use the built-in template instead.
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
| API | FastAPI (stateless), streaming Server-Sent Events | `backend/`, entry `api/index.py` → Vercel Python function |
| AI | Gemini (`google-genai`) → Groq (OpenAI-compatible HTTP), both free tiers | `backend/ai/` |
| File editing | PyMuPDF (PDF), python-docx (Word); pdf.js / docx-preview to show files in the browser | `backend/fileedit/` |
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

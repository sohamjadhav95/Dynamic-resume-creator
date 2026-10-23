# Tailor — one resume, tailored to every job

Paste a job post and get a version of your resume that speaks its language: honest rewrites, a live match score, and
a PDF that looks exactly like yours. Upload your resume as a PDF and the page you edit **is your PDF**: fonts,
photo, columns, colours and spacing stay exactly as they are; only the words you (or the AI) change are rewritten.

![Studio](docs/screenshots/studio.png)

## How tailoring works

1. **Master resume.** Upload your resume as a PDF (or start from a template: paste text, a JSON export such as the old
   `master_resume.json`, the sample, or a blank page). It becomes your master profile; tailoring never changes it,
   every job gets its own version.
2. **Rewrite.** The AI rewrites the summary and every bullet (jobs, projects and other sections such as research or
   volunteering) so the part each one shares with the job post comes first, in plain words. Same number of bullets,
   about the same length.
3. **Skills (ATS keywords).** The job's important tools are added to the skills lines and the least relevant ones
   removed (at most 4 new ones); categories may be renamed for the role. Added skills are listed under **Tips** so you
   can remove any you haven't used.
4. **Checks, in code.** Every rewrite must keep all numbers, add no new ones, stay about the same length, and not name
   tools or terms your resume doesn't show (bullets: only from that same job or project, plus what its tools imply:
   FastAPI → Python, React → UI, Tableau → BI). Code also refuses a rewrite that:
   - drops what a number measures ("0.9416 Dice score") or most of what the line is about;
   - borrows a specialist word or skill name from the job post that the resume never uses (a nurse's "heparin drips"
     must not become "vasoactive drips"). Everyday words ("growth", "leaders", "event-driven") are fine: a
     word-frequency list (`web/src/data/common-words.txt`) tells them apart;
   - adds an uncommon word found nowhere in the resume or the job post (filler or a new claim);
   - sounds AI-written ("leveraged", "spearheaded", "seamless", "robust"…), unless the resume already uses the word.
     A long dash (—) becomes a comma.

   A refused line gets one more AI try, told every reason; otherwise the original stays. Refused lines are listed
   under Tips.
5. **Fits your PDF.** For an uploaded PDF the server measures how many characters fill each block's lines; the AI is
   told, and the checks use it. Every rewrite is written into the PDF and checked: one that would need an extra line,
   or leave an empty one, gets one more try with the exact numbers, else the original line stays. A skills line that
   comes out short is topped up with the person's own skills. Nothing else on the page ever moves.
6. **Edit and export.** Click any text on the page to change it; **PDF** downloads exactly the page you see.

## Your PDF, edited in place (`backend/fileedit/`, `web/src/lib/source.ts`)

Real resumes come in every design (photos, two columns, colour bars, icon fonts, LaTeX), so the app doesn't redraw
an uploaded resume; it edits the file:

1. **Read** (PyMuPDF): every character with its font, size, colour and position, grouped into blocks: a bullet with
   its wrapped lines, a paragraph, a "Label: a, b" line, a title. Word's separate bullet signs and bold labels inside
   bullets ("**TensorFlow:** built…") are understood.
2. **Link**: the AI splits the text into resume fields, and each field (summary, bullets, skills lines) is tied to the
   block that shows it, by text similarity. Every other block (name, dates, headings, contact) is still editable.
3. **Write**: to change a block, only its old characters are removed and the new words are drawn on the same
   baselines, from the same start, in the same size and colour (justified if it was). The font is the file's own when
   it has every letter, else the same family from Google Fonts (Lato, Roboto, Source Sans…) or a twin with equal widths
   (Calibri → Carlito, Arial → Arimo, Times → Tinos), else a built-in PDF font. Text that needs more lines than the
   block has is refused, with roughly how many characters to cut.
4. **Show**: pdf.js draws the PDF; clickable areas sit over every block and open a small editor; the server writes
   the change and the page updates a moment later.

**Paper size**: a PDF is shown at its own size (A4, Letter, Legal or anything else). If the page is longer than an A4
page, a dashed line marks where A4 would end. The paper menu can also put it on A4 or Letter: **same size, more pages**
(the width is fitted and a long page continues on the next sheet, cut between lines) or **shrink to fit each page**
(scaled down evenly). The download uses the chosen paper.

To add, move or hide whole sections, **Use a template instead** turns the resume into a template page.

## Template pages (`web/src/lib/page/`)

Resumes without a PDF (pasted text, JSON, sample, blank) use the app's own page engine, never browser printing:

1. **measures** every word with the exact metrics of the PDF Helvetica / Times families, with no kerning;
2. **lays out** the resume: justified bullets with a hanging indent, bold "Category:" labels, dates on the right, a
   rule under each section title, and records which field every word belongs to;
3. **keeps it on one page** by tightening spacing, then text size (to 92% at most); if even that isn't one page it
   keeps the normal look and flows onto a second page, never leaving a heading alone at the bottom;
4. draws that one layout as SVG on screen and as a real PDF with `pdf-lib` (selectable text for applicant tracking
   systems).

The default **Original** style reproduces the owner's PDF (A4, 15 mm sides, 17 pt name, 9 pt headings with a rule,
8.5 pt justified body). Classic, Modern and Compact are variations.

## What it does

- **Studio layout**: build on the left, the real page in the middle, match score and AI tools on the right.
  On tablets the right panel becomes a tab; on phones there is a bottom tab bar.
- **Master profile + versions**: one master profile; each job gets its own tailored version.
- **Instant match score** (runs in the browser, no AI needed): required vs nice-to-have keywords, found and missing,
  and the job post with highlights.
- **Click-to-edit page** with undo/redo and AI rewrite of any bullet (stronger, shorter, add a keyword, fix grammar).
- **Resizable, collapsible panels**: drag the edge of the side columns, or collapse them to a slim rail.
- **Accounts are optional**: guests save in this browser; signing in (Google or email link) saves resumes, versions
  and uploaded PDFs to the account. The app opens straight into the signed-in account; a resume made as a guest moves
  into an account only if you choose to; signing out leaves a clean start.
- **Accessible**: keyboard everywhere, visible focus, screen-reader labels, WCAG AA contrast, reduced motion, dark mode.

## Which AI models, and why (all free tiers)

```
Groq · qwen3.8-27b  ─▶  Gemini · 3.1-flash-lite  ─▶  Gemini · 3.5-flash-lite  ─▶  Groq · gpt-oss-20b  ─▶  Offline engine
```

Groq's Qwen is fastest for short answers (reading a resume, rewriting one bullet). Its free tier only lets it write
about 1,000 tokens a minute, too little for a whole tailored resume, so tailoring asks Gemini first. Change the order
without code via the `AI_CHAIN` environment variable.

- **Slow is not a failure.** Answers stream in live, and a model is dropped only when it errors, returns bad JSON,
  or sends **nothing at all** for 45 s.
- **Busy models wait their turn.** A model that answers "503 busy" gets one retry after a few seconds; after that it is
  tried last for 90 seconds.
- **"Use quick version now"** skips the wait at any time.
- The **offline engine** reorders your skills, bullets and projects for the job. It never writes new text, so it can't
  make anything up. It also kicks in when the server can't be reached or the daily limit is reached.
- Usage limits fail **open**: if the database is down, people can still use the AI.

## Architecture

| Part | Tech | Where |
| --- | --- | --- |
| Web app | React 19 + TypeScript + Vite, plain CSS design tokens | `web/` → Vercel CDN |
| Uploaded PDF view | pdf.js on screen, clickable blocks, file storage (browser + account) | `web/src/lib/source.ts`, `web/src/components/PdfView.tsx` |
| Template page + PDF | Own layout engine, SVG on screen, `pdf-lib` for the PDF | `web/src/lib/page/` |
| API | FastAPI (stateless), streaming Server-Sent Events | `backend/`, entry `api/index.py` → Vercel Python function |
| PDF editing | PyMuPDF: read blocks, write changes in place, fit onto A4 / Letter | `backend/fileedit/` |
| AI | Gemini (`google-genai`) and Groq (OpenAI-compatible HTTP), both free tiers | `backend/ai/` |
| Accounts & data | Supabase Auth + Postgres with Row Level Security | `supabase/migrations/` |

API endpoints: `POST /api/file/extract`, `POST /api/file/render`, `POST /api/tailor` (stream), `POST /api/parse`
(stream), `POST /api/rewrite`, `GET /api/config`, `GET /api/health`, docs at `/api/docs`.

The browser talks to Supabase directly for the user's own data (RLS ensures people only see their own rows).
The API only verifies who is calling (for daily limits), runs AI and edits PDFs. Name, email and phone are never
sent to the AI.

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
pytest -q                               # API, AI fallback chain, limits, PDF editing and paper sizes
ruff check backend api tests
cd web && npm test && npm run typecheck # PDF field linking, checks on AI rewrites, page engine, import, undo
```

`web/src/lib/tailoring.samples.test.ts` runs 15 resumes from different fields (engineer, nurse, marketer, accountant,
teacher, sales, designer, a graduate with only projects…) against real-style job posts and AI answers
(`web/src/lib/fixtures/samples.ts`): good rewrites must be used in every section, and the slips models make (a
buzzword, a tool from the job post, a changed number, a different metric) must be refused.

CI runs all of these on every push (`.github/workflows/ci.yml`).

## Deploy

Everything runs on **Vercel** (free Hobby plan) + **Supabase** (free plan). See [`DEPLOY_PROMPT.md`](DEPLOY_PROMPT.md)
for a step-by-step guide. The database tables are in `supabase/migrations/` (run them in order in the Supabase SQL
editor). `supabase/reset.sql` deletes every account and all data, for a fresh start.

Environment variables are listed in [`.env.example`](.env.example).

## Your old resume

The original `master_resume.json` is in `examples/legacy_master_resume.json`. Import it from the resume menu
(**Import a resume…**) or the welcome screen and it is converted to the new format automatically.

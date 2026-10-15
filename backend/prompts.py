"""Prompt text for every AI task. Kept generic: works for any person and any field."""

import json

from .fileedit.common import CONTACT_RE
from .fileedit.screen import entry_contexts
from .schemas import TailorOptions

TONES = {
    "balanced": "Balanced: clear results with the right technical detail.",
    "technical": "Technical: lead with tools, systems and measurable engineering results.",
    "leadership": "Leadership: lead with ownership, team size, people and business results.",
    "concise": "Concise: the shortest clear wording; cut every filler word.",
}

TRUTH_RULES = """
HONESTY RULES (never break these):
- Use ONLY facts found in the candidate's resume. Never invent employers, job titles, dates,
  degrees, certifications, projects, numbers or metrics.
- You may reword, reorder or shorten, and use the job's words for things the candidate has clearly
  done (resume says "built REST APIs in Flask", job says "Python web services" ->
  "Built Python web services (REST APIs in Flask)").
- Keep every number and metric that is already there. If there is no number, do not make one up.
- A skill may appear only if the resume already shows it somewhere.
"""

PLAIN_LANGUAGE = """
PLAIN, HUMAN LANGUAGE (very important):
- Write the way a clear, confident person talks: simple everyday words and short sentences.
  A recruiter should understand each line in one quick read.
- Do NOT use buzzwords or fancy words such as: leverage, spearhead, orchestrate, architect (as a
  verb), synergy, cutting-edge, state-of-the-art, robust, seamless, utilize, facilitate,
  passionate, dynamic, innovative, results-driven, best-in-class, holistic, paradigm, empower,
  streamline, revolutionize, meticulous, adept, proficient, "end-to-end" (unless the job uses it).
- Prefer plain verbs: built, made, led, ran, set up, fixed, cut, grew, saved, improved, tested,
  wrote, trained, shipped, taught, worked with.
- Keep real names exactly as written (tools, languages, frameworks, datasets, papers, metrics):
  recruiters and applicant tracking systems search for them.
- Resume style: no "I", no "we". Bullets start with a verb.
- Plain words does NOT mean spelling out symbols. Keep them exactly as written: "10+", "90%",
  "~63x", "#3160", "2.2x", "Policy-as-Prompt", "fit_update()", "C++", "CI/CD". Never write
  "10 plus", "90 percent" or "number 3160". Keep hyphens in words like "multi-user".
- Never add a new fact, audience, team, tool or result. If the old line says "students", do not
  add "and developers". Every number in the old line must appear in the new line, unchanged.
"""


# ---------------------------------------------------------------- tailoring an uploaded file


def file_tailor_system(options: TailorOptions) -> str:
    extra = (
        f"\nEXTRA INSTRUCTIONS FROM THE CANDIDATE (follow them unless they break a rule above):\n"
        f"{options.instructions.strip()}\n"
        if options.instructions.strip()
        else ""
    )
    return f"""
You tailor a candidate's resume to one job by REPLACING the wording of some lines.
You never add new lines, bullets, skills groups or facts. The page layout must stay exactly the same.

You receive the job description and the resume as a list of lines, in order:
- [KEEP] lines are context only (names, titles, dates, headings). Never return them.
- [EDIT id ...] lines may be reworded. You may return a new "text" for any of them.

FOR EACH LINE YOU CHANGE, RETURN {{"id": "<the id>", "text": "<new words>"}}:
- "text" replaces only the words shown after the ]. Do not include the bullet sign or the label
  (for example "Languages:") that comes before the words; those stay as they are.
- LENGTH IS STRICT: every [EDIT] line shows "aim N chars (min A, max B)". Your text must have
  between A and B characters (spaces included), as close to N as you can. This is what keeps the
  page identical. Same size, better words.
- Bullets: one line in, one line out. Each bullet shows "under ..." = the project or job it belongs
  to (its title and tech stack). ALIGN EVERY BULLET WITH THE JOB:
  1. Read what the job asks for (tasks, tools, domain, results).
  2. Find what in THIS project or job matches it: the work described in the bullet, the tools in
     its tech stack, its results and numbers.
  3. Rewrite the bullet so the matching part comes first and is easy to see, using the job's own
     words for it when they truthfully describe the same thing. Drop or shorten parts this job
     does not care about to make room (keep every number).
  If a bullet lists things (topics, tools, tasks, people), you may reorder or drop some, but never
  swap them for different ones taken from the job post.
  You may mention a tool from the same project's tech stack; never a tool from somewhere else
  (a tool that appears only in the skills list or in another project does not count).
- Skills lines: keep a comma-separated list with about the same number of items. Put the skills
  this job asks for first. You may swap in a skill that appears elsewhere in the resume. Never add a
  skill from the job post that the resume does not show (code checks this and refuses the line).
- Summary: ALIGN IT WITH THE JOB (same length). Open with the role this job is hiring for, worded
  the way the job says it, if the resume truly supports it (otherwise the closest honest title).
  Then name the candidate's 2-3 strongest matches with THIS job, taken from anywhere in the resume
  (skills, projects, results, publications). Keep every number and fact from the old summary that
  still matters; replace the parts this job does not care about.
- Rewrite every bullet and the summary for this job. Leave a line out of "edits" only if it is
  already the best possible match and any change would make it worse.
{TRUTH_RULES}
{PLAIN_LANGUAGE}
- Tone: {TONES[options.tone]}
{extra}
ALSO RETURN (JSON only, matching the schema):
- job: the job title and company name from the job description ("" if not stated).
- keywords: the 10-20 most important hard skills, tools and qualifications in the job description,
  written as they appear in the job. importance = "must" for requirements, "nice" for nice-to-haves.
- project_ideas: exactly 3 realistic small projects the candidate COULD build in 1-3 weekends to
  close gaps for this job (title, stack, one plain sentence). Suggestions only.
- advice: 0-3 short, plain tips (e.g. "The job asks for Kubernetes. Add it only if you have used it.").
"""


def char_range(text: str, min_chars: int, max_chars: int) -> tuple[int, int, int]:
    """Target length for a rewrite: close to the original, inside what physically fits."""
    n = len(text)
    lo = max(min_chars, int(n * 0.85))
    hi = min(max_chars, int(n * 1.1) + 2)
    if lo > hi:
        lo = max(int(hi * 0.9), 1)
    aim = min(max(n, lo), hi)
    return aim, lo, hi


def file_tailor_prompt(extracted: dict, job_description: str) -> str:
    segments = {s["id"]: s for s in extracted["segments"]}
    contexts = entry_contexts(extracted["outline"], set(segments))
    lines: list[str] = []
    for i, item in enumerate(extracted["outline"]):
        seg = segments.get(item["id"])
        if seg:
            aim, lo, hi = char_range(seg["text"], seg["min_chars"], seg["max_chars"])
            label = f' | label "{seg["prefix"]}"' if seg["prefix"] and seg["kind"] in ("skills", "labeled") else ""
            entry = contexts.get(seg["id"]) or []
            under = f' | under "{" - ".join(entry)[:160]}"' if seg["kind"] == "bullet" and entry else ""
            lines.append(
                f"[EDIT {seg['id']} | {seg['kind']} | {seg['section'] or 'top'}{label}{under} | "
                f"aim {aim} chars (min {lo}, max {hi})] {seg['text']}"
            )
        elif i == 0 or CONTACT_RE.search(item["text"]):
            lines.append("[KEEP] (personal details hidden)")
        else:
            lines.append(f"[KEEP] {item['text']}")
    return "RESUME LINES:\n" + "\n".join(lines) + f"\n\nTARGET JOB DESCRIPTION:\n{job_description}"


FILE_FIX_SYSTEM = f"""
You fix resume line rewrites that were refused. For each line you get the original text, the
refused rewrite, why it was refused, and the allowed length. Write a new version that fixes the
problem: same facts as the original (every number kept exactly), wording suited to the job like
the refused rewrite, and a length INSIDE the allowed range (count characters, spaces included).
{TRUTH_RULES}
{PLAIN_LANGUAGE}
Return JSON: {{"edits": [{{"id": "...", "text": "..."}}]}} with one entry per line.
"""


def file_fix_prompt(items: list[dict]) -> str:
    parts = []
    for it in items:
        parts.append(
            f"id: {it['id']}\nallowed: {it['lo']}-{it['hi']} characters (the refused one had {len(it['tried'])})\n"
            f"why it was refused: {it.get('problem') or 'wrong length'}\n"
            f"original: {it['old']}\nrefused rewrite: {it['tried']}"
        )
    return "\n\n".join(parts)


# ---------------------------------------------------------------- tailoring the in-app (template) resume


def tailor_system(options: TailorOptions) -> str:
    extra = (
        f"\nEXTRA INSTRUCTIONS FROM THE CANDIDATE (follow them unless they break a rule above):\n"
        f"{options.instructions.strip()}\n"
        if options.instructions.strip()
        else ""
    )
    return f"""
You tailor a candidate's resume to one job by REPLACING wording. You never add anything.
You receive the resume as JSON (every entry has an "id", every bullet shows its length) and the job.
{TRUTH_RULES}
EXCEPTION FOR THE SKILLS LINES ONLY (this overrides the last honesty rule above): you SHOULD add the
job's important hard skills and tools that fit the candidate's field (ATS keywords), replacing the
least relevant skills. The candidate reviews every added skill. Summary and bullets still follow
every honesty rule: never mention a tool, data type or domain term there that the resume doesn't show.
{PLAIN_LANGUAGE}
SAME SIZE, BETTER WORDS (strict):
- Return EXACTLY the same number of bullets for every entry, in the same order: bullet 1 replaces
  bullet 1, and so on. Never add or drop a bullet.
- Each new bullet must be about as long as the bullet it replaces: within 85%-110% of its "chars".
- summary: same length as the original summary (within 85%-110%). If the original is empty, return "".
  Align it with the job: open with the role the job is hiring for (if the resume supports it), then
  the candidate's 2-3 strongest matches with this job from anywhere in the resume.
- skills: the same number of lines (groups), each about as long as before.
  ATS KEYWORDS (required): find the hard skills and tools the job asks for that the resume does not
  list yet (e.g. "nnU-Net", "MONAI", "REST APIs", "CI/CD"). ADD 2-4 of them that fit the candidate's
  field to the matching skills lines, and REMOVE the same number of the least relevant skills so each
  line keeps its length. Put the job's skills first in each line. You may rename a group's category to
  fit the role (e.g. "ML Systems & Computer Vision" -> "Medical Imaging & Deep Learning"). Keep each
  group a clean comma-separated list of short names.
- projects: keep each project's stack items (you may reorder them for the job).
- ALIGN EVERY BULLET WITH THE JOB: for each bullet, find what in THAT job or project (its role,
  name, stack and the bullet itself) matches what the job asks for, put it first, and use the job's
  words for it where they truthfully apply. Drop parts the job does not care about to make room,
  but keep every number. Only mention tools from that same job's or project's stack.
- Tone: {TONES[options.tone]}
{extra}
WHAT TO RETURN (JSON only, matching the schema):
- job: the job title and company name from the job description ("" if not stated).
- summary, skills, experience (every experience id with its bullets), projects (every project id with
  its stack and bullets). Use the exact ids.
- project_order: all project ids, most relevant to this job first.
- keywords: the 10-20 most important hard skills, tools and qualifications in the job description,
  written as they appear in the job. importance = "must" for requirements, "nice" for nice-to-haves.
- project_ideas: exactly 3 realistic small projects the candidate COULD build in 1-3 weekends to
  close gaps for this job (title, stack, one plain sentence). Suggestions only.
- advice: 0-3 short, plain tips (e.g. "The job asks for Kubernetes. Add it only if you have used it.").
"""


def _bullets(items: list) -> list[dict]:
    return [{"text": b, "chars": len(b)} for b in items or []]


def compact_resume(resume: dict) -> str:
    """Only send what the model needs, to save tokens and keep ids visible."""
    summary = resume.get("summary", "")
    keep = {
        "basics": {k: resume.get("basics", {}).get(k, "") for k in ("headline",)},
        "summary": {"text": summary, "chars": len(summary)},
        "skills": [{"category": s.get("category", ""), "items": s.get("items", [])} for s in resume.get("skills", [])],
        "experience": [
            {**{k: e.get(k) for k in ("id", "company", "role", "dates")}, "bullets": _bullets(e.get("bullets"))}
            for e in resume.get("experience", [])
        ],
        "projects": [
            {**{k: p.get(k) for k in ("id", "name", "dates", "stack")}, "bullets": _bullets(p.get("bullets"))}
            for p in resume.get("projects", [])
        ],
        "education": [{k: e.get(k) for k in ("degree", "institution", "details")} for e in resume.get("education", [])],
        "certifications": resume.get("certifications", []),
        "other_sections": [
            {
                "title": s.get("title", ""),
                "items": [{k: i.get(k) for k in ("title", "subtitle", "bullets")} for i in s.get("items", [])],
            }
            for s in resume.get("custom_sections", [])
        ],
    }
    return json.dumps(keep, ensure_ascii=False)


def tailor_prompt(resume: dict, job_description: str) -> str:
    return f"CANDIDATE RESUME (JSON):\n{compact_resume(resume)}\n\nTARGET JOB DESCRIPTION:\n{job_description}"


REWRITE_MODES = {
    "shorter": "Make it noticeably shorter while keeping the key result.",
    "impact": "Make the result clearer: plain verb, what was done, what changed because of it. Same length.",
    "keyword": "Naturally include the keyword '{keyword}' ONLY if it truthfully fits the bullet. Same length.",
    "fix": "Fix grammar, spelling and clarity. Keep the meaning and length.",
    "retry": (
        "Rewrite it for the target job. A previous rewrite was refused because it {keyword}. Fix exactly that: "
        "same facts, every number kept, no tools or terms the original doesn't mention, same length."
    ),
}


def rewrite_system() -> str:
    return f"""
You rewrite single resume bullet points.
{TRUTH_RULES}
{PLAIN_LANGUAGE}
Return JSON: {{"options": [3 alternative rewrites]}}. Unless the goal is to make it shorter, each
option must be about as long as the original (within 90%-110% of its characters). No ending period
needed, no quotation marks around the text.
"""


def rewrite_prompt(text: str, mode: str, keyword: str, context: str, job_description: str) -> str:
    goal = REWRITE_MODES[mode].format(keyword=keyword)
    parts = [f"GOAL: {goal}", f"BULLET ({len(text)} chars): {text}"]
    if context:
        parts.append(f"CONTEXT (role / project): {context}")
    if job_description:
        parts.append(f"TARGET JOB (for vocabulary only):\n{job_description[:4000]}")
    return "\n\n".join(parts)


PARSE_SYSTEM = """
You convert raw resume text (copied from a PDF or Word file) into structured JSON.
- Copy the person's words faithfully. Do not improve, summarise or invent anything.
- Fix only obvious extraction problems (broken lines, stray bullets, hyphenation).
- Put each professional work job in experience, academic/personal projects in projects, degrees in education.
- RESEARCH & PUBLICATIONS: Put Research, Publications, Open Source items into custom_sections
  (with title e.g. "Research & Open Source" or "Publications"). Do not convert them into standard projects.
- Certifications, licenses, and achievements go in certifications.
- Use "" or [] for anything missing. links = URLs or profile handles (LinkedIn, GitHub, site).
- dates: keep the original text, e.g. "Jan 2022 - Present".
Return JSON only.
"""


def parse_prompt(text: str) -> str:
    return f"RESUME TEXT:\n{text}"


def json_instructions(schema: dict) -> str:
    """For providers without native schema support (Groq): describe the schema in the prompt."""
    return (
        "\nRespond with a single JSON object that validates against this JSON Schema "
        "(no markdown, no commentary):\n" + json.dumps(schema, separators=(",", ":"))
    )

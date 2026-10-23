"""Prompt text for every AI task. Kept generic: works for any person and any field."""

import json

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

KEEP_MEANING = """
KEEP THE MEANING (a recruiter will ask about every line):
- Never change what a line is about. Keep its subject words: what was handled (sales, loans,
  patients, medicines, students), the named methods, models and datasets, and the name of every
  metric ("0.9416 Dice score" stays "0.9416 Dice score", never "0.9416 score").
- Never swap a word for a job-post word that means something else: "sales" must not become
  "shipments", "heparin and diltiazem drips" must not become "vasoactive drips".
- Never pad a line to reach a length, and never tack job words onto the end of a sentence
  ("... for the platform", "... of manual platform work"). If an honest rewrite comes out much
  shorter, keep more of the original words instead.
- If a line has nothing in common with the job, return it unchanged. Unchanged beats forced.
"""


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
{KEEP_MEANING}
SAME SIZE, BETTER WORDS (strict):
- Return EXACTLY the same number of bullets for every entry, in the same order: bullet 1 replaces
  bullet 1, and so on. Never add or drop a bullet.
- Each new bullet: 80%-110% of the "chars" of the bullet it replaces.
- summary: 80%-110% of the original summary's length. If the original is empty, return "".
  Align it with the job: keep the candidate's own title (from their summary or latest job, e.g.
  "Data analyst"), never the job post's title unless they have held it. Then their 2-3 strongest
  matches with this job from anywhere in the resume. No skill, tool, domain or kind of work the
  resume doesn't show (for example "edge devices" when the resume never mentions them).
- skills: the same number of lines (groups), each about as long as before.
  ATS KEYWORDS (required): find the hard skills and tools the job asks for that the resume does not
  list yet (e.g. "nnU-Net", "MONAI", "REST APIs", "CI/CD"). ADD 2-4 of them that fit the candidate's
  field to the matching skills lines, and REMOVE the same number of the least relevant skills so each
  line keeps its length. Add tools, software and methods only: never licenses, certifications,
  clinical procedures or years of experience. Put the job's skills first in each line.
  You may rename a group's category to fit the role
  (e.g. "ML Systems & Computer Vision" -> "Medical Imaging & Deep Learning"). Keep each
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


def _line(text: str, room: list[int] | None) -> dict:
    """A rewritable line with its length; for an uploaded PDF also the room its lines give (min..max)."""
    out = {"text": text, "chars": len(text)}
    if room:
        out["min"], out["max"] = room
    return out


def _bullets(items: list, item_id: str, limits: dict) -> list[dict]:
    return [_line(b, limits.get(f"{item_id}.{k}")) for k, b in enumerate(items or [])]


def compact_resume(resume: dict, limits: dict | None = None) -> str:
    """Only send what the model needs, to save tokens and keep ids visible."""
    limits = limits or {}
    summary = resume.get("summary", "")
    keep = {
        "basics": {k: resume.get("basics", {}).get(k, "") for k in ("headline",)},
        "summary": _line(summary, limits.get("summary")),
        "skills": [{"category": s.get("category", ""), "items": s.get("items", [])} for s in resume.get("skills", [])],
        "experience": [
            {
                **{k: e.get(k) for k in ("id", "company", "role", "dates")},
                "bullets": _bullets(e.get("bullets"), str(e.get("id")), limits),
            }
            for e in resume.get("experience", [])
        ],
        "projects": [
            {
                **{k: p.get(k) for k in ("id", "name", "dates", "stack")},
                "bullets": _bullets(p.get("bullets"), str(p.get("id")), limits),
            }
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


def tailor_prompt(resume: dict, job_description: str, limits: dict | None = None) -> str:
    groups = len(resume.get("skills", []))
    room = (
        '\nThis resume is the person\'s own PDF: a line that shows "min" and "max" must be rewritten to between '
        "min and max characters, so it fills exactly the lines it has on the page."
        if limits
        else ""
    )
    return (
        f"CANDIDATE RESUME (JSON):\n{compact_resume(resume, limits)}\n\nTARGET JOB DESCRIPTION:\n{job_description}\n\n"
        f"Return exactly {groups} skills lines, in the same order (never merge or split them).{room}"
    )


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
- Never drop words. A project's whole title line is its name, including a short description after a dash
  ("pgshift — open source migration tool").
- RESEARCH & PUBLICATIONS: Put Research, Publications, Open Source items into custom_sections
  (with title e.g. "Research & Open Source" or "Publications"). Do not convert them into standard projects.
- Certifications, licenses, and achievements go in certifications.
- skills: one group per labelled line, keeping its label ("Languages: Python, SQL" -> category "Languages").
  Only when the skills section has no labels at all, return a single group with category "".
- Any other section (Volunteer, Languages, Talks, Awards, Interests...) goes in custom_sections with its own heading
  as the title. Keep every line; never drop a section.
- headline: only a short title line written in the header under the name (e.g. "Registered Nurse, BSN").
  "" if there is none. Never copy a sentence from the summary into it.
- Use "" or [] for anything missing. links = URLs or profile handles (LinkedIn, GitHub, site). Anything else on the
  contact line (license number, visa status, portfolio) also goes in links, exactly as written.
- location of a job, project or school: only when the text writes a place for that entry. Never copy the person's
  own city into entries.
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

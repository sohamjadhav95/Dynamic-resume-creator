"""Prompt text for every AI task. Kept generic: works for any person and any field."""

import json

from .schemas import TailorOptions

TONES = {
    "balanced": "Balanced: clear impact with the right technical detail.",
    "technical": "Technical: lead with tools, systems and measurable engineering outcomes.",
    "leadership": "Leadership: lead with ownership, scope, people and business outcomes.",
    "concise": "Concise: shortest clear phrasing; cut every filler word.",
}

TRUTH_RULES = """
HONESTY RULES (never break these):
- Use ONLY facts found in the candidate's resume. Never invent employers, job titles, dates,
  degrees, certifications, projects, numbers or metrics.
- You may rephrase, reorder, merge or drop content, and use the job's vocabulary for things the
  candidate has clearly done (e.g. resume says "built REST APIs in Flask", job says "Python web
  services" -> "Built Python web services (REST APIs in Flask)").
- If a metric is not in the resume, describe the outcome without a number.
- A skill may appear in the skills list only if the resume shows it somewhere.
"""


def tailor_system(options: TailorOptions) -> str:
    length = (
        "The final resume must fit on ONE page, so prefer fewer, stronger bullets."
        if options.one_page
        else "Length is flexible, but every bullet must earn its place."
    )
    extra = (
        f"\nEXTRA INSTRUCTIONS FROM THE CANDIDATE:\n{options.instructions.strip()}\n"
        if options.instructions.strip()
        else ""
    )
    return f"""
You are an expert resume writer and ATS (applicant tracking system) specialist.
You receive a candidate's resume as JSON (every entry has an "id") and a target job description.
Rewrite the resume content so it is a strong, honest match for this job.
{TRUTH_RULES}
STYLE:
- Tone: {TONES[options.tone]}
- Bullets start with a strong past-tense verb (present tense for current roles) and follow
  Action -> What/How -> Result. At most {options.max_words_per_bullet} words per bullet.
- Up to {options.bullets_per_role} bullets per experience entry and up to {options.bullets_per_project}
  per project. Put the most relevant bullet first.
- {length}
{extra}
WHAT TO RETURN (JSON only, matching the schema):
- job: the job title and company name from the job description ("" if not stated).
- summary: 2-3 sentences (35-55 words) positioning the candidate for this role.
- skills: 3-5 groups with category names that mirror the job's language. Most relevant first.
- experience: for EVERY experience id in the resume, the tailored bullets. Use the exact ids.
- projects: for EVERY project id in the resume, a tailored stack list and bullets. Use the exact ids.
- project_order: all project ids, most relevant to this job first.
- keywords: the 10-20 most important hard skills, tools and qualifications in the job description,
  written as they appear in the job. importance = "must" for requirements, "nice" for nice-to-haves.
- project_ideas: exactly 3 realistic portfolio projects the candidate COULD build in 1-3 weekends
  to close gaps for this job (title, stack, one-sentence pitch). These are suggestions only.
- advice: 0-3 short, specific tips (e.g. "The job asks for Kubernetes; add it only if you have used it").
"""


def compact_resume(resume: dict) -> str:
    """Only send what the model needs, to save tokens and keep ids visible."""
    keep = {
        "basics": {k: resume.get("basics", {}).get(k, "") for k in ("headline",)},
        "summary": resume.get("summary", ""),
        "skills": [{"category": s.get("category", ""), "items": s.get("items", [])} for s in resume.get("skills", [])],
        "experience": [
            {k: e.get(k) for k in ("id", "company", "role", "dates", "bullets")} for e in resume.get("experience", [])
        ],
        "projects": [
            {k: p.get(k) for k in ("id", "name", "dates", "stack", "bullets")} for p in resume.get("projects", [])
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
    "impact": "Make it more impactful: strong verb, clear action, clear result.",
    "keyword": "Naturally include the keyword '{keyword}' ONLY if it truthfully fits what the bullet describes.",
    "fix": "Fix grammar, spelling and clarity. Keep the meaning and length.",
}


def rewrite_system() -> str:
    return f"""
You rewrite single resume bullet points.
{TRUTH_RULES}
Return JSON: {{"options": [3 alternative rewrites]}}. Each under 35 words, no ending period needed,
no quotation marks around the text.
"""


def rewrite_prompt(text: str, mode: str, keyword: str, context: str, job_description: str) -> str:
    goal = REWRITE_MODES[mode].format(keyword=keyword)
    parts = [f"GOAL: {goal}", f"BULLET: {text}"]
    if context:
        parts.append(f"CONTEXT (role / project): {context}")
    if job_description:
        parts.append(f"TARGET JOB (for vocabulary only):\n{job_description[:4000]}")
    return "\n\n".join(parts)


PARSE_SYSTEM = """
You convert raw resume text (copied from a PDF or Word file) into structured JSON.
- Copy the person's words faithfully. Do not improve, summarise or invent anything.
- Fix only obvious extraction problems (broken lines, stray bullets, hyphenation).
- Put each job in experience, each project in projects, degrees in education.
- Publications, awards, volunteering, open source, languages etc. go in custom_sections.
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

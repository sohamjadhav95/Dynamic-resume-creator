"""Honesty checks that need to know where a line sits in the resume.

- A bullet may only name tools and technical terms that already appear in that bullet or in the
  title / tech-stack lines of its own project or job (no borrowing "Docker" from the skills list).
- A skills line may only list skills whose words already appear somewhere in the resume
  (no copying "MRI" or "IoU" from the job post).
"""

import re

from .common import EditResult, clean, normalize_ai_text

DATE_WORDS_RE = re.compile(
    r"(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?|(19|20)\d{2}|present|current|now|till|to", re.I
)
STOP = set(
    "and or the of for in on with to a an & using via based on-premise end-to-end real-time multi skills tools "
    "systems system development design".split()
)
# Tool-like words: an uppercase letter after the first character (PyTorch, nnU-Net, CT, IoU) or
# symbols inside the word (C++, CI/CD, Three.js, C#).
TERM_RE = re.compile(r"[A-Za-z][A-Za-z0-9]*(?:[+#./-]+[A-Za-z0-9]*)*\+*")


def is_date_only(text: str) -> bool:
    """'Sept 2024 - Sept 2025', '2026', 'May 2026 - Present' (dates carry no context for a bullet)."""
    return bool(re.search(r"(19|20)\d{2}", text)) and not re.sub(r"[\W_]+", "", DATE_WORDS_RE.sub("", text))


def entry_contexts(outline: list[dict], segment_ids: set[str]) -> dict[str, list[str]]:
    """For every editable line: the title / stack lines of the project or job it belongs to."""
    out: dict[str, list[str]] = {}
    entry: list[str] = []
    after_edit = True
    for item in outline:
        if item["id"] in segment_ids:
            out[item["id"]] = list(entry)
            after_edit = True
        elif item["kind"] == "heading":
            entry, after_edit = [], True
        elif not is_date_only(item["text"]):
            # A title or stack line right after bullets starts a new project / job.
            entry = [item["text"]] if after_edit else [*entry, item["text"]]
            after_edit = False
    return out


def _words(text: str) -> set[str]:
    words = set()
    for w in re.findall(r"[A-Za-z0-9][A-Za-z0-9+#.-]*", text):
        w = w.lower().rstrip(".-")  # "Airflow." at the end of a sentence is "airflow"
        words.add(w)
        words.update(p for p in re.split(r"[/-]", w) if p)  # "ci/cd" also knows "ci" and "cd"
    return words


def _is_term(token: str) -> bool:
    if len(token) < 2:
        return False
    return any(c.isupper() for c in token[1:]) or bool(re.search(r"[A-Za-z][+#./][A-Za-z+]|\+\+|#$", token))


def new_terms(old: str, new: str, allowed: str) -> list[str]:
    """Names in `new` (tools, products, places) that are not in `old` or `allowed` text."""
    # PDF lines can split words ("Policy-as- Prompt"), so glue those back before comparing.
    known = _words(re.sub(r"(\w)- (\w)", r"\1-\2", old + " " + allowed))
    seen = []
    sentence_start = True
    for match in re.finditer(r"\S+", new):
        raw = match.group(0)
        token = raw.strip("()[]{},;:.!?\"'").strip("-/")
        starts_here, sentence_start = sentence_start, raw.endswith((".", ";", ":", "!", "?"))
        if len(token) < 2 or not token[0].isalpha():
            continue
        named = token[0].isupper() and not starts_here  # "Docker" in the middle of a sentence
        if not (_is_term(token) or named):
            continue
        parts = [p for p in re.split(r"[/-]", token) if p]
        if token.lower() in known or all(p.lower() in known for p in parts):
            continue
        if token not in seen:
            seen.append(token)
    return seen


def unsupported_skills(new: str, whole_resume: str) -> list[str]:
    """Skills in a comma list whose meaningful words are not all found in the resume."""
    known = _words(whole_resume)
    bad = []
    for item in re.split(r"[,;•|]", new):
        item = item.strip()
        if not item:
            continue
        words = re.findall(r"[A-Za-z0-9][A-Za-z0-9+#.-]*", item.replace("/", " "))
        words = [w for w in words if w.lower() not in STOP]
        if any(w.lower().strip(".") not in known and w.lower() not in known for w in words):
            bad.append(item)
    return bad


def screen_edits(extracted: dict, edits: dict[str, str]) -> tuple[dict[str, str], list[EditResult]]:
    """Splits AI edits into ones that may be written and ones refused for adding things."""
    segments = {s["id"]: s for s in extracted["segments"]}
    contexts = entry_contexts(extracted["outline"], set(segments))
    whole = extracted["text"]
    # Bullets of the same project / job share their facts.
    siblings: dict[tuple, list[str]] = {}
    for sid, ctx in contexts.items():
        if segments[sid]["kind"] == "bullet":
            siblings.setdefault(tuple(ctx), []).append(segments[sid]["text"])
    ok: dict[str, str] = {}
    refused: list[EditResult] = []
    for seg_id, raw in edits.items():
        seg = segments.get(seg_id)
        if seg is None:
            continue
        new = normalize_ai_text(raw)
        note = ""
        if seg["kind"] == "skills":
            bad = unsupported_skills(new, whole)
            if bad:
                note = f"Kept the original: {', '.join(bad[:3])} is not in your resume."
        elif seg["kind"] == "bullet":
            ctx = contexts.get(seg_id, [])
            allowed = " ".join(ctx + siblings.get(tuple(ctx), []))
            bad = new_terms(seg["text"], new, allowed)
            if bad:
                note = f"Kept the original: {', '.join(bad[:3])} is not part of this project or job."
        else:  # summary and other text may draw on the whole resume
            bad = new_terms(seg["text"], new, whole)
            if bad:
                note = f"Kept the original: {', '.join(bad[:3])} is not in your resume."
        if note:
            refused.append(
                EditResult(seg_id, seg["section"], seg["kind"], clean(seg["text"]), new, "changed_facts", note)
            )
        else:
            ok[seg_id] = raw
    return ok, refused

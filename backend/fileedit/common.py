"""Shared pieces for editing an uploaded resume file in place (PDF or Word).

The idea: we never rebuild the document. We find the text pieces ("segments") that are safe to
rewrite (bullets, the summary, skill lists), let the AI suggest new text for them, and write the
new text back into exactly the same place. A rewrite that would need more lines than the
original is refused, so the page count and layout cannot change.
"""

import re
from dataclasses import asdict, dataclass, field

BULLET_CHARS = "•●▪◦‣∙·■□►▸▹➢➤✓✔○◆◇⁃"
BULLET_RE = re.compile(rf"^\s*([{re.escape(BULLET_CHARS)}]|[-–—*](?=\s))\s*")

# Sections whose text must stay word-for-word (names of degrees, certificates, papers...).
FIXED_SECTION_RE = re.compile(
    r"educat|academ|certif|licen|award|honou?r|achiev|publica|patent|language|interest|hobb|reference|contact|personal",
    re.I,
)
DATE_RE = re.compile(
    r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(19|20)\d{2}\b|\b(19|20)\d{2}\s*[-–—]\s*((19|20)\d{2}|present|current|now)\b",
    re.I,
)
CONTACT_RE = re.compile(r"@|https?://|www\.|linkedin|github\.com|\+?\d[\d ()-]{8,}\d", re.I)

# Rewrites may be a little shorter than the original, never much longer.
MIN_LENGTH_RATIO = 0.7
MAX_LENGTH_RATIO = 1.10


@dataclass
class Segment:
    id: str
    kind: str  # bullet | summary | skills | text
    section: str
    text: str  # the editable part only (no bullet sign, no "Skills:" label)
    prefix: str = ""  # text kept in front (label like "Languages:")
    editable: bool = True
    lines: int = 1
    min_chars: int = 0  # the rewrite should be at least this long (so no empty gap appears)
    max_chars: int = 0  # and at most this long (so it still fits in the same lines)

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class EditResult:
    id: str
    section: str
    kind: str
    old: str
    new: str
    status: str  # applied | too_long | too_short | changed_facts | unchanged | not_allowed
    note: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Extracted:
    file_type: str  # pdf | docx
    pages: int
    segments: list[Segment] = field(default_factory=list)
    outline: list[dict] = field(default_factory=list)  # every line in order, editable or not
    text: str = ""
    font: str = ""  # main body font (Word files: browsers need it to preview the file faithfully)

    def to_dict(self) -> dict:
        return {
            "file_type": self.file_type,
            "pages": self.pages,
            "segments": [s.to_dict() for s in self.segments],
            "outline": self.outline,
            "text": self.text,
        }


def clean(text: str) -> str:
    return " ".join((text or "").split())


def strip_bullet(text: str) -> tuple[str, str]:
    """'•  Built X' -> ('•  ', 'Built X')"""
    m = BULLET_RE.match(text)
    if not m:
        return "", text
    return text[: m.end()], text[m.end() :]


def looks_like_heading(text: str, bold: bool, size: float, body_size: float) -> bool:
    t = clean(text).rstrip(":")
    if not t or len(t) > 45 or BULLET_RE.match(t):
        return False
    if DATE_RE.search(t) or CONTACT_RE.search(t):
        return False
    letters = [c for c in t if c.isalpha()]
    if not letters:
        return False
    upper = sum(c.isupper() for c in letters) / len(letters) > 0.85
    return (upper and len(t.split()) <= 6) or (bold and size >= body_size + 1.2 and len(t.split()) <= 5)


def classify(text: str, *, is_bullet: bool, section: str, bold: bool, words_min: int = 12) -> tuple[str, bool]:
    """Decide what kind of segment this is and whether the AI may rewrite it."""
    fixed_section = bool(FIXED_SECTION_RE.search(section))
    t = clean(text)
    if is_bullet:
        return "bullet", not fixed_section and len(t.split()) >= 4
    if re.search(r"summary|profile|objective|about", section, re.I) and len(t.split()) >= 8:
        return "summary", True
    if CONTACT_RE.search(t) or (DATE_RE.search(t) and len(t.split()) < 14):
        return "text", False
    parts = [p for p in re.split(r"\s[·•|]\s", t) if p.strip()]
    if len(parts) >= 3 and sum(len(p.split()) for p in parts) / len(parts) <= 4:
        return "text", False  # a list of names (tools, certificates): keep word-for-word
    if not bold and not fixed_section and len(t.split()) >= words_min:
        return "text", True
    return "text", False


def normalize_ai_text(text: str) -> str:
    """Tidy AI output so it drops cleanly into a resume line."""
    t = clean(text).strip().strip('"').strip()
    t = re.sub(r"^\s*[-•*]\s+", "", t)
    t = t.replace("**", "")
    return t


NUMBER_RE = re.compile(r"\d+(?:[.,]\d+)*")


def numbers(text: str) -> set[str]:
    return {m.group(0).replace(",", "") for m in NUMBER_RE.finditer(text or "")}


def check_rewrite(old: str, new: str, whole_resume: str) -> tuple[str, str] | None:
    """Honesty and size checks for one rewrite. Returns (status, note) when it must be refused."""
    missing = sorted(numbers(old) - numbers(new))
    if missing:
        return "changed_facts", f"Kept the original: the new text dropped {', '.join(missing[:3])}."
    added = sorted(numbers(new) - numbers(whole_resume))
    if added:
        note = f"Kept the original: the new text added {', '.join(added[:3])}, which is not in your resume."
        return "changed_facts", note
    return length_problem(old, new)


def length_problem(old: str, new: str) -> tuple[str, str] | None:
    """Rewrites replace text, they never add to it. Returns (status, note) when the length is off."""
    o, n = len(clean(old)), len(clean(new))
    if n > o * MAX_LENGTH_RATIO + 4:
        return "too_long", "Kept the original: the new text was longer than the old one."
    if n < o * MIN_LENGTH_RATIO:
        return "too_short", "Kept the original: the new text dropped too much."
    return None


def to_winansi(text: str) -> str:
    """Characters the standard PDF fonts can draw."""
    table = {
        "→": "->",
        "←": "<-",
        "≤": "<=",
        "≥": ">=",
        "≈": "~",
        "×": "x",
        "−": "-",
        "‑": "-",
        " ": " ",
        " ": " ",
        " ": " ",
    }
    out = []
    for ch in text:
        ch = table.get(ch, ch)
        try:
            ch.encode("cp1252")
            out.append(ch)
        except UnicodeEncodeError:
            out.append("?")
    return "".join(out)

"""Edit the text of an uploaded PDF resume in place, keeping every other pixel where it was.

How it works:
1. Read every character with its font, size, colour and position (PyMuPDF "rawdict").
2. Group lines into blocks: a bullet and its wrapped lines, a paragraph, a "Label: a, b" line, a title.
3. To change a block we remove only its old characters (a redaction limited to them) and draw the new
   words on the same baselines, from the same start positions, in the same size and colour. The bullet
   sign and a bold "Label:" stay untouched.
4. Text that needs more lines than the block has (even at 92% size) is refused, so nothing else on the
   page ever moves. Shorter text is fine.
"""

import logging
import math
import re
import statistics
from collections import Counter
from dataclasses import dataclass, field

import pymupdf

from .fonts import google_font

log = logging.getLogger("resume.pdf_edit")

# Last group: Word's Symbol / Wingdings bullets, which come out as private-use characters.
BULLET_CHARS = "•●▪◦‣∙·■□►▸▹➢➤✓✔○◆◇⁃"
BULLET_RE = re.compile(rf"^\s*([{re.escape(BULLET_CHARS)}]|[-–—*](?=\s))\s*")
DATE_RE = re.compile(
    r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(19|20)\d{2}\b"
    r"|\b(19|20)\d{2}\s*[-–—]\s*((19|20)\d{2}|present|current|now)\b",
    re.I,
)
CONTACT_RE = re.compile(r"@|https?://|www\.|linkedin|github\.com|\+?\d[\d ()-]{8,}\d", re.I)
FONT_SCALES = (1.0, 0.97, 0.94, 0.92)
SERIF_RE = re.compile(
    r"times|georgia|garamond|cambria|book|serif|minion|palatino|caslon|baskerville|didot|merriweather|lora|roman|"
    r"cmr|lmr|charter|bodoni|constantia|tinos|gelasio|caladea",
    re.I,
)
MONO_RE = re.compile(r"courier|mono|consolas|menlo|inconsolata|cousine", re.I)


def clean(text: str) -> str:
    return " ".join((text or "").split())


def to_winansi(text: str) -> str:
    """Characters the built-in PDF fonts can draw."""
    table = {"→": "->", "←": "<-", "≤": "<=", "≥": ">=", "≈": "~", "×": "x", "−": "-", "‑": "-"}
    out = []
    for ch in text:
        ch = table.get(ch, ch)
        try:
            ch.encode("cp1252")
            out.append(ch)
        except UnicodeEncodeError:
            out.append("?")
    return "".join(out)


def looks_like_heading(text: str, bold: bool, size: float, body_size: float) -> bool:
    t = clean(text).rstrip(":")
    if not t or len(t) > 45 or BULLET_RE.match(t) or DATE_RE.search(t) or CONTACT_RE.search(t):
        return False
    letters = [c for c in t if c.isalpha()]
    if not letters:
        return False
    upper = sum(c.isupper() for c in letters) / len(letters) > 0.85
    return (upper and len(t.split()) <= 6) or (bold and size >= body_size + 1.2 and len(t.split()) <= 5)


# ---------------------------------------------------------------- reading


@dataclass
class Char:
    c: str
    x0: float
    y0: float
    x1: float
    y1: float
    ox: float  # origin (left end of the baseline)
    oy: float
    font: str
    size: float
    bold: bool
    italic: bool
    color: int

    @property
    def style(self) -> tuple:
        return (self.font, round(self.size * 2) / 2, self.bold, self.italic)


@dataclass
class Line:
    page: int
    chars: list[Char]

    @property
    def text(self) -> str:
        return "".join(c.c for c in self.chars)

    @property
    def x0(self) -> float:
        return min(c.x0 for c in self.chars)

    @property
    def x1(self) -> float:
        return max(c.x1 for c in self.chars if c.c.strip()) if self.text.strip() else self.x0

    @property
    def y0(self) -> float:
        return min(c.y0 for c in self.chars)

    @property
    def y1(self) -> float:
        return max(c.y1 for c in self.chars)

    @property
    def baseline(self) -> float:
        return Counter(round(c.oy, 1) for c in self.chars if c.c.strip()).most_common(1)[0][0]

    @property
    def size(self) -> float:
        return main_style(self.chars)[1]


@dataclass
class Group:
    page: int
    lines: list[Line]
    prefix_len: int = 0  # characters of the first line that are kept (bullet sign / label)
    is_bullet: bool = False
    id: str = ""
    kind: str = "text"  # heading | bullet | labeled | summary | text
    section: str = ""
    right: float = 0.0  # right edge text may run to
    justified: bool = False
    extra: dict = field(default_factory=dict)

    def body_chars(self, line_index: int) -> list[Char]:
        chars = self.lines[line_index].chars
        return chars[self.prefix_len :] if line_index == 0 else chars

    @property
    def prefix(self) -> str:
        return "".join(c.c for c in self.lines[0].chars[: self.prefix_len])

    @property
    def body(self) -> str:
        return clean(" ".join("".join(c.c for c in self.body_chars(i)) for i in range(len(self.lines))))

    @property
    def full_text(self) -> str:
        return clean(" ".join(line.text for line in self.lines))


def main_style(chars: list[Char]) -> tuple:
    counts = Counter(c.style for c in chars if c.c.strip())
    if not counts:
        return chars[0].style if chars else ("", 10.0, False, False)
    return counts.most_common(1)[0][0]


def main_color(chars: list[Char]) -> int:
    counts = Counter(c.color for c in chars if c.c.strip())
    return counts.most_common(1)[0][0] if counts else 0


def read_lines(doc: pymupdf.Document) -> list[Line]:
    lines: list[Line] = []
    for pno, page in enumerate(doc):
        data = page.get_text("rawdict", flags=pymupdf.TEXT_PRESERVE_WHITESPACE | pymupdf.TEXT_MEDIABOX_CLIP)
        for block in data["blocks"]:
            if block.get("type") != 0:
                continue
            for raw in block["lines"]:
                dx, dy = raw.get("dir", (1, 0))
                if abs(dx - 1) > 0.01 or abs(dy) > 0.01:
                    continue  # rotated text: leave alone
                chars: list[Char] = []
                for span in raw["spans"]:
                    font = span["font"]
                    bold = bool(span["flags"] & 16) or bool(re.search(r"bold|black|heavy|semibold|demi", font, re.I))
                    italic = bool(span["flags"] & 2) or bool(re.search(r"italic|oblique", font, re.I))
                    for ch in span["chars"]:
                        x0, y0, x1, y1 = ch["bbox"]
                        ox, oy = ch["origin"]
                        chars.append(
                            Char(ch["c"], x0, y0, x1, y1, ox, oy, font, span["size"], bold, italic, span["color"])
                        )
                if chars and "".join(c.c for c in chars).strip():
                    lines.append(Line(pno, chars))
    return _join_bullets(lines)


def _join_bullets(lines: list[Line]) -> list[Line]:
    """Word writes each bullet sign as its own piece of text beside the line: put them back together."""
    signs = set()
    for ln in lines:
        t = ln.text.strip()
        if len(t) != 1 or t not in BULLET_CHARS:
            continue
        base, end = ln.baseline, max(c.x1 for c in ln.chars if c.c.strip())
        beside = [o for o in lines if o is not ln and o.page == ln.page and abs(o.baseline - base) < 1.5]
        target = min((o for o in beside if 0 <= o.x0 - end < 40), key=lambda o: o.x0, default=None)
        if target is None:
            continue
        sign = [c for c in ln.chars if c.c.strip()]
        first = target.chars[0]
        gap = Char(" ", end, first.y0, first.x0, first.y1, end, first.oy, first.font, first.size, False, False, 0)
        target.chars = sign + [gap] + target.chars
        signs.add(id(ln))
    return [ln for ln in lines if id(ln) not in signs]


def _label_prefix(line: Line) -> int:
    """Length of a 'Label:' (or bold label followed by a wide gap) at the start of a line."""
    chars = line.chars
    n = len(chars)
    text = line.text
    i = 0
    while i < n and (chars[i].bold or not chars[i].c.strip()):
        i += 1
    if i >= n:
        return 0  # the whole line is bold: a title, not a label
    if i == 0:
        # Not bold-led; still accept a plain "Label: a, b, c" with a short label.
        m = re.match(r"^\s*([A-Z][^:•|.]{1,40}):\s+", text)
        return m.end() if m and "," in text[m.end() :] else 0
    if any(c.bold for c in chars[i:] if c.c.strip()) and not re.match(r"^[^:]{2,60}:", text):
        return 0
    label = clean("".join(c.c for c in chars[:i]))
    if not label or len(label) > 60 or i > n * 0.6:
        return 0
    last = max((k for k in range(i) if chars[k].c.strip()), default=None)
    gap = chars[i].x0 - chars[last].x1 if last is not None else 0
    spaces = sum(1 for c in chars[(last or 0) + 1 : i] if not c.c.strip())
    if label.endswith((":", "|", "-", "–")) or gap > 2 * chars[0].size or spaces >= 3:
        return i
    m = re.match(r"^\s*[^:]{2,60}:\s*", text)  # bold run ended a little after the colon
    return m.end() if m and m.end() <= i + 2 else 0


def _bullet_label(line: Line, start: int) -> int:
    """'• TensorFlow: built ...' -> the length of 'TensorFlow: ' (a bold label right after the bullet)."""
    chars = line.chars[start:]
    i = 0
    while i < len(chars) and (chars[i].bold or not chars[i].c.strip()):
        i += 1
    label = clean("".join(c.c for c in chars[:i]))
    if not label or len(label) > 50 or i >= len(chars) * 0.7:
        return 0
    if not label.endswith(":"):
        if i < len(chars) and chars[i].c == ":":
            i += 1  # \textbf{Label}: with a regular colon
        else:
            return 0
    while i < len(chars) and not chars[i].c.strip():
        i += 1
    return i


def build_groups(doc: pymupdf.Document) -> tuple[list[Group], float]:
    lines = read_lines(doc)
    if not lines:
        return [], 10.0
    body_size = Counter(round(c.size * 2) / 2 for ln in lines for c in ln.chars if c.c.strip()).most_common(1)[0][0]

    # Bold lines (a long "Role | Company" title) may run past the text column; they don't set its edge.
    regular = [ln for ln in lines if not main_style(ln.chars)[2]] or lines

    def column_right(page: int, left: float, indent: float) -> float:
        candidates = sorted(
            (
                ln.x1
                for ln in regular
                if ln.page == page
                and len(ln.text.strip()) > 25
                and (abs(ln.x0 - left) < 20 or abs(ln.x0 - indent) < 20)
            ),
            reverse=True,
        )
        if not candidates:
            return max(ln.x1 for ln in lines if ln.page == page)
        # The edge most lines reach: one line sticking out further (a wide headline) doesn't move it.
        for i, x in enumerate(candidates[:-2]):
            if x - candidates[i + 2] <= 6:
                return x
        return candidates[0]

    groups: list[Group] = []
    cur: Group | None = None
    for ln in lines:
        bullet_match = BULLET_RE.match(ln.text)
        if cur is not None and not bullet_match and _continues(cur, ln, column_right):
            cur.lines.append(ln)
            continue
        cur = Group(page=ln.page, lines=[ln], is_bullet=bool(bullet_match))
        if bullet_match:
            cur.prefix_len = bullet_match.end() + _bullet_label(ln, bullet_match.end())
        else:
            cur.prefix_len = _label_prefix(ln)
        groups.append(cur)

    section = ""
    per_page: Counter = Counter()
    for g in groups:
        first = g.lines[0]
        _font, size, bold, _italic = main_style([c for line in g.lines for c in line.chars])
        g.id = f"p{g.page}-{per_page[g.page]}"
        per_page[g.page] += 1
        text_x = g.body_chars(0)[0].ox if g.body_chars(0) else first.x0
        g.right = max(max(line.x1 for line in g.lines), column_right(g.page, first.x0, text_x))
        g.justified = len(g.lines) >= 2 and all(line.x1 >= g.right - 3 for line in g.lines[:-1])
        if len(g.lines) == 1 and not g.is_bullet and looks_like_heading(first.text, bold, size, body_size):
            g.kind = "heading"
            section = clean(first.text).rstrip(":")
        elif g.is_bullet:
            g.kind = "bullet"
        elif g.prefix_len:
            g.kind = "labeled"
        elif re.search(r"summary|profile|objective|about", section, re.I) and len(g.body.split()) >= 8:
            g.kind = "summary"
        g.section = section
    # A 2-line block whose first line happens to end near the edge isn't justified when the file's other
    # wrapped lines are ragged: decide from the whole file.
    wrapped = [line.x1 >= g.right - 1.5 for g in groups if len(g.lines) >= 2 for line in g.lines[:-1]]
    if wrapped and sum(wrapped) < 0.7 * len(wrapped):
        for g in groups:
            g.justified = False
    return groups, body_size


def _continues(cur: Group, ln: Line, column_right) -> bool:
    prev = cur.lines[-1]
    if ln.page != cur.page:
        return False
    first = cur.lines[0]
    body0 = cur.body_chars(0) or first.chars
    body_style = main_style([c for i in range(len(cur.lines)) for c in cur.body_chars(i)] or first.chars)
    line_style = main_style(ln.chars)
    if line_style[1] != body_style[1]:
        return False  # a different size -> a new paragraph
    # Bold or italic lines usually start something new; a lower-case start says it reads on (bold keywords).
    reads_on = ln.text.strip()[:1].islower() and len(prev.text.strip()) >= 40
    if line_style[2:] != body_style[2:] and not reads_on:
        return False
    if _label_prefix(ln):
        return False  # "Label: ..." always starts a new line of its own
    size = body_style[1]
    gap = ln.y0 - prev.y1
    if gap < -0.4 * size or gap > 1.0 * size:
        return False
    left, indent = first.x0, body0[0].x0
    if not (left - 3 <= ln.x0 <= max(left, indent) + 3):
        return False
    # The previous line wrapped only if this line's first word would not have fit on it.
    right = column_right(cur.page, left, indent)
    word = []
    for c in ln.chars:
        if not c.c.strip():
            if word:
                break
            continue
        word.append(c)
    first_word = (word[-1].x1 - word[0].x0) if word else 0
    if prev.x1 + 0.28 * size + first_word > right - 1 and line_style[2:] == body_style[2:]:
        return True
    # A paragraph narrower than the column (indented on the right, or cut short by a date beside it):
    # measure against its own widest line. Only for tight lines that read as a continuation.
    own_right = max(max(x.x1 for x in cur.lines), ln.x1)
    return reads_on and gap <= 0.45 * size and prev.x1 + 0.28 * size + first_word > own_right - 1


def extract(pdf_bytes: bytes) -> dict:
    """The text (for the AI) and every text block with where it sits (for clicking and editing)."""
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        groups, _ = build_groups(doc)
        blocks = []
        for g in groups:
            if not g.body:
                continue
            blocks.append(
                {
                    "id": g.id,
                    "page": g.page,
                    "kind": g.kind,
                    "section": g.section,
                    "text": g.body,
                    "prefix": clean(g.prefix),
                    "lines": [[round(v, 1) for v in (ln.x0, ln.y0, ln.x1, ln.y1)] for ln in g.lines],
                    "room": _room(g, groups),
                }
            )
        return {
            "pages": [{"width": round(p.rect.width, 2), "height": round(p.rect.height, 2)} for p in doc],
            "text": "\n".join(g.full_text for g in groups),
            "blocks": blocks,
        }
    finally:
        doc.close()


# ---------------------------------------------------------------- writing


class FontBook:
    """A font to draw new text: the file's own embedded font when it has every needed letter, else the
    same family from Google Fonts (or a twin with equal widths), else a built-in PDF font."""

    def __init__(self, doc: pymupdf.Document):
        self.embedded: dict[str, list[pymupdf.Font]] = {}
        self.base: dict[str, pymupdf.Font] = {}
        seen: set[int] = set()
        for page in doc:
            for xref, _ext, _type, basefont, *_ in page.get_fonts(full=True):
                if xref in seen:
                    continue
                seen.add(xref)
                try:
                    _name, ext, _t, buf = doc.extract_font(xref)
                    if buf and ext not in ("n/a", ""):
                        self.embedded.setdefault(basefont.split("+")[-1], []).append(pymupdf.Font(fontbuffer=buf))
                except Exception:  # unreadable embedded font: another one is used
                    continue

    def pick(self, font_name: str, bold: bool, italic: bool, text: str, sample: str) -> tuple[pymupdf.Font, bool]:
        """Returns (font, is_builtin). `sample` is text the file already drew with this font: an embedded
        font that can't find those letters has no usable character map."""
        needed = {ord(c) for c in text + sample if not c.isspace()}
        for font in self.embedded.get(font_name.split("+")[-1], []):
            if all(font.has_glyph(cp) for cp in needed):
                return font, False
        twin = google_font(font_name, bold, italic)
        if twin is not None and all(twin.has_glyph(cp) for cp in needed):
            return twin, False
        family = "mono" if MONO_RE.search(font_name) else "serif" if SERIF_RE.search(font_name) else "sans"
        code = {
            "sans": ("helv", "hebo", "heit", "hebi"),
            "serif": ("tiro", "tibo", "tiit", "tibi"),
            "mono": ("cour", "cobo", "coit", "cobi"),
        }[family][int(bold) + 2 * int(italic)]
        if code not in self.base:
            self.base[code] = pymupdf.Font(code)
        return self.base[code], True


@dataclass
class Word:
    text: str
    bold: bool = False


@dataclass
class Plan:
    group: Group
    layout: list[list[Word]]
    regular: pymupdf.Font
    strong: pymupdf.Font
    size: float
    color: int
    starts: list[float]
    right: float
    space: float


def _key(word: str) -> str:
    return re.sub(r"[^\w+#.]", "", word).strip(".").lower()


def _bold_words(g: Group) -> set[str]:
    """Words shown in bold inside a regular-weight paragraph (keywords people highlight)."""
    words: set[str] = set()
    current: list[Char] = []
    end = Char(" ", 0, 0, 0, 0, 0, 0, "", 0, False, False, 0)
    for c in [c for i in range(len(g.lines)) for c in g.body_chars(i)] + [end]:
        if c.c.strip():
            current.append(c)
            continue
        if current and all(x.bold for x in current) and (key := _key("".join(x.c for x in current))):
            words.add(key)
        current = []
    return words


def _word_gap(g: Group, size: float) -> float:
    """The space between words as the file drew it (some embedded fonts have no space letter)."""
    gaps = []
    for i in range(len(g.lines)):
        last_ink, spaced = None, False
        for c in g.body_chars(i):
            if not c.c.strip():
                spaced = True
                continue
            if last_ink is not None and (spaced or c.x0 - last_ink.x1 > 0.18 * size):
                gaps.append(c.x0 - last_ink.x1)
            last_ink, spaced = c, False
    found = [x for x in gaps if 0 < x < size]
    return statistics.median(found) if found else 0.25 * size


def _wrap(words: list[Word], width_of, space: float, starts: list[float], right: float, max_lines: int):
    out: list[list[Word]] = []
    i = 0
    while i < len(words) and len(out) < max_lines:
        width = right - starts[min(len(out), len(starts) - 1)]
        line: list[Word] = []
        used = 0.0
        while i < len(words):
            w = width_of(words[i])
            need = w if not line else used + space + w
            if need <= width + 0.01:
                line.append(words[i])
                used = need
                i += 1
            elif not line:
                return None  # a single word wider than the line
            else:
                break
        out.append(line)
    return out if i >= len(words) else None


def apply(pdf_bytes: bytes, edits: dict[str, str]) -> tuple[bytes, list[dict]]:
    """Writes {block id: new text} into the PDF. Returns the new file and one result per edit:
    status applied (with lines used) | too_long (with roughly how many characters to cut) | missing."""
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        groups, _ = build_groups(doc)
        by_id = {g.id: g for g in groups}
        fonts = FontBook(doc)
        results: list[dict] = []
        plans: dict[int, list[Plan]] = {}
        wipes: dict[int, list[Group]] = {}
        for gid, raw in edits.items():
            g = by_id.get(gid)
            new = clean(raw)
            if g is None:
                results.append({"id": gid, "status": "missing"})
            elif new == g.body:
                results.append({"id": gid, "status": "unchanged", "lines": len(g.lines), "used": len(g.lines)})
            elif not new:
                wipes.setdefault(g.page, []).append(g)  # an emptied block disappears, bullet sign too
                results.append({"id": gid, "status": "applied", "lines": len(g.lines), "used": 0})
            else:
                plan, over = _plan(g, new, fonts, groups)
                if plan is None:
                    results.append({"id": gid, "status": "too_long", "over": over, "lines": len(g.lines)})
                    continue
                results.append({"id": gid, "status": "applied", "lines": len(g.lines), "used": len(plan.layout)})
                plans.setdefault(g.page, []).append(plan)

        for pno in set(plans) | set(wipes):
            page = doc[pno]
            for g, whole in [(p.group, False) for p in plans.get(pno, [])] + [(g, True) for g in wipes.get(pno, [])]:
                for i, line in enumerate(g.lines):
                    chars = [c for c in (line.chars if whole else g.body_chars(i)) if c.c.strip()]
                    if not chars:
                        continue
                    sz, base = chars[0].size, line.baseline
                    rect = pymupdf.Rect(
                        min(c.x0 for c in chars) + 0.2,
                        base - 0.62 * sz,
                        max(c.x1 for c in chars) + 0.5,
                        base - 0.05 * sz,
                    )
                    page.add_redact_annot(rect)
            page.apply_redactions(
                images=pymupdf.PDF_REDACT_IMAGE_NONE,
                graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
                text=pymupdf.PDF_REDACT_TEXT_REMOVE,
            )
            for plan in plans.get(pno, []):
                _draw(page, plan)
        return doc.tobytes(garbage=3, deflate=True), results
    finally:
        doc.close()


def _plan(g: Group, new: str, fonts: FontBook, groups: list[Group]) -> tuple[Plan | None, int]:
    body = [c for i in range(len(g.lines)) for c in g.body_chars(i)]
    font_name, size, bold, italic = main_style(body)
    bold_keys = set() if bold else _bold_words(g)
    strong_name = Counter(c.font for c in body if c.bold and c.c.strip()).most_common(1)
    strong_name = strong_name[0][0] if strong_name else font_name
    words = [Word(w, _key(w) in bold_keys) for w in new.split()]
    sample = "".join(c.c for c in body if c.font == font_name)
    regular, builtin1 = fonts.pick(font_name, bold, italic, " ".join(w.text for w in words if not w.bold), sample)
    strong, builtin2 = fonts.pick(strong_name, True, italic, " ".join(w.text for w in words if w.bold), "")
    if builtin1 or builtin2:
        words = [Word(to_winansi(w.text), w.bold) for w in words]
    starts = [g.body_chars(i)[0].ox if g.body_chars(i) else g.lines[i].x0 for i in range(len(g.lines))]
    right = _right_limit(g, groups)
    for scale in FONT_SCALES:
        sz = size * scale
        space = regular.text_length(" ", sz) if regular.has_glyph(32) else _word_gap(g, size) * scale

        def width_of(w: Word, sz=sz) -> float:
            return (strong if w.bold else regular).text_length(w.text, sz)

        layout = _wrap(words, width_of, space, starts, right, len(g.lines))
        if layout is not None:
            return Plan(g, layout, regular, strong, sz, main_color(body), starts, right, space), 0
    # Too long: roughly how many characters to cut.
    sz = size * FONT_SCALES[-1]
    room = sum(right - x for x in starts)
    need = regular.text_length(new, sz)
    return None, max(1, round((need - room) / max(need / max(len(new), 1), 0.1)))


def _draw(page: pymupdf.Page, plan: Plan) -> None:
    g, size = plan.group, plan.size
    writer = pymupdf.TextWriter(page.rect, color=pymupdf.sRGB_to_pdf(plan.color))

    def width_of(w: Word) -> float:
        return (plan.strong if w.bold else plan.regular).text_length(w.text, size)

    for li, words in enumerate(plan.layout):
        x = plan.starts[li]
        natural = sum(width_of(w) for w in words) + plan.space * (len(words) - 1)
        avail = plan.right - x
        gap = plan.space
        if g.justified and li < len(plan.layout) - 1 and len(words) > 1 and natural >= 0.85 * avail:
            gap += (avail - natural) / (len(words) - 1)
        # Word by word: some embedded fonts have no space letter, so spaces are positions, not glyphs.
        for w in words:
            writer.append(
                (x, g.lines[li].baseline), w.text, font=plan.strong if w.bold else plan.regular, fontsize=size
            )
            x += width_of(w) + gap
    writer.write_text(page)


def _room(g: Group, groups: list[Group]) -> list[int]:
    """How many characters fill the block's lines: at least (reaching its last line) and at most."""
    starts, used = [], 0.0
    for i, line in enumerate(g.lines):
        chars = [c for c in g.body_chars(i) if c.c.strip()]
        start = chars[0].x0 if chars else line.x0
        starts.append(start)
        used += (max(c.x1 for c in chars) - start) if chars else 0
    n = len(g.body)
    per_char = used / max(n, 1) or 1
    right = _right_limit(g, groups)
    fits = [max(right - x, 0) / per_char for x in starts]
    low = math.ceil(sum(fits[:-1]) + 0.15 * fits[-1])
    high = math.floor(0.97 * sum(fits))
    return [min(low, n), max(high, n)]


def _right_limit(g: Group, groups: list[Group]) -> float:
    """Text may run to the column edge, but never into other text on the same line (e.g. a date)."""
    right = g.right
    mine = {id(line) for line in g.lines}
    for other in groups:
        if other.page != g.page:
            continue
        for line in other.lines:
            if id(line) in mine:
                continue
            for gl in g.lines:
                if abs(line.baseline - gl.baseline) < 0.5 * gl.size and line.x0 > gl.x0 + 5:
                    right = min(right, line.x0 - 4)
    return right


PAPER = {"A4": (595.28, 841.89), "Letter": (612.0, 792.0)}


def _gaps(page: pymupdf.Page) -> list[tuple[float, float]]:
    """Vertical ranges covered by text lines (a page can only be cut between them)."""
    spans = []
    for b in page.get_text("dict")["blocks"]:
        for ln in b.get("lines", []):
            if "".join(s["text"] for s in ln["spans"]).strip():
                spans.append((ln["bbox"][1], ln["bbox"][3]))
    return sorted(spans)


def _cut_below(spans: list[tuple[float, float]], start: float, limit: float) -> float:
    """The lowest y at or above `limit` that no text line crosses (falls back to `limit`)."""
    best = None
    for y in [limit] + [y1 + 1 for _y0, y1 in spans]:
        if start + 20 < y <= limit and not any(y0 < y < y1 for y0, y1 in spans):
            best = y if best is None else max(best, y)
    return best or limit


def fit_to_paper(pdf_bytes: bytes, paper: str, mode: str = "shrink") -> tuple[bytes, list[dict]]:
    """Puts the pages on A4 or Letter paper. "shrink": each page scaled down to fit one sheet.
    "pages": the text keeps its size (the width is fitted) and a tall page continues on the next sheet,
    cut between lines. Returns the file and, for each new sheet, which part of which page it shows."""
    width, height = PAPER[paper]
    src = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    out = pymupdf.open()
    sheets: list[dict] = []
    try:
        for page in src:
            w, h = page.rect.width, page.rect.height
            spans = _gaps(page)
            top_margin = spans[0][0] if spans else 0.0  # continued sheets start with the page's own top margin
            if mode == "shrink":
                scale = min(width / w, height / h)
                parts = [(0.0, h)]
            else:
                scale = min(width / w, 1.0)
                parts, start = [], 0.0
                while h - start > 1:
                    room = (height - (top_margin * scale if parts else 0)) / scale
                    if start + room >= h:
                        parts.append((start, h))
                        break
                    cut = _cut_below(spans, start, start + room)
                    parts.append((start, cut))
                    start = cut
            for k, (y0, y1) in enumerate(parts):
                top = 0.0 if k == 0 else top_margin * scale
                dx = (width - w * scale) / 2
                sheet = out.new_page(width=width, height=height)
                sheet.show_pdf_page(
                    pymupdf.Rect(dx, top, dx + w * scale, top + (y1 - y0) * scale),
                    src,
                    page.number,
                    clip=pymupdf.Rect(0, y0, w, y1),
                )
                sheets.append(
                    {
                        "page": page.number,
                        "y0": round(y0, 2),
                        "y1": round(y1, 2),
                        "scale": round(scale, 5),
                        "dx": round(dx, 2),
                        "top": round(top, 2),
                        "width": width,
                        "height": height,
                    }
                )
        return out.tobytes(garbage=3, deflate=True), sheets
    finally:
        out.close()
        src.close()

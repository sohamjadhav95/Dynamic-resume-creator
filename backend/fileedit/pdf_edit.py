"""Edit the text of a PDF resume in place, keeping every other pixel where it was.

How it works:
1. Read every character with its font, size, colour and position (PyMuPDF "rawdict").
2. Group lines into paragraphs: a bullet and its wrapped lines, the summary, a skills line.
3. To change a paragraph we remove only its old characters (a redaction limited to those
   characters) and draw the new words on the same baselines, same start positions, same font
   size and colour. The bullet sign and any "Label:" stay untouched.
4. If the new words do not fit in the same number of lines (even at 92% font size), the change
   is refused and the original stays. So the page count and layout never change.
"""

import logging
import re
from collections import Counter
from dataclasses import dataclass, field

import pymupdf

from .common import (
    BULLET_RE,
    EditResult,
    Extracted,
    Segment,
    check_rewrite,
    classify,
    clean,
    looks_like_heading,
    normalize_ai_text,
    to_winansi,
)

log = logging.getLogger("resume.pdf_edit")

FONT_SCALES = (1.0, 0.97, 0.94, 0.92)
SERIF_RE = re.compile(
    r"times|georgia|garamond|cambria|book|serif|minion|palatino|caslon|baskerville|didot|merriweather|lora|roman|cmr|lmr|charter|bodoni|constantia",
    re.I,
)
MONO_RE = re.compile(r"courier|mono|consolas|menlo|inconsolata", re.I)


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
    kind: str = "text"
    section: str = ""
    editable: bool = False
    heading: bool = False
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


# ---------------------------------------------------------------- reading


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
                        chars.append(
                            Char(
                                ch["c"],
                                x0,
                                y0,
                                x1,
                                y1,
                                ch["origin"][0],
                                ch["origin"][1],
                                font,
                                span["size"],
                                bold,
                                italic,
                                span["color"],
                            )
                        )
                if chars and "".join(c.c for c in chars).strip():
                    lines.append(Line(pno, chars))
    return lines


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
        if m and "," in text[m.end() :]:
            return m.end()
        return 0
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
    if m and m.end() <= i + 2:
        return m.end()
    return 0


def build_groups(doc: pymupdf.Document) -> tuple[list[Group], float]:
    lines = read_lines(doc)
    if not lines:
        return [], 10.0
    body_size = Counter(round(c.size * 2) / 2 for ln in lines for c in ln.chars if c.c.strip()).most_common(1)[0][0]

    def column_right(page: int, left: float, indent: float) -> float:
        candidates = [
            ln.x1
            for ln in lines
            if ln.page == page and len(ln.text.strip()) > 25 and (abs(ln.x0 - left) < 20 or abs(ln.x0 - indent) < 20)
        ]
        return max(candidates) if candidates else max(ln.x1 for ln in lines if ln.page == page)

    groups: list[Group] = []
    cur: Group | None = None
    for ln in lines:
        bullet_match = BULLET_RE.match(ln.text)
        if cur is not None and not bullet_match and _continues(cur, ln, column_right):
            cur.lines.append(ln)
            continue
        cur = Group(page=ln.page, lines=[ln], is_bullet=bool(bullet_match))
        if bullet_match:
            cur.prefix_len = bullet_match.end()
        else:
            cur.prefix_len = _label_prefix(ln)
        groups.append(cur)

    # Sections, kinds, ids and geometry
    section = ""
    per_page: Counter = Counter()
    for g in groups:
        first = g.lines[0]
        font, size, bold, _italic = main_style([c for line in g.lines for c in line.chars])
        g.id = f"p{g.page}-{per_page[g.page]}"
        per_page[g.page] += 1
        if len(g.lines) == 1 and not g.is_bullet and looks_like_heading(first.text, bold, size, body_size):
            g.heading = True
            section = clean(first.text).rstrip(":")
            g.section = section
            continue
        g.section = section
        body_chars = [c for i in range(len(g.lines)) for c in g.body_chars(i)]
        body_bold = main_style(body_chars)[2] if body_chars else bold
        if g.prefix_len and not g.is_bullet:
            g.kind = "skills" if re.search(r"skill|tech|tool|competenc|stack|expertise", section, re.I) else "labeled"
            g.editable = len(g.body.split(",")) >= 2 or len(g.body.split()) >= 3
            if re.search(r"educat|certif|award|contact", section, re.I):
                g.editable = False
        else:
            g.kind, g.editable = classify(g.body, is_bullet=g.is_bullet, section=section, bold=body_bold)
        if not g.body.strip():
            g.editable = False
        text_x = g.body_chars(0)[0].ox if g.body_chars(0) else first.x0
        g.right = max(max(line.x1 for line in g.lines), column_right(g.page, first.x0, text_x))
        g.justified = len(g.lines) >= 2 and all(line.x1 >= g.right - 3 for line in g.lines[:-1])
    return groups, body_size


def _continues(cur: Group, ln: Line, column_right) -> bool:
    prev = cur.lines[-1]
    if ln.page != cur.page:
        return False
    first = cur.lines[0]
    body0 = cur.body_chars(0) or first.chars
    body_style = main_style([c for i in range(len(cur.lines)) for c in cur.body_chars(i)] or first.chars)
    if main_style(ln.chars)[1:] != body_style[1:]:
        return False  # different size / weight / slant -> a new paragraph
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
    return prev.x1 + 0.28 * size + first_word > right - 1


def extract(pdf_bytes: bytes) -> Extracted:
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        groups, _ = build_groups(doc)
        out = Extracted(file_type="pdf", pages=doc.page_count)
        out.text = "\n".join(g.full_text for g in groups)
        for g in groups:
            out.outline.append(
                {"id": g.id, "text": g.full_text, "editable": g.editable, "kind": "heading" if g.heading else g.kind}
            )
            if g.editable:
                lo, hi = _capacity(g, groups)
                out.segments.append(
                    Segment(
                        id=g.id,
                        kind=g.kind,
                        section=g.section,
                        text=g.body,
                        prefix=clean(g.prefix),
                        lines=len(g.lines),
                        min_chars=lo,
                        max_chars=hi,
                    )
                )
        return out
    finally:
        doc.close()


def _capacity(g: Group, groups: list[Group]) -> tuple[int, int]:
    """Roughly how many characters fill the paragraph's lines: (min, max)."""
    body = [c for i in range(len(g.lines)) for c in g.body_chars(i)]
    text = g.body
    used = sum(c.x1 - c.x0 for c in body if c.c.strip()) + sum(0.28 * c.size for c in body if not c.c.strip())
    avg = used / max(len(text), 1)
    right = _right_limit(g, groups)
    starts = [g.body_chars(i)[0].ox if g.body_chars(i) else g.lines[i].x0 for i in range(len(g.lines))]
    per_line = [(right - x) / max(avg, 0.1) for x in starts]
    hi = int(sum(per_line) * 0.96)
    lo = int(sum(per_line[:-1]) + 6) if len(per_line) > 1 else int(len(text) * 0.6)
    return max(min(lo, len(text)), 10), max(hi, len(text))


# ---------------------------------------------------------------- writing


class FontBook:
    """Finds a font to draw new text: the file's own embedded font when it has every needed
    character, otherwise a standard font with matching widths (Helvetica ~ Arial, Times ~ Times New Roman)."""

    def __init__(self, doc: pymupdf.Document):
        self.doc = doc
        self.embedded: dict[str, list[pymupdf.Font]] = {}
        self.base: dict[str, pymupdf.Font] = {}
        for page in doc:
            for xref, _ext, _type, basefont, *_ in page.get_fonts(full=True):
                key = basefont.split("+")[-1]
                if any(getattr(f, "_xref", None) == xref for f in self.embedded.get(key, [])):
                    continue
                try:
                    _name, ext, _t, buf = doc.extract_font(xref)
                    if not buf or ext in ("n/a", ""):
                        continue
                    font = pymupdf.Font(fontbuffer=buf)
                    font._xref = xref  # type: ignore[attr-defined]
                    self.embedded.setdefault(key, []).append(font)
                except Exception:  # unreadable or unsupported embedded font: use a standard one
                    continue

    def pick(self, font_name: str, bold: bool, italic: bool, text: str) -> tuple[pymupdf.Font, bool]:
        """Returns (font, is_standard_font)."""
        needed = {ord(c) for c in text if not c.isspace()}
        for font in self.embedded.get(font_name, []):
            if all(font.has_glyph(cp) for cp in needed):
                return font, False
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


def _key(word: str) -> str:
    return re.sub(r"[^\w+#.]", "", word).strip(".").lower()


def _bold_words(g: Group) -> set[str]:
    """Words shown in bold inside a regular-weight paragraph (keywords people highlight)."""
    words: set[str] = set()
    current: list[Char] = []
    chars = [c for i in range(len(g.lines)) for c in g.body_chars(i)] + [
        Char(" ", 0, 0, 0, 0, 0, 0, "", 0, False, False, 0)
    ]
    for c in chars:
        if c.c.strip():
            current.append(c)
            continue
        if current and all(x.bold for x in current):
            key = _key("".join(x.c for x in current))
            if key:
                words.add(key)
        current = []
    return words


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


def apply(pdf_bytes: bytes, edits: dict[str, str]) -> tuple[bytes, list[EditResult]]:
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        groups, _ = build_groups(doc)
        whole = "\n".join(x.full_text for x in groups)
        by_id = {g.id: g for g in groups}
        fonts = FontBook(doc)
        results: list[EditResult] = []
        plans: dict[int, list[Plan]] = {}

        for seg_id, raw_text in edits.items():
            g = by_id.get(seg_id)
            new = normalize_ai_text(raw_text)
            if g is None or not g.editable:
                results.append(
                    EditResult(
                        seg_id, g.section if g else "", g.kind if g else "", g.body if g else "", new, "not_allowed"
                    )
                )
                continue
            old = g.body
            if not new or clean(new) == clean(old):
                results.append(EditResult(seg_id, g.section, g.kind, old, old, "unchanged"))
                continue
            problem = check_rewrite(old, new, whole)
            if problem:
                results.append(EditResult(seg_id, g.section, g.kind, old, new, *problem))
                continue
            plan = _plan(g, new, fonts, groups)
            if plan is None:
                results.append(
                    EditResult(
                        seg_id,
                        g.section,
                        g.kind,
                        old,
                        new,
                        "too_long",
                        "Kept the original: the new text needed an extra line.",
                    )
                )
                continue
            if len(plan.layout) < len(g.lines):
                results.append(
                    EditResult(
                        seg_id,
                        g.section,
                        g.kind,
                        old,
                        new,
                        "too_short",
                        "Kept the original: the new text was shorter and would leave an empty line.",
                    )
                )
                continue
            size = main_style([c for i in range(len(g.lines)) for c in g.body_chars(i)])[1]
            scale = plan.size / size
            note = "" if scale > 0.995 else f"Text set {round((1 - scale) * 100)}% smaller to fit the same lines."
            results.append(EditResult(seg_id, g.section, g.kind, old, new, "applied", note))
            plans.setdefault(g.page, []).append(plan)

        for pno, items in plans.items():
            page = doc[pno]
            for plan in items:
                g = plan.group
                for i in range(len(g.lines)):
                    chars = [c for c in g.body_chars(i) if c.c.strip()]
                    if not chars:
                        continue
                    sz = chars[0].size
                    base = g.lines[i].baseline
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
            for plan in items:
                _draw(page, plan)

        out = doc.tobytes(garbage=3, deflate=True)
        return out, results
    finally:
        doc.close()


def _plan(g: Group, new: str, fonts: FontBook, groups: list[Group]) -> Plan | None:
    body = [c for i in range(len(g.lines)) for c in g.body_chars(i)]
    font_name, size, bold, italic = main_style(body)
    bold_keys = set() if bold else _bold_words(g)
    bold_font_name = Counter(c.font for c in body if c.bold and c.c.strip()).most_common(1)
    bold_font_name = bold_font_name[0][0] if bold_font_name else font_name
    words = [Word(w, _key(w) in bold_keys) for w in new.split()]
    regular, std1 = fonts.pick(font_name, bold, italic, " ".join(w.text for w in words if not w.bold))
    strong, std2 = fonts.pick(bold_font_name, True, italic, " ".join(w.text for w in words if w.bold))
    if std1 or std2:
        words = [Word(to_winansi(w.text), w.bold) for w in words]
    starts = [g.body_chars(i)[0].ox if g.body_chars(i) else g.lines[i].x0 for i in range(len(g.lines))]
    right = _right_limit(g, groups)
    for scale in FONT_SCALES:
        sz = size * scale

        def width_of(w: Word, sz=sz) -> float:
            return (strong if w.bold else regular).text_length(w.text, sz)

        layout = _wrap(words, width_of, regular.text_length(" ", sz), starts, right, len(g.lines))
        if layout is not None:
            return Plan(g, layout, regular, strong, sz, main_color(body), starts, right)
    return None


def _draw(page: pymupdf.Page, plan: Plan) -> None:
    g, size = plan.group, plan.size
    writer = pymupdf.TextWriter(page.rect, color=pymupdf.sRGB_to_pdf(plan.color))
    space = plan.regular.text_length(" ", size)

    def width_of(w: Word) -> float:
        return (plan.strong if w.bold else plan.regular).text_length(w.text, size)

    for li, words in enumerate(plan.layout):
        x = plan.starts[li]
        y = g.lines[li].baseline
        natural = sum(width_of(w) for w in words) + space * (len(words) - 1)
        last = li == len(plan.layout) - 1
        avail = plan.right - x
        gap = space
        if g.justified and not last and len(words) > 1 and natural >= 0.85 * avail:
            gap = space + (avail - natural) / (len(words) - 1)
        if gap == space and not any(w.bold for w in words):
            writer.append((x, y), " ".join(w.text for w in words), font=plan.regular, fontsize=size)
            continue
        for w in words:
            writer.append((x, y), w.text, font=plan.strong if w.bold else plan.regular, fontsize=size)
            x += width_of(w) + gap
    writer.write_text(page)


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
                start = gl.x0
                if abs(line.baseline - gl.baseline) < 0.5 * gl.size and line.x0 > start + 5:
                    right = min(right, line.x0 - 4)
    return right

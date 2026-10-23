"""Measure the design of an uploaded resume so the app can draw it in the same style.

Works on any single-column resume. Returns sizes and distances in PDF points in the same shape the
web page engine uses (web/src/lib/page/layout.ts, interface Style). Anything that cannot be
measured is left out, and the engine uses its default for it.
"""

import io
import logging
import re
import statistics
import zipfile
from collections import Counter

import docx
import pymupdf

from .common import DATE_RE, clean, looks_like_heading
from .pdf_edit import MONO_RE, build_groups

log = logging.getLogger("resume.style")

SERIF_RE = re.compile(
    r"times|georgia|garamond|cambria|book|serif|minion|palatino|caslon|baskerville|didot|merriweather|lora|roman|"
    r"cmr|lmr|charter|charis|bodoni|constantia|crimson|playfair|libre ?baskerville|pt ?serif|source ?serif|"
    r"noto ?serif|droid ?serif|georgia|tinos|liberation ?serif|dejavu ?serif|century|bookman|goudy|sabon|utopia",
    re.I,
)

SANS_RE = re.compile(
    r"sans|arial|helvetica|calibri|verdana|tahoma|roboto|inter|lato|segoe|gill|futura|avenir|montserrat|"
    r"poppins|nunito|raleway|ubuntu|carlito|arimo|aptos|franklin|trebuchet|century gothic|frutiger|myriad",
    re.I,
)

# Which section a heading text belongs to (so the resume keeps its own heading words).
SECTION_RE = [
    ("summary", re.compile(r"summary|profile|about|objective", re.I)),
    ("skills", re.compile(r"skill|competenc|technolog|tools|expertise|tech stack", re.I)),
    ("experience", re.compile(r"experience|employment|work history|career", re.I)),
    ("projects", re.compile(r"project", re.I)),
    ("certifications", re.compile(r"certif|licen|achievement|award|course", re.I)),
    ("education", re.compile(r"education|academic|qualification", re.I)),
]


def _clamp(v: float, lo: float, hi: float) -> float:
    return round(max(lo, min(hi, v)), 2)


# A real contact detail (email, link, phone). "GSoC 2026 @ ML4Sci" is a headline, not an email.
CONTACT_DETAIL_RE = re.compile(r"\S+@\S+\.\w|https?://|www\.|linkedin|github\.com|\+?\d[\d ()-]{8,}\d", re.I)


def _colourful(hex6: str) -> bool:
    """True for a real colour (navy, teal, red), false for black and greys."""
    try:
        r, g, b = (int(hex6[i : i + 2], 16) for i in (0, 2, 4))
    except ValueError:
        return False
    return max(r, g, b) - min(r, g, b) > 30


def _hex(color: int) -> str:
    return f"#{color:06x}"


def _median(values: list[float], default: float) -> float:
    return statistics.median(values) if values else default


def _section_titles(headings: list[str]) -> dict[str, str]:
    titles: dict[str, str] = {}
    for text in headings:
        for key, rx in SECTION_RE:
            if rx.search(text) and key not in titles:
                titles[key] = clean(text).rstrip(":")
                break
    return titles


def _section_order(headings: list[str]) -> list[str]:
    """The sections in the file's order; headings we don't know (Volunteer, Languages) count as "custom"."""
    order: list[str] = []
    for text in headings:
        key = next((k for k, rx in SECTION_RE if rx.search(text)), "custom")
        if key not in order:
            order.append(key)
    return order


def _contact_sep(text: str) -> str | None:
    """What separates the contact details: "|", "·", "•", "–" or ","."""
    counts = Counter(ch for ch in text if ch in "|·•–,")
    if not counts:
        return None
    sep = counts.most_common(1)[0][0]
    return None if sep == "," and "@" not in text.split(",")[0] else sep


# ------------------------------------------------------------------ PDF


def detect_pdf_style(data: bytes) -> dict:
    doc = pymupdf.open(stream=data, filetype="pdf")
    try:
        page = doc[0]
        W, H = page.rect.width, page.rect.height
        all_groups, body = build_groups(doc)
        groups = [g for g in all_groups if g.page == 0]
        lines = [ln for g in groups for ln in g.lines]
        if len(lines) < 5:
            return {}

        # Fonts: serif or sans, from the spans that carry most of the text.
        families: Counter = Counter()
        span_info = page.get_text("dict")["blocks"]
        for b in span_info:
            for ln in b.get("lines", []):
                for sp in ln["spans"]:
                    n = len(sp["text"].strip())
                    if not n:
                        continue
                    name = sp["font"]
                    mono = bool(MONO_RE.search(name)) or (bool(sp["flags"] & 8) and not SANS_RE.search(name))
                    # The font's name is more reliable than its flags (some sans fonts claim to be serif).
                    serif = bool(SERIF_RE.search(name)) or (not SANS_RE.search(name) and bool(sp["flags"] & 4))
                    families["mono" if mono else "serif" if serif else "sans"] += n
        family = families.most_common(1)[0][0] if families else "sans"
        if family == "mono":
            family = "sans"

        style: dict = {"family": family, "page": "Letter" if abs(W - 612) < 10 and abs(H - 792) < 10 else "A4"}

        # Margins from where the text sits.
        lefts = sorted(ln.x0 for ln in lines)
        rights = sorted(ln.x1 for ln in lines)
        left = lefts[max(0, len(lefts) // 20)]
        right = W - rights[min(len(rights) - 1, len(rights) * 19 // 20)]
        top = min(ln.y0 for ln in lines)
        bottom_text = max(ln.y1 for ln in lines)
        # Resumes are almost always symmetric; the left edge is reliable (ragged-right text is not).
        side = left if right > left + 6 else (left + right) / 2
        top_m = top - 2
        # A page that is not full says nothing about its bottom margin: assume it matches the top.
        bottom_m = H - bottom_text if H - bottom_text < top_m else max(top_m, 24)
        style["margin"] = {
            "side": _clamp(side, 18, 90),
            "top": _clamp(top_m, 14, 90),
            "bottom": _clamp(bottom_m, 18, 60),
        }

        def size_of(g) -> float:
            sizes = Counter(round(c.size * 2) / 2 for ln in g.lines for c in ln.chars if c.c.strip())
            return sizes.most_common(1)[0][0] if sizes else body

        def is_bold(g) -> bool:
            chars = [c for ln in g.lines for c in ln.chars if c.c.strip()]
            return bool(chars) and sum(c.bold for c in chars) > 0.6 * len(chars)

        def is_italic(g) -> bool:
            chars = [c for ln in g.lines for c in ln.chars if c.c.strip()]
            return bool(chars) and sum(c.italic for c in chars) > 0.6 * len(chars)

        def color_of(g) -> int:
            cols = Counter(c.color for ln in g.lines for c in ln.chars if c.c.strip())
            return cols.most_common(1)[0][0] if cols else 0

        def baseline(g, last=False) -> float:
            return g.lines[-1 if last else 0].baseline

        # Header: the name is the biggest text near the top, then contact / tagline lines.
        top_groups = [g for g in groups[:8] if g.lines[0].y0 < H * 0.3]
        name_g = max(top_groups or groups[:3], key=size_of)
        ni = groups.index(name_g)
        style["name"] = _clamp(size_of(name_g), 12, 36)
        centre = (name_g.lines[0].x0 + name_g.lines[0].x1) / 2
        style["headerAlign"] = "center" if abs(centre - W / 2) < W * 0.08 else "left"
        heading_idx = [i for i, g in enumerate(groups) if g.heading and i > ni]
        first_heading = heading_idx[0] if heading_idx else len(groups)
        header = groups[ni + 1 : first_heading]
        contact = next((g for g in header if CONTACT_DETAIL_RE.search(g.full_text)), None)
        tagline = next((g for g in header if g is not contact and not CONTACT_DETAIL_RE.search(g.full_text)), None)
        if contact:
            style["contact"] = _clamp(size_of(contact), 6, 12)
        if tagline:
            style["badge"] = _clamp(size_of(tagline), 7, 14)
            style["badgeBold"] = is_bold(tagline)
            style["badgeItalic"] = is_italic(tagline)

        # Section headings: size, case, colour, and the rule line under them.
        heads = [groups[i] for i in heading_idx]
        if heads:
            style["title"] = _clamp(_median([size_of(g) for g in heads], body + 1), 7, 18)
            style["titleBold"] = sum(is_bold(g) for g in heads) >= len(heads) / 2
            colour = Counter(color_of(g) for g in heads).most_common(1)[0][0]
            style["accent"] = _hex(colour)
            style["titleUpper"] = False  # the headings' own words are kept, with their own case
            style["titles"] = _section_titles([g.full_text for g in heads])
            below_name = all_groups[all_groups.index(name_g) + 1 :]
            style["order"] = _section_order([g.full_text for g in below_name if g.heading])
            rules = []
            for d in page.get_drawings():
                for item in d.get("items", []):
                    kind = item[0]
                    if kind == "l":
                        p1, p2 = item[1], item[2]
                        if abs(p1.y - p2.y) < 1 and abs(p2.x - p1.x) > W * 0.4:
                            rules.append((p1.y, d.get("width") or 0.75, d.get("color")))
                    elif kind == "re":
                        r = item[1]
                        if r.height < 3 and r.width > W * 0.4:
                            rules.append((r.y0 + r.height / 2, max(r.height, 0.4), d.get("fill") or d.get("color")))
            under = []
            for g in heads:
                y1 = g.lines[-1].y1
                hit = [r for r in rules if y1 - 3 <= r[0] <= y1 + 9]
                if hit:
                    under.append(hit[0])
            style["rule"] = (
                _clamp(_median([r[1] for r in under], 0.75), 0.3, 2.5) if len(under) >= len(heads) / 2 else 0
            )

        # Body text, line spacing and bullets.
        style["body"] = _clamp(body, 7, 13)
        pitches = []
        for g in groups:
            if len(g.lines) >= 2 and abs(size_of(g) - body) < 0.6:
                for a, b in zip(g.lines, g.lines[1:], strict=False):
                    pitches.append((b.baseline - a.baseline) / body)
        lh = _clamp(_median(pitches, 1.25), 1.08, 1.6)
        style["lineHeight"] = lh
        bullets = [g for g in groups if g.is_bullet]
        if bullets:
            bx = [g.lines[0].chars[0].x0 for g in bullets]
            tx = [g.body_chars(0)[0].x0 for g in bullets if g.body_chars(0)]
            style["bulletIndent"] = _clamp(_median(bx, left) - left, 0, 30)
            style["textIndent"] = _clamp(_median(tx, left + 14) - left, 6, 40)
            glyph = Counter(clean(g.prefix)[:1] for g in bullets).most_common(1)[0][0]
            style["bullet"] = {"●": "•", "▪": "•", "■": "•", "◦": "•", "": "•", "‣": "•", "·": "•"}.get(
                glyph, glyph or "•"
            )

        # Entry titles (bold lines that are not headings), tech-stack lines (italic) and skills lines.
        bold_rows = [
            g
            for g in groups
            if not g.heading and not g.is_bullet and is_bold(g) and g not in (name_g, contact, tagline)
        ]
        if bold_rows:
            style["heading"] = _clamp(_median([size_of(g) for g in bold_rows], body), 7, 14)
            style["role"] = style["heading"]
        italics = [g for g in groups if not g.heading and is_italic(g) and g is not tagline]
        if italics:
            style["stack"] = _clamp(_median([size_of(g) for g in italics], body), 6.5, 13)
        skills = [g for g in groups if g.kind == "skills"]
        if skills:
            style["skills"] = _clamp(_median([size_of(g) for g in skills], body), 7, 13)

        # Distances, converted to the engine's "gap between line boxes".
        def offset(size: float) -> float:
            pitch = size * lh
            return size * 0.86 + (pitch - size) / 2

        def tail(size: float) -> float:
            return size * lh - offset(size)

        title_size = style.get("title", body + 1)
        section, after = [], []
        for i in heading_idx:
            g = groups[i]
            if i > 0 and groups[i - 1] is not name_g and i - 1 >= first_heading:
                prev = groups[i - 1]
                d = baseline(g) - baseline(prev, last=True)
                section.append(d - tail(size_of(prev)) - offset(title_size))
            if i + 1 < len(groups):
                nxt = groups[i + 1]
                d = baseline(nxt) - baseline(g, last=True)
                rule = style.get("rule", 0)
                after.append(d - tail(title_size) - (0.6 + rule if rule else 0) - offset(size_of(nxt)))
        entry, bullet_gaps = [], []
        for a, b in zip(groups, groups[1:], strict=False):
            d = baseline(b) - baseline(a, last=True) - tail(size_of(a)) - offset(size_of(b))
            if a.is_bullet and b.is_bullet:
                bullet_gaps.append(d)
            elif a.is_bullet and b in bold_rows:
                entry.append(d)
        style["gaps"] = {
            "section": _clamp(_median(section, 8), 2, 24),
            "afterTitle": _clamp(_median(after, 3), 0, 14),
            "entry": _clamp(_median(entry, 5), 0, 16),
            "bullet": _clamp(_median(bullet_gaps, 2), 0, 8),
        }
        if heading_idx:
            last_header = groups[first_heading - 1]
            d = baseline(groups[first_heading]) - baseline(last_header, last=True)
            style["gaps"]["header"] = _clamp(d - tail(size_of(last_header)) - offset(title_size), 2, 30)
        lines_below = [g for g in header if g in (contact, tagline)]
        if lines_below:
            d = baseline(lines_below[0]) - baseline(name_g, last=True)
            style["gaps"]["name"] = _clamp(d - tail(style["name"]) - offset(size_of(lines_below[0])), 0, 14)
        if len(lines_below) == 2:
            a, b = lines_below
            d = baseline(b) - baseline(a, last=True)
            style["gaps"]["contact"] = _clamp(d - tail(size_of(a)) - offset(size_of(b)), 0, 14)
            style["badgeFirst"] = a is tagline
        style["ink"] = _hex(Counter(color_of(g) for g in groups if not g.heading).most_common(1)[0][0])
        style["pages"] = doc.page_count

        # Justified text stretches the spaces of every line but a paragraph's last; ragged text doesn't.
        def word_gaps(ln) -> list[float]:
            gaps, last_x1, spaced = [], None, False
            for c in ln.chars:
                if not c.c.strip():
                    spaced = True
                    continue
                if spaced and last_x1 is not None:
                    gaps.append((c.x0 - last_x1) / max(c.size, 1))
                last_x1, spaced = c.x1, False
            return gaps

        texts = [g for g in groups if not g.heading and abs(size_of(g) - body) < 0.6]
        natural = _median([x for g in texts for x in word_gaps(g.lines[-1])], 0.25)
        inner = [statistics.median(gs) for g in texts for ln in g.lines[:-1] if (gs := word_gaps(ln))]
        if inner:
            style["justify"] = sum(x > natural * 1.12 + 0.005 for x in inner) >= len(inner) / 2
        if contact and (sep := _contact_sep(contact.full_text)):
            style["contactSep"] = sep
        if heads and color_of(name_g) == colour and _colourful(f"{colour:06x}"):
            style["nameInAccent"] = True
        date_bold = []
        for g in groups:
            if g.heading or g.is_bullet:
                continue
            text = g.lines[0].text
            m = ([None, *DATE_RE.finditer(text)])[-1]  # the last date on the line
            if m and m.start() > 0 and len(text.rstrip()) - m.end() <= 2:
                chars = [c for c in g.lines[0].chars[m.start() : m.end()] if c.c.strip()]
                if chars:
                    date_bold.append(sum(c.bold for c in chars) > len(chars) / 2)
        if date_bold:
            style["datesBold"] = sum(date_bold) >= len(date_bold) / 2
        return style
    finally:
        doc.close()


# ------------------------------------------------------------------ Word


W_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
BULLET_GLYPHS = "•-–*>"


def _chain(style):
    seen = 0
    while style is not None and seen < 10:
        yield style
        style = style.base_style
        seen += 1


def _docx_color(par) -> str | None:
    """Most used text colour of a paragraph ("1F3A5F"), from its runs or its style."""
    counts: Counter = Counter()
    for run in par.runs:
        n = len(run.text.strip())
        if not n:
            continue
        rgb = run.font.color.rgb if run.font.color is not None else None
        if rgb is None:
            rgb = next((st.font.color.rgb for st in _chain(par.style) if st.font.color.rgb is not None), None)
        counts[str(rgb) if rgb is not None else "000000"] += n
    return counts.most_common(1)[0][0] if counts else None


def _docx_italic(par) -> bool:
    total = italic = 0
    for run in par.runs:
        n = len(run.text.strip())
        it = run.italic
        if it is None:
            it = next((st.font.italic for st in _chain(par.style) if st.font.italic is not None), False)
        total += n
        italic += n if it else 0
    return total > 0 and italic > total * 0.6


def _docx_bullet(d, par) -> dict:
    """Bullet sign and indents of a Word list paragraph, from its numbering definition."""
    ppr = par._p.pPr
    num_pr = ppr.numPr if ppr is not None and ppr.numPr is not None else None
    if num_pr is None:
        num_pr = next(
            st.element.pPr.numPr
            for st in _chain(par.style)
            if st.element.pPr is not None and st.element.pPr.numPr is not None
        )
    ilvl = num_pr.ilvl.val if num_pr.ilvl is not None else 0
    numbering = d.part.numbering_part.element
    abstract_id = numbering.num_having_numId(num_pr.numId.val).abstractNumId.val
    lvl = numbering.xpath(f'./w:abstractNum[@w:abstractNumId="{abstract_id}"]/w:lvl[@w:ilvl="{ilvl}"]')[0]
    text = lvl.find(f"{W_NS}lvlText")
    glyph = (text.get(f"{W_NS}val") if text is not None else None) or "•"
    out: dict = {"bullet": glyph if glyph in BULLET_GLYPHS else "•"}
    ind = lvl.find(f"{W_NS}pPr/{W_NS}ind")
    if ind is not None:
        left = int(ind.get(f"{W_NS}left") or ind.get(f"{W_NS}start") or 0) / 20
        hanging = int(ind.get(f"{W_NS}hanging") or 0) / 20
        if par.paragraph_format.left_indent is not None:
            left = par.paragraph_format.left_indent.pt
        out["bulletIndent"] = _clamp(left - hanging, 0, 30)
        out["textIndent"] = _clamp(left, 6, 40)
    return out


def detect_docx_style(data: bytes) -> dict:
    from docx.text.paragraph import Paragraph

    from .docx_edit import read_paras  # local import: avoids a cycle with the editing helpers

    d = docx.Document(io.BytesIO(data))
    sec = d.sections[0]
    pt = 12700  # EMU per point
    style: dict = {}
    width, height = sec.page_width / pt, sec.page_height / pt
    style["page"] = "Letter" if abs(width - 612) < 10 and abs(height - 792) < 10 else "A4"
    style["margin"] = {
        "side": _clamp((sec.left_margin + sec.right_margin) / 2 / pt, 18, 90),
        "top": _clamp(sec.top_margin / pt, 14, 90),
        "bottom": _clamp(sec.bottom_margin / pt, 18, 60),
    }
    paras, body = read_paras(d)
    if not paras:
        return style
    style["body"] = _clamp(body, 7, 13)
    fonts = Counter(p.font or "" for p in paras for _ in p.text)
    main_font = fonts.most_common(1)[0][0]
    style["family"] = "serif" if SERIF_RE.search(main_font) and not SANS_RE.search(main_font) else "sans"

    # Word's "single" line height depends on the font.
    single = 1.22 if re.search(r"calibri|carlito|aptos", main_font, re.I) else 1.15
    defaults = d.styles.element.find(f"{W_NS}docDefaults/{W_NS}pPrDefault/{W_NS}pPr/{W_NS}spacing")
    default_space = {
        k: int(defaults.get(f"{W_NS}{k}")) / 20 if defaults is not None and defaults.get(f"{W_NS}{k}") else 0.0
        for k in ("before", "after")
    }
    default_line = (
        int(defaults.get(f"{W_NS}line")) / 240
        if defaults is not None and defaults.get(f"{W_NS}line") and defaults.get(f"{W_NS}lineRule", "auto") == "auto"
        else 1.0
    )
    objs = {id(p): Paragraph(p.el, d._body) for p in paras}

    def obj(p):
        return objs[id(p)]

    def line_height(p) -> float:
        par = obj(p)
        v = par.paragraph_format.line_spacing
        if v is None:
            v = next(
                (st.paragraph_format.line_spacing for st in _chain(par.style) if st.paragraph_format.line_spacing),
                None,
            )
        if isinstance(v, float) and v < 4:
            return single * v
        if v is not None and hasattr(v, "pt") and v.pt > 0:
            return v.pt / p.size
        return single * default_line

    style["lineHeight"] = _clamp(
        _median([line_height(p) for p in paras if abs(p.size - body) < 0.6], single), 1.08, 1.6
    )

    def space(p, which: str) -> float:
        par = obj(p)
        attr = f"space_{which}"
        v = getattr(par.paragraph_format, attr)
        if v is None:
            v = next(
                (
                    getattr(st.paragraph_format, attr)
                    for st in _chain(par.style)
                    if getattr(st.paragraph_format, attr) is not None
                ),
                None,
            )
        return v.pt if v is not None else default_space[which]

    def contextual(p) -> bool:
        par = obj(p)
        els = [par._p.pPr] + [st.element.pPr for st in _chain(par.style)]
        return any(e is not None and e.find(f"{W_NS}contextualSpacing") is not None for e in els)

    def gap(a, b) -> float:
        if contextual(a) and contextual(b) and obj(a).style.style_id == obj(b).style.style_id:
            return 0.0
        return space(a, "after") + space(b, "before")

    def color(p) -> str:
        return (_docx_color(obj(p)) or "000000").lower()

    # Header: the name, then the contact line and a headline line in the file's order.
    name = max(paras[:4], key=lambda p: p.size)
    ni = paras.index(name)
    style["name"] = _clamp(name.size, 12, 36)
    align = obj(name).alignment
    style["headerAlign"] = "center" if align is not None and int(align) == 1 else "left"
    heads = [p for p in paras if p is not name and not p.is_bullet and looks_like_heading(p.text, p.bold, p.size, body)]
    first_head = paras.index(heads[0]) if heads else len(paras)
    header = paras[ni + 1 : first_head]
    contact = next((p for p in header if CONTACT_DETAIL_RE.search(p.text)), None)
    tagline = next((p for p in header if p is not contact and not CONTACT_DETAIL_RE.search(p.text)), None)
    if contact:
        style["contact"] = _clamp(contact.size, 6, 12)
    if tagline:
        style["badge"] = _clamp(tagline.size, 7, 14)
        style["badgeBold"] = tagline.bold
        style["badgeItalic"] = _docx_italic(obj(tagline))
        if contact and header.index(tagline) < header.index(contact):
            style["badgeFirst"] = True

    # Section headings: size, weight, colour, border line, and their own words.
    if heads:
        style["title"] = _clamp(_median([p.size for p in heads], body + 1), 7, 18)
        style["titleBold"] = sum(p.bold for p in heads) >= len(heads) / 2
        style["titleUpper"] = False
        style["titles"] = _section_titles([p.text for p in heads])
        style["order"] = _section_order([p.text for p in heads])
        accent = Counter(color(p) for p in heads).most_common(1)[0][0]
        style["accent"] = f"#{accent}"
        borders = [p.el.find(f".//{W_NS}pBdr/{W_NS}bottom") for p in heads]
        sizes = [int(b.get(f"{W_NS}sz") or 6) / 8 for b in borders if b is not None]
        style["rule"] = _clamp(_median(sizes, 0.75), 0.3, 2.5) if len(sizes) >= len(heads) / 2 else 0
        if color(name) == accent and _colourful(accent):
            style["nameInAccent"] = True
    ink = Counter(color(p) for p in paras if p not in heads and p is not name).most_common(1)
    if ink and re.fullmatch(r"[0-9a-f]{6}", ink[0][0]):
        style["ink"] = f"#{ink[0][0]}"
    if contact and (sep := _contact_sep(contact.text)):
        style["contactSep"] = sep
    body_paras = [p for p in paras if not p.is_bullet and p not in heads and len(p.text) > 120]
    bullets_long = [p for p in paras if p.is_bullet and len(p.text) > 100]
    long_paras = body_paras + bullets_long
    if long_paras:
        justified = sum(obj(p).alignment is not None and int(obj(p).alignment) == 3 for p in long_paras)
        style["justify"] = justified >= len(long_paras) / 2
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            m = re.search(r"<Pages>(\d+)</Pages>", z.read("docProps/app.xml").decode("utf-8", "ignore"))
        if m:
            style["pages"] = int(m.group(1))
    except (KeyError, zipfile.BadZipFile):
        pass

    # Entry title rows ("Job title — Company <tab> 2021 – Present") and whether their dates are bold.
    rows = [
        p
        for p in paras
        if not p.is_bullet and p not in heads and p is not name
        if (p.bold or "\t" in p.text) and DATE_RE.search(p.text)
    ]
    rows += [p for p in paras if "\t" in p.text and not p.is_bullet and p not in heads + rows and p.atoms[0].bold]
    if rows:
        style["heading"] = _clamp(_median([p.size for p in rows], body), 7, 14)
        style["role"] = style["heading"]
        date_bold = []
        for p in rows:
            tabs = [i for i, a in enumerate(p.atoms) if a.kind == "tab"]
            after = [a for a in p.atoms[tabs[-1] + 1 :] if a.text.strip()] if tabs else []
            if after:
                date_bold.append(all(a.bold for a in after))
        if date_bold:
            style["datesBold"] = sum(date_bold) >= len(date_bold) / 2

    bullets = [p for p in paras if p.is_bullet]
    if bullets:
        try:
            style.update(_docx_bullet(d, obj(bullets[0])))
        except Exception:  # unusual numbering: keep the plain bullet
            style["bullet"] = "•"

    # Distances between paragraphs (Word adds one paragraph's "space after" to the next one's "space before").
    at = {id(p): i for i, p in enumerate(paras)}
    section = [gap(paras[at[id(h)] - 1], h) for h in heads[1:]]
    after = [gap(h, paras[at[id(h)] + 1]) for h in heads if at[id(h)] + 1 < len(paras)]
    pairs = list(zip(paras, paras[1:], strict=False))
    gaps = {
        "section": _clamp(_median(section, 8), 2, 24),
        "afterTitle": _clamp(_median(after, 3), 0, 14),
        "entry": _clamp(_median([gap(a, b) for a, b in pairs if a.is_bullet and b in rows], 5), 0, 16),
        "bullet": _clamp(_median([gap(a, b) for a, b in pairs if a.is_bullet and b.is_bullet], 1), 0, 8),
    }
    if header:
        gaps["name"] = _clamp(gap(name, header[0]), 0, 14)
        gaps["header"] = _clamp(gap(header[-1], heads[0]) if heads else 8, 2, 30)
    if len(header) > 1:
        gaps["contact"] = _clamp(gap(header[0], header[1]), 0, 14)
    style["gaps"] = gaps
    return style


def detect_style(file_type: str, data: bytes) -> dict:
    """Never fails: an unusual file just gets the default style."""
    try:
        return detect_pdf_style(data) if file_type == "pdf" else detect_docx_style(data)
    except Exception as exc:  # odd files: fall back to the default look
        log.warning("style.detect_failed type=%s error=%r", file_type, exc)
        return {}

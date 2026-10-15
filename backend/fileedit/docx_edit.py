"""Edit the text of a Word (.docx) resume in place, keeping every style, font and spacing.

We only change the characters inside existing runs: the paragraph, its numbering/bullet, its
indents and the formatting of the first text run all stay. A "Label:" in front (bold skill group
names) is kept. Words that were bold in the old text stay bold in the new text.

Word re-flows text when it opens the file, so we estimate line counts with font metrics and refuse
any rewrite that would need more lines than the original (that is what pushes a resume to page 2).
"""

import copy
import io
import re
from collections import Counter
from dataclasses import dataclass

import docx
import pymupdf
from docx.oxml.ns import qn

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
)
from .pdf_edit import SERIF_RE

XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"
SAFETY = 0.97  # new text may use 97% of the measured line width (Word's metrics differ slightly)


@dataclass
class Atom:
    kind: str  # t | tab | br
    el: object
    text: str
    run: object
    bold: bool


@dataclass
class Para:
    index: int
    el: object
    atoms: list[Atom]
    prefix_len: int
    is_bullet: bool
    size: float
    font: str
    bold: bool
    width: float  # available text width in points
    id: str = ""
    kind: str = "text"
    section: str = ""
    editable: bool = False
    heading: bool = False

    @property
    def text(self) -> str:
        return "".join(a.text for a in self.atoms)

    @property
    def prefix(self) -> str:
        return self.text[: self.prefix_len]

    @property
    def body(self) -> str:
        return clean(self.text[self.prefix_len :])


# ---------------------------------------------------------------- style lookups


def _on(el) -> bool:
    if el is None:
        return False
    val = el.get(qn("w:val"))
    return val not in ("0", "false", "off", "none")


class Styles:
    def __init__(self, document):
        self.doc = document
        self.by_id = {s.style_id: s for s in document.styles if s.type is not None}
        defaults = document.styles.element.find(qn("w:docDefaults"))
        self.default_size = 11.0
        self.default_font = "Calibri"
        if defaults is not None:
            rpr = defaults.find(f"{qn('w:rPrDefault')}/{qn('w:rPr')}")
            if rpr is not None:
                sz = rpr.find(qn("w:sz"))
                if sz is not None and sz.get(qn("w:val")):
                    self.default_size = int(sz.get(qn("w:val"))) / 2
                fonts = rpr.find(qn("w:rFonts"))
                if fonts is not None and fonts.get(qn("w:ascii")):
                    self.default_font = fonts.get(qn("w:ascii"))

    def chain(self, style_id: str | None):
        seen = 0
        style = self.by_id.get(style_id) if style_id else self.by_id.get("Normal")
        while style is not None and seen < 10:
            yield style
            style = style.base_style
            seen += 1

    def para_style_id(self, p) -> str | None:
        ppr = p.find(qn("w:pPr"))
        ps = ppr.find(qn("w:pStyle")) if ppr is not None else None
        return ps.get(qn("w:val")) if ps is not None else None

    def run_props(self, run, p) -> tuple[float, str, bool]:
        size = font = bold = None
        rpr = run.find(qn("w:rPr")) if run is not None else None
        if rpr is not None:
            sz = rpr.find(qn("w:sz"))
            if sz is not None and sz.get(qn("w:val")):
                size = int(sz.get(qn("w:val"))) / 2
            rf = rpr.find(qn("w:rFonts"))
            if rf is not None:
                font = rf.get(qn("w:ascii")) or rf.get(qn("w:hAnsi"))
            b = rpr.find(qn("w:b"))
            if b is not None:
                bold = _on(b)
            rstyle = rpr.find(qn("w:rStyle"))
            if rstyle is not None:
                for st in self.chain(rstyle.get(qn("w:val"))):
                    size = size or (st.font.size.pt if st.font.size else None)
                    font = font or st.font.name
                    if bold is None and st.font.bold is not None:
                        bold = st.font.bold
        for st in self.chain(self.para_style_id(p)):
            f = getattr(st, "font", None)
            if f is None:
                continue
            size = size or (f.size.pt if f.size else None)
            font = font or f.name
            if bold is None and f.bold is not None:
                bold = f.bold
        return size or self.default_size, font or self.default_font, bool(bold)

    def is_list(self, p) -> bool:
        ppr = p.find(qn("w:pPr"))
        if ppr is not None and ppr.find(qn("w:numPr")) is not None:
            num = ppr.find(qn("w:numPr")).find(qn("w:numId"))
            return num is None or num.get(qn("w:val")) != "0"
        for st in self.chain(self.para_style_id(p)):
            sppr = st.element.find(qn("w:pPr"))
            if sppr is not None and sppr.find(qn("w:numPr")) is not None:
                return True
        return False

    def is_heading_style(self, p) -> bool:
        return any(re.match(r"heading|title", st.name or "", re.I) for st in self.chain(self.para_style_id(p)))


def _twips(el, attr: str) -> float:
    if el is None:
        return 0.0
    for name in (attr, attr.replace("left", "start").replace("right", "end")):
        v = el.get(qn(f"w:{name}"))
        if v and re.fullmatch(r"-?\d+", v):
            return int(v) / 20
    return 0.0


# ---------------------------------------------------------------- reading


def _atoms(p, styles: Styles) -> list[Atom]:
    out: list[Atom] = []
    for el in p.iter():
        tag = el.tag
        if tag not in (qn("w:t"), qn("w:tab"), qn("w:br"), qn("w:cr"), qn("w:noBreakHyphen")):
            continue
        run = el.getparent()
        if run is None or run.tag != qn("w:r"):
            continue  # e.g. <w:tabs> inside paragraph properties
        if any(a.tag in (qn("w:del"), qn("w:moveFrom")) for a in el.iterancestors()):
            continue
        _, _, bold = styles.run_props(run, p)
        if tag == qn("w:t"):
            out.append(Atom("t", el, el.text or "", run, bold))
        elif tag == qn("w:tab"):
            out.append(Atom("tab", el, "\t", run, bold))
        elif tag == qn("w:noBreakHyphen"):
            out.append(Atom("tab", el, "-", run, bold))
        else:
            out.append(Atom("br", el, " ", run, bold))
    return out


def _text_width(document, p) -> float:
    section = document.sections[-1]
    width = (section.page_width - section.left_margin - section.right_margin) / 12700  # EMU -> pt
    tc = next((a for a in p.iterancestors() if a.tag == qn("w:tc")), None)
    if tc is not None:
        tcw = tc.find(f"{qn('w:tcPr')}/{qn('w:tcW')}")
        if tcw is not None and tcw.get(qn("w:type")) in (None, "dxa") and (tcw.get(qn("w:w")) or "").isdigit():
            width = int(tcw.get(qn("w:w"))) / 20 - 10
    ppr = p.find(qn("w:pPr"))
    ind = ppr.find(qn("w:ind")) if ppr is not None else None
    width -= _twips(ind, "left") + _twips(ind, "right")
    return max(width, 72.0)


def _label_len(atoms: list[Atom], text: str) -> int:
    """'Languages: Python, SQL' -> length of 'Languages: ' when the label is bold and the rest is not."""
    pos = 0
    i = 0
    while i < len(atoms) and (atoms[i].bold or not atoms[i].text.strip()):
        pos += len(atoms[i].text)
        i += 1
    if i == 0 or i >= len(atoms):
        m = re.match(r"^\s*([A-Z][^:•|.]{1,40}):\s+", text)
        return m.end() if m and "," in text[m.end() :] else 0
    if any(a.bold for a in atoms[i:] if a.text.strip()):
        return 0
    label = clean(text[:pos])
    if not label or len(label) > 60:
        return 0
    if label.endswith((":", "|", "-", "–")) or "\t" in text[:pos] or "   " in text[:pos]:
        return pos
    m = re.match(r"^\s*[^:]{2,60}:\s*", text)
    return m.end() if m and m.end() <= pos + 2 else 0


def read_paras(document) -> tuple[list[Para], float]:
    styles = Styles(document)
    paras: list[Para] = []
    body = document.element.body
    for idx, p in enumerate(body.iter(qn("w:p"))):
        atoms = _atoms(p, styles)
        text = "".join(a.text for a in atoms)
        if not text.strip():
            continue
        first_run = next((a.run for a in atoms if a.text.strip()), None)
        sizes = Counter()
        fonts = Counter()
        bold_chars = 0
        for a in atoms:
            size, font, bold = styles.run_props(a.run, p)
            n = len(a.text.strip())
            sizes[size] += n
            fonts[font] += n
            bold_chars += n if bold else 0
        size = sizes.most_common(1)[0][0] if sizes else styles.default_size
        font = fonts.most_common(1)[0][0] if fonts else styles.default_font
        total = sum(len(a.text.strip()) for a in atoms) or 1
        is_list = styles.is_list(p)
        m = BULLET_RE.match(text)
        prefix = m.end() if m else 0
        is_bullet = is_list or bool(m)
        if not is_bullet:
            prefix = _label_len(atoms, text)
        para = Para(
            index=idx,
            el=p,
            atoms=atoms,
            prefix_len=prefix,
            is_bullet=is_bullet,
            size=size,
            font=font,
            bold=bold_chars / total > 0.6,
            width=_text_width(document, p),
        )
        para.heading = styles.is_heading_style(p) and not is_bullet
        _ = first_run
        paras.append(para)
    body_size = Counter()
    for para in paras:
        body_size[para.size] += len(para.text)
    return paras, (body_size.most_common(1)[0][0] if body_size else 11.0)


def _classify_all(paras: list[Para], body_size: float) -> None:
    section = ""
    for para in paras:
        para.id = f"d{para.index}"
        if para.heading or (
            not para.is_bullet
            and not para.prefix_len
            and looks_like_heading(para.text, para.bold, para.size, body_size)
        ):
            para.heading = True
            section = clean(para.text).rstrip(":")
            para.section = section
            continue
        para.section = section
        if para.prefix_len and not para.is_bullet:
            para.kind = (
                "skills" if re.search(r"skill|tech|tool|competenc|stack|expertise", section, re.I) else "labeled"
            )
            para.editable = (len(para.body.split(",")) >= 2 or len(para.body.split()) >= 3) and not re.search(
                r"educat|certif|award|contact", section, re.I
            )
        else:
            body_atoms = para.atoms
            bold = sum(len(a.text) for a in body_atoms if a.bold) > 0.6 * max(len(para.text), 1)
            para.kind, para.editable = classify(para.body, is_bullet=para.is_bullet, section=section, bold=bold)
        if "\t" in para.text[para.prefix_len :].strip():
            para.editable = False  # tab-aligned columns (title <tab> date): leave alone


# ---------------------------------------------------------------- line estimates


def _measure_font(name: str, bold: bool) -> pymupdf.Font:
    serif = bool(SERIF_RE.search(name or ""))
    return pymupdf.Font(("tibo" if bold else "tiro") if serif else ("hebo" if bold else "helv"))


def _lines_needed(text: str, font: pymupdf.Font, size: float, width: float) -> int:
    words = text.replace("\t", "    ").split()
    if not words:
        return 1
    space = font.text_length(" ", size)
    lines, used = 1, 0.0
    for w in words:
        wl = font.text_length(w, size)
        need = wl if used == 0 else used + space + wl
        if need <= width:
            used = need
        else:
            lines += 1
            used = wl
    return lines


def _capacity(para: Para) -> tuple[int, int, int]:
    """(lines, min_chars, max_chars) for the editable part of a paragraph."""
    font = _measure_font(para.font, False)
    full = clean(para.text)
    lines = _lines_needed(full, font, para.size, para.width)
    avg = font.text_length(full, para.size) / max(len(full), 1)
    per_line = para.width / max(avg, 0.1)
    prefix = len(clean(para.prefix)) + (1 if para.prefix else 0)
    max_chars = int(per_line * lines * SAFETY) - prefix
    min_chars = int(per_line * (lines - 1)) - prefix + 6 if lines > 1 else int(len(para.body) * 0.6)
    return lines, max(min(min_chars, len(para.body)), 10), max(max_chars, len(para.body))


def extract(docx_bytes: bytes) -> Extracted:
    document = docx.Document(io.BytesIO(docx_bytes))
    paras, body_size = read_paras(document)
    _classify_all(paras, body_size)
    out = Extracted(file_type="docx", pages=1)
    out.text = "\n".join(clean(p.text) for p in paras)
    fonts: Counter = Counter()
    for para in paras:
        fonts[para.font] += len(para.text)
    out.font = fonts.most_common(1)[0][0] if fonts else ""
    for para in paras:
        out.outline.append(
            {
                "id": para.id,
                "text": clean(para.text),
                "editable": para.editable,
                "kind": "heading" if para.heading else para.kind,
            }
        )
        if para.editable:
            lines, lo, hi = _capacity(para)
            out.segments.append(
                Segment(
                    id=para.id,
                    kind=para.kind,
                    section=para.section,
                    text=para.body,
                    prefix=clean(para.prefix),
                    lines=lines,
                    min_chars=lo,
                    max_chars=hi,
                )
            )
    return out


# ---------------------------------------------------------------- writing


def _key(word: str) -> str:
    return re.sub(r"[^\w+#.]", "", word).strip(".").lower()


def _set_text(t_el, text: str) -> None:
    t_el.text = text
    if text != text.strip():
        t_el.set(XML_SPACE, "preserve")


def _write(para: Para, new: str) -> None:
    """Replace the editable part of a paragraph, keeping run formatting."""
    pos = 0
    body_atoms: list[tuple[Atom, int]] = []  # (atom, chars of this atom that belong to the prefix)
    for a in para.atoms:
        end = pos + len(a.text)
        if end > para.prefix_len:
            body_atoms.append((a, max(0, para.prefix_len - pos)))
        pos = end
    first_t = next(((a, keep) for a, keep in body_atoms if a.kind == "t" and a.text[keep:].strip()), None)
    if first_t is None:
        return
    template_regular = first_t[0].run
    old_bold = {_key(w) for a, _ in body_atoms if a.bold and a.kind == "t" for w in a.text.split()}
    template_bold = next((a.run for a, _ in body_atoms if a.bold and a.kind == "t" and a.text.strip()), None)
    if para.bold:  # whole paragraph bold: no keyword highlighting to preserve
        old_bold, template_bold = set(), None

    # 1) clear the old body text
    for a, keep in body_atoms:
        if a.kind == "t":
            _set_text(a.el, a.text[:keep])
        elif keep == 0:
            parent = a.el.getparent()
            if parent is not None:
                parent.remove(a.el)

    # 2) build the new runs right after the first body run
    chunks: list[tuple[str, bool]] = []
    for i, word in enumerate(new.split()):
        bold = template_bold is not None and _key(word) in old_bold
        piece = (" " if i else "") + word
        if chunks and chunks[-1][1] == bold:
            chunks[-1] = (chunks[-1][0] + piece, bold)
        else:
            chunks.append((piece, bold))
    if para.prefix_len and not para.text[: para.prefix_len].endswith((" ", "\t")) and chunks:
        chunks[0] = (" " + chunks[0][0].lstrip(), chunks[0][1])

    anchor = template_regular
    first_atom, keep = first_t
    if keep == 0 and not chunks[0][1]:
        _set_text(first_atom.el, chunks[0][0])
        chunks = chunks[1:]
    for text, bold in chunks:
        template = template_bold if bold else template_regular
        run = copy.deepcopy(template)
        for child in list(run):
            if child.tag != qn("w:rPr"):
                run.remove(child)
        t = run.makeelement(qn("w:t"), {})
        _set_text(t, text)
        run.append(t)
        anchor.addnext(run)
        anchor = run


def apply(docx_bytes: bytes, edits: dict[str, str]) -> tuple[bytes, list[EditResult]]:
    document = docx.Document(io.BytesIO(docx_bytes))
    paras, body_size = read_paras(document)
    _classify_all(paras, body_size)
    whole = "\n".join(x.text for x in paras)
    by_id = {p.id: p for p in paras}
    results: list[EditResult] = []
    for seg_id, raw in edits.items():
        para = by_id.get(seg_id)
        new = normalize_ai_text(raw)
        if para is None or not para.editable:
            results.append(EditResult(seg_id, "", "", para.body if para else "", new, "not_allowed"))
            continue
        old = para.body
        if not new or clean(new) == old:
            results.append(EditResult(seg_id, para.section, para.kind, old, old, "unchanged"))
            continue
        problem = check_rewrite(old, new, whole)
        if problem:
            results.append(EditResult(seg_id, para.section, para.kind, old, new, *problem))
            continue
        font = _measure_font(para.font, False)
        before = _lines_needed(clean(para.text), font, para.size, para.width)
        after = _lines_needed(clean(para.prefix + " " + new), font, para.size, para.width * SAFETY)
        if after > before:
            results.append(
                EditResult(
                    seg_id,
                    para.section,
                    para.kind,
                    old,
                    new,
                    "too_long",
                    "Kept the original: the new text needed an extra line.",
                )
            )
            continue
        _write(para, new)
        results.append(EditResult(seg_id, para.section, para.kind, old, new, "applied"))
    out = io.BytesIO()
    document.save(out)
    return out.getvalue(), results

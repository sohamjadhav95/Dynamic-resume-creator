"""Find a real font file for text we write into an uploaded PDF.

PDFs usually embed only the letters they use, so a new word may need a letter the file doesn't have.
Then we use the same family from Google Fonts (most resume fonts are there: Lato, Roboto, Open Sans...),
or a free twin with the same letter widths for Microsoft fonts (Calibri -> Carlito, Arial -> Arimo).
Downloaded fonts are cached in memory and in the temp folder. Returns None when nothing matches;
the caller then uses a built-in PDF font.
"""

import logging
import re
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path

import pymupdf

log = logging.getLogger("resume.fonts")

# Free fonts with the same widths as common Microsoft fonts (so lines break the same way).
TWINS = {
    "arial": "Arimo",
    "arialmt": "Arimo",
    "calibri": "Carlito",
    "cambria": "Caladea",
    "timesnewroman": "Tinos",
    "timesnewromanps": "Tinos",
    "times": "Tinos",
    "georgia": "Gelasio",
    "garamond": "EB Garamond",
    "couriernew": "Cousine",
    "helvetica": "Arimo",
    "helveticaneue": "Arimo",
    "liberationsans": "Arimo",
    "liberationserif": "Tinos",
}
WEIGHTS = [
    ("hairline", 100),
    ("thin", 100),
    ("extralight", 200),
    ("ultralight", 200),
    ("semibold", 600),
    ("demibold", 600),
    ("extrabold", 800),
    ("ultrabold", 800),
    ("light", 300),
    ("medium", 500),
    ("bold", 700),
    ("black", 900),
    ("heavy", 900),
]
CACHE = Path(tempfile.gettempdir()) / "tailor-fonts"
_loaded: dict[str, pymupdf.Font | None] = {}


def describe(pdf_font: str, bold: bool, italic: bool) -> tuple[str, int, bool]:
    """'ABCDEF+Lato-LightItalic' -> ('Lato', 300, True)."""
    name = re.sub(r"^[A-Z]{6}\+", "", pdf_font)
    base, _, style = name.partition("-")
    if not style and "," in base:
        base, _, style = base.partition(",")
    style_l = style.lower()
    weight = next((w for word, w in WEIGHTS if word in style_l), 700 if bold else 400)
    italic = italic or "italic" in style_l or "oblique" in style_l
    key = re.sub(r"(mt|ps|psmt|-?bold.*|-?italic.*)$", "", base.lower().replace(" ", ""))
    family = TWINS.get(key) or TWINS.get(base.lower().replace(" ", ""))
    if not family:
        # "SourceSansPro" -> "Source Sans Pro"
        family = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", base).strip()
    return family, weight, italic


def _download(family: str, weight: int, italic: bool) -> bytes | None:
    query = urllib.parse.quote(f"{family}:ital,wght@{int(italic)},{weight}", safe=":,@")
    req = urllib.request.Request(
        f"https://fonts.googleapis.com/css2?family={query}",
        headers={"User-Agent": "Mozilla/5.0 (Tailor resume editor)"},  # plain UA -> TrueType files
    )
    with urllib.request.urlopen(req, timeout=4) as res:  # noqa: S310 - fixed Google Fonts host
        css = res.read().decode("utf-8", "ignore")
    m = re.search(r"url\((https://fonts\.gstatic\.com/[^)]+\.ttf)\)", css)
    if not m:
        return None
    with urllib.request.urlopen(m.group(1), timeout=6) as res:  # noqa: S310 - Google's font CDN
        return res.read()


def google_font(pdf_font: str, bold: bool, italic: bool) -> pymupdf.Font | None:
    family, weight, italic = describe(pdf_font, bold, italic)
    key = f"{family}|{weight}|{int(italic)}"
    if key in _loaded:
        return _loaded[key]
    font = None
    path = CACHE / (re.sub(r"\W", "_", key) + ".ttf")
    try:
        if path.exists():
            data = path.read_bytes()
        else:
            data = _download(family, weight, italic)
            if data:
                CACHE.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
        font = pymupdf.Font(fontbuffer=data) if data else None
    except Exception as exc:  # offline, unknown family, odd file: use a built-in font instead
        log.info("fonts.unavailable family=%s weight=%s error=%r", family, weight, exc)
    _loaded[key] = font
    return font

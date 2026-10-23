"""Editing an uploaded PDF in place: only the changed text moves, nothing else on the page."""

import base64

import pymupdf
import pytest
from fastapi.testclient import TestClient

from backend import app as app_module
from backend import fileedit, limits
from backend.config import get_settings
from backend.fileedit import fonts, pdf_edit

BULLET_1 = (
    "Built a data pipeline in Python and Airflow that loads sales data from 12 stores every night, cutting report "
    "time by 40% and removing manual spreadsheet work for the finance team."
)
BULLET_2 = "Set up Docker based test servers for 3 product teams."
SKILLS = "Python, SQL, Airflow, Docker, Tableau"


def _wrap(text: str, font: pymupdf.Font, size: float, width: float) -> list[str]:
    lines, cur = [], ""
    for word in text.split():
        trial = f"{cur} {word}".strip()
        if cur and font.text_length(trial, size) > width:
            lines.append(cur)
            cur = word
        else:
            cur = trial
    return lines + [cur]


def make_pdf(width: float = 595, height: float = 842) -> bytes:
    doc = pymupdf.open()
    page = doc.new_page(width=width, height=height)
    helv = pymupdf.Font("helv")
    page.insert_text((230, 50), "Jane Doe", fontname="hebo", fontsize=18)
    page.insert_text((50, 70), "jane@example.com | github.com/jane", fontname="helv", fontsize=9)
    page.insert_text((50, 100), "EXPERIENCE", fontname="hebo", fontsize=11)
    page.insert_text((50, 116), "Data Engineer | Acme Retail", fontname="hebo", fontsize=10)
    y = 132.0
    for bullet in (BULLET_1, BULLET_2):
        page.insert_text((50, y), "•", fontname="helv", fontsize=10)
        for line in _wrap(bullet, helv, 10, 485):
            page.insert_text((60, y), line, fontname="helv", fontsize=10)
            y += 12
        y += 4
    page.insert_text((50, y + 14), "SKILLS", fontname="hebo", fontsize=11)
    label = "Languages: "
    page.insert_text((50, y + 30), label, fontname="hebo", fontsize=10)
    page.insert_text((50 + pymupdf.Font("hebo").text_length(label, 10), y + 30), SKILLS, fontname="helv", fontsize=10)
    return doc.tobytes()


def text_of(data: bytes) -> str:
    return " ".join(" ".join(p.get_text().split()) for p in pymupdf.open(stream=data))


def block(info: dict, start: str) -> dict:
    return next(b for b in info["blocks"] if b["text"].startswith(start))


@pytest.fixture(autouse=True)
def offline_fonts(monkeypatch):
    monkeypatch.setattr(pdf_edit, "google_font", lambda *a: None)  # tests never download fonts


def test_extract_lists_every_block_with_its_place():
    info = fileedit.extract(make_pdf())
    assert info["pages"] == [{"width": 595.0, "height": 842.0}]
    kinds = {b["text"][:12]: b["kind"] for b in info["blocks"]}
    assert kinds["EXPERIENCE"] == "heading" and kinds["jane@example"] == "text"
    first = block(info, "Built a data")
    assert first["kind"] == "bullet" and pdf_edit.BULLET_RE.match(first["prefix"]) and len(first["lines"]) == 2
    x0, y0, x1, y1 = first["lines"][0]
    assert 45 < x0 < 62 and y0 < y1 and x1 > 400
    skills = block(info, "Python, SQL")
    assert skills["kind"] == "labeled" and skills["prefix"] == "Languages:"
    assert "Jane Doe" in info["text"] and "EXPERIENCE" in info["text"]


def test_rewrite_is_written_in_place_and_nothing_else_moves():
    data = make_pdf()
    info = fileedit.extract(data)
    first = block(info, "Built a data")
    new = BULLET_1.replace("Built a data pipeline", "Made a sales pipeline")
    out, results = fileedit.apply(data, {first["id"]: new})
    assert results == [{"id": first["id"], "status": "applied", "lines": 2, "used": 2}]
    text = text_of(out)
    assert "Made a sales pipeline" in text and "Built a data" not in text
    assert "Jane Doe" in text and BULLET_2 in text
    after = fileedit.extract(out)
    assert block(after, "Set up Docker")["lines"] == block(info, "Set up Docker")["lines"]  # the next bullet stayed put


def test_text_that_needs_more_lines_is_refused():
    data = make_pdf()
    second = block(fileedit.extract(data), "Set up Docker")
    out, results = fileedit.apply(data, {second["id"]: BULLET_2 + " " + BULLET_1})
    assert results[0]["status"] == "too_long" and results[0]["over"] > 20
    assert BULLET_2 in text_of(out)


def test_people_may_change_anything_shorter_names_numbers_titles():
    data = make_pdf()
    info = fileedit.extract(data)
    edits = {
        block(info, "Built a data")["id"]: "Built a pipeline for 15 stores.",  # shorter, new number
        block(info, "Jane Doe")["id"]: "Jane Q. Doe",
        block(info, "EXPERIENCE")["id"]: "WORK",
    }
    out, results = fileedit.apply(data, edits)
    assert all(r["status"] == "applied" for r in results)
    assert next(r for r in results if r["id"] == block(info, "Built a data")["id"])["used"] == 1
    text = text_of(out)
    assert "Built a pipeline for 15 stores." in text and "Jane Q. Doe" in text and "WORK" in text


def test_a_label_stays_and_an_emptied_block_disappears():
    data = make_pdf()
    info = fileedit.extract(data)
    skills, second = block(info, "Python, SQL"), block(info, "Set up Docker")
    out, _ = fileedit.apply(data, {skills["id"]: "SQL, Python, Docker, Airflow, Tableau", second["id"]: ""})
    text = text_of(out)
    assert "Languages: SQL, Python, Docker" in text
    assert "Set up Docker" not in text


def test_bold_label_inside_a_bullet_is_kept():
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((50, 100), "•", fontname="helv", fontsize=10)
    page.insert_text((60, 100), "TensorFlow:", fontname="hebo", fontsize=10)
    page.insert_text(
        (60 + pymupdf.Font("hebo").text_length("TensorFlow: ", 10), 100),
        "Built models for search ranking.",
        fontname="helv",
        fontsize=10,
    )
    info = fileedit.extract(doc.tobytes())
    b = block(info, "Built models")
    assert b["prefix"].endswith("TensorFlow:")
    out, _ = fileedit.apply(doc.tobytes(), {b["id"]: "Trained models for ranking."})
    assert "TensorFlow: Trained models for ranking." in text_of(out)


def test_word_bullet_signs_are_joined_to_their_line():
    def char(c, x, font="helv"):
        return pdf_edit.Char(c, x, 90, x + 5, 102, x, 100, font, 10, False, False, 0)

    sign = pdf_edit.Line(0, [char("", 50, "SymbolMT")])
    words = pdf_edit.Line(0, [char(c, 68 + i * 5) for i, c in enumerate("Led a team")])
    joined = pdf_edit._join_bullets([sign, words])
    assert len(joined) == 1 and pdf_edit.BULLET_RE.match(joined[0].text)


def make_wide_header_pdf() -> bytes:
    """A headline and a bold job title wider than the text column, a summary line that ends in a full
    stop, a skills line that wraps, a short one-line bullet and a ragged 2-line bullet."""
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    helv, hebo = pymupdf.Font("helv"), pymupdf.Font("hebo")
    headline = (
        "Applied ML Engineer · Open source maintainer · Published research · Talks at 3 meetups each year · Mentor"
    )
    page.insert_text((50, 50), headline, fontname="helv", fontsize=10.5)
    page.insert_text((50, 80), "SUMMARY", fontname="hebo", fontsize=11)
    summary = (
        "Engineer with 5 years of building data products in Python and SQL for retail, travel and healthcare teams. "
        "Experienced in shipping models to production, writing clear docs and helping teammates grow."
    )
    y = 96.0
    for line in _wrap(summary, helv, 10, 495):
        page.insert_text((50, y), line, fontname="helv", fontsize=10)
        y += 12
    page.insert_text((50, y + 14), "SKILLS", fontname="hebo", fontsize=11)
    y += 30
    label = "Languages: "
    lw = hebo.text_length(label, 10)
    page.insert_text((50, y), label, fontname="hebo", fontsize=10)
    items = "Python, SQL, Go, TypeScript, Bash, Scala, Rust, Java, Kotlin, Swift, Ruby, PHP, Julia, MATLAB, Haskell, "
    items += "Elixir"
    for line in _wrap(items, helv, 10, 495 - lw):
        page.insert_text((50 + lw, y), line, fontname="helv", fontsize=10)
        y += 12
    title = "Senior Machine Learning Engineer | Northwind Retail Analytics Group | New York, NY | 2021 - Present"
    title += " | Full time"
    page.insert_text((50, y + 14), title, fontname="hebo", fontsize=10.5)
    y += 30
    page.insert_text((50, y), "•", fontname="helv", fontsize=10)
    page.insert_text((60, y), "Cut model training time by 40%.", fontname="helv", fontsize=10)
    y += 16
    ragged = (
        "Built a feature store used by 6 teams that serves features to 30 models in production every day, "
        "with tests and drift alerts."
    )
    page.insert_text((50, y), "•", fontname="helv", fontsize=10)
    for line in _wrap(ragged, helv, 10, 485):
        page.insert_text((60, y), line, fontname="helv", fontsize=10)
        y += 12
    return doc.tobytes()


def test_wide_lines_do_not_split_paragraphs_or_skills_lines():
    info = fileedit.extract(make_wide_header_pdf())
    summary = block(info, "Engineer with 5 years")
    assert len(summary["lines"]) == 2 and summary["text"].endswith("teammates grow.")  # one paragraph
    skills = block(info, "Python, SQL")
    assert len(skills["lines"]) == 2 and skills["text"].endswith("Elixir")  # the wrapped line belongs to it
    assert not any(b["text"].startswith("Experienced") for b in info["blocks"])


def test_each_block_says_how_many_characters_fill_it():
    info = fileedit.extract(make_wide_header_pdf())
    short = block(info, "Cut model training")
    low, high = short["room"]
    assert low < len(short["text"]) and high > 2 * len(short["text"])  # a half-empty line has room to grow
    two = block(info, "Built a feature store")
    low, high = two["room"]
    assert 105 < low <= len(two["text"]) <= high < 230


def test_ragged_file_is_not_stretched_when_rewritten():
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    helv, y = pymupdf.Font("helv"), 60.0
    reviews = "Led weekly reviews of 40 dashboards with sales leads and finance partners to agree on regional targets."
    for bullet in (BULLET_1, reviews, BULLET_1[::-1].title(), BULLET_2 * 3):
        page.insert_text((50, y), "•", fontname="helv", fontsize=10)
        for line in _wrap(bullet, helv, 10, 485):
            page.insert_text((60, y), line, fontname="helv", fontsize=10)
            y += 12
        y += 4
    groups, _ = pdf_edit.build_groups(pymupdf.open(stream=doc.tobytes()))
    assert len(groups) == 4 and not any(g.justified for g in groups)


def test_justified_file_stays_justified():
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    for i in range(3):
        page.insert_textbox(
            pymupdf.Rect(50, 60 + i * 60, 545, 110 + i * 60),
            (BULLET_1 + " ") * 2,
            fontname="helv",
            fontsize=10,
            align=pymupdf.TEXT_ALIGN_JUSTIFY,
        )
    groups, _ = pdf_edit.build_groups(pymupdf.open(stream=doc.tobytes()))
    assert all(g.justified for g in groups if len(g.lines) >= 2)


def test_pages_can_be_put_on_a4_or_letter():
    letter = make_pdf(612, 792)
    a4, sheets = fileedit.fit_to_paper(letter, "A4")
    page = pymupdf.open(stream=a4)[0]
    assert (round(page.rect.width), round(page.rect.height)) == (595, 842)
    assert "Jane Doe" in page.get_text()  # still real, selectable text
    assert sheets[0]["page"] == 0 and sheets[0]["scale"] < 1


def test_a_tall_page_continues_on_a_second_sheet_between_lines():
    doc = pymupdf.open()
    page = doc.new_page(width=612, height=1008)  # US Legal
    for i in range(70):
        page.insert_text(
            (60, 40 + i * 13.5), f"Line {i} of a long resume with enough words", fontname="helv", fontsize=10
        )
    out, sheets = fileedit.fit_to_paper(doc.tobytes(), "A4", "pages")
    pages = pymupdf.open(stream=out)
    assert pages.page_count == 2 and len(sheets) == 2
    words = [p.get_text() for p in pages]
    assert "Line 0 " in words[0] and "Line 69 " in words[1]
    assert sum(t.count("Line ") for t in words) == 70  # no line cut in half or lost
    assert sheets[1]["y0"] == sheets[0]["y1"] and sheets[1]["top"] > 0


def test_font_names_become_families():
    assert fonts.describe("ABCDEF+Lato-LightItalic", False, False) == ("Lato", 300, True)
    assert fonts.describe("Arial-BoldMT", True, False) == ("Arimo", 700, False)
    assert fonts.describe("Calibri", False, False)[0] == "Carlito"
    assert fonts.describe("TimesNewRomanPSMT", False, False)[0] == "Tinos"
    assert fonts.describe("SourceSansPro-Regular", False, False) == ("Source Sans Pro", 400, False)


# ---------------------------------------------------------------- API


@pytest.fixture
def client(monkeypatch):
    for key in ("GEMINI_API_KEY", "GROQ_API_KEY", "SUPABASE_URL", "SUPABASE_ANON_KEY"):
        monkeypatch.setenv(key, "")
    get_settings.cache_clear()
    limits._memory.clear()
    yield TestClient(app_module.app)
    get_settings.cache_clear()


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


def test_api_extract_and_render(client):
    data = make_pdf(612, 792)
    res = client.post("/api/file/extract", json={"filename": "cv.pdf", "file_base64": b64(data)})
    assert res.status_code == 200
    info = res.json()
    assert info["pages"][0]["width"] == 612 and "Jane Doe" in info["text"]
    skills = block(info, "Python, SQL")
    res = client.post(
        "/api/file/render",
        json={
            "file_base64": b64(data),
            "edits": [{"id": skills["id"], "text": "SQL, Python, Docker, Airflow, Tableau"}],
            "paper": "A4",
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["results"][0]["status"] == "applied"
    out = base64.b64decode(body["file_base64"])
    assert "SQL, Python, Docker" in text_of(out)
    assert round(pymupdf.open(stream=out)[0].rect.width) == 595
    assert body["sheets"][0]["width"] == 595.28


def test_api_accepts_only_pdfs(client):
    for name, data in (("cv.txt", b"hello there " * 20), ("cv.docx", b"PK\x03\x04" + b"0" * 200)):
        res = client.post("/api/file/extract", json={"filename": name, "file_base64": b64(data)})
        assert res.status_code == 422 and "PDF" in res.json()["error"]

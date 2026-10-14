import io
import logging
import os
import tempfile
from typing import Any

import docx
from pdf2docx import Converter

log = logging.getLogger("resume.converter")


def convert_pdf_to_docx_bytes(pdf_bytes: bytes) -> bytes:
    """Converts PDF bytes to DOCX bytes preserving formatting and layout."""
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as temp_pdf:
        temp_pdf.write(pdf_bytes)
        temp_pdf_path = temp_pdf.name

    docx_path = temp_pdf_path.replace(".pdf", ".docx")
    try:
        cv = Converter(temp_pdf_path)
        cv.convert(docx_path)
        cv.close()

        with open(docx_path, "rb") as f:
            docx_bytes = f.read()
        return docx_bytes
    finally:
        if os.path.exists(temp_pdf_path):
            try:
                os.remove(temp_pdf_path)
            except Exception:
                pass
        if os.path.exists(docx_path):
            try:
                os.remove(docx_path)
            except Exception:
                pass


def extract_docx_text(docx_bytes: bytes) -> str:
    """Extracts readable structured text from a DOCX file."""
    doc = docx.Document(io.BytesIO(docx_bytes))
    lines: list[str] = []
    for p in doc.paragraphs:
        t = p.text.strip()
        if t:
            lines.append(t)
    for table in doc.tables:
        for row in table.rows:
            row_text = [cell.text.strip() for cell in row.cells if cell.text.strip()]
            if row_text:
                lines.append(" | ".join(row_text))
    return "\n".join(lines)


def update_docx_bullets(docx_bytes: bytes, replacements: list[dict[str, str]]) -> bytes:
    """
    Replaces targeted bullets/text in a DOCX document while preserving
    original paragraph styles, font faces, font sizes, boldness, and alignments.
    """
    doc = docx.Document(io.BytesIO(docx_bytes))

    def try_replace(paragraph: Any, old_text: str, new_text: str) -> bool:
        norm_p = " ".join(paragraph.text.split()).strip()
        norm_old = " ".join(old_text.split()).strip()
        if not norm_old:
            return False

        if norm_old.lower() in norm_p.lower() or norm_p.lower() in norm_old.lower():
            if paragraph.runs:
                # Keep font properties of the first run
                paragraph.runs[0].text = new_text
                for r in paragraph.runs[1:]:
                    r.text = ""
            else:
                paragraph.text = new_text
            return True
        return False

    for rep in replacements:
        old_val = rep.get("old_text", "").strip()
        new_val = rep.get("new_text", "").strip()
        if not old_val or not new_val:
            continue

        replaced = False
        # Search paragraphs
        for p in doc.paragraphs:
            if try_replace(p, old_val, new_val):
                replaced = True
                break

        # Search tables if not found in root paragraphs
        if not replaced:
            for table in doc.tables:
                for row in table.rows:
                    for cell in row.cells:
                        for p in cell.paragraphs:
                            if try_replace(p, old_val, new_val):
                                replaced = True
                                break
                        if replaced:
                            break
                    if replaced:
                        break
                if replaced:
                    break

    out = io.BytesIO()
    doc.save(out)
    return out.getvalue()

"""Edit an uploaded resume file (PDF or Word) in place. See common.py for the idea."""

from . import docx_edit, pdf_edit
from .common import EditResult, Extracted

MAX_FILE_BYTES = 3 * 1024 * 1024


def file_type_of(filename: str, data: bytes) -> str | None:
    name = (filename or "").lower()
    if data[:5] == b"%PDF-" or name.endswith(".pdf"):
        return "pdf"
    if data[:2] == b"PK" and (name.endswith(".docx") or not name):
        return "docx"
    return None


def extract(file_type: str, data: bytes) -> Extracted:
    return (pdf_edit if file_type == "pdf" else docx_edit).extract(data)


def apply(file_type: str, data: bytes, edits: dict[str, str]) -> tuple[bytes, list[EditResult]]:
    return (pdf_edit if file_type == "pdf" else docx_edit).apply(data, edits)


__all__ = ["MAX_FILE_BYTES", "EditResult", "Extracted", "apply", "extract", "file_type_of"]

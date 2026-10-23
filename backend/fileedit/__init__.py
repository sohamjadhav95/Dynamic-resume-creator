"""Edit an uploaded PDF resume in place: see pdf_edit.py for how."""

from .pdf_edit import PAPER, apply, extract, fit_to_paper

MAX_FILE_BYTES = 3 * 1024 * 1024


def is_pdf(data: bytes) -> bool:
    return data[:5] == b"%PDF-"


__all__ = ["MAX_FILE_BYTES", "PAPER", "apply", "extract", "fit_to_paper", "is_pdf"]

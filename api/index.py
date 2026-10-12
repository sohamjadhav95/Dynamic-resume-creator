"""Vercel entry point: every /api/* request is routed here (see vercel.json)."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.app import app  # noqa: E402

__all__ = ["app"]

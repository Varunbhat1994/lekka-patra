"""Compatibility shim for the supervisor command `uvicorn server:app`.

The real application assembly lives in `main.py` — a single source of
truth for how the FastAPI app is built. Keeping this shim means:

    * `uvicorn server:app` (existing supervisor config) keeps working
    * `uvicorn main:app` (the canonical form) also works
    * both resolve to the SAME `app` object — no duplicate wiring

Do not add any logic here. All routes, models, middleware, and startup
hooks belong in `main.py` (or, where appropriate, the relevant feature
module under `routes/`, `services/`, `security/`, or `core/`).
"""
from main import app  # noqa: F401 — re-export for `uvicorn server:app`

__all__ = ["app"]

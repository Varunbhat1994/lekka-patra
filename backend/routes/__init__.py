"""HTTP route modules for the Lekka Patra backend.

Each submodule exposes a `router: APIRouter` that is mounted onto the
main `/api` router in server.py via `api.include_router(...)`.

Import order in server.py MUST be:
    core.database  →  security.*  →  routes.*

so that shared infrastructure and auth helpers are ready before any
route module registers its endpoints.
"""

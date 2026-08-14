"""Lekka Patra backend — application assembly.

This is the single source of truth for how the FastAPI app is built.
`server.py` is a thin compatibility shim (`from main import app`) so
that the existing supervisor command `uvicorn server:app` continues to
work without any operational change.

Responsibilities kept in this file (and only in this file):
    1. Load shared infrastructure (importing core.database also imports
       core.config, which runs load_dotenv() before any os.environ read)
    2. Wire every feature router onto the `/api` prefix
    3. Register the ad-seed + owner-promotion startup event
    4. Register global exception handlers (Mongo timeout / Mongo error /
       catch-all 500)
    5. Add the CORS middleware
    6. Close the shared Motor client on shutdown

All business logic lives in `routes/*`, `services/*`, `security/*`, and
`core/*`. Do not add route handlers, models, or feature logic here.
"""
import logging
import os

from fastapi import FastAPI, APIRouter, Request
from fastapi.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware

# Shared infrastructure — importing core.database also imports core.config,
# which runs load_dotenv() so all subsequent os.environ reads in this
# module resolve correctly. Keep this import BEFORE any other os.environ
# access.
from core.database import client

# Feature routers.
from routes.auth import router as auth_router
from routes.workers import router as workers_router
from routes.attendance import router as attendance_router
from routes.advances import router as advances_router
from routes.contractors import router as contractors_router
from routes.ledger import router as ledger_router
from routes.settlements import router as settlements_router
from routes.feedback import router as feedback_router
from routes.ads import router as ads_router, _seed_ads
from routes.dashboard import router as dashboard_router
from routes.reports import router as reports_router
from routes.payments import router as payments_router
from routes.owner import router as owner_router
from routes.health import router as health_router
from routes.calendar import router as calendar_router

# RBAC helpers used only inside the startup event below.
from security.authorization import _owner_mobile, _owner_email
from core.database import db


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("farmlog")

app = FastAPI()

# Single /api router — every feature module mounts here, so every route
# ends up under /api/... exactly like it always has.
api = APIRouter(prefix="/api")
api.include_router(auth_router)
api.include_router(workers_router)
api.include_router(attendance_router)
api.include_router(advances_router)
api.include_router(contractors_router)
api.include_router(ledger_router)
api.include_router(settlements_router)
api.include_router(feedback_router)
api.include_router(ads_router)
api.include_router(dashboard_router)
api.include_router(reports_router)
api.include_router(payments_router)
api.include_router(owner_router)
api.include_router(health_router)
api.include_router(calendar_router)


@app.on_event("startup")
async def _startup_seed():
    """Seed default ads on first boot and promote the pre-configured
    OWNER_MOBILE / OWNER_EMAIL account (idempotent, safe to re-run)."""
    await _seed_ads()
    om = _owner_mobile()
    if om:
        await db.users.update_many({"mobile": om}, {"$set": {"role": "owner"}})
    oe = _owner_email()
    if oe:
        # case-insensitive email match
        import re as _re
        await db.users.update_many(
            {"email": {"$regex": f"^{_re.escape(oe)}$", "$options": "i"}},
            {"$set": {"role": "owner"}},
        )


app.include_router(api)


# ---- Global exception hardening ----
from pymongo.errors import PyMongoError, ServerSelectionTimeoutError


@app.exception_handler(ServerSelectionTimeoutError)
async def _mongo_timeout_handler(request: Request, exc: ServerSelectionTimeoutError):
    logger.error("mongo timeout on %s: %s", request.url.path, exc)
    return JSONResponse(
        status_code=503,
        content={"detail": "Database temporarily unavailable. Please retry."},
    )


@app.exception_handler(PyMongoError)
async def _mongo_error_handler(request: Request, exc: PyMongoError):
    logger.error("mongo error on %s: %s", request.url.path, exc)
    return JSONResponse(
        status_code=503,
        content={"detail": "Database error. Please retry."},
    )


@app.exception_handler(Exception)
async def _unhandled_exception_handler(request: Request, exc: Exception):
    # HTTPException instances are still handled by FastAPI's built-in
    # handler before hitting this catch-all.
    logger.exception("unhandled error on %s: %s", request.url.path, exc)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )


app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

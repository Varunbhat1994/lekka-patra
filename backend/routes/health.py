"""Health and root probes."""
import logging

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from core.database import client


router = APIRouter()
logger = logging.getLogger("farmlog")


@router.get("/")
async def root():
    return {"status": "ok", "app": "Lekka Patra"}

@router.get("/health")
async def health():
    """Lightweight health probe. Verifies DB reachability with a short ping.
    Returns 200 when healthy, 503 when the DB is unreachable so uptime
    monitors can flag the incident."""
    try:
        await client.admin.command("ping")
        return {"status": "ok", "db": "up"}
    except Exception as e:
        logger.warning("health check db down: %s", e)
        return JSONResponse(
            status_code=503,
            content={"status": "degraded", "db": "down", "error": str(e)[:200]},
        )

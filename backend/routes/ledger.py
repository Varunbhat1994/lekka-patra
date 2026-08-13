"""Worker ledger route.

GET /api/ledger/{worker_id}
    Returns the current-cycle ledger (settlement cutoff applies).

GET /api/ledger/{worker_id}?start=YYYY-MM-DD&end=YYYY-MM-DD
    Returns a HISTORICAL ledger snapshot for the given date window.
    In this mode the settlement cutoff is ignored — attendance, advances,
    returns, and settlements are all filtered by the explicit range so
    year/month history views show ALL records regardless of settlements.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from core.database import db
from security.authentication import get_current_user
from services.ledger import compute_worker_ledger


router = APIRouter()


@router.get("/ledger/{worker_id}")
async def ledger(
    worker_id: str,
    user: dict = Depends(get_current_user),
    start: Optional[str] = None,
    end: Optional[str] = None,
):
    worker = await db.workers.find_one({"id": worker_id, "user_id": user["user_id"]}, {"_id": 0})
    if not worker:
        raise HTTPException(404, "Worker not found")
    return await compute_worker_ledger(user["user_id"], worker, start=start, end=end)

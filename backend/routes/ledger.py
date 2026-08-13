"""Worker ledger route.

Exposes GET /api/ledger/{worker_id} which returns the full
compute_worker_ledger() payload for a single worker owned by the
caller.
"""
from fastapi import APIRouter, Depends, HTTPException

from core.database import db
from security.authentication import get_current_user
from services.ledger import compute_worker_ledger


router = APIRouter()


@router.get("/ledger/{worker_id}")
async def ledger(worker_id: str, user: dict = Depends(get_current_user)):
    worker = await db.workers.find_one({"id": worker_id, "user_id": user["user_id"]}, {"_id": 0})
    if not worker:
        raise HTTPException(404, "Worker not found")
    return await compute_worker_ledger(user["user_id"], worker)

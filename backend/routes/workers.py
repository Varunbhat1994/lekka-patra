"""Worker CRUD routes.

Owns:
    GET    /workers             — list current user's workers
    POST   /workers             — create (write-gated)
    PUT    /workers/{worker_id} — update (write-gated)
    DELETE /workers/{worker_id} — cascade-delete worker + attendance +
                                  advances + advance_returns (write-gated)

Behavior, response shapes, ownership scoping, cascade deletes, and
error responses are preserved bit-for-bit from the original inline
implementation in server.py.
"""
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core.database import db
from security.authentication import get_current_user
from security.authorization import require_write_access


router = APIRouter()


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


# ---------------- Models ----------------

class Worker(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    name: str
    mobile: Optional[str] = ""
    skill: Optional[str] = ""
    daily_rate: float
    worker_type: str = "regular"  # regular | temporary
    created_at: datetime = Field(default_factory=_now_utc)


class WorkerIn(BaseModel):
    name: str
    mobile: Optional[str] = ""
    skill: Optional[str] = ""
    daily_rate: float
    worker_type: Optional[str] = "regular"


# ---------------- Routes ----------------

@router.get("/workers")
async def list_workers(user: dict = Depends(get_current_user)):
    workers = await db.workers.find({"user_id": user["user_id"]}, {"_id": 0}).to_list(1000)
    return workers


@router.post("/workers")
async def create_worker(w: WorkerIn, user: dict = Depends(require_write_access)):
    obj = Worker(user_id=user["user_id"], **w.model_dump())
    doc = obj.model_dump()
    doc["created_at"] = doc["created_at"].isoformat()
    await db.workers.insert_one(doc)
    return obj


@router.put("/workers/{worker_id}")
async def update_worker(worker_id: str, w: WorkerIn, user: dict = Depends(require_write_access)):
    res = await db.workers.update_one(
        {"id": worker_id, "user_id": user["user_id"]},
        {"$set": w.model_dump()},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Worker not found")
    return {"ok": True}


@router.delete("/workers/{worker_id}")
async def delete_worker(worker_id: str, user: dict = Depends(require_write_access)):
    await db.workers.delete_one({"id": worker_id, "user_id": user["user_id"]})
    await db.attendance.delete_many({"worker_id": worker_id, "user_id": user["user_id"]})
    await db.advances.delete_many({"worker_id": worker_id, "user_id": user["user_id"]})
    await db.advance_returns.delete_many({"worker_id": worker_id, "user_id": user["user_id"]})
    return {"ok": True}

"""Attendance routes.

Owns:
    GET    /attendance          — list attendance rows scoped to current
                                  user, optionally filtered by date,
                                  worker_id, or [start, end] range
    POST   /attendance          — upsert per (worker_id, date) pair
                                  (write-gated)
    DELETE /attendance/{att_id} — delete an attendance row (write-gated)

Behavior, response shapes, ownership scoping, upsert semantics, and
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

class Attendance(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    worker_id: str
    date: str  # YYYY-MM-DD
    status: str  # present, half_day, absent, overtime
    overtime_hours: float = 0
    field_crop: Optional[str] = ""
    description: Optional[str] = ""
    created_at: datetime = Field(default_factory=_now_utc)


class AttendanceIn(BaseModel):
    worker_id: str
    date: str
    status: str
    overtime_hours: float = 0
    field_crop: Optional[str] = ""
    description: Optional[str] = ""


# ---------------- Routes ----------------

@router.get("/attendance")
async def list_attendance(
    user: dict = Depends(get_current_user),
    date: Optional[str] = None,
    worker_id: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
):
    q = {"user_id": user["user_id"]}
    if date:
        q["date"] = date
    if worker_id:
        q["worker_id"] = worker_id
    if start and end:
        q["date"] = {"$gte": start, "$lte": end}
    rows = await db.attendance.find(q, {"_id": 0}).to_list(5000)
    return rows


@router.post("/attendance")
async def upsert_attendance(a: AttendanceIn, user: dict = Depends(require_write_access)):
    # Reject attendance for workers the caller doesn't own.
    if not await db.workers.find_one(
        {"id": a.worker_id, "user_id": user["user_id"]}, {"_id": 1}
    ):
        raise HTTPException(404, "Worker not found")
    # Upsert per (worker_id, date)
    existing = await db.attendance.find_one({
        "user_id": user["user_id"], "worker_id": a.worker_id, "date": a.date
    }, {"_id": 0})
    if existing:
        await db.attendance.update_one(
            {"id": existing["id"]},
            {"$set": a.model_dump()},
        )
        return {"ok": True, "id": existing["id"]}
    obj = Attendance(user_id=user["user_id"], **a.model_dump())
    doc = obj.model_dump()
    doc["created_at"] = doc["created_at"].isoformat()
    await db.attendance.insert_one(doc)
    return obj


@router.delete("/attendance/{att_id}")
async def del_attendance(att_id: str, user: dict = Depends(require_write_access)):
    await db.attendance.delete_one({"id": att_id, "user_id": user["user_id"]})
    return {"ok": True}

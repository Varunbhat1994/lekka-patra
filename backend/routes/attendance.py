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
    # Optional manual overtime BONUS amount in rupees. When present,
    # earning for an overtime day = daily_rate_snapshot + overtime_amount.
    # When absent, legacy overtime_hours formula is used.
    overtime_amount: Optional[float] = None
    # Optional manual half-day wage in rupees. When present, earning for
    # a half_day = manual_wage. When absent, legacy 0.5 × rate is used.
    manual_wage: Optional[float] = None
    field_crop: Optional[str] = ""
    description: Optional[str] = ""
    # Wage rate snapshotted at write time. Locks the wage that applied
    # to this specific day so later edits to the worker's `daily_rate`
    # never rewrite historical earnings. Nullable to remain backward
    # compatible with rows created before this field existed — those
    # rows fall back to `worker.daily_rate` at compute time.
    daily_rate_snapshot: Optional[float] = None
    created_at: datetime = Field(default_factory=_now_utc)


class AttendanceIn(BaseModel):
    worker_id: str
    date: str
    status: str
    overtime_hours: float = 0
    overtime_amount: Optional[float] = None
    manual_wage: Optional[float] = None
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
    worker = await db.workers.find_one(
        {"id": a.worker_id, "user_id": user["user_id"]}, {"_id": 0}
    )
    if not worker:
        raise HTTPException(404, "Worker not found")
    # Validation for optional manual amounts: non-negative, and capped at
    # a sensible upper bound (10× the worker's current daily rate, min 100000)
    # to prevent stray taps from creating nonsense records.
    max_cap = max(100000.0, float(worker.get("daily_rate", 0)) * 10)
    if a.manual_wage is not None:
        if a.manual_wage < 0:
            raise HTTPException(400, "manual_wage cannot be negative")
        if a.manual_wage > max_cap:
            raise HTTPException(400, f"manual_wage exceeds allowed maximum ({max_cap})")
    if a.overtime_amount is not None:
        if a.overtime_amount < 0:
            raise HTTPException(400, "overtime_amount cannot be negative")
        if a.overtime_amount > max_cap:
            raise HTTPException(400, f"overtime_amount exceeds allowed maximum ({max_cap})")
    # Upsert per (worker_id, date). NOTE: `daily_rate_snapshot` is written
    # ONLY on the first insert for this (worker_id, date). If the row
    # already exists, we update fields the client sent (status, hours,
    # crop, description) but PRESERVE the existing snapshot so the wage
    # that applied on that day never changes — even when the row is
    # edited (e.g. absent → half_day) after a wage change.
    existing = await db.attendance.find_one({
        "user_id": user["user_id"], "worker_id": a.worker_id, "date": a.date
    }, {"_id": 0})
    if existing:
        await db.attendance.update_one(
            {"id": existing["id"]},
            {"$set": a.model_dump()},
        )
        return {"ok": True, "id": existing["id"]}
    obj = Attendance(
        user_id=user["user_id"],
        daily_rate_snapshot=float(worker["daily_rate"]),
        **a.model_dump(),
    )
    doc = obj.model_dump()
    doc["created_at"] = doc["created_at"].isoformat()
    await db.attendance.insert_one(doc)
    return obj


@router.delete("/attendance/{att_id}")
async def del_attendance(att_id: str, user: dict = Depends(require_write_access)):
    await db.attendance.delete_one({"id": att_id, "user_id": user["user_id"]})
    return {"ok": True}

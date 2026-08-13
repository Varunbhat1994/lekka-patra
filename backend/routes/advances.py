"""Worker Advances and Advance Returns routes.

Owns:
    GET    /advances                  — list current user's advances,
                                        optionally filtered by worker_id
    POST   /advances                  — create advance (write-gated)
    DELETE /advances/{adv_id}         — delete advance (write-gated)

    GET    /returns                   — list advance returns, optionally
                                        filtered by worker_id
    POST   /returns                   — create return (write-gated)
    DELETE /returns/{rid}             — delete return (write-gated)

Behavior, response shapes, ownership scoping, validation, error
responses, and MongoDB collection names (`advances`, `advance_returns`)
are preserved bit-for-bit from the original inline implementation in
server.py. Settlements remain in server.py because they touch both
worker and contractor ledgers.
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

class Advance(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    worker_id: str
    date: str
    amount: float
    method: str  # cash / upi
    notes: Optional[str] = ""
    created_at: datetime = Field(default_factory=_now_utc)


class AdvanceIn(BaseModel):
    worker_id: str
    date: str
    amount: float
    method: str
    notes: Optional[str] = ""


class ReturnIn(BaseModel):
    worker_id: str
    date: str
    amount: float
    method: str = "cash"
    notes: Optional[str] = ""


# ---------------- Advances ----------------

@router.get("/advances")
async def list_advances(user: dict = Depends(get_current_user), worker_id: Optional[str] = None):
    q = {"user_id": user["user_id"]}
    if worker_id:
        q["worker_id"] = worker_id
    rows = await db.advances.find(q, {"_id": 0}).sort("date", -1).to_list(5000)
    return rows


@router.post("/advances")
async def create_advance(a: AdvanceIn, user: dict = Depends(require_write_access)):
    # Reject records referencing a worker not owned by the caller.
    # Prevents cross-account orphan rows and keeps every advance tied
    # to a (user_id, worker_id) pair the ledger can trust.
    if not await db.workers.find_one(
        {"id": a.worker_id, "user_id": user["user_id"]}, {"_id": 1}
    ):
        raise HTTPException(404, "Worker not found")
    obj = Advance(user_id=user["user_id"], **a.model_dump())
    doc = obj.model_dump()
    doc["created_at"] = doc["created_at"].isoformat()
    await db.advances.insert_one(doc)
    return obj


@router.delete("/advances/{adv_id}")
async def del_advance(adv_id: str, user: dict = Depends(require_write_access)):
    await db.advances.delete_one({"id": adv_id, "user_id": user["user_id"]})
    return {"ok": True}


# ---------------- Advance Returns (money returned back by the worker) ----------------

@router.get("/returns")
async def list_returns(user: dict = Depends(get_current_user), worker_id: Optional[str] = None):
    q = {"user_id": user["user_id"]}
    if worker_id:
        q["worker_id"] = worker_id
    rows = await db.advance_returns.find(q, {"_id": 0}).sort("date", -1).to_list(5000)
    return rows


@router.post("/returns")
async def create_return(r: ReturnIn, user: dict = Depends(require_write_access)):
    if not await db.workers.find_one(
        {"id": r.worker_id, "user_id": user["user_id"]}, {"_id": 1}
    ):
        raise HTTPException(404, "Worker not found")
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["user_id"],
        "worker_id": r.worker_id,
        "date": r.date,
        "amount": r.amount,
        "method": r.method,
        "notes": r.notes or "",
        "created_at": _now_utc().isoformat(),
    }
    await db.advance_returns.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.delete("/returns/{rid}")
async def del_return(rid: str, user: dict = Depends(require_write_access)):
    await db.advance_returns.delete_one({"id": rid, "user_id": user["user_id"]})
    return {"ok": True}

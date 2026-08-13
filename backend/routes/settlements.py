"""Settlement routes.

The `/settlements` endpoints are polymorphic — the same request handles
BOTH worker settlements (which record the current pending wages as a
cycle-cut settlement) and contractor settlements (which also auto-write
a compensating `contractor_returns` row so `net_paid` drops to zero).

Behavior, cascade auto-return, cross-collection wiring, and error
responses are preserved bit-for-bit from the original inline
implementation in server.py.

Endpoints:
    POST   /settlements            — settle worker OR contractor
                                     (write-gated, 400 if neither id
                                     is provided)
    GET    /settlements            — list, optionally filtered by
                                     worker_id or contractor_id
    DELETE /settlements/{sid}      — reverse a settlement; if it was a
                                     contractor settlement, also delete
                                     the auto-recorded return
                                     (write-gated)
"""
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.database import db
from security.authentication import get_current_user
from security.authorization import require_write_access
from services.ledger import compute_worker_ledger


router = APIRouter()


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


class SettlementIn(BaseModel):
    worker_id: Optional[str] = None
    contractor_id: Optional[str] = None
    up_to_date: str
    note: Optional[str] = ""


@router.post("/settlements")
async def settle(s: SettlementIn, user: dict = Depends(require_write_access)):
    """Zero out the pending balance for a worker OR contractor by recording
    the current pending amount as a settlement. Ledger treats settlements
    as money paid out."""
    if not s.worker_id and not s.contractor_id:
        raise HTTPException(400, "worker_id or contractor_id required")

    if s.worker_id:
        worker = await db.workers.find_one({"id": s.worker_id, "user_id": user["user_id"]}, {"_id": 0})
        if not worker:
            raise HTTPException(404, "Worker not found")
        led = await compute_worker_ledger(user["user_id"], worker)
        pending = max(0.0, led["pending"])
        doc = {
            "id": str(uuid.uuid4()),
            "user_id": user["user_id"],
            "worker_id": s.worker_id,
            "up_to_date": s.up_to_date,
            "amount": round(pending, 2),
            "note": s.note or "",
            "created_at": _now_utc().isoformat(),
        }
        await db.settlements.insert_one(doc)
        doc.pop("_id", None)
        return {"ok": True, "id": doc["id"], "amount": doc["amount"], "kind": "worker"}

    # Contractor settle: zero out net_paid by recording a return equal to net_paid.
    contractor = await db.contractors.find_one({"id": s.contractor_id, "user_id": user["user_id"]}, {"_id": 0})
    if not contractor:
        raise HTTPException(404, "Contractor not found")
    payments = await db.contractor_payments.find(
        {"contractor_id": s.contractor_id, "user_id": user["user_id"]}, {"_id": 0}
    ).to_list(2000)
    returns = await db.contractor_returns.find(
        {"contractor_id": s.contractor_id, "user_id": user["user_id"]}, {"_id": 0}
    ).to_list(2000)
    net_paid = round(sum(p["amount"] for p in payments) - sum(r["amount"] for r in returns), 2)
    net_paid = max(0.0, net_paid)
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["user_id"],
        "contractor_id": s.contractor_id,
        "up_to_date": s.up_to_date,
        "amount": round(net_paid, 2),
        "note": s.note or "",
        "kind": "contractor_settle",
        "created_at": _now_utc().isoformat(),
    }
    await db.settlements.insert_one(doc)
    # Also record it as a return so contractor_ledger.net_paid becomes 0.
    if net_paid > 0:
        await db.contractor_returns.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": user["user_id"],
            "contractor_id": s.contractor_id,
            "date": s.up_to_date,
            "amount": net_paid,
            "method": "settlement",
            "notes": "Auto-recorded on Mark Settled",
            "settlement_id": doc["id"],
            "created_at": _now_utc().isoformat(),
        })
    doc.pop("_id", None)
    return {"ok": True, "id": doc["id"], "amount": doc["amount"], "kind": "contractor"}


@router.get("/settlements")
async def list_settlements(
    user: dict = Depends(get_current_user),
    worker_id: Optional[str] = None,
    contractor_id: Optional[str] = None,
):
    q = {"user_id": user["user_id"]}
    if worker_id:
        q["worker_id"] = worker_id
    if contractor_id:
        q["contractor_id"] = contractor_id
    rows = await db.settlements.find(q, {"_id": 0}).sort("up_to_date", -1).to_list(1000)
    return rows


@router.delete("/settlements/{sid}")
async def del_settlement(sid: str, user: dict = Depends(require_write_access)):
    """Reverse a settlement (in case cash was never actually paid)."""
    # If it was a contractor settlement, also remove its auto-return
    await db.contractor_returns.delete_many({"user_id": user["user_id"], "settlement_id": sid})
    res = await db.settlements.delete_one({"id": sid, "user_id": user["user_id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Settlement not found")
    return {"ok": True}

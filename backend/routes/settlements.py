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
    amount: Optional[float] = None  # legacy — kept for backwards compat
    mode: Optional[str] = None  # "adjust_advance" | "actual_paid" (worker only)
    actual_paid: Optional[float] = None  # cash paid today (mode=actual_paid)
    note: Optional[str] = ""


@router.post("/settlements")
async def settle(s: SettlementIn, user: dict = Depends(require_write_access)):
    """Close out the current work period for a worker OR a contractor.

    Worker modes (payload.mode):
      - "adjust_advance" (Scenario A): no cash exchanged. The current
        earned amount is deducted from the outstanding advance by
        auto-recording a RETURN equal to earned. If existing advance >
        earned, the result is "worker owes you (existing_advance - earned)".
      - "actual_paid"    (Scenario B): payload.actual_paid is the cash
        physically handed over today. If actual_paid > earned the excess
        is auto-recorded as a NEW ADVANCE dated up_to_date.
      - (mode omitted): behaves like the legacy call — settlement records
        `amount` (defaulting to earned). No auto-return, no auto-advance.

    Contractor branch is unchanged (no mode logic).
    """
    if not s.worker_id and not s.contractor_id:
        raise HTTPException(400, "worker_id or contractor_id required")

    if s.worker_id:
        worker = await db.workers.find_one({"id": s.worker_id, "user_id": user["user_id"]}, {"_id": 0})
        if not worker:
            raise HTTPException(404, "Worker not found")
        led = await compute_worker_ledger(user["user_id"], worker)
        earned = max(0.0, led["pending"])  # pending == period earned since last cutoff
        existing_net_advance = round(led["net_advance"], 2)

        mode = (s.mode or "").strip().lower() or None
        auto_return_id: Optional[str] = None
        auto_advance_id: Optional[str] = None
        settlement_amount = earned
        worker_owes_user = 0.0
        new_advance = 0.0

        if mode == "adjust_advance":
            # No cash. Deduct earned from existing advance by recording a
            # return of `earned` on up_to_date.
            settlement_amount = earned
            if earned > 0:
                auto_return_id = str(uuid.uuid4())
                await db.advance_returns.insert_one({
                    "id": auto_return_id,
                    "user_id": user["user_id"],
                    "worker_id": s.worker_id,
                    "date": s.up_to_date,
                    "amount": round(earned, 2),
                    "method": "adjust",
                    "notes": "Auto-adjust from advance on Mark Settled",
                    "settlement_id": None,  # set below after settlement insert
                    "created_at": _now_utc().isoformat(),
                })
            new_net_advance = existing_net_advance - earned
            worker_owes_user = max(0.0, new_net_advance)

        elif mode == "actual_paid":
            actual = 0.0 if s.actual_paid is None else max(0.0, float(s.actual_paid))
            if actual < earned:
                raise HTTPException(
                    400,
                    "actual_paid is less than earned. Use adjust_advance or pay at least the earned amount.",
                )
            settlement_amount = earned
            extra = round(actual - earned, 2)
            if extra > 0:
                auto_advance_id = str(uuid.uuid4())
                await db.advances.insert_one({
                    "id": auto_advance_id,
                    "user_id": user["user_id"],
                    "worker_id": s.worker_id,
                    "date": s.up_to_date,
                    "amount": extra,
                    "method": "cash",
                    "notes": "Auto-created from Mark Settled (overpayment)",
                    "settlement_id": None,
                    "created_at": _now_utc().isoformat(),
                })
                new_advance = extra

        else:
            # Legacy path — caller supplied amount or default to earned.
            default_amount = earned
            settlement_amount = default_amount if s.amount is None else max(0.0, float(s.amount))

        doc = {
            "id": str(uuid.uuid4()),
            "user_id": user["user_id"],
            "worker_id": s.worker_id,
            "up_to_date": s.up_to_date,
            "amount": round(settlement_amount, 2),
            "mode": mode,
            "actual_paid": None if s.actual_paid is None else round(float(s.actual_paid), 2),
            "period_earned": round(led["total_earned"], 2),
            "period_days_worked": led["days_worked"],
            "advance_snapshot": existing_net_advance,
            "auto_return_id": auto_return_id,
            "auto_advance_id": auto_advance_id,
            "note": s.note or "",
            "created_at": _now_utc().isoformat(),
        }
        await db.settlements.insert_one(doc)

        # Link the auto-generated rows back to the settlement id for undo.
        if auto_return_id:
            await db.advance_returns.update_one(
                {"id": auto_return_id}, {"$set": {"settlement_id": doc["id"]}}
            )
        if auto_advance_id:
            await db.advances.update_one(
                {"id": auto_advance_id}, {"$set": {"settlement_id": doc["id"]}}
            )

        doc.pop("_id", None)
        return {
            "ok": True,
            "id": doc["id"],
            "amount": doc["amount"],
            "kind": "worker",
            "mode": mode,
            "period_earned": doc["period_earned"],
            "advance_snapshot": existing_net_advance,
            "worker_owes_user": round(worker_owes_user, 2),
            "new_advance_created": round(new_advance, 2),
        }

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
    """Reverse a settlement and any auto-created rows tied to it
    (contractor return, worker auto-return, or worker auto-advance)."""
    await db.contractor_returns.delete_many({"user_id": user["user_id"], "settlement_id": sid})
    await db.advance_returns.delete_many({"user_id": user["user_id"], "settlement_id": sid})
    await db.advances.delete_many({"user_id": user["user_id"], "settlement_id": sid})
    res = await db.settlements.delete_one({"id": sid, "user_id": user["user_id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Settlement not found")
    return {"ok": True}

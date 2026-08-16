"""Contractor routes.

Owns every /contractors, /contractor-visits, /contractor-payments, and
/contractor-returns endpoint plus the per-contractor ledger view:

    GET    /contractors                       — list current user's contractors
    POST   /contractors                       — create (write-gated)
    PUT    /contractors/{cid}                 — update (write-gated)
    DELETE /contractors/{cid}                 — cascade-delete contractor +
                                                visits + payments + returns
                                                (write-gated)

    GET    /contractor-visits?contractor_id=  — list visits for one contractor
    POST   /contractor-visits                 — add visit (write-gated)
    DELETE /contractor-visits/{vid}           — delete visit (write-gated)

    GET    /contractor-payments?contractor_id=— list payments
    POST   /contractor-payments               — add payment (write-gated)
    DELETE /contractor-payments/{pid}         — delete payment (write-gated)

    GET    /contractor-returns?contractor_id= — list returns
    POST   /contractor-returns                — add return (write-gated)
    DELETE /contractor-returns/{rid}          — delete return (write-gated)

    GET    /contractors/{cid}/ledger          — summary + visits/payments/returns

Behavior, response shapes, ownership scoping, cascade deletes, ledger
computation (`total_paid - total_returned = net_paid`), and error
responses are preserved bit-for-bit from the original inline
implementation in server.py.

Note: This module deliberately does NOT touch the polymorphic
`/settlements` endpoint — that still lives in server.py because it
also handles worker settlements.
"""
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.database import db
from security.authentication import get_current_user
from security.authorization import require_write_access
from services.ledger import compute_contractor_ledger
from services.sync_ops import idempotent


router = APIRouter()


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


# ---------------- Models ----------------

class ContractorIn(BaseModel):
    name: str
    mobile: Optional[str] = ""
    notes: Optional[str] = ""
    operation_id: Optional[str] = None


class VisitIn(BaseModel):
    contractor_id: str
    date: str
    workers_count: int
    field_crop: Optional[str] = ""
    notes: Optional[str] = ""
    # Client-supplied idempotency key from the offline sync queue.
    # Optional so existing online callers are unaffected.
    operation_id: Optional[str] = None


class ContractorPaymentIn(BaseModel):
    contractor_id: str
    date: str
    amount: float
    method: str = "cash"
    notes: Optional[str] = ""
    operation_id: Optional[str] = None


class ContractorReturnIn(BaseModel):
    contractor_id: str
    date: str
    amount: float
    method: str = "cash"
    notes: Optional[str] = ""
    operation_id: Optional[str] = None


# ---------------- Contractors ----------------

@router.get("/contractors")
async def list_contractors(user: dict = Depends(get_current_user)):
    rows = await db.contractors.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return rows


@router.post("/contractors")
async def create_contractor(c: ContractorIn, user: dict = Depends(require_write_access)):
    async def do():
        doc = {
            "id": str(uuid.uuid4()),
            "user_id": user["user_id"],
            "name": c.name,
            "mobile": c.mobile or "",
            "notes": c.notes or "",
            "created_at": _now_utc().isoformat(),
        }
        await db.contractors.insert_one(doc)
        doc.pop("_id", None)
        return doc
    return await idempotent(user["user_id"], c.operation_id, "contractors", do)


@router.put("/contractors/{cid}")
async def update_contractor(cid: str, c: ContractorIn, user: dict = Depends(require_write_access)):
    async def do():
        res = await db.contractors.update_one(
            {"id": cid, "user_id": user["user_id"]},
            {"$set": {"name": c.name, "mobile": c.mobile or "", "notes": c.notes or ""}},
        )
        if res.matched_count == 0:
            raise HTTPException(404, "Contractor not found")
        return {"ok": True}
    return await idempotent(user["user_id"], c.operation_id, "contractors", do)


@router.delete("/contractors/{cid}")
async def del_contractor(cid: str, user: dict = Depends(require_write_access)):
    await db.contractors.delete_one({"id": cid, "user_id": user["user_id"]})
    await db.contractor_visits.delete_many({"contractor_id": cid, "user_id": user["user_id"]})
    await db.contractor_payments.delete_many({"contractor_id": cid, "user_id": user["user_id"]})
    await db.contractor_returns.delete_many({"contractor_id": cid, "user_id": user["user_id"]})
    return {"ok": True}


# ---------------- Visits ----------------

@router.get("/contractor-visits")
async def list_visits(contractor_id: str, user: dict = Depends(get_current_user)):
    rows = await db.contractor_visits.find(
        {"contractor_id": contractor_id, "user_id": user["user_id"]}, {"_id": 0}
    ).sort("date", -1).to_list(2000)
    return rows


@router.post("/contractor-visits")
async def add_visit(v: VisitIn, user: dict = Depends(require_write_access)):
    async def do():
        # Reject visits for contractors the caller doesn't own — prevents
        # orphan rows and cross-account writes.
        if not await db.contractors.find_one(
            {"id": v.contractor_id, "user_id": user["user_id"]}, {"_id": 1}
        ):
            raise HTTPException(404, "Contractor not found")
        doc = {
            "id": str(uuid.uuid4()),
            "user_id": user["user_id"],
            "contractor_id": v.contractor_id,
            "date": v.date,
            "workers_count": int(v.workers_count),
            "field_crop": v.field_crop or "",
            "notes": v.notes or "",
            "created_at": _now_utc().isoformat(),
        }
        await db.contractor_visits.insert_one(doc)
        doc.pop("_id", None)
        return doc
    return await idempotent(user["user_id"], v.operation_id, "contractor_visits", do)


@router.delete("/contractor-visits/{vid}")
async def del_visit(vid: str, user: dict = Depends(require_write_access)):
    await db.contractor_visits.delete_one({"id": vid, "user_id": user["user_id"]})
    return {"ok": True}


# ---------------- Payments ----------------

@router.get("/contractor-payments")
async def list_cpayments(contractor_id: str, user: dict = Depends(get_current_user)):
    rows = await db.contractor_payments.find(
        {"contractor_id": contractor_id, "user_id": user["user_id"]}, {"_id": 0}
    ).sort("date", -1).to_list(2000)
    return rows


@router.post("/contractor-payments")
async def add_cpayment(p: ContractorPaymentIn, user: dict = Depends(require_write_access)):
    async def do():
        if not await db.contractors.find_one(
            {"id": p.contractor_id, "user_id": user["user_id"]}, {"_id": 1}
        ):
            raise HTTPException(404, "Contractor not found")
        doc = {
            "id": str(uuid.uuid4()),
            "user_id": user["user_id"],
            "contractor_id": p.contractor_id,
            "date": p.date,
            "amount": float(p.amount),
            "method": p.method,
            "notes": p.notes or "",
            "created_at": _now_utc().isoformat(),
        }
        await db.contractor_payments.insert_one(doc)
        doc.pop("_id", None)
        return doc
    return await idempotent(user["user_id"], p.operation_id, "contractor_payments", do)


@router.delete("/contractor-payments/{pid}")
async def del_cpayment(pid: str, user: dict = Depends(require_write_access)):
    await db.contractor_payments.delete_one({"id": pid, "user_id": user["user_id"]})
    return {"ok": True}


# ---------------- Returns ----------------

@router.get("/contractor-returns")
async def list_creturns(contractor_id: str, user: dict = Depends(get_current_user)):
    rows = await db.contractor_returns.find(
        {"contractor_id": contractor_id, "user_id": user["user_id"]}, {"_id": 0}
    ).sort("date", -1).to_list(2000)
    return rows


@router.post("/contractor-returns")
async def add_creturn(r: ContractorReturnIn, user: dict = Depends(require_write_access)):
    async def do():
        if not await db.contractors.find_one(
            {"id": r.contractor_id, "user_id": user["user_id"]}, {"_id": 1}
        ):
            raise HTTPException(404, "Contractor not found")
        doc = {
            "id": str(uuid.uuid4()),
            "user_id": user["user_id"],
            "contractor_id": r.contractor_id,
            "date": r.date,
            "amount": float(r.amount),
            "method": r.method,
            "notes": r.notes or "",
            "created_at": _now_utc().isoformat(),
        }
        await db.contractor_returns.insert_one(doc)
        doc.pop("_id", None)
        return doc
    return await idempotent(user["user_id"], r.operation_id, "contractor_returns", do)


@router.delete("/contractor-returns/{rid}")
async def del_creturn(rid: str, user: dict = Depends(require_write_access)):
    await db.contractor_returns.delete_one({"id": rid, "user_id": user["user_id"]})
    return {"ok": True}


# ---------------- Ledger ----------------

@router.get("/contractors/{cid}/ledger")
async def contractor_ledger(
    cid: str,
    user: dict = Depends(get_current_user),
    start: Optional[str] = None,
    end: Optional[str] = None,
):
    contractor = await db.contractors.find_one({"id": cid, "user_id": user["user_id"]}, {"_id": 0})
    if not contractor:
        raise HTTPException(404, "Contractor not found")
    return await compute_contractor_ledger(user["user_id"], contractor, start=start, end=end)

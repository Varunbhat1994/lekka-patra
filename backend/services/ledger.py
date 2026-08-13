"""Ledger computation service.

Pure computation module that reads from MongoDB and returns dict payloads.
No FastAPI routes here — the route handlers live in `routes/ledger.py`
and `routes/dashboard.py`, which call these functions.

Behavior is preserved bit-for-bit from the original inline
implementations in server.py:

    _wage_units(status, overtime_hours, daily_rate) -> float
        · present → daily_rate
        · half_day → 0.5 × daily_rate
        · overtime → daily_rate + daily_rate * (overtime_hours / 8)
        · anything else (absent, etc.) → 0

    compute_worker_ledger(user_id, worker, start=None, end=None) -> dict
        Applies the "Mark Settled" cycle-cutoff: only attendance and
        advances AFTER the latest settlement date are counted. Explicit
        start/end filter overrides the cutoff.

    _compute_pending_list(user_id, workers) -> list
        Dashboard helper — lists {name, pending, advance, type} for
        every worker/contractor who has received an advance/payment.
"""
from typing import Optional

from core.database import db


def _wage_units(status: str, overtime_hours: float, daily_rate: float) -> float:
    if status == "present":
        return daily_rate
    if status == "half_day":
        return daily_rate * 0.5
    if status == "overtime":
        # 1 day + (overtime_hours / 8) day equivalent
        return daily_rate + daily_rate * (overtime_hours / 8.0)
    return 0.0


async def compute_worker_ledger(
    user_id: str,
    worker: dict,
    start: Optional[str] = None,
    end: Optional[str] = None,
) -> dict:
    # Find the latest settlement cutoff date so we only count activity AFTER it.
    all_settlements = await db.settlements.find(
        {"user_id": user_id, "worker_id": worker["id"]}, {"_id": 0}
    ).sort("up_to_date", -1).to_list(5000)
    cutoff = all_settlements[0]["up_to_date"] if all_settlements else None

    q = {"user_id": user_id, "worker_id": worker["id"]}
    if start and end:
        q["date"] = {"$gte": start, "$lte": end}
    elif cutoff:
        q["date"] = {"$gt": cutoff}
    att = await db.attendance.find(q, {"_id": 0}).to_list(5000)
    total_earned = 0.0
    days_worked = 0.0
    for a in att:
        u = _wage_units(a["status"], a.get("overtime_hours", 0), worker["daily_rate"])
        total_earned += u
        if a["status"] == "present":
            days_worked += 1
        elif a["status"] == "half_day":
            days_worked += 0.5
        elif a["status"] == "overtime":
            days_worked += 1 + a.get("overtime_hours", 0) / 8.0

    adv_q = {"user_id": user_id, "worker_id": worker["id"]}
    if cutoff:
        adv_q_dated = {**adv_q, "date": {"$gt": cutoff}}
    else:
        adv_q_dated = adv_q
    advances = await db.advances.find(adv_q_dated, {"_id": 0}).to_list(5000)
    total_advance = sum(a["amount"] for a in advances)
    returns = await db.advance_returns.find(adv_q_dated, {"_id": 0}).sort("date", -1).to_list(5000)
    total_returned = sum(r["amount"] for r in returns)
    total_settled = sum(s.get("amount", 0) or 0 for s in all_settlements)
    net_advance = total_advance - total_returned
    return {
        "worker": worker,
        "days_worked": round(days_worked, 2),
        "total_earned": round(total_earned, 2),
        "total_advance": round(total_advance, 2),
        "total_returned": round(total_returned, 2),
        "total_settled": round(total_settled, 2),
        "net_advance": round(net_advance, 2),
        "pending": round(total_earned - net_advance, 2),
        "settled_up_to": cutoff,
        "attendance": att,
        "advances": advances,
        "returns": returns,
        "settlements": all_settlements,
    }


async def _compute_pending_list(user_id: str, workers: list) -> list:
    """List of {name, pending, type} for workers/contractors who have
    received an advance/payment. Used by the /dashboard route."""
    items = []
    # Workers with advance given
    for w in workers:
        advs = await db.advances.find({"user_id": user_id, "worker_id": w["id"]}, {"_id": 0}).to_list(1000)
        if not advs:
            continue
        led = await compute_worker_ledger(user_id, w)
        items.append({
            "type": "worker",
            "name": w["name"],
            "pending": led["pending"],
            "advance": led["total_advance"],
        })
    # Contractors with payment given
    contractors = await db.contractors.find({"user_id": user_id}, {"_id": 0}).to_list(500)
    for c in contractors:
        payments = await db.contractor_payments.find({"user_id": user_id, "contractor_id": c["id"]}, {"_id": 0}).to_list(1000)
        if not payments:
            continue
        returns = await db.contractor_returns.find({"user_id": user_id, "contractor_id": c["id"]}, {"_id": 0}).to_list(1000)
        total_paid = sum(p["amount"] for p in payments)
        total_returned = sum(r["amount"] for r in returns)
        net_paid = round(total_paid - total_returned, 2)
        items.append({
            "type": "contractor",
            "name": c["name"],
            "pending": net_paid,
            "advance": round(total_paid, 2),
        })
    return items

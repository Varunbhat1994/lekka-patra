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


def _wage_units(
    status: str,
    overtime_hours: float,
    daily_rate: float,
    *,
    manual_wage: Optional[float] = None,
    overtime_amount: Optional[float] = None,
) -> float:
    """Compute the monetary earning for one attendance row.

    Priority order — most explicit first:
        · manual_wage      → used verbatim (any status where the owner
                              typed an override; typically half_day)
        · overtime_amount  → status='overtime' → daily_rate + amount
        · overtime_hours   → status='overtime' → legacy formula
        · half_day         → 0.5 × daily_rate  (legacy fallback)
        · present          → daily_rate
        · anything else    → 0.0
    """
    if manual_wage is not None:
        return float(manual_wage)
    if status == "present":
        return daily_rate
    if status == "half_day":
        return daily_rate * 0.5
    if status == "overtime":
        if overtime_amount is not None:
            return daily_rate + float(overtime_amount)
        # legacy hours-based formula preserved verbatim
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
    att = await db.attendance.find(q, {"_id": 0}).sort("date", -1).to_list(10000)
    total_earned = 0.0
    days_worked = 0.0
    for a in att:
        # Prefer the wage snapshot stored on the row (locked at write
        # time) so wage-rate edits never rewrite historical earnings.
        # Fall back to the worker's current daily_rate for legacy rows
        # created before `daily_rate_snapshot` existed.
        rate = a.get("daily_rate_snapshot")
        if rate is None:
            rate = worker["daily_rate"]
        u = _wage_units(
            a["status"],
            a.get("overtime_hours", 0),
            rate,
            manual_wage=a.get("manual_wage"),
            overtime_amount=a.get("overtime_amount"),
        )
        total_earned += u
        if a["status"] == "present":
            days_worked += 1
        elif a["status"] == "half_day":
            days_worked += 0.5
        elif a["status"] == "overtime":
            # Amount-based overtime = a full day + monetary bonus (no
            # fractional-day inflation). Legacy hours-based overtime
            # keeps its "1 + hours/8" day count for backward compat.
            if a.get("overtime_amount") is not None:
                days_worked += 1
            else:
                days_worked += 1 + a.get("overtime_hours", 0) / 8.0

    # Advances and returns.
    # For CURRENT-cycle mode (no explicit start/end): they are an
    # independent running balance that carries forward across settlements.
    # For HISTORY mode (start & end supplied): filter by the same date
    # window so year/month views show only what happened in that period.
    adv_q = {"user_id": user_id, "worker_id": worker["id"]}
    if start and end:
        adv_q["date"] = {"$gte": start, "$lte": end}
    advances = await db.advances.find(adv_q, {"_id": 0}).sort("date", -1).to_list(10000)
    total_advance = sum(a["amount"] for a in advances)
    returns = await db.advance_returns.find(adv_q, {"_id": 0}).sort("date", -1).to_list(10000)
    total_returned = sum(r["amount"] for r in returns)
    # Settlements in history mode: filter by up_to_date; in current mode
    # keep all_settlements (used to compute cutoff above).
    if start and end:
        settlements_in_range = [
            s for s in all_settlements
            if s.get("up_to_date") and start <= s["up_to_date"] <= end
        ]
        total_settled = sum(s.get("amount", 0) or 0 for s in settlements_in_range)
        settlements_out = settlements_in_range
    else:
        total_settled = sum(s.get("amount", 0) or 0 for s in all_settlements)
        settlements_out = all_settlements
    net_advance = total_advance - total_returned
    pending = total_earned
    # Period-aware final balance — SINGLE SOURCE OF TRUTH.
    #
    # Positive → employer owes worker  ("You owe worker ₹X")
    # Negative → worker owes employer  ("Worker owes you ₹X")
    # Zero     → balanced
    #
    # CURRENT-CYCLE mode (no start/end): `total_earned` is already
    # cutoff-filtered (resets after each Mark Settled), while
    # `net_advance` intentionally carries forward. `total_settled`
    # is cumulative (all-time) and must NOT be subtracted here — the
    # earnings it closed out are already excluded from `total_earned`
    # by the cutoff, so subtracting the settlement again would
    # double-count the closed period and produce a bogus deficit.
    #
    # HISTORY mode (start & end supplied): earnings, advances,
    # returns AND settlements are all windowed by the same date
    # range, so the classical accounting formula
    #     earned - net_advance - settled_paid_in_window
    # accurately reflects the net activity of that window.
    if start and end:
        final_balance = total_earned - net_advance - total_settled
    else:
        final_balance = total_earned - net_advance
    return {
        "worker": worker,
        "days_worked": round(days_worked, 2),
        "total_earned": round(total_earned, 2),
        "total_advance": round(total_advance, 2),
        "total_returned": round(total_returned, 2),
        "total_settled": round(total_settled, 2),
        "net_advance": round(net_advance, 2),
        "pending": round(pending, 2),
        "final_balance": round(final_balance, 2),
        "settled_up_to": cutoff,
        "attendance": att,
        "advances": advances,
        "returns": returns,
        "settlements": settlements_out,
        "range": {"start": start, "end": end} if (start and end) else None,
    }


async def compute_contractor_ledger(
    user_id: str,
    contractor: dict,
    start: Optional[str] = None,
    end: Optional[str] = None,
) -> dict:
    """Contractor equivalent of compute_worker_ledger — supports the same
    optional date-range filter for year/month history views. Ownership is
    the caller's responsibility (pass a contractor doc already scoped by
    user_id). This is the single source of truth used by both the UI
    ledger route and the PDF/Excel export.

    Contractor semantics (deliberately NOT a copy of the worker formula):

        net_paid       = total_paid - total_returned    (unchanged)
        total_settled  = Σ settlement.amount for this contractor
                         (kind='contractor_settle' only — never mixes
                         with worker settlements). Informational.
        final_balance  = -net_paid   (both current and history)
                         > 0 → "You owe contractor"
                         < 0 → "Contractor owes you"
                         = 0 → "Balanced"

    `final_balance` deliberately does NOT subtract `total_settled`
    because contractor settlements already write a matching
    `contractor_returns` row, so their cash effect is already in
    `total_returned`. Subtracting settled again would double-count.
    `total_settled` is surfaced only so the UI can distinguish
    "return via settlement" from "voluntary return" in historical
    views.
    """
    cid = contractor["id"]
    base = {"user_id": user_id, "contractor_id": cid}
    dated = dict(base)
    if start and end:
        dated["date"] = {"$gte": start, "$lte": end}
    visits = await db.contractor_visits.find(dated, {"_id": 0}).sort("date", -1).to_list(10000)
    payments = await db.contractor_payments.find(dated, {"_id": 0}).sort("date", -1).to_list(10000)
    returns = await db.contractor_returns.find(dated, {"_id": 0}).sort("date", -1).to_list(10000)
    total_paid = sum(p["amount"] for p in payments)
    total_returned = sum(r["amount"] for r in returns)
    net_paid = round(total_paid - total_returned, 2)

    # Contractor-scoped settlements only — kind='contractor_settle'.
    # Never counts worker settlements.
    settle_q = {
        "user_id": user_id,
        "contractor_id": cid,
        "kind": "contractor_settle",
    }
    if start and end:
        settle_q["up_to_date"] = {"$gte": start, "$lte": end}
    settlements = await db.settlements.find(settle_q, {"_id": 0}).sort("up_to_date", -1).to_list(1000)
    total_settled = round(sum(float(s.get("amount", 0) or 0) for s in settlements), 2)

    final_balance = round(-net_paid, 2)

    return {
        "contractor": contractor,
        "total_visits": len(visits),
        "total_workers_brought": sum(v.get("workers_count", 0) for v in visits),
        "total_paid": round(total_paid, 2),
        "total_returned": round(total_returned, 2),
        "net_paid": net_paid,
        "total_settled": total_settled,
        "final_balance": final_balance,
        "visits": visits,
        "payments": payments,
        "returns": returns,
        "settlements": settlements,
        "range": {"start": start, "end": end} if (start and end) else None,
    }


async def _compute_pending_list(user_id: str, workers: list) -> list:
    """List of {name, pending, advance, type} for workers/contractors who
    have received an advance/payment.

    `pending` here is the same period-aware `final_balance` used by the
    Ledger UI — one accounting model across the whole app. Positive means
    owner still owes the worker; negative means worker owes owner.
    """
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
            "pending": led["final_balance"],
            "advance": led["net_advance"],
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
            # For contractors, "pending" is the outstanding amount the
            # contractor still owes the owner — expressed as negative to
            # keep the marquee's sign convention consistent with workers.
            "pending": -net_paid,
            "advance": net_paid,
        })
    return items

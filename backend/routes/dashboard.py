"""Dashboard summary route.

Aggregated numbers on the dashboard use the SAME period-aware ledger
model as the Ledger and Worker History pages. `outstanding_advance`
is the sum of positive per-worker net advances (money that hasn't
been returned yet). `pending_wage` is the sum of positive
per-worker final balances (what the owner still owes workers). This
guarantees the dashboard totals equal the sum of what the user sees on
each individual worker card — no separate formula.
"""
from typing import Optional

from fastapi import APIRouter, Depends

from core.database import db
from security.authentication import get_current_user
from services.ledger import _wage_units, _compute_pending_list, compute_worker_ledger
from datetime import datetime, timezone


router = APIRouter()


def now_utc():
    return datetime.now(timezone.utc)


@router.get("/dashboard")
async def dashboard(user: dict = Depends(get_current_user)):
    today = now_utc().strftime("%Y-%m-%d")
    workers = await db.workers.find({"user_id": user["user_id"]}, {"_id": 0}).to_list(1000)
    workers_by_id = {w["id"]: w for w in workers}

    today_att = await db.attendance.find({"user_id": user["user_id"], "date": today}, {"_id": 0}).to_list(1000)
    present_today = sum(1 for a in today_att if a["status"] in ("present", "half_day", "overtime"))
    est_wage_today = 0.0
    for a in today_att:
        w = workers_by_id.get(a["worker_id"])
        if not w: continue
        est_wage_today += _wage_units(a["status"], a.get("overtime_hours", 0), w["daily_rate"])

    # Aggregate current-cycle balances by summing per-worker ledgers so
    # dashboard totals match what the Ledger UI shows for each worker.
    outstanding_advance = 0.0
    pending_wage = 0.0
    for w in workers:
        led = await compute_worker_ledger(user["user_id"], w)
        adv_net = float(led["net_advance"])
        if adv_net > 0:
            outstanding_advance += adv_net
        fb = float(led["final_balance"])
        if fb > 0:
            pending_wage += fb

    # Monthly by field/crop (last 6 months) — this is a historical breakdown,
    # so we still read ALL attendance (unchanged behavior).
    all_att = await db.attendance.find({"user_id": user["user_id"]}, {"_id": 0}).to_list(20000)
    from collections import defaultdict
    monthly = defaultdict(lambda: defaultdict(float))
    for a in all_att:
        w = workers_by_id.get(a["worker_id"])
        if not w: continue
        month = a["date"][:7]
        crop = a.get("field_crop") or "Uncategorized"
        monthly[month][crop] += _wage_units(a["status"], a.get("overtime_hours", 0), w["daily_rate"])
    # Convert to list
    months_sorted = sorted(monthly.keys())[-6:]
    chart = []
    all_crops = set()
    for m in months_sorted:
        for c in monthly[m].keys():
            all_crops.add(c)
    for m in months_sorted:
        row = {"month": m}
        for c in all_crops:
            row[c] = round(monthly[m].get(c, 0), 2)
        chart.append(row)

    return {
        "workers_total": len(workers),
        "present_today": present_today,
        "estimated_wage_today": round(est_wage_today, 2),
        "outstanding_advance": round(outstanding_advance, 2),
        "pending_wage": round(pending_wage, 2),
        "chart": chart,
        "crops": sorted(list(all_crops)),
        "pending_list": await _compute_pending_list(user["user_id"], workers),
    }


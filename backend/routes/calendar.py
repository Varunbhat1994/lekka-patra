"""Read-only Attendance Calendar endpoints.

STRICTLY read-only. Introduced for the Dashboard calendar widget. These
endpoints:
    - do NOT create/update/delete any records
    - do NOT touch accounting: no ledger, no wage math, no settlements
    - only read `db.workers` and `db.attendance` scoped to the current
      authenticated user

Endpoints:
    GET /calendar/month?worker_id=&year=YYYY&month=MM
        → { worker_id, year, month, records: [{date, status}, ...] }
        Only the currently authenticated user's worker records for that
        month. status is exactly what's stored ("present" | "half_day" |
        "overtime" | "absent"). Absent rows are OMITTED so the frontend
        only receives dates that should be highlighted.

    GET /calendar/date?date=YYYY-MM-DD
        → { date, workers: [{worker_id, name, status}, ...] }
        Every one of the caller's workers with an attendance record on
        the requested date. Empty list when nobody has a record. Absent
        rows are OMITTED (calendar never claims a worker as "absent").
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from core.database import db
from security.authentication import get_current_user


router = APIRouter()

# Statuses the calendar considers as "worked" — absent is deliberately
# excluded so a highlighted date always represents actual work.
_WORKED_STATUSES = ("present", "half_day", "overtime")


@router.get("/calendar/month")
async def calendar_month(
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
    worker_id: str = Query(...),
    user: dict = Depends(get_current_user),
):
    # Ownership: the worker must belong to the caller. This blocks
    # cross-user data leakage even if a client passes another user's id.
    worker = await db.workers.find_one(
        {"id": worker_id, "user_id": user["user_id"]}, {"_id": 0, "id": 1}
    )
    if not worker:
        raise HTTPException(404, "Worker not found")

    # Compute the string range for the month, e.g. 2026-08-01 .. 2026-08-31.
    start = f"{year:04d}-{month:02d}-01"
    if month == 12:
        end = f"{year+1:04d}-01-01"
    else:
        end = f"{year:04d}-{month+1:02d}-01"

    cursor = db.attendance.find(
        {
            "user_id": user["user_id"],
            "worker_id": worker_id,
            "date": {"$gte": start, "$lt": end},
            "status": {"$in": list(_WORKED_STATUSES)},
        },
        {"_id": 0, "date": 1, "status": 1},
    )
    rows = await cursor.to_list(500)
    return {
        "worker_id": worker_id,
        "year": year,
        "month": month,
        "records": [{"date": r["date"], "status": r["status"]} for r in rows],
    }


@router.get("/calendar/date")
async def calendar_date(
    date: str = Query(..., min_length=10, max_length=10),
    user: dict = Depends(get_current_user),
):
    """Return every worker (belonging to the caller) with a worked
    attendance status on this date. Absent rows are omitted."""
    # Gather all caller's workers to enforce isolation via id lookup.
    workers = await db.workers.find(
        {"user_id": user["user_id"]},
        {"_id": 0, "id": 1, "name": 1},
    ).to_list(1000)
    worker_by_id = {w["id"]: w for w in workers}
    if not worker_by_id:
        return {"date": date, "workers": []}

    rows = await db.attendance.find(
        {
            "user_id": user["user_id"],
            "date": date,
            "worker_id": {"$in": list(worker_by_id.keys())},
            "status": {"$in": list(_WORKED_STATUSES)},
        },
        {"_id": 0, "worker_id": 1, "status": 1},
    ).to_list(1000)

    workers_out = []
    for r in rows:
        w = worker_by_id.get(r["worker_id"])
        if not w:
            continue
        workers_out.append(
            {
                "worker_id": r["worker_id"],
                "name": w.get("name", ""),
                "status": r["status"],
            }
        )
    # Deterministic order: name asc
    workers_out.sort(key=lambda x: (x["name"] or "").lower())
    return {"date": date, "workers": workers_out}

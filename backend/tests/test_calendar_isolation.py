"""Phase 3 dashboard-calendar: read-only endpoints + cross-user isolation.

Guarantees:
  - GET /calendar/month rejects a worker_id that isn't owned by caller
  - GET /calendar/month returns only worked statuses for the caller's worker
  - GET /calendar/date returns only workers belonging to the caller
    (never leaks another user's workers who worked that day)
"""
import os
import sys
import uuid
from datetime import datetime, timezone

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.database import db  # noqa: E402
from routes.calendar import calendar_month, calendar_date  # noqa: E402
from fastapi import HTTPException  # noqa: E402


def _now():
    return datetime.now(timezone.utc)


async def _seed_user(prefix):
    uid = f"{prefix}_{uuid.uuid4()}"
    await db.users.insert_one({
        "user_id": uid,
        "email": f"{prefix}@t.com",
        "name": prefix,
        "created_at": _now().isoformat(),
        "trial_start": _now().isoformat(),
        "is_paid": False,
    })
    return {"user_id": uid}


async def _seed_worker(uid, name, rate=500):
    wid = str(uuid.uuid4())
    await db.workers.insert_one({
        "id": wid,
        "user_id": uid,
        "name": name,
        "mobile": "9000000000",
        "skill": "Field",
        "daily_rate": rate,
        "worker_type": "regular",
        "created_at": _now().isoformat(),
    })
    return wid


async def _seed_att(uid, wid, date, status):
    await db.attendance.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": uid,
        "worker_id": wid,
        "date": date,
        "status": status,
        "overtime_hours": 0,
        "field_crop": "",
        "description": "",
        "daily_rate_snapshot": 500,
        "created_at": _now().isoformat(),
    })


async def _cleanup(*uids):
    for uid in uids:
        await db.attendance.delete_many({"user_id": uid})
        await db.workers.delete_many({"user_id": uid})
        await db.users.delete_one({"user_id": uid})


@pytest.mark.asyncio
async def test_1_month_returns_only_worked_records():
    u = await _seed_user("cal1")
    w = await _seed_worker(u["user_id"], "Ramesh")
    await _seed_att(u["user_id"], w, "2026-02-10", "present")
    await _seed_att(u["user_id"], w, "2026-02-11", "half_day")
    await _seed_att(u["user_id"], w, "2026-02-12", "overtime")
    await _seed_att(u["user_id"], w, "2026-02-13", "absent")  # excluded
    try:
        out = await calendar_month(year=2026, month=2, worker_id=w, user=u)
        dates = {r["date"] for r in out["records"]}
        statuses = {r["date"]: r["status"] for r in out["records"]}
        assert dates == {"2026-02-10", "2026-02-11", "2026-02-12"}
        assert statuses["2026-02-10"] == "present"
        assert statuses["2026-02-11"] == "half_day"
        assert statuses["2026-02-12"] == "overtime"
    finally:
        await _cleanup(u["user_id"])


@pytest.mark.asyncio
async def test_2_month_rejects_foreign_worker_id():
    a = await _seed_user("calA")
    b = await _seed_user("calB")
    wa = await _seed_worker(a["user_id"], "A-worker")
    try:
        with pytest.raises(HTTPException) as ei:
            await calendar_month(year=2026, month=2, worker_id=wa, user=b)
        assert ei.value.status_code == 404
    finally:
        await _cleanup(a["user_id"], b["user_id"])


@pytest.mark.asyncio
async def test_3_date_returns_only_callers_workers():
    a = await _seed_user("calA2")
    b = await _seed_user("calB2")
    wa = await _seed_worker(a["user_id"], "A-worker")
    wb = await _seed_worker(b["user_id"], "B-worker")
    d = "2026-02-15"
    await _seed_att(a["user_id"], wa, d, "present")
    await _seed_att(b["user_id"], wb, d, "half_day")
    try:
        out_a = await calendar_date(date=d, user=a)
        assert len(out_a["workers"]) == 1
        assert out_a["workers"][0]["worker_id"] == wa
        assert out_a["workers"][0]["status"] == "present"

        out_b = await calendar_date(date=d, user=b)
        assert len(out_b["workers"]) == 1
        assert out_b["workers"][0]["worker_id"] == wb
        assert out_b["workers"][0]["status"] == "half_day"

        # Absolute no cross-user leakage
        assert not any(w["worker_id"] == wb for w in out_a["workers"])
        assert not any(w["worker_id"] == wa for w in out_b["workers"])
    finally:
        await _cleanup(a["user_id"], b["user_id"])


@pytest.mark.asyncio
async def test_4_date_omits_absent():
    u = await _seed_user("calAb")
    w = await _seed_worker(u["user_id"], "Ramesh")
    await _seed_att(u["user_id"], w, "2026-02-20", "absent")
    try:
        out = await calendar_date(date="2026-02-20", user=u)
        assert out["workers"] == []
    finally:
        await _cleanup(u["user_id"])


@pytest.mark.asyncio
async def test_5_status_pass_through_no_inference():
    """Never combines half_day + overtime; each stored status returned verbatim."""
    u = await _seed_user("calStatus")
    r = await _seed_worker(u["user_id"], "Ramesh")
    s = await _seed_worker(u["user_id"], "Suresh")
    k = await _seed_worker(u["user_id"], "Kumar")
    d = "2026-02-25"
    await _seed_att(u["user_id"], r, d, "present")
    await _seed_att(u["user_id"], s, d, "half_day")
    await _seed_att(u["user_id"], k, d, "overtime")
    try:
        out = await calendar_date(date=d, user=u)
        assert len(out["workers"]) == 3
        by_name = {w["name"]: w["status"] for w in out["workers"]}
        assert by_name["Ramesh"] == "present"
        assert by_name["Suresh"] == "half_day"
        assert by_name["Kumar"] == "overtime"
    finally:
        await _cleanup(u["user_id"])

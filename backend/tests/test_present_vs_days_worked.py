"""Test the new Present vs Days Worked distinction in Worker ledger + PDF.

Scenario (per review_request):
  daily_rate = 500
  Day1: present         -> +1 attendance day, +1.0 wage-unit, ₹500
  Day2: half_day        -> +1 attendance day, +0.5 wage-unit, ₹250
  Day3: overtime, manual_amount=150  -> +1 attendance day, +1.0 wage-unit, ₹650
  Expect: present_count=3, days_worked=2.5, total_earned=1400

Also validates:
  - Duplicate-same-date POST keeps present_count == 1
  - PDF contains "Present" and "Days Worked" headers and both 3 and 2.5
  - Per-row parity: 'Rs 500 + Rs 150 (OT)' and 'Final Amount = Rs 650' appear
  - Contractor ledger unchanged: no present_count field
  - Cross-user isolation on /ledger and /reports/pdf?worker_id=
"""
import asyncio
import io
import os
import sys
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import httpx
from pypdf import PdfReader

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from core.database import db  # noqa: E402

BASE = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://field-crew-log-1.preview.emergentagent.com",
).rstrip("/") + "/api"


# ---------- helpers ----------
async def _seed(uid: str, mobile: str) -> str:
    now = datetime.now(timezone.utc)
    await db.users.insert_one({
        "user_id": uid, "email": f"{uid}@t.com", "mobile": mobile,
        "name": f"T_{uid[:6]}", "role": "owner",
        "subscription_active": True,
        "subscription_expires_at": (now + timedelta(days=365)).isoformat(),
        "trial_starts_at": now.isoformat(),
        "trial_expires_at": (now + timedelta(days=365)).isoformat(),
        "created_at": now.isoformat(),
    })
    token = uuid.uuid4().hex + uuid.uuid4().hex
    await db.user_sessions.insert_one({
        "session_token": token, "user_id": uid,
        "expires_at": (now + timedelta(hours=2)).isoformat(),
        "created_at": now.isoformat(),
    })
    return token


async def _cleanup(uid: str, token: str) -> None:
    for coll in ("users", "user_sessions", "workers", "attendance",
                 "advances", "advance_returns", "settlements",
                 "contractors", "contractor_visits",
                 "contractor_payments", "contractor_returns"):
        await db[coll].delete_many({"user_id": uid})
    await db.user_sessions.delete_many({"session_token": token})


def _pdf_text(b: bytes) -> str:
    return "\n".join(p.extract_text() or "" for p in PdfReader(io.BytesIO(b)).pages)


# ---------- Present vs Days Worked scenario ----------
async def _run_worker_ledger_present_count_and_days_worked_distinction():
    uid = f"pvd_{uuid.uuid4().hex[:6]}"
    tok = await _seed(uid, "9010001001")
    try:
        async with httpx.AsyncClient(
            base_url=BASE, headers={"Authorization": f"Bearer {tok}"},
            timeout=30, verify=False,
        ) as c:
            w = (await c.post("/workers", json={
                "name": "TestPVD", "mobile": "", "skill": "",
                "daily_rate": 500, "worker_type": "regular",
            })).json()

            r1 = await c.post("/attendance", json={
                "worker_id": w["id"], "date": "2026-04-01", "status": "present",
            })
            r2 = await c.post("/attendance", json={
                "worker_id": w["id"], "date": "2026-04-02", "status": "half_day",
            })
            r3 = await c.post("/attendance", json={
                "worker_id": w["id"], "date": "2026-04-03",
                "status": "overtime", "overtime_amount": 150,
            })
            for r in (r1, r2, r3):
                assert r.status_code == 200, r.text

            led = (await c.get(f"/ledger/{w['id']}")).json()
            assert "present_count" in led, "New field 'present_count' missing"
            assert led["present_count"] == 3, led
            assert led["days_worked"] == 2.5, led
            assert led["total_earned"] == 1400.0, led

            # Per-row parity on OT row
            ot_row = next(a for a in led["attendance"] if a["date"] == "2026-04-03")
            assert ot_row["wage_component"] == 500.0
            assert ot_row["ot_component"] == 150.0
            assert ot_row["final_amount"] == 650.0

            # PDF checks
            pdf = await c.get(f"/reports/pdf?worker_id={w['id']}")
            assert pdf.status_code == 200
            assert pdf.headers["content-type"] == "application/pdf"
            text = _pdf_text(pdf.content)
            assert "Present" in text, "PDF missing 'Present' header"
            assert "Days Worked" in text, "PDF missing 'Days Worked' header"
            # summary row values
            assert "3" in text and "2.5" in text, text[:800]
            assert "1400" in text, text[:800]
            # per-row OT parity in PDF body
            assert "500" in text and "150" in text and "650" in text
    finally:
        await _cleanup(uid, tok)


async def _run_same_date_upsert_present_count_stays_one():
    uid = f"dup_{uuid.uuid4().hex[:6]}"
    tok = await _seed(uid, "9010001002")
    try:
        async with httpx.AsyncClient(
            base_url=BASE, headers={"Authorization": f"Bearer {tok}"},
            timeout=30, verify=False,
        ) as c:
            w = (await c.post("/workers", json={
                "name": "Dup", "mobile": "", "skill": "",
                "daily_rate": 500, "worker_type": "regular",
            })).json()
            payload = {"worker_id": w["id"], "date": "2026-04-10", "status": "present"}
            r1, r2 = await asyncio.gather(
                c.post("/attendance", json=payload),
                c.post("/attendance", json=payload),
            )
            assert r1.status_code == 200 and r2.status_code == 200
            # Overwrite same date with overtime — still 1 attendance date
            r3 = await c.post("/attendance", json={
                "worker_id": w["id"], "date": "2026-04-10",
                "status": "overtime", "overtime_amount": 100,
            })
            assert r3.status_code == 200
            led = (await c.get(f"/ledger/{w['id']}")).json()
            assert led["present_count"] == 1, led
            # After upsert the row is now overtime → days_worked = 1.0
            assert led["days_worked"] == 1.0, led
            assert led["total_earned"] == 600.0, led
    finally:
        await _cleanup(uid, tok)


async def _run_contractor_ledger_unchanged_no_present_count():
    uid = f"con_{uuid.uuid4().hex[:6]}"
    tok = await _seed(uid, "9010001003")
    try:
        async with httpx.AsyncClient(
            base_url=BASE, headers={"Authorization": f"Bearer {tok}"},
            timeout=30, verify=False,
        ) as c:
            cn = (await c.post("/contractors", json={
                "name": "CX", "mobile": "", "notes": "",
            })).json()
            await c.post("/contractor-payments", json={
                "contractor_id": cn["id"], "date": "2026-04-05",
                "amount": 5000, "method": "cash",
            })
            await c.post("/contractor-returns", json={
                "contractor_id": cn["id"], "date": "2026-04-15",
                "amount": 2000, "method": "cash",
            })
            led = (await c.get(f"/contractors/{cn['id']}/ledger")).json()
            assert "present_count" not in led, "Contractor ledger must NOT have present_count"
            assert led["net_paid"] == 3000.0
            assert led["total_settled"] == 0.0
            assert led["final_balance"] == -3000.0
            # Contractor PDF unchanged
            pdf = await c.get(f"/reports/contractor/{cn['id']}/pdf")
            assert pdf.status_code == 200
            text = _pdf_text(pdf.content)
            assert "Contractor owes you" in text and "3000" in text
    finally:
        await _cleanup(uid, tok)


async def _run_cross_user_isolation_ledger_and_pdf():
    uidA = f"pvA_{uuid.uuid4().hex[:6]}"
    uidB = f"pvB_{uuid.uuid4().hex[:6]}"
    tokA = await _seed(uidA, "9010002001")
    tokB = await _seed(uidB, "9010002002")
    try:
        async with httpx.AsyncClient(
            base_url=BASE, headers={"Authorization": f"Bearer {tokA}"},
            timeout=30, verify=False,
        ) as cA:
            wA = (await cA.post("/workers", json={
                "name": "WA", "mobile": "", "skill": "",
                "daily_rate": 500, "worker_type": "regular",
            })).json()
            await cA.post("/attendance", json={
                "worker_id": wA["id"], "date": "2026-04-01", "status": "present",
            })
        async with httpx.AsyncClient(
            base_url=BASE, headers={"Authorization": f"Bearer {tokB}"},
            timeout=30, verify=False,
        ) as cB:
            for path in (f"/ledger/{wA['id']}",
                         f"/reports/pdf?worker_id={wA['id']}"):
                r = await cB.get(path)
                assert r.status_code in (403, 404), f"LEAK on {path}: {r.status_code}"
            for payload in (("/attendance", {"worker_id": wA["id"], "date": "2026-04-04", "status": "present"}),
                            ("/advances",   {"worker_id": wA["id"], "date": "2026-04-04", "amount": 100, "method": "cash"}),
                            ("/returns",    {"worker_id": wA["id"], "date": "2026-04-04", "amount": 100, "method": "cash"})):
                r = await cB.post(payload[0], json=payload[1])
                assert r.status_code in (403, 404), f"LEAK on POST {payload[0]}: {r.status_code}"
            r = await cB.delete(f"/workers/{wA['id']}")
            assert r.status_code in (403, 404)
    finally:
        await _cleanup(uidA, tokA)
        await _cleanup(uidB, tokB)


# ---------- sync pytest entrypoints (project uses no pytest-asyncio) ----------
# All scenarios share a single event loop because Motor's client binds to
# the first loop it sees; using asyncio.run() per test closes that loop
# and breaks the shared `db` handle for subsequent tests.
def test_present_vs_days_worked_all_scenarios():
    async def _all():
        await _run_worker_ledger_present_count_and_days_worked_distinction()
        await _run_same_date_upsert_present_count_stays_one()
        await _run_contractor_ledger_unchanged_no_present_count()
        await _run_cross_user_isolation_ledger_and_pdf()
    asyncio.run(_all())

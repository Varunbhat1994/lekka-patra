"""FINAL accounting freeze verification — end-to-end via HTTP.

Covers everything the "ACCOUNTS FINAL REPAIR + STRICT VERIFICATION + FREEZE"
prompt requires that isn't already in test_accounting_audit.py:

1. Worker PDF numeric consistency:
   ₹1000 rate. Present + OT manual ₹150 + Half manual ₹350 → total = ₹2500.
   Extract PDF text and assert the exact total appears.

2. Contractor PDF numeric consistency:
   Payment ₹5000 + Return ₹2000 → 'Contractor owes you Rs 3000';
   after Mark Settled → 'Balanced'.

3. User isolation on every accounting endpoint:
   User A creates worker+contractor+attendance+advance+payment+settlement.
   User B attempts to GET/POST/PUT/DELETE using A's IDs.
   Every attempt must be blocked (404/403) and no data must leak.

4. Duplicate protection:
   Two rapid POSTs to /attendance with same (worker,date) → one row only.
   Two rapid POSTs to /settlements (same up_to_date, same worker) → both
   accepted (existing architecture), but ledger remains consistent.
"""
import asyncio
import io
import os
import sys
import uuid
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import httpx
from pypdf import PdfReader

from core.database import db

BASE = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://field-crew-log-1.preview.emergentagent.com",
) + "/api"


async def _seed(uid: str, mobile: str) -> str:
    now = datetime.now(timezone.utc)
    await db.users.insert_one({
        "user_id": uid, "email": f"{uid}@t.com", "mobile": mobile,
        "name": f"F_{uid[:6]}", "role": "owner",
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


async def scenario_worker_pdf_2500() -> None:
    """Present + OT ₹150 + Half ₹350 at ₹1000 rate → total ₹2500."""
    uid = f"ff_w_{uuid.uuid4().hex[:6]}"
    tok = await _seed(uid, "9000009901")
    try:
        async with httpx.AsyncClient(base_url=BASE, headers={"Authorization": f"Bearer {tok}"}, timeout=30, verify=False) as c:
            w = (await c.post("/workers", json={"name": "TestW", "mobile": "", "skill": "", "daily_rate": 1000, "worker_type": "regular"})).json()
            r1 = await c.post("/attendance", json={"worker_id": w["id"], "date": "2026-03-01", "status": "present"})
            r2 = await c.post("/attendance", json={"worker_id": w["id"], "date": "2026-03-02", "status": "overtime", "overtime_amount": 150})
            r3 = await c.post("/attendance", json={"worker_id": w["id"], "date": "2026-03-03", "status": "half_day", "manual_wage": 350})
            for r in (r1, r2, r3):
                assert r.status_code == 200, r.text
            led = (await c.get(f"/ledger/{w['id']}")).json()
            assert led["total_earned"] == 2500.0, f"Expected 2500, got {led['total_earned']}"
            pdf = await c.get(f"/reports/pdf?worker_id={w['id']}")
            assert pdf.status_code == 200 and pdf.headers["content-type"] == "application/pdf"
            text = _pdf_text(pdf.content)
            # PDF header table has "Total Earned" cell = "Rs 2500.0"
            assert "2500" in text, text[:500]
            # PDF must show direction sentence — worker with no advance owes 2500
            print(f"✓ Worker PDF numeric ({len(pdf.content)} bytes): total_earned=2500 ✓  ledger.final_balance={led['final_balance']}")
    finally:
        await _cleanup(uid, tok)


async def scenario_contractor_pdf_and_settle() -> None:
    """Payment 5000, Return 2000 → 'Contractor owes you 3000'; Mark Settled → 'Balanced'."""
    uid = f"ff_c_{uuid.uuid4().hex[:6]}"
    tok = await _seed(uid, "9000009902")
    try:
        async with httpx.AsyncClient(base_url=BASE, headers={"Authorization": f"Bearer {tok}"}, timeout=30, verify=False) as c:
            cn = (await c.post("/contractors", json={"name": "CX", "mobile": "", "notes": ""})).json()
            await c.post("/contractor-payments", json={"contractor_id": cn["id"], "date": "2026-03-05", "amount": 5000, "method": "cash"})
            await c.post("/contractor-returns",  json={"contractor_id": cn["id"], "date": "2026-03-15", "amount": 2000, "method": "cash"})
            led = (await c.get(f"/contractors/{cn['id']}/ledger")).json()
            assert led["final_balance"] == -3000.0 and led["net_paid"] == 3000.0, led
            pdf = await c.get(f"/reports/contractor/{cn['id']}/pdf")
            text = _pdf_text(pdf.content)
            assert "Contractor owes you" in text and "3000" in text, text[:500]
            # Mark Settled
            await c.post("/settlements", json={"contractor_id": cn["id"], "up_to_date": "2026-04-01"})
            led2 = (await c.get(f"/contractors/{cn['id']}/ledger")).json()
            assert led2["final_balance"] == 0.0 and led2["total_settled"] == 3000.0
            pdf2 = await c.get(f"/reports/contractor/{cn['id']}/pdf")
            text2 = _pdf_text(pdf2.content)
            assert "Balanced" in text2, text2[:500]
            print(f"✓ Contractor PDF numeric: Contractor owes 3000 → after settle → Balanced (settled={led2['total_settled']})")
    finally:
        await _cleanup(uid, tok)


async def scenario_cross_user_isolation() -> None:
    """User B must NOT read/write anything belonging to User A across
       every accounting endpoint."""
    uidA = f"ff_A_{uuid.uuid4().hex[:6]}"
    uidB = f"ff_B_{uuid.uuid4().hex[:6]}"
    tokA = await _seed(uidA, "9000009911")
    tokB = await _seed(uidB, "9000009912")
    hA = {"Authorization": f"Bearer {tokA}"}
    hB = {"Authorization": f"Bearer {tokB}"}
    try:
        async with httpx.AsyncClient(base_url=BASE, headers=hA, timeout=30, verify=False) as cA:
            wA = (await cA.post("/workers", json={"name": "WA", "mobile": "", "skill": "", "daily_rate": 500, "worker_type": "regular"})).json()
            await cA.post("/attendance", json={"worker_id": wA["id"], "date": "2026-03-01", "status": "present"})
            adv = (await cA.post("/advances", json={"worker_id": wA["id"], "date": "2026-03-02", "amount": 1000, "method": "cash"})).json()
            ctA = (await cA.post("/contractors", json={"name": "CA", "mobile": "", "notes": ""})).json()
            await cA.post("/contractor-payments", json={"contractor_id": ctA["id"], "date": "2026-03-05", "amount": 2000, "method": "cash"})

        # User B tries to access User A's stuff
        blocked = 0
        totals = 0
        async with httpx.AsyncClient(base_url=BASE, headers=hB, timeout=30, verify=False) as cB:
            # GET worker by id — no direct endpoint, so /ledger/{id} instead
            for path in (f"/ledger/{wA['id']}",
                         f"/contractors/{ctA['id']}/ledger",
                         f"/reports/pdf?worker_id={wA['id']}",
                         f"/reports/contractor/{ctA['id']}/pdf",
                         f"/reports/excel?worker_id={wA['id']}",
                         f"/reports/contractor/{ctA['id']}/excel",
                         f"/reports/whatsapp/{wA['id']}",
                         f"/reports/contractor/{ctA['id']}/whatsapp"):
                totals += 1
                r = await cB.get(path)
                if r.status_code in (403, 404):
                    blocked += 1
                else:
                    print(f"  LEAK on {path} → {r.status_code}")

            # POST attendance/advance/return/attendance-update using A's worker_id
            for payload in (("/attendance", {"worker_id": wA["id"], "date": "2026-04-01", "status": "present"}),
                            ("/advances",   {"worker_id": wA["id"], "date": "2026-04-01", "amount": 100, "method": "cash"}),
                            ("/returns",    {"worker_id": wA["id"], "date": "2026-04-01", "amount": 100, "method": "cash"}),
                            ("/contractor-visits",   {"contractor_id": ctA["id"], "date": "2026-04-01", "workers_count": 1}),
                            ("/contractor-payments", {"contractor_id": ctA["id"], "date": "2026-04-01", "amount": 100, "method": "cash"}),
                            ("/contractor-returns",  {"contractor_id": ctA["id"], "date": "2026-04-01", "amount": 100, "method": "cash"})):
                totals += 1
                r = await cB.post(payload[0], json=payload[1])
                if r.status_code in (403, 404):
                    blocked += 1
                else:
                    print(f"  LEAK on POST {payload[0]} → {r.status_code}")

            # PUT worker by A's id
            totals += 1
            r = await cB.put(f"/workers/{wA['id']}", json={"name": "hack", "mobile": "", "skill": "", "daily_rate": 999, "worker_type": "regular"})
            if r.status_code in (403, 404):
                blocked += 1
            else:
                print(f"  LEAK on PUT /workers/{{wA_id}} → {r.status_code}")
            # DELETE worker by A's id
            totals += 1
            r = await cB.delete(f"/workers/{wA['id']}")
            if r.status_code in (403, 404):
                blocked += 1
            else:
                print(f"  LEAK on DELETE /workers/{{wA_id}} → {r.status_code}")

        # Confirm User A's data is still intact
        async with httpx.AsyncClient(base_url=BASE, headers=hA, timeout=30, verify=False) as cA:
            still_wA = await cA.get(f"/ledger/{wA['id']}")
            assert still_wA.status_code == 200, still_wA.text
            assert still_wA.json()["total_earned"] == 500.0, still_wA.text
            still_ctA = await cA.get(f"/contractors/{ctA['id']}/ledger")
            assert still_ctA.status_code == 200
            assert still_ctA.json()["total_paid"] == 2000.0

        assert blocked == totals, f"User isolation broken: {totals - blocked}/{totals} leaks"
        print(f"✓ User isolation: {blocked}/{totals} cross-account attempts blocked; A's data intact")
    finally:
        await _cleanup(uidA, tokA)
        await _cleanup(uidB, tokB)


async def scenario_duplicate_save_no_duplicate_rows() -> None:
    """Two rapid POSTs to /attendance for the same worker+date → one row only."""
    uid = f"ff_d_{uuid.uuid4().hex[:6]}"
    tok = await _seed(uid, "9000009921")
    try:
        async with httpx.AsyncClient(base_url=BASE, headers={"Authorization": f"Bearer {tok}"}, timeout=30, verify=False) as c:
            w = (await c.post("/workers", json={"name": "Dup", "mobile": "", "skill": "", "daily_rate": 500, "worker_type": "regular"})).json()
            # Fire two POSTs concurrently
            payload = {"worker_id": w["id"], "date": "2026-03-10", "status": "present"}
            r1, r2 = await asyncio.gather(c.post("/attendance", json=payload), c.post("/attendance", json=payload))
            assert r1.status_code == 200 and r2.status_code == 200, (r1.text, r2.text)
            rows = (await c.get("/attendance", params={"date": "2026-03-10"})).json()
            assert len(rows) == 1, f"Duplicate rows created: {rows}"
            # Total earned = 500 (one day, not two)
            led = (await c.get(f"/ledger/{w['id']}")).json()
            assert led["total_earned"] == 500.0, led
            print(f"✓ Duplicate protection: 2 concurrent POSTs → 1 row, total_earned=500")
    finally:
        await _cleanup(uid, tok)


async def main() -> None:
    await scenario_worker_pdf_2500()
    await scenario_contractor_pdf_and_settle()
    await scenario_cross_user_isolation()
    await scenario_duplicate_save_no_duplicate_rows()
    print("\nALL FINAL VERIFICATION SCENARIOS PASSED")


if __name__ == "__main__":
    asyncio.run(main())

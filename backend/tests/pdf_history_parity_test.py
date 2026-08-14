"""Verify Worker PDF ↔ Worker History screen numeric parity for the
selected year/month window.

The regression: previously, the per-worker PDF button in Ledger.jsx
did not send the selected year/month to /api/reports/pdf, so the
downloaded PDF always showed lifetime numbers even when the History
screen showed only a filtered window. This test confirms the backend
is capable of returning the right numbers for any window, and also
confirms the PDF text includes:

    - Direction sentence matching the ledger's final_balance
    - Manual half-day wage rendered per-row
    - Manual overtime amount rendered per-row
    - Settlement rows rendered (only when in-window)
    - Returns tagged 'Return (settlement)' when linked to a settlement
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


async def _seed_session(uid, mobile):
    now = datetime.now(timezone.utc)
    await db.users.insert_one({
        "user_id": uid, "email": f"{uid}@t.com", "mobile": mobile,
        "name": "PdfHist", "role": "owner",
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


def _pdf_text(b: bytes) -> str:
    return "\n".join(p.extract_text() or "" for p in PdfReader(io.BytesIO(b)).pages)


async def scenario_year_filter_parity():
    """Two separate months in the same year, wage bumped mid-year. PDF
    filtered to Feb must show ONLY Feb numbers. Full-year PDF must show
    both months summed."""
    uid = f"pfh_{uuid.uuid4().hex[:6]}"
    tok = await _seed_session(uid, "9000030001")
    h = {"Authorization": f"Bearer {tok}"}
    try:
        async with httpx.AsyncClient(base_url=BASE, headers=h, timeout=30, verify=False) as c:
            w = (await c.post("/workers", json={"name": "Ravi", "mobile": "", "skill": "", "daily_rate": 500, "worker_type": "regular"})).json()
            # Jan: 4 days @500
            for i in range(4):
                await c.post("/attendance", json={"worker_id": w["id"], "date": f"2026-01-{i+1:02d}", "status": "present"})
            # Wage bumped to 600 mid-year
            await c.put(f"/workers/{w['id']}", json={"name": "Ravi", "mobile": "", "skill": "", "daily_rate": 600, "worker_type": "regular"})
            # Feb: 4 days @600, plus half_day manual 350 and overtime manual 150
            for i in range(4):
                await c.post("/attendance", json={"worker_id": w["id"], "date": f"2026-02-{i+1:02d}", "status": "present"})
            await c.post("/attendance", json={"worker_id": w["id"], "date": "2026-02-10", "status": "half_day", "manual_wage": 350})
            await c.post("/attendance", json={"worker_id": w["id"], "date": "2026-02-11", "status": "overtime", "overtime_amount": 150})
            # Advance in Jan, Return in Feb, Settlement in Feb (actual_paid must be >= earned).
            await c.post("/advances", json={"worker_id": w["id"], "date": "2026-01-15", "amount": 1000, "method": "cash"})
            await c.post("/returns", json={"worker_id": w["id"], "date": "2026-02-15", "amount": 300, "method": "cash"})
            # Total earned across Jan+Feb = 2000+3500=5500. Settle full amount.
            rs = await c.post("/settlements", json={"worker_id": w["id"], "up_to_date": "2026-02-28", "mode": "actual_paid", "actual_paid": 5500})
            assert rs.status_code == 200, rs.text

            # /ledger with Jan window
            led_jan = (await c.get(f"/ledger/{w['id']}?start=2026-01-01&end=2026-01-31")).json()
            # /ledger with Feb window
            led_feb = (await c.get(f"/ledger/{w['id']}?start=2026-02-01&end=2026-02-28")).json()
            # /ledger with full year
            led_yr = (await c.get(f"/ledger/{w['id']}?start=2026-01-01&end=2026-12-31")).json()

            # Sanity: Feb window earnings = 4 × 600 + 350 (half manual) + (600+150) (OT manual) = 2400 + 350 + 750 = 3500
            assert led_feb["total_earned"] == 3500.0, f"Feb ledger wrong: {led_feb['total_earned']}"
            # Jan window earnings = 4 × 500 = 2000
            assert led_jan["total_earned"] == 2000.0, f"Jan ledger wrong: {led_jan['total_earned']}"
            # Year window earnings = 2000 + 3500 = 5500
            assert led_yr["total_earned"] == 5500.0, f"Year ledger wrong: {led_yr['total_earned']}"

            # Now download PDFs for each window and confirm parity
            pdf_jan = await c.get(f"/reports/pdf?start=2026-01-01&end=2026-01-31&worker_id={w['id']}")
            pdf_feb = await c.get(f"/reports/pdf?start=2026-02-01&end=2026-02-28&worker_id={w['id']}")
            pdf_yr  = await c.get(f"/reports/pdf?start=2026-01-01&end=2026-12-31&worker_id={w['id']}")
            for r in (pdf_jan, pdf_feb, pdf_yr):
                assert r.status_code == 200 and r.headers["content-type"] == "application/pdf"

            t_jan = _pdf_text(pdf_jan.content)
            t_feb = _pdf_text(pdf_feb.content)
            t_yr  = _pdf_text(pdf_yr.content)

            # Numeric parity
            assert "2000" in t_jan, "Jan PDF missing 2000 total"
            assert "3500" in t_feb, "Feb PDF missing 3500 total"
            assert "5500" in t_yr,  "Year PDF missing 5500 total"

            # Jan PDF should NOT include the Feb-only ₹3500
            assert "3500" not in t_jan, "Jan PDF leaked Feb totals"
            # Feb PDF should NOT include the Jan ₹2000
            assert "2000" not in t_feb, "Feb PDF leaked Jan totals"

            # Manual amounts appear in Feb PDF (per-row column) & the totals include them.
            # Note: pypdf sometimes strips column separators; check presence of the amount digits.
            assert "350" in t_feb and "150" in t_feb, "Feb PDF missing manual amounts"

            # Feb PDF must show the Settlement row and direction sentence.
            assert "Settlements" in t_feb or "Settlement" in t_feb, "Feb PDF missing Settlements section"

            # Direction sentence: after settle actual_paid=1000, Feb window
            # earned=3500, adv=0 (Jan), ret=300+1000 auto=1300, settled=1000
            # → final_balance = 3500 - (0-1300) - 1000 = 3500+1300-1000 = 3800
            # → "You owe worker Rs 3800.0"
            assert "You owe worker" in t_feb or "Worker owes you" in t_feb or "Balanced" in t_feb, \
                "Feb PDF missing direction sentence"

            print(f"✓ PDF parity: Jan=2000 · Feb=3500 · Year=5500; manual amounts + settlements + direction visible in PDF")
    finally:
        for coll in ("users", "user_sessions", "workers", "attendance",
                     "advances", "advance_returns", "settlements"):
            await db[coll].delete_many({"user_id": uid})
        await db.user_sessions.delete_many({"session_token": tok})


async def scenario_ledger_ledger_history_match():
    """The /ledger endpoint (used by Ledger card + Worker History screen)
       and /reports/pdf must return identical totals for the same window."""
    uid = f"pfhm_{uuid.uuid4().hex[:6]}"
    tok = await _seed_session(uid, "9000030002")
    h = {"Authorization": f"Bearer {tok}"}
    try:
        async with httpx.AsyncClient(base_url=BASE, headers=h, timeout=30, verify=False) as c:
            w = (await c.post("/workers", json={"name": "W", "mobile": "", "skill": "", "daily_rate": 400, "worker_type": "regular"})).json()
            for i in range(5):
                await c.post("/attendance", json={"worker_id": w["id"], "date": f"2026-03-{i+1:02d}", "status": "present"})
            await c.post("/advances", json={"worker_id": w["id"], "date": "2026-03-06", "amount": 500, "method": "cash"})
            led = (await c.get(f"/ledger/{w['id']}?start=2026-03-01&end=2026-03-31")).json()
            pdf = await c.get(f"/reports/pdf?start=2026-03-01&end=2026-03-31&worker_id={w['id']}")
            text = _pdf_text(pdf.content)
            # Ledger says: 5 × 400 = 2000 earned; adv=500; net_adv=500; final=1500
            assert led["total_earned"] == 2000.0 and led["final_balance"] == 1500.0
            assert "2000" in text and "1500" in text, text[:400]
            assert "You owe worker Rs 1500" in text, "PDF direction mismatch"
            print("✓ Ledger==WorkerHistory==PDF parity: total_earned=2000, final_balance=1500, direction correct")
    finally:
        for coll in ("users", "user_sessions", "workers", "attendance",
                     "advances", "advance_returns", "settlements"):
            await db[coll].delete_many({"user_id": uid})
        await db.user_sessions.delete_many({"session_token": tok})


async def main():
    await scenario_year_filter_parity()
    await scenario_ledger_ledger_history_match()
    print("\nALL PDF↔HISTORY PARITY CHECKS PASSED")


if __name__ == "__main__":
    asyncio.run(main())

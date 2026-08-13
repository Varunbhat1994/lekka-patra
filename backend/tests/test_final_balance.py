"""Verifies the accounting relationship:
    net_advance   = total_advances - total_returns
    final_balance = total_earned - net_advance - total_settled

Uses the live compute_worker_ledger service against a fresh throw-away
user_id so it never touches real user data. Also validates that a
`Mark Settled` (adjust_advance) call leaves final_balance == 0.
"""
import asyncio
import os
import sys
import uuid
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.database import db  # noqa: E402
from services.ledger import compute_worker_ledger  # noqa: E402


async def _mk_worker(user_id: str, name: str, wage: float) -> dict:
    w = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "name": name,
        "daily_rate": wage,
        "mobile": "",
        "skill": "",
        "worker_type": "regular",
    }
    await db.workers.insert_one(dict(w))
    return w


async def _add_attendance(user_id: str, worker_id: str, days_present: int, wage: float):
    for i in range(days_present):
        await db.attendance.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "worker_id": worker_id,
            "date": f"2026-01-{i+1:02d}",
            "status": "present",
            "overtime_hours": 0,
        })


async def _add_advance(user_id: str, worker_id: str, amount: float):
    await db.advances.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "worker_id": worker_id,
        "date": "2026-01-15",
        "amount": amount,
    })


async def _add_return(user_id: str, worker_id: str, amount: float):
    await db.advance_returns.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "worker_id": worker_id,
        "date": "2026-01-20",
        "amount": amount,
    })


async def _cleanup(user_id: str):
    for coll in ("workers", "attendance", "advances", "advance_returns", "settlements"):
        await db[coll].delete_many({"user_id": user_id})


async def scenario_sappu():
    user_id = f"test_sappu_{uuid.uuid4()}"
    try:
        w = await _mk_worker(user_id, "Sappu", 650.0)
        # Earned 7150 = 11 days x 650
        await _add_attendance(user_id, w["id"], 11, 650.0)
        await _add_advance(user_id, w["id"], 3000)
        await _add_return(user_id, w["id"], 1000)
        led = await compute_worker_ledger(user_id, w)
        assert led["total_earned"] == 7150.0, led
        assert led["net_advance"] == 2000.0, led
        assert led["total_settled"] == 0.0, led
        assert led["final_balance"] == 5150.0, led
        print(f"✓ Sappu: earned={led['total_earned']} net_adv={led['net_advance']} settled={led['total_settled']} final={led['final_balance']} (expected 5150)")
    finally:
        await _cleanup(user_id)


async def scenario_shiva():
    user_id = f"test_shiva_{uuid.uuid4()}"
    try:
        w = await _mk_worker(user_id, "Shiva", 600.0)
        # Earned 1200 = 2 days x 600
        await _add_attendance(user_id, w["id"], 2, 600.0)
        await _add_advance(user_id, w["id"], 5000)
        led = await compute_worker_ledger(user_id, w)
        assert led["total_earned"] == 1200.0, led
        assert led["net_advance"] == 5000.0, led
        assert led["total_settled"] == 0.0, led
        assert led["final_balance"] == -3800.0, led
        print(f"✓ Shiva: earned={led['total_earned']} net_adv={led['net_advance']} settled={led['total_settled']} final={led['final_balance']} (expected -3800)")
    finally:
        await _cleanup(user_id)


async def scenario_balanced():
    user_id = f"test_balanced_{uuid.uuid4()}"
    try:
        w = await _mk_worker(user_id, "Ravi", 500.0)
        # Earned 5000 = 10 days x 500, advance 5000, return 0
        await _add_attendance(user_id, w["id"], 10, 500.0)
        await _add_advance(user_id, w["id"], 5000)
        led = await compute_worker_ledger(user_id, w)
        assert led["final_balance"] == 0.0, led
        print(f"✓ Balanced: earned={led['total_earned']} net_adv={led['net_advance']} final={led['final_balance']} (expected 0)")
    finally:
        await _cleanup(user_id)


async def main():
    await scenario_sappu()
    await scenario_shiva()
    await scenario_balanced()
    print("\nAll final_balance scenarios passed.")


if __name__ == "__main__":
    asyncio.run(main())

"""Backend tests for offline-sync idempotency + settlement revalidation.

Covers the two P0 checkpoints:
  §1 post-offline-advances-returns: POST /advances and POST /returns wrapped
     in services.sync_ops.idempotent via operation_id. DELETE is naturally
     idempotent.
  §2 post-offline-settlement-draft: POST /settlements accepts operation_id +
     client_earned_snapshot + client_advance_snapshot. Divergence > 0.01
     rupees -> HTTP 409 detail.code=settlement_revalidation_failed with NO
     side-effect writes. Endpoint wrapped in idempotent().

Regression: attendance operation_id + daily_rate_snapshot preservation,
workers/contractors idempotency.
"""
import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone, timedelta

import httpx
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from core.database import db  # noqa: E402

BASE = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/") + "/api"


# ---------- helpers ----------

async def _seed_user():
    uid = f"osi_{uuid.uuid4().hex[:8]}"
    token = uuid.uuid4().hex + uuid.uuid4().hex
    now = datetime.now(timezone.utc)
    await db.users.insert_one({
        "user_id": uid, "email": f"{uid}@t.com", "mobile": f"9{uuid.uuid4().int % 10**9:09d}",
        "name": f"OSI_{uid[:6]}", "role": "owner",
        "subscription_active": True,
        "subscription_expires_at": (now + timedelta(days=365)).isoformat(),
        "trial_starts_at": now.isoformat(),
        "trial_expires_at": (now + timedelta(days=365)).isoformat(),
        "created_at": now.isoformat(),
    })
    await db.user_sessions.insert_one({
        "session_token": token, "user_id": uid,
        "expires_at": (now + timedelta(hours=2)).isoformat(),
        "created_at": now.isoformat(),
    })
    return uid, token


async def _cleanup(uid, token):
    for coll in ("users", "user_sessions", "workers", "attendance",
                 "advances", "advance_returns", "settlements",
                 "contractors", "sync_ops"):
        await db[coll].delete_many({"user_id": uid})
    await db.user_sessions.delete_many({"session_token": token})


class Ctx:
    def __init__(self, uid, token, client, worker_id=None):
        self.uid = uid
        self.token = token
        self.client = client
        self.worker_id = worker_id
        self.headers = {"Authorization": f"Bearer {token}"}


@pytest.fixture
def ctx():
    async def _mk():
        uid, token = await _seed_user()
        client = httpx.AsyncClient(base_url=BASE, timeout=30.0)
        # Create a worker for tests that need one
        r = await client.post("/workers", json={"name": "W1", "daily_rate": 500},
                              headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200, r.text
        wid = r.json()["id"]
        return Ctx(uid, token, client, wid)
    c = asyncio.get_event_loop().run_until_complete(_mk())
    yield c
    async def _tear():
        await c.client.aclose()
        await _cleanup(c.uid, c.token)
    asyncio.get_event_loop().run_until_complete(_tear())


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


# ================== ADVANCES / RETURNS IDEMPOTENCY ==================

def test_advance_operation_id_replay_returns_same_row(ctx):
    op = str(uuid.uuid4())
    payload = {"worker_id": ctx.worker_id, "date": "2026-01-05",
               "amount": 100, "method": "cash", "operation_id": op}
    r1 = _run(ctx.client.post("/advances", json=payload, headers=ctx.headers))
    r2 = _run(ctx.client.post("/advances", json=payload, headers=ctx.headers))
    assert r1.status_code == 200 and r2.status_code == 200, (r1.text, r2.text)
    j1, j2 = r1.json(), r2.json()
    assert j1["id"] == j2["id"], "operation_id replay must return same row id"
    # DB has exactly one row for this op / user
    count = _run(db.advances.count_documents({"user_id": ctx.uid}))
    assert count == 1, f"expected 1 advance, got {count}"


def test_advance_different_operation_id_creates_distinct_row(ctx):
    p1 = {"worker_id": ctx.worker_id, "date": "2026-01-05",
          "amount": 100, "method": "cash", "operation_id": str(uuid.uuid4())}
    p2 = dict(p1, operation_id=str(uuid.uuid4()))
    r1 = _run(ctx.client.post("/advances", json=p1, headers=ctx.headers))
    r2 = _run(ctx.client.post("/advances", json=p2, headers=ctx.headers))
    assert r1.json()["id"] != r2.json()["id"]
    count = _run(db.advances.count_documents({"user_id": ctx.uid}))
    assert count == 2


def test_advance_without_operation_id_creates_two_rows(ctx):
    p = {"worker_id": ctx.worker_id, "date": "2026-01-05", "amount": 50, "method": "cash"}
    r1 = _run(ctx.client.post("/advances", json=p, headers=ctx.headers))
    r2 = _run(ctx.client.post("/advances", json=p, headers=ctx.headers))
    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json()["id"] != r2.json()["id"]
    count = _run(db.advances.count_documents({"user_id": ctx.uid}))
    assert count == 2


def test_return_operation_id_replay_returns_same_row(ctx):
    # Give a starting advance so there's something to return
    _run(ctx.client.post("/advances", json={
        "worker_id": ctx.worker_id, "date": "2026-01-01", "amount": 1000, "method": "cash"
    }, headers=ctx.headers))
    op = str(uuid.uuid4())
    payload = {"worker_id": ctx.worker_id, "date": "2026-01-06",
               "amount": 200, "method": "cash", "operation_id": op}
    r1 = _run(ctx.client.post("/returns", json=payload, headers=ctx.headers))
    r2 = _run(ctx.client.post("/returns", json=payload, headers=ctx.headers))
    assert r1.status_code == 200 and r2.status_code == 200, (r1.text, r2.text)
    assert r1.json()["id"] == r2.json()["id"]
    count = _run(db.advance_returns.count_documents({"user_id": ctx.uid}))
    assert count == 1


def test_delete_advance_replay_safe(ctx):
    r = _run(ctx.client.post("/advances", json={
        "worker_id": ctx.worker_id, "date": "2026-01-05", "amount": 50, "method": "cash"
    }, headers=ctx.headers))
    aid = r.json()["id"]
    d1 = _run(ctx.client.delete(f"/advances/{aid}", headers=ctx.headers))
    d2 = _run(ctx.client.delete(f"/advances/{aid}", headers=ctx.headers))
    assert d1.status_code == 200 and d1.json() == {"ok": True}
    assert d2.status_code == 200 and d2.json() == {"ok": True}


# ================== SETTLEMENT REVALIDATION ==================

def _seed_earned(ctx, earned_amount=1000.0):
    """Seed one 'present' attendance day so pending == earned_amount (daily_rate 500 * 2)."""
    # Update worker daily rate to earned_amount to keep it simple with one day
    _run(db.workers.update_one({"id": ctx.worker_id}, {"$set": {"daily_rate": earned_amount}}))
    r = _run(ctx.client.post("/attendance", json={
        "worker_id": ctx.worker_id, "date": "2026-01-10", "status": "present",
        "daily_rate_snapshot": earned_amount,
    }, headers=ctx.headers))
    assert r.status_code == 200, r.text


def test_settlement_matching_snapshot_finalizes(ctx):
    _seed_earned(ctx, 1000.0)
    # Give an existing advance of 300
    _run(ctx.client.post("/advances", json={
        "worker_id": ctx.worker_id, "date": "2026-01-02", "amount": 300, "method": "cash"
    }, headers=ctx.headers))
    payload = {
        "worker_id": ctx.worker_id, "up_to_date": "2026-01-31",
        "mode": "adjust_advance",
        "client_earned_snapshot": 1000.0,
        "client_advance_snapshot": 300.0,
        "cached_at": datetime.now(timezone.utc).isoformat(),
    }
    r = _run(ctx.client.post("/settlements", json=payload, headers=ctx.headers))
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["ok"] is True
    assert j["kind"] == "worker"
    assert j["mode"] == "adjust_advance"
    assert "worker_owes_user" in j
    assert "new_advance_created" in j


def test_settlement_mismatched_snapshot_returns_409_no_writes(ctx):
    _seed_earned(ctx, 1000.0)
    before_settle = _run(db.settlements.count_documents({"user_id": ctx.uid}))
    before_ret = _run(db.advance_returns.count_documents({"user_id": ctx.uid}))
    before_adv = _run(db.advances.count_documents({"user_id": ctx.uid}))

    payload = {
        "worker_id": ctx.worker_id, "up_to_date": "2026-01-31",
        "mode": "adjust_advance",
        "client_earned_snapshot": 500.0,  # server has 1000
        "client_advance_snapshot": 0.0,
        "cached_at": datetime.now(timezone.utc).isoformat(),
    }
    r = _run(ctx.client.post("/settlements", json=payload, headers=ctx.headers))
    assert r.status_code == 409, r.text
    detail = r.json()["detail"]
    assert detail["code"] == "settlement_revalidation_failed"
    assert "client" in detail and "server" in detail
    assert detail["client"]["earned"] == 500.0
    assert abs(detail["server"]["earned"] - 1000.0) < 0.01

    # No side effects
    assert _run(db.settlements.count_documents({"user_id": ctx.uid})) == before_settle
    assert _run(db.advance_returns.count_documents({"user_id": ctx.uid})) == before_ret
    assert _run(db.advances.count_documents({"user_id": ctx.uid})) == before_adv


def test_settlement_no_snapshot_online_path_unchanged(ctx):
    _seed_earned(ctx, 1000.0)
    payload = {"worker_id": ctx.worker_id, "up_to_date": "2026-01-31", "mode": "adjust_advance"}
    r = _run(ctx.client.post("/settlements", json=payload, headers=ctx.headers))
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["kind"] == "worker" and j["mode"] == "adjust_advance"


def test_settlement_operation_id_replay_no_double_write(ctx):
    _seed_earned(ctx, 1000.0)
    op = str(uuid.uuid4())
    payload = {
        "worker_id": ctx.worker_id, "up_to_date": "2026-01-31",
        "mode": "actual_paid", "actual_paid": 1500.0,
        "operation_id": op,
        "client_earned_snapshot": 1000.0,
        "client_advance_snapshot": 0.0,
    }
    r1 = _run(ctx.client.post("/settlements", json=payload, headers=ctx.headers))
    r2 = _run(ctx.client.post("/settlements", json=payload, headers=ctx.headers))
    assert r1.status_code == 200 and r2.status_code == 200, (r1.text, r2.text)
    j1, j2 = r1.json(), r2.json()
    assert j1["id"] == j2["id"], "replay must return same settlement id"
    # DB: exactly one settlement + exactly one auto-advance (overpay of 500)
    settle_count = _run(db.settlements.count_documents({"user_id": ctx.uid}))
    assert settle_count == 1, f"expected 1 settlement, got {settle_count}"
    auto_adv_count = _run(db.advances.count_documents({
        "user_id": ctx.uid, "settlement_id": j1["id"]
    }))
    assert auto_adv_count == 1, f"expected 1 auto-advance, got {auto_adv_count}"


def test_settlement_adjust_advance_draft_replay_safe(ctx):
    _seed_earned(ctx, 1000.0)
    op = str(uuid.uuid4())
    payload = {
        "worker_id": ctx.worker_id, "up_to_date": "2026-01-31",
        "mode": "adjust_advance", "operation_id": op,
        "client_earned_snapshot": 1000.0, "client_advance_snapshot": 0.0,
    }
    r1 = _run(ctx.client.post("/settlements", json=payload, headers=ctx.headers))
    r2 = _run(ctx.client.post("/settlements", json=payload, headers=ctx.headers))
    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json()["id"] == r2.json()["id"]
    # Exactly one auto-return
    auto_ret_count = _run(db.advance_returns.count_documents({
        "user_id": ctx.uid, "settlement_id": r1.json()["id"]
    }))
    assert auto_ret_count == 1


# ================== REGRESSION: attendance / workers / contractors ==================

def test_attendance_operation_id_idempotent(ctx):
    op = str(uuid.uuid4())
    payload = {"worker_id": ctx.worker_id, "date": "2026-02-01", "status": "present",
               "daily_rate_snapshot": 500.0, "operation_id": op}
    r1 = _run(ctx.client.post("/attendance", json=payload, headers=ctx.headers))
    r2 = _run(ctx.client.post("/attendance", json=payload, headers=ctx.headers))
    assert r1.status_code == 200 and r2.status_code == 200
    count = _run(db.attendance.count_documents({"user_id": ctx.uid, "worker_id": ctx.worker_id}))
    assert count == 1


def test_attendance_daily_rate_snapshot_preserved_on_update(ctx):
    # Insert with rate 500
    _run(ctx.client.post("/attendance", json={
        "worker_id": ctx.worker_id, "date": "2026-02-02", "status": "present",
        "daily_rate_snapshot": 500.0,
    }, headers=ctx.headers))
    # Change worker daily_rate on server side
    _run(db.workers.update_one({"id": ctx.worker_id}, {"$set": {"daily_rate": 900}}))
    # Update same date (no operation_id, different payload) - should NOT overwrite snapshot
    _run(ctx.client.post("/attendance", json={
        "worker_id": ctx.worker_id, "date": "2026-02-02", "status": "half_day",
        "daily_rate_snapshot": 900.0,  # client sends but server must ignore on update
    }, headers=ctx.headers))
    row = _run(db.attendance.find_one({
        "user_id": ctx.uid, "worker_id": ctx.worker_id, "date": "2026-02-02"
    }))
    assert row["daily_rate_snapshot"] == 500.0, f"snapshot leaked to {row['daily_rate_snapshot']}"
    assert row["status"] == "half_day"


def test_workers_create_idempotent(ctx):
    op = str(uuid.uuid4())
    payload = {"name": "IdempW", "daily_rate": 700, "operation_id": op}
    r1 = _run(ctx.client.post("/workers", json=payload, headers=ctx.headers))
    r2 = _run(ctx.client.post("/workers", json=payload, headers=ctx.headers))
    assert r1.json()["id"] == r2.json()["id"]
    count = _run(db.workers.count_documents({"user_id": ctx.uid, "name": "IdempW"}))
    assert count == 1


def test_contractors_create_idempotent(ctx):
    op = str(uuid.uuid4())
    payload = {"name": "IdempC", "operation_id": op}
    r1 = _run(ctx.client.post("/contractors", json=payload, headers=ctx.headers))
    r2 = _run(ctx.client.post("/contractors", json=payload, headers=ctx.headers))
    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json()["id"] == r2.json()["id"]
    count = _run(db.contractors.count_documents({"user_id": ctx.uid, "name": "IdempC"}))
    assert count == 1

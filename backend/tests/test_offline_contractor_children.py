"""Backend end-to-end tests for post-offline-remaining-writes.

Covers:
  * POST /contractor-visits, /contractor-payments, /contractor-returns
    with operation_id idempotency (replay must NOT double-write).
  * DELETE endpoints are idempotent by construction (safe replay).
  * Ownership guard: cannot POST for a contractor you don't own (404).
  * The check runs inside idempotent(...) so an ownership 404 is not
    cached — the client can retry after fixing the id (verified below).
  * Account A/B isolation via db.sync_ops uniqueness scoped to user_id.

Every test provisions its own ephemeral user + session and cleans up
in teardown. Tests are self-contained and safe to run individually or
together (no shared fixtures beyond the module-level DB handle).
"""
import asyncio
import os
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone

import httpx
import pytest

sys.path.insert(0, "/app/backend")
from core.database import db  # noqa: E402


API_BASE = os.environ.get("BACKEND_URL", "http://localhost:8001") + "/api"


async def _mk_user(prefix: str) -> tuple[str, str]:
    """Create a fresh user + session; return (user_id, session_token)."""
    user_id = f"user_{prefix}_{uuid.uuid4().hex[:10]}"
    email = f"{prefix}_{uuid.uuid4().hex[:6]}@ex.com"
    await db.users.insert_one({
        "user_id": user_id,
        "email": email,
        "name": prefix,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    token = f"sess-{uuid.uuid4()}"
    await db.user_sessions.insert_one({
        "session_token": token,
        "user_id": user_id,
        "expires_at": datetime.now(timezone.utc) + timedelta(hours=1),
        "created_at": datetime.now(timezone.utc),
    })
    return user_id, token


async def _cleanup(user_id: str, token: str):
    for coll in (
        "users", "user_sessions", "contractors",
        "contractor_visits", "contractor_payments", "contractor_returns",
        "sync_ops",
    ):
        try:
            await db[coll].delete_many({"user_id": user_id})
        except Exception:
            pass
    await db.user_sessions.delete_one({"session_token": token})


@pytest.mark.asyncio
async def test_visits_idempotent_replay():
    user_id, token = await _mk_user("visits_idem")
    try:
        async with httpx.AsyncClient(base_url=API_BASE, timeout=15.0,
                                     headers={"Authorization": f"Bearer {token}"}) as c:
            # Create contractor
            r = await c.post("/contractors", json={"name": f"C-{int(time.time())}"})
            assert r.status_code == 200, r.text
            cid = r.json()["id"]

            op_id = str(uuid.uuid4())
            body = {"contractor_id": cid, "date": "2026-02-05", "workers_count": 5,
                    "field_crop": "sugarcane", "notes": "morning",
                    "operation_id": op_id}
            r1 = await c.post("/contractor-visits", json=body); assert r1.status_code == 200
            r2 = await c.post("/contractor-visits", json=body); assert r2.status_code == 200

            assert r1.json()["id"] == r2.json()["id"], \
                f"IDEMPOTENCY FAIL: {r1.json()['id']} != {r2.json()['id']}"

            # DB must hold exactly one visit row for this triple
            n = await db.contractor_visits.count_documents({
                "user_id": user_id, "contractor_id": cid, "workers_count": 5,
            })
            assert n == 1, f"expected 1 visit row, got {n}"

            # Different op_id → new row (not falsely idempotent)
            body2 = dict(body); body2["operation_id"] = str(uuid.uuid4())
            r3 = await c.post("/contractor-visits", json=body2); assert r3.status_code == 200
            assert r3.json()["id"] != r1.json()["id"]

            # No op_id → each call inserts a new row (backwards compat)
            body3 = {k: v for k, v in body.items() if k != "operation_id"}
            r4 = await c.post("/contractor-visits", json=body3); assert r4.status_code == 200
            r5 = await c.post("/contractor-visits", json=body3); assert r5.status_code == 200
            assert r4.json()["id"] != r5.json()["id"]
    finally:
        await _cleanup(user_id, token)


@pytest.mark.asyncio
async def test_payments_idempotent_replay():
    user_id, token = await _mk_user("pays_idem")
    try:
        async with httpx.AsyncClient(base_url=API_BASE, timeout=15.0,
                                     headers={"Authorization": f"Bearer {token}"}) as c:
            r = await c.post("/contractors", json={"name": f"C-{int(time.time())}"})
            cid = r.json()["id"]

            op_id = str(uuid.uuid4())
            body = {"contractor_id": cid, "date": "2026-02-05",
                    "amount": 5000, "method": "upi", "notes": "advance",
                    "operation_id": op_id}
            r1 = await c.post("/contractor-payments", json=body); assert r1.status_code == 200
            r2 = await c.post("/contractor-payments", json=body); assert r2.status_code == 200
            assert r1.json()["id"] == r2.json()["id"]

            n = await db.contractor_payments.count_documents({
                "user_id": user_id, "contractor_id": cid, "amount": 5000,
            })
            assert n == 1
    finally:
        await _cleanup(user_id, token)


@pytest.mark.asyncio
async def test_returns_idempotent_replay():
    user_id, token = await _mk_user("rets_idem")
    try:
        async with httpx.AsyncClient(base_url=API_BASE, timeout=15.0,
                                     headers={"Authorization": f"Bearer {token}"}) as c:
            r = await c.post("/contractors", json={"name": f"C-{int(time.time())}"})
            cid = r.json()["id"]

            op_id = str(uuid.uuid4())
            body = {"contractor_id": cid, "date": "2026-02-06",
                    "amount": 1200, "method": "cash",
                    "operation_id": op_id}
            r1 = await c.post("/contractor-returns", json=body); assert r1.status_code == 200
            r2 = await c.post("/contractor-returns", json=body); assert r2.status_code == 200
            assert r1.json()["id"] == r2.json()["id"]

            n = await db.contractor_returns.count_documents({
                "user_id": user_id, "contractor_id": cid, "amount": 1200,
            })
            assert n == 1
    finally:
        await _cleanup(user_id, token)


@pytest.mark.asyncio
async def test_delete_replay_safe():
    """DELETE returns 200 {ok: true} even when the id no longer exists —
    so a queued delete op can drain safely after network flakiness."""
    user_id, token = await _mk_user("del_replay")
    try:
        async with httpx.AsyncClient(base_url=API_BASE, timeout=15.0,
                                     headers={"Authorization": f"Bearer {token}"}) as c:
            r = await c.post("/contractors", json={"name": f"C-{int(time.time())}"})
            cid = r.json()["id"]
            r = await c.post("/contractor-visits", json={
                "contractor_id": cid, "date": "2026-02-01", "workers_count": 2,
            })
            vid = r.json()["id"]
            r_del = await c.delete(f"/contractor-visits/{vid}"); assert r_del.status_code == 200
            r_dup = await c.delete(f"/contractor-visits/{vid}"); assert r_dup.status_code == 200

            r = await c.post("/contractor-payments", json={
                "contractor_id": cid, "date": "2026-02-01", "amount": 100,
            })
            pid = r.json()["id"]
            assert (await c.delete(f"/contractor-payments/{pid}")).status_code == 200
            assert (await c.delete(f"/contractor-payments/{pid}")).status_code == 200

            r = await c.post("/contractor-returns", json={
                "contractor_id": cid, "date": "2026-02-01", "amount": 50,
            })
            rid = r.json()["id"]
            assert (await c.delete(f"/contractor-returns/{rid}")).status_code == 200
            assert (await c.delete(f"/contractor-returns/{rid}")).status_code == 200
    finally:
        await _cleanup(user_id, token)


@pytest.mark.asyncio
async def test_cross_account_isolation():
    """Account A cannot POST a visit/payment/return for a contractor
    owned by Account B — must 404 without cross-account writes."""
    a_uid, a_tok = await _mk_user("iso_a")
    b_uid, b_tok = await _mk_user("iso_b")
    try:
        # B creates a contractor
        async with httpx.AsyncClient(base_url=API_BASE, timeout=15.0,
                                     headers={"Authorization": f"Bearer {b_tok}"}) as cb:
            r = await cb.post("/contractors", json={"name": "B-contractor"})
            b_cid = r.json()["id"]

        # A tries to write children pointing at B's contractor
        async with httpx.AsyncClient(base_url=API_BASE, timeout=15.0,
                                     headers={"Authorization": f"Bearer {a_tok}"}) as ca:
            for path, body in [
                ("/contractor-visits", {"contractor_id": b_cid, "date": "2026-02-05",
                                        "workers_count": 3}),
                ("/contractor-payments", {"contractor_id": b_cid, "date": "2026-02-05",
                                          "amount": 100}),
                ("/contractor-returns", {"contractor_id": b_cid, "date": "2026-02-05",
                                         "amount": 50}),
            ]:
                # With op_id — must still 404, NOT be cached as ok
                body["operation_id"] = str(uuid.uuid4())
                r = await ca.post(path, json=body)
                assert r.status_code == 404, f"{path} accepted cross-account: {r.text}"

            # B's collections must have zero rows from A
            for coll in ("contractor_visits", "contractor_payments", "contractor_returns"):
                n = await db[coll].count_documents({"user_id": a_uid})
                assert n == 0, f"A leaked into {coll}: {n} rows"
                n = await db[coll].count_documents({"user_id": b_uid, "contractor_id": b_cid})
                assert n == 0, f"unexpected B write in {coll}: {n} rows"

        # Sanity: idempotency ledger did NOT cache the 404 responses.
        # (Actual HTTPException 404 raised inside do() propagates out
        # BEFORE sync_ops.insert_one, so no row is stored — verified
        # explicitly here.)
        n_ops = await db.sync_ops.count_documents({"user_id": a_uid})
        assert n_ops == 0, f"sync_ops cached a 404 for account A ({n_ops} rows)"
    finally:
        await _cleanup(a_uid, a_tok)
        await _cleanup(b_uid, b_tok)


@pytest.mark.asyncio
async def test_ledger_reflects_new_rows():
    """After creating a visit + payment + return, the ledger endpoint
    must include all three and the summary totals must be correct."""
    user_id, token = await _mk_user("ledger_after")
    try:
        async with httpx.AsyncClient(base_url=API_BASE, timeout=15.0,
                                     headers={"Authorization": f"Bearer {token}"}) as c:
            r = await c.post("/contractors", json={"name": "Ledger-C"})
            cid = r.json()["id"]

            await c.post("/contractor-visits", json={
                "contractor_id": cid, "date": "2026-02-01", "workers_count": 4,
            })
            await c.post("/contractor-visits", json={
                "contractor_id": cid, "date": "2026-02-02", "workers_count": 6,
            })
            await c.post("/contractor-payments", json={
                "contractor_id": cid, "date": "2026-02-02", "amount": 3000,
            })
            await c.post("/contractor-returns", json={
                "contractor_id": cid, "date": "2026-02-03", "amount": 500,
            })

            led = (await c.get(f"/contractors/{cid}/ledger")).json()
            assert led["total_visits"] == 2
            assert led["total_workers_brought"] == 10
            assert led["total_paid"] == 3000.0
            assert led["total_returned"] == 500.0
            assert led["net_paid"] == 2500.0
    finally:
        await _cleanup(user_id, token)


@pytest.mark.asyncio
async def test_replay_after_delete_returns_cached_body():
    """Once an op is cached, replaying it must not depend on whether
    the underlying row still exists. This models the classic
    'user deleted a synced row while offline; we then replay the
    delete op' scenario — no crash, no phantom rewrite."""
    user_id, token = await _mk_user("replay_after_del")
    try:
        async with httpx.AsyncClient(base_url=API_BASE, timeout=15.0,
                                     headers={"Authorization": f"Bearer {token}"}) as c:
            r = await c.post("/contractors", json={"name": "R-C"})
            cid = r.json()["id"]

            op_id = str(uuid.uuid4())
            body = {"contractor_id": cid, "date": "2026-02-05",
                    "amount": 999, "method": "cash",
                    "operation_id": op_id}
            r1 = await c.post("/contractor-payments", json=body); assert r1.status_code == 200
            pid = r1.json()["id"]

            # Delete the row directly, then replay the create op.
            assert (await c.delete(f"/contractor-payments/{pid}")).status_code == 200

            r2 = await c.post("/contractor-payments", json=body); assert r2.status_code == 200
            # Idempotency ledger returns the ORIGINAL response snapshot,
            # not a re-inserted row.
            assert r2.json()["id"] == pid

            # The row does NOT come back into contractor_payments — the
            # cache is a response snapshot, not a rewind.
            n = await db.contractor_payments.count_documents({"id": pid})
            assert n == 0, f"replay unexpectedly re-inserted row (n={n})"
    finally:
        await _cleanup(user_id, token)


if __name__ == "__main__":
    # Motor connections can't be reused across separate asyncio.run()
    # calls in the same process (the executor gets bound to the first
    # loop). Drive all tests inside ONE loop.
    async def _all():
        await test_visits_idempotent_replay()
        print("[PASS] test_visits_idempotent_replay")
        await test_payments_idempotent_replay()
        print("[PASS] test_payments_idempotent_replay")
        await test_returns_idempotent_replay()
        print("[PASS] test_returns_idempotent_replay")
        await test_delete_replay_safe()
        print("[PASS] test_delete_replay_safe")
        await test_cross_account_isolation()
        print("[PASS] test_cross_account_isolation")
        await test_ledger_reflects_new_rows()
        print("[PASS] test_ledger_reflects_new_rows")
        await test_replay_after_delete_returns_cached_body()
        print("[PASS] test_replay_after_delete_returns_cached_body")
    asyncio.run(_all())
    print("\n=== ALL 7 CONTRACTOR-CHILDREN OFFLINE-SYNC TESTS PASSED ===")

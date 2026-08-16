"""Backend tests for post-offline-contractor-settlement.

Contract:
  * SettlementIn accepts optional client_net_paid_snapshot (+ cached_at).
  * When present, the contractor branch recomputes net_paid live via
    compute_contractor_ledger and raises HTTP 409 with
    detail.code='settlement_revalidation_failed', detail.kind='contractor',
    and structured client / server sub-dicts if the numbers diverge
    beyond 0.01 rupees. NO settlement / auto-return row is written.
  * When absent → pure online path unchanged (bit-for-bit).
  * Endpoint is wrapped in services.sync_ops.idempotent (existing) so
    replays with the same operation_id return the cached response and
    never double-write auto-return rows.
  * Cross-account isolation: Account A cannot POST a contractor
    settlement (draft or otherwise) targeting Account B's contractor.
"""
from __future__ import annotations
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
    user_id = f"user_{prefix}_{uuid.uuid4().hex[:10]}"
    email = f"{prefix}_{uuid.uuid4().hex[:6]}@ex.com"
    await db.users.insert_one({
        "user_id": user_id,
        "email": email,
        "name": prefix,
        "mobile": "9000000000",
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


async def _cleanup(user_id: str, token: str) -> None:
    for coll in (
        "users", "user_sessions", "contractors",
        "contractor_visits", "contractor_payments", "contractor_returns",
        "settlements", "sync_ops",
    ):
        try:
            await db[coll].delete_many({"user_id": user_id})
        except Exception:
            pass
    await db.user_sessions.delete_one({"session_token": token})


@pytest.mark.asyncio
async def test_contractor_draft_matching_snapshot_finalizes():
    """When the client's net_paid snapshot equals live server net_paid,
    the settlement is finalized: exactly ONE settlement row + ONE
    auto-return row inserted (auto-return zeroes net_paid)."""
    user_id, token = await _mk_user("csettle_match")
    try:
        async with httpx.AsyncClient(base_url=API_BASE, timeout=15.0,
                                     headers={"Authorization": f"Bearer {token}"}) as c:
            r = await c.post("/contractors", json={"name": f"C-{int(time.time())}"})
            cid = r.json()["id"]
            await c.post("/contractor-payments", json={
                "contractor_id": cid, "date": "2026-02-05", "amount": 3000,
            })
            await c.post("/contractor-returns", json={
                "contractor_id": cid, "date": "2026-02-06", "amount": 500,
            })
            # Confirm live net_paid = 2500
            led = (await c.get(f"/contractors/{cid}/ledger")).json()
            assert led["net_paid"] == 2500.0

            body = {
                "contractor_id": cid,
                "up_to_date": "2026-02-07",
                "client_net_paid_snapshot": 2500.0,
                "cached_at": "2026-02-07T09:00:00Z",
                "operation_id": str(uuid.uuid4()),
            }
            r_ok = await c.post("/settlements", json=body)
            assert r_ok.status_code == 200, f"match should finalize: {r_ok.status_code} {r_ok.text}"
            sid = r_ok.json()["id"]

            # Exactly one contractor_settle row for this contractor
            settles = await db.settlements.find({
                "user_id": user_id, "contractor_id": cid, "kind": "contractor_settle",
            }).to_list(10)
            assert len(settles) == 1, f"expected 1 settlement, got {len(settles)}"
            assert settles[0]["id"] == sid
            assert settles[0]["amount"] == 2500.0

            # Exactly one auto-recorded return linked to that settlement
            auto_returns = await db.contractor_returns.find({
                "user_id": user_id, "contractor_id": cid, "settlement_id": sid,
            }).to_list(10)
            assert len(auto_returns) == 1
            assert auto_returns[0]["amount"] == 2500.0

            # net_paid is now zero
            led2 = (await c.get(f"/contractors/{cid}/ledger")).json()
            assert led2["net_paid"] == 0.0
    finally:
        await _cleanup(user_id, token)


@pytest.mark.asyncio
async def test_contractor_draft_mismatch_returns_409_writes_zero_rows():
    """When snapshot ≠ live: HTTP 409, code=settlement_revalidation_failed,
    kind=contractor, ZERO settlement rows, ZERO auto-return rows.
    """
    user_id, token = await _mk_user("csettle_conflict")
    try:
        async with httpx.AsyncClient(base_url=API_BASE, timeout=15.0,
                                     headers={"Authorization": f"Bearer {token}"}) as c:
            r = await c.post("/contractors", json={"name": "C-conflict"})
            cid = r.json()["id"]
            await c.post("/contractor-payments", json={
                "contractor_id": cid, "date": "2026-02-05", "amount": 1000,
            })

            settles_before = await db.settlements.count_documents({
                "user_id": user_id, "contractor_id": cid, "kind": "contractor_settle",
            })
            returns_before = await db.contractor_returns.count_documents({
                "user_id": user_id, "contractor_id": cid,
            })

            # Draft says net_paid=1000 but suppose server ledger later
            # shifted — we simulate that here by ALSO inserting a payment
            # BEFORE the settle POST, so live net_paid = 1500 ≠ draft 1000.
            await c.post("/contractor-payments", json={
                "contractor_id": cid, "date": "2026-02-06", "amount": 500,
            })
            body = {
                "contractor_id": cid,
                "up_to_date": "2026-02-07",
                "client_net_paid_snapshot": 1000.0,   # STALE
                "cached_at": "2026-02-05T20:00:00Z",
                "operation_id": str(uuid.uuid4()),
            }
            r_bad = await c.post("/settlements", json=body)
            assert r_bad.status_code == 409, f"mismatch must 409: {r_bad.status_code}"
            detail = r_bad.json()["detail"]
            assert detail["code"] == "settlement_revalidation_failed"
            assert detail.get("kind") == "contractor"
            assert detail["client"]["net_paid"] == 1000.0
            assert detail["server"]["net_paid"] == 1500.0
            assert detail["client"]["cached_at"] == "2026-02-05T20:00:00Z"

            # NO new settlement / auto-return rows
            settles_after = await db.settlements.count_documents({
                "user_id": user_id, "contractor_id": cid, "kind": "contractor_settle",
            })
            assert settles_after == settles_before, \
                f"MISMATCH WROTE SETTLEMENT: {settles_before}→{settles_after}"
            returns_after = await db.contractor_returns.count_documents({
                "user_id": user_id, "contractor_id": cid,
            })
            assert returns_after == returns_before, \
                f"MISMATCH WROTE AUTO-RETURN: {returns_before}→{returns_after}"
    finally:
        await _cleanup(user_id, token)


@pytest.mark.asyncio
async def test_contractor_no_snapshot_online_path_unchanged():
    """Absent snapshot fields → pure online contractor settle behaves
    bit-for-bit as before (writes settlement + auto-return, response
    shape unchanged)."""
    user_id, token = await _mk_user("csettle_online")
    try:
        async with httpx.AsyncClient(base_url=API_BASE, timeout=15.0,
                                     headers={"Authorization": f"Bearer {token}"}) as c:
            r = await c.post("/contractors", json={"name": "C-online"})
            cid = r.json()["id"]
            await c.post("/contractor-payments", json={
                "contractor_id": cid, "date": "2026-02-05", "amount": 700,
            })
            r_ok = await c.post("/settlements", json={
                "contractor_id": cid,
                "up_to_date": "2026-02-06",
            })
            assert r_ok.status_code == 200
            body = r_ok.json()
            assert body["kind"] == "contractor"
            assert body["amount"] == 700.0
    finally:
        await _cleanup(user_id, token)


@pytest.mark.asyncio
async def test_contractor_operation_id_replay_no_double_write():
    """Replaying the same operation_id must NOT create a second
    settlement or a second auto-return."""
    user_id, token = await _mk_user("csettle_replay")
    try:
        async with httpx.AsyncClient(base_url=API_BASE, timeout=15.0,
                                     headers={"Authorization": f"Bearer {token}"}) as c:
            r = await c.post("/contractors", json={"name": "C-replay"})
            cid = r.json()["id"]
            await c.post("/contractor-payments", json={
                "contractor_id": cid, "date": "2026-02-05", "amount": 900,
            })
            op_id = str(uuid.uuid4())
            body = {
                "contractor_id": cid,
                "up_to_date": "2026-02-06",
                "client_net_paid_snapshot": 900.0,
                "operation_id": op_id,
            }
            r1 = await c.post("/settlements", json=body)
            assert r1.status_code == 200
            r2 = await c.post("/settlements", json=body)
            assert r2.status_code == 200
            assert r1.json()["id"] == r2.json()["id"], "not idempotent"

            # Exactly one settlement
            n_settle = await db.settlements.count_documents({
                "user_id": user_id, "contractor_id": cid, "kind": "contractor_settle",
            })
            assert n_settle == 1, f"double-write: {n_settle} settlements"
            # Exactly one auto-return linked
            n_ret = await db.contractor_returns.count_documents({
                "user_id": user_id, "contractor_id": cid, "settlement_id": r1.json()["id"],
            })
            assert n_ret == 1, f"double auto-return: {n_ret}"
    finally:
        await _cleanup(user_id, token)


@pytest.mark.asyncio
async def test_contractor_cross_account_isolation():
    """Account A cannot POST a contractor settlement for Account B's
    contractor. Even with a snapshot + operation_id, must 404 and
    NOT cache the 404 in sync_ops."""
    a_uid, a_tok = await _mk_user("iso_a")
    b_uid, b_tok = await _mk_user("iso_b")
    try:
        async with httpx.AsyncClient(base_url=API_BASE, timeout=15.0,
                                     headers={"Authorization": f"Bearer {b_tok}"}) as cb:
            r = await cb.post("/contractors", json={"name": "B-contractor"})
            b_cid = r.json()["id"]
            await cb.post("/contractor-payments", json={
                "contractor_id": b_cid, "date": "2026-02-05", "amount": 500,
            })

        async with httpx.AsyncClient(base_url=API_BASE, timeout=15.0,
                                     headers={"Authorization": f"Bearer {a_tok}"}) as ca:
            r = await ca.post("/settlements", json={
                "contractor_id": b_cid,
                "up_to_date": "2026-02-06",
                "client_net_paid_snapshot": 500.0,
                "operation_id": str(uuid.uuid4()),
            })
            assert r.status_code == 404

        # No leaked settlements or sync_ops rows for account A
        assert await db.settlements.count_documents({"user_id": a_uid}) == 0
        assert await db.sync_ops.count_documents({"user_id": a_uid}) == 0
        # B's contractor still has 0 contractor_settle rows
        assert await db.settlements.count_documents({
            "user_id": b_uid, "contractor_id": b_cid, "kind": "contractor_settle",
        }) == 0
    finally:
        await _cleanup(a_uid, a_tok)
        await _cleanup(b_uid, b_tok)


@pytest.mark.asyncio
async def test_worker_settlement_still_works_untouched():
    """Regression: adding client_net_paid_snapshot must not affect the
    worker branch."""
    user_id, token = await _mk_user("worker_regression")
    try:
        async with httpx.AsyncClient(base_url=API_BASE, timeout=15.0,
                                     headers={"Authorization": f"Bearer {token}"}) as c:
            r = await c.post("/workers", json={"name": "W", "daily_rate": 400})
            wid = r.json()["id"]
            for d in ["2026-02-01", "2026-02-02"]:
                await c.post("/attendance", json={
                    "worker_id": wid, "date": d, "status": "present",
                })
            # Match earned (400*2=800) — must finalize
            r_ok = await c.post("/settlements", json={
                "worker_id": wid, "up_to_date": "2026-02-03",
                "mode": "actual_paid", "actual_paid": 800,
                "client_earned_snapshot": 800.0,
                "client_advance_snapshot": 0.0,
                "operation_id": str(uuid.uuid4()),
            })
            assert r_ok.status_code == 200
            assert r_ok.json()["kind"] == "worker"
    finally:
        await _cleanup(user_id, token)


if __name__ == "__main__":
    async def _all():
        await test_contractor_draft_matching_snapshot_finalizes()
        print("[PASS] test_contractor_draft_matching_snapshot_finalizes")
        await test_contractor_draft_mismatch_returns_409_writes_zero_rows()
        print("[PASS] test_contractor_draft_mismatch_returns_409_writes_zero_rows")
        await test_contractor_no_snapshot_online_path_unchanged()
        print("[PASS] test_contractor_no_snapshot_online_path_unchanged")
        await test_contractor_operation_id_replay_no_double_write()
        print("[PASS] test_contractor_operation_id_replay_no_double_write")
        await test_contractor_cross_account_isolation()
        print("[PASS] test_contractor_cross_account_isolation")
        await test_worker_settlement_still_works_untouched()
        print("[PASS] test_worker_settlement_still_works_untouched")
    asyncio.run(_all())
    print("\n=== ALL 6 CONTRACTOR-SETTLEMENT DRAFT TESTS PASSED ===")

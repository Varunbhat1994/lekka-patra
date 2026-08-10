"""Iteration 5: Contractor Mark Settled + worker settle regression + negative paths."""
import os
import uuid
import pytest
import requests
from datetime import datetime, timezone, timedelta

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://field-crew-log-1.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def session():
    mobile = f"9{uuid.uuid4().int % 1000000000:09d}"
    r = requests.post(f"{API}/auth/otp/send", json={"mobile": mobile})
    assert r.status_code == 200, r.text
    otp = r.json()["dev_otp"]
    r = requests.post(f"{API}/auth/otp/verify", json={"mobile": mobile, "otp": otp})
    assert r.status_code == 200, r.text
    token = r.json()["session_token"]
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}"})
    r = s.post(f"{API}/auth/profile", json={"name": "TEST_User5", "district": "Mysuru"})
    assert r.status_code == 200, r.text
    return s


# ---------- CONTRACTOR SETTLE ----------
@pytest.fixture(scope="module")
def contractor_with_payment(session):
    r = session.post(f"{API}/contractors", json={"name": "TEST_Contractor5", "mobile": "", "notes": ""})
    assert r.status_code == 200, r.text
    cid = r.json()["id"]
    today = datetime.now(timezone.utc).date().isoformat()
    r = session.post(f"{API}/contractor-payments", json={
        "contractor_id": cid, "date": today, "amount": 1500, "method": "cash"
    })
    assert r.status_code == 200, r.text
    return cid


def test_contractor_ledger_before_settle(session, contractor_with_payment):
    r = session.get(f"{API}/contractors/{contractor_with_payment}/ledger")
    assert r.status_code == 200
    led = r.json()
    assert led["total_paid"] == 1500
    assert led["total_returned"] == 0
    assert led["net_paid"] == 1500


def test_contractor_settle_zeroes_net_paid(session, contractor_with_payment):
    today = datetime.now(timezone.utc).date().isoformat()
    r = session.post(f"{API}/settlements", json={
        "contractor_id": contractor_with_payment, "up_to_date": today, "note": "settle"
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["amount"] == 1500
    assert body["kind"] == "contractor"
    sid = body["id"]

    r = session.get(f"{API}/contractors/{contractor_with_payment}/ledger")
    led = r.json()
    assert led["total_paid"] == 1500
    assert led["total_returned"] == 1500, f"total_returned should be 1500, got {led}"
    assert led["net_paid"] == 0, f"net_paid should be 0 after settle, got {led['net_paid']}"

    # Store sid on the fixture via module-level attr
    test_contractor_settle_zeroes_net_paid.sid = sid


def test_contractor_undo_settle_reverts_net_paid(session, contractor_with_payment):
    sid = test_contractor_settle_zeroes_net_paid.sid
    r = session.delete(f"{API}/settlements/{sid}")
    assert r.status_code == 200, r.text

    r = session.get(f"{API}/contractors/{contractor_with_payment}/ledger")
    led = r.json()
    assert led["total_paid"] == 1500
    assert led["total_returned"] == 0, f"After undo, total_returned should be 0, got {led}"
    assert led["net_paid"] == 1500, f"After undo, net_paid should revert to 1500, got {led['net_paid']}"


# ---------- WORKER SETTLE REGRESSION ----------
@pytest.fixture(scope="module")
def worker_with_data(session):
    r = session.post(f"{API}/workers", json={
        "name": "TEST_WorkerReg5", "mobile": "", "skill": "", "daily_rate": 500
    })
    assert r.status_code == 200, r.text
    wid = r.json()["id"]
    today = datetime.now(timezone.utc).date()
    d1 = (today - timedelta(days=1)).isoformat()
    d2 = today.isoformat()
    for d in [d1, d2]:
        r = session.post(f"{API}/attendance", json={
            "worker_id": wid, "date": d, "status": "present"
        })
        assert r.status_code == 200, r.text
    r = session.post(f"{API}/advances", json={
        "worker_id": wid, "date": d2, "amount": 300, "method": "cash"
    })
    assert r.status_code == 200, r.text
    return wid


def test_worker_settle_still_works(session, worker_with_data):
    today = datetime.now(timezone.utc).date().isoformat()
    r = session.post(f"{API}/settlements", json={
        "worker_id": worker_with_data, "up_to_date": today
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["amount"] == 700
    assert body["kind"] == "worker"

    r = session.get(f"{API}/ledger/{worker_with_data}")
    led = r.json()
    assert led["pending"] == 0
    assert led["total_settled"] == 700


# ---------- NEGATIVE PATHS ----------
def test_settle_missing_ids_returns_400(session):
    r = session.post(f"{API}/settlements", json={"up_to_date": "2026-01-01"})
    assert r.status_code == 400, r.text


def test_settle_nonexistent_worker_returns_404(session):
    r = session.post(f"{API}/settlements", json={
        "worker_id": f"nope-{uuid.uuid4().hex}", "up_to_date": "2026-01-01"
    })
    assert r.status_code == 404, r.text


def test_settle_nonexistent_contractor_returns_404(session):
    r = session.post(f"{API}/settlements", json={
        "contractor_id": f"nope-{uuid.uuid4().hex}", "up_to_date": "2026-01-01"
    })
    assert r.status_code == 404, r.text


# ---------- CLEANUP ----------
def test_cleanup(session, contractor_with_payment, worker_with_data):
    r = session.delete(f"{API}/contractors/{contractor_with_payment}")
    assert r.status_code == 200
    r = session.delete(f"{API}/workers/{worker_with_data}")
    assert r.status_code == 200

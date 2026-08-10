"""Iteration 4: Mark Settled fix + Undo Settle feature backend tests."""
import os
import uuid
import pytest
import requests
from datetime import datetime, timezone, timedelta

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://field-crew-log-1.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def session():
    """Create ephemeral OTP-based session."""
    mobile = f"9{uuid.uuid4().int % 1000000000:09d}"
    r = requests.post(f"{API}/auth/otp/send", json={"mobile": mobile})
    assert r.status_code == 200, r.text
    otp = r.json()["dev_otp"]
    r = requests.post(f"{API}/auth/otp/verify", json={"mobile": mobile, "otp": otp})
    assert r.status_code == 200, r.text
    token = r.json()["session_token"]
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}"})
    # Set profile so writes aren't locked (trial is auto active for new user)
    r = s.post(f"{API}/auth/profile", json={"name": "TEST_User4", "district": "Mysuru"})
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def worker_with_data(session):
    """Create worker with 2 present days and 1 advance of 300."""
    r = session.post(f"{API}/workers", json={
        "name": "TEST_SettleWorker", "mobile": "", "skill": "", "daily_rate": 500
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


def test_ledger_before_settle(session, worker_with_data):
    r = session.get(f"{API}/ledger/{worker_with_data}")
    assert r.status_code == 200
    led = r.json()
    assert led["total_earned"] == 1000, led
    assert led["total_advance"] == 300
    assert led["pending"] == 700
    assert led["total_settled"] == 0


def test_settlement_zeroes_pending(session, worker_with_data):
    today = datetime.now(timezone.utc).date().isoformat()
    r = session.post(f"{API}/settlements", json={
        "worker_id": worker_with_data, "up_to_date": today, "note": "test"
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["amount"] == 700
    sid = body["id"]

    r = session.get(f"{API}/ledger/{worker_with_data}")
    led = r.json()
    assert led["pending"] == 0, f"Pending must be 0 after settle, got {led['pending']}"
    assert led["total_settled"] == 700
    assert led["net_advance"] == 1000  # 300 advance + 700 settled
    assert len(led["settlements"]) == 1
    assert led["settlements"][0]["id"] == sid


def test_undo_settle_reverts_pending(session, worker_with_data):
    # Get current settlement id
    r = session.get(f"{API}/settlements?worker_id={worker_with_data}")
    assert r.status_code == 200
    sl = r.json()
    assert len(sl) >= 1
    sid = sl[0]["id"]

    r = session.delete(f"{API}/settlements/{sid}")
    assert r.status_code == 200, r.text

    r = session.get(f"{API}/ledger/{worker_with_data}")
    led = r.json()
    assert led["pending"] == 700, f"Pending must revert to 700 after undo, got {led['pending']}"
    assert led["total_settled"] == 0
    assert led["net_advance"] == 300
    assert len(led["settlements"]) == 0


def test_undo_settle_nonexistent_returns_404(session):
    r = session.delete(f"{API}/settlements/nonexistent-id-{uuid.uuid4().hex}")
    assert r.status_code == 404


def test_undo_settle_no_auth_returns_401():
    r = requests.delete(f"{API}/settlements/anyid")
    assert r.status_code == 401


def test_cleanup(session, worker_with_data):
    """Cleanup TEST_ prefixed worker."""
    r = session.delete(f"{API}/workers/{worker_with_data}")
    assert r.status_code == 200

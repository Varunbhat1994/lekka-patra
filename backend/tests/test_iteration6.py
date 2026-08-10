"""Iteration 6: settlement cutoff semantics (days/pending reset, post-settle fresh, undo)."""
import os
import uuid
import pytest
import requests
from datetime import datetime, timezone, timedelta

def _read_frontend_env():
    p = "/app/frontend/.env"
    with open(p) as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip()
    raise RuntimeError("REACT_APP_BACKEND_URL not set")

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _read_frontend_env()).rstrip("/")
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
    r = s.post(f"{API}/auth/profile", json={"name": "TEST_User6", "district": "Mysuru"})
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def worker(session):
    r = session.post(f"{API}/workers", json={
        "name": "TEST_WorkerSettleCutoff", "mobile": "", "skill": "", "daily_rate": 500
    })
    assert r.status_code == 200, r.text
    wid = r.json()["id"]
    # Seed: 3 present days + advance 400
    for d in ["2026-02-01", "2026-02-02", "2026-02-03"]:
        r = session.post(f"{API}/attendance", json={"worker_id": wid, "date": d, "status": "present"})
        assert r.status_code == 200
    r = session.post(f"{API}/advances", json={"worker_id": wid, "date": "2026-02-02", "amount": 400, "method": "cash"})
    assert r.status_code == 200
    yield wid
    session.delete(f"{API}/workers/{wid}")


state = {}


# ---------- Scenario A ----------
def test_a1_pre_settle_ledger(session, worker):
    r = session.get(f"{API}/ledger/{worker}")
    assert r.status_code == 200
    led = r.json()
    assert led["days_worked"] == 3
    assert led["total_earned"] == 1500
    assert led["total_advance"] == 400
    assert led["pending"] == 1100
    assert led.get("settled_up_to") in (None, "")


def test_a2_settle_amount_1100(session, worker):
    r = session.post(f"{API}/settlements", json={"worker_id": worker, "up_to_date": "2026-02-10"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["amount"] == 1100
    assert body["kind"] == "worker"
    state["sid_a"] = body["id"]


def test_a3_post_settle_ledger_zeros(session, worker):
    r = session.get(f"{API}/ledger/{worker}")
    led = r.json()
    assert led["days_worked"] == 0, led
    assert led["total_earned"] == 0, led
    assert led["total_advance"] == 0, led
    assert led["pending"] == 0, led
    assert led["settled_up_to"] == "2026-02-10"
    assert led["total_settled"] == 1100


# ---------- Scenario B ----------
def test_b_post_settle_activity_counts_fresh(session, worker):
    r = session.post(f"{API}/attendance", json={
        "worker_id": worker, "date": "2026-02-15", "status": "present"
    })
    assert r.status_code == 200
    r = session.get(f"{API}/ledger/{worker}")
    led = r.json()
    assert led["days_worked"] == 1, led
    assert led["total_earned"] == 500, led
    assert led["total_advance"] == 0, led
    assert led["pending"] == 500, led


# ---------- Scenario C ----------
def test_c_undo_restores_full_history(session, worker):
    r = session.delete(f"{API}/settlements/{state['sid_a']}")
    assert r.status_code == 200
    r = session.get(f"{API}/ledger/{worker}")
    led = r.json()
    assert led["days_worked"] == 4, led
    assert led["total_earned"] == 2000, led
    assert led["total_advance"] == 400, led
    assert led["pending"] == 1600, led
    assert led.get("settled_up_to") in (None, "")


# ---------- Scenario D ----------
def test_d_multiple_settlements(session, worker):
    # Add present 2026-02-16 (already have 4 days & 400 adv from above)
    r = session.post(f"{API}/attendance", json={"worker_id": worker, "date": "2026-02-16", "status": "present"})
    assert r.status_code == 200
    # Settle up_to 2026-02-20
    r = session.post(f"{API}/settlements", json={"worker_id": worker, "up_to_date": "2026-02-20"})
    assert r.status_code == 200
    body = r.json()
    # amount = 5 days*500 - 400 = 2100
    assert body["amount"] == 2100, body
    r = session.get(f"{API}/ledger/{worker}")
    led = r.json()
    assert led["days_worked"] == 0
    assert led["pending"] == 0
    assert led["settled_up_to"] == "2026-02-20"
    # Add fresh activity after settlement
    r = session.post(f"{API}/attendance", json={"worker_id": worker, "date": "2026-02-25", "status": "present"})
    assert r.status_code == 200
    r = session.get(f"{API}/ledger/{worker}")
    led = r.json()
    assert led["days_worked"] == 1, led
    assert led["total_earned"] == 500, led


# ---------- Regression: advance return + contractor settle ----------
def test_e_advance_return_reduces_net_advance(session):
    r = session.post(f"{API}/workers", json={"name": "TEST_ReturnReg6", "daily_rate": 400})
    wid = r.json()["id"]
    session.post(f"{API}/attendance", json={"worker_id": wid, "date": "2026-03-01", "status": "present"})
    session.post(f"{API}/advances", json={"worker_id": wid, "date": "2026-03-01", "amount": 500, "method": "cash"})
    session.post(f"{API}/returns", json={"worker_id": wid, "date": "2026-03-02", "amount": 200, "method": "cash"})
    r = session.get(f"{API}/ledger/{wid}")
    led = r.json()
    assert led["total_advance"] == 500
    assert led["total_returned"] == 200
    assert led["net_advance"] == 300
    assert led["pending"] == 400 - 300
    session.delete(f"{API}/workers/{wid}")


def test_f_contractor_settle_regression(session):
    r = session.post(f"{API}/contractors", json={"name": "TEST_C6"})
    cid = r.json()["id"]
    session.post(f"{API}/contractor-payments", json={
        "contractor_id": cid, "date": "2026-03-01", "amount": 800, "method": "cash"
    })
    r = session.post(f"{API}/settlements", json={"contractor_id": cid, "up_to_date": "2026-03-05"})
    assert r.status_code == 200
    assert r.json()["amount"] == 800
    r = session.get(f"{API}/contractors/{cid}/ledger")
    led = r.json()
    assert led["net_paid"] == 0
    session.delete(f"{API}/contractors/{cid}")

"""
FarmLog backend regression tests - Iteration 2
Focus: Mark Settled logic, per-worker PDF, contractor return, contractor PDF/Excel.
"""
import os
import re
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://field-crew-log-1.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


def _rand_mobile():
    # 10 digits starting with 9
    return "9" + "".join([str((uuid.uuid4().int >> (i * 4)) & 9) for i in range(9)])


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    # OTP auth
    mobile = _rand_mobile()
    r = s.post(f"{API}/auth/otp/send", json={"mobile": mobile})
    assert r.status_code == 200, r.text
    otp = r.json()["dev_otp"]
    r = s.post(f"{API}/auth/otp/verify", json={"mobile": mobile, "otp": otp})
    assert r.status_code == 200, r.text
    # profile
    r = s.post(f"{API}/auth/profile", json={"name": "TEST_User", "district": "Bengaluru Urban"})
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def worker(client):
    r = client.post(f"{API}/workers", json={"name": "TEST_Worker", "skill": "labour", "daily_rate": 500, "phone": ""})
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def contractor(client):
    r = client.post(f"{API}/contractors", json={"name": "TEST_Contractor", "phone": "9999999999", "notes": ""})
    assert r.status_code == 200, r.text
    return r.json()


# ----------------- BUG FIX: Mark Settled -----------------

class TestSettlement:
    def test_settle_zeros_pending(self, client, worker):
        wid = worker["id"]
        # 2 present days
        for d in ["2025-01-10", "2025-01-11"]:
            r = client.post(f"{API}/attendance", json={"worker_id": wid, "date": d, "status": "present", "overtime_hours": 0})
            assert r.status_code == 200, r.text
        # 1 advance of 300
        r = client.post(f"{API}/advances", json={"worker_id": wid, "date": "2025-01-11", "amount": 300, "method": "cash", "notes": ""})
        assert r.status_code == 200, r.text

        r = client.get(f"{API}/ledger/{wid}")
        assert r.status_code == 200
        led = r.json()
        assert led["total_earned"] == 1000, led
        assert led["total_advance"] == 300, led
        assert led["pending"] == 700, led

        # Settle
        r = client.post(f"{API}/settlements", json={"worker_id": wid, "up_to_date": "2025-01-11", "note": "test"})
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["amount"] == 700, j

        # After settle pending==0
        r = client.get(f"{API}/ledger/{wid}")
        led = r.json()
        assert led["pending"] == 0, led
        assert led["total_settled"] == 700, led


# ----------------- Advance Return (worker) -----------------

class TestWorkerReturn:
    def test_return_reduces_net_advance(self, client):
        # create fresh worker
        r = client.post(f"{API}/workers", json={"name": "TEST_W2", "skill": "labour", "daily_rate": 500, "phone": ""})
        wid = r.json()["id"]
        client.post(f"{API}/advances", json={"worker_id": wid, "date": "2025-01-05", "amount": 500, "method": "cash", "notes": ""})
        r = client.post(f"{API}/returns", json={"worker_id": wid, "date": "2025-01-06", "amount": 200, "method": "cash", "notes": ""})
        assert r.status_code == 200, r.text
        r = client.get(f"{API}/ledger/{wid}")
        led = r.json()
        assert led["total_advance"] == 500
        assert led["total_returned"] == 200
        assert led["net_advance"] == 300


# ----------------- Per-worker PDF -----------------

class TestWorkerPDF:
    def test_pdf_with_worker_id(self, client, worker):
        wid = worker["id"]
        r = client.get(f"{API}/reports/pdf", params={"worker_id": wid})
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("application/pdf")
        cd = r.headers.get("content-disposition", "")
        # filename should include worker_id prefix (first 8 chars)
        assert wid[:8] in cd, cd
        assert r.content[:4] == b"%PDF", "Not a PDF"


# ----------------- Contractor Return -----------------

class TestContractorReturn:
    def test_contractor_return_flow(self, client, contractor):
        cid = contractor["id"]
        # payment
        r = client.post(f"{API}/contractor-payments", json={"contractor_id": cid, "date": "2025-01-10", "amount": 1000, "method": "cash", "notes": ""})
        assert r.status_code == 200, r.text
        # return
        r = client.post(f"{API}/contractor-returns", json={"contractor_id": cid, "date": "2025-01-11", "amount": 300, "method": "cash", "notes": ""})
        assert r.status_code == 200, r.text

        r = client.get(f"{API}/contractors/{cid}/ledger")
        assert r.status_code == 200
        led = r.json()
        assert led["total_paid"] == 1000
        assert led["total_returned"] == 300
        assert led["net_paid"] == 700


# ----------------- Contractor PDF/Excel -----------------

class TestContractorReports:
    def test_contractor_pdf(self, client, contractor):
        r = client.get(f"{API}/reports/contractor/{contractor['id']}/pdf")
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert r.content[:4] == b"%PDF"

    def test_contractor_excel(self, client, contractor):
        r = client.get(f"{API}/reports/contractor/{contractor['id']}/excel")
        assert r.status_code == 200
        ct = r.headers.get("content-type", "")
        assert "spreadsheet" in ct or "excel" in ct, ct
        # xlsx = zip; starts with PK
        assert r.content[:2] == b"PK"


# ----------------- Ads endpoint -----------------

class TestAds:
    def test_ads_endpoint(self, client):
        r = client.get(f"{API}/ads")
        assert r.status_code == 200
        # returns list
        assert isinstance(r.json(), list)

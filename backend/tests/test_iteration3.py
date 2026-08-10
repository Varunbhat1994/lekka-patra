"""
FarmLog backend tests - Iteration 3
Focus:
 - Regression: Mark Settled zeros pending, worker + contractor Advance Return.
 - NEW: /api/dashboard.pending_list includes ONLY entries with advance/payment > 0.
 - NEW: /api/reports/contractor/{cid}/whatsapp returns {message, phone} with required fields.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"


def _rand_mobile():
    return "9" + "".join([str((uuid.uuid4().int >> (i * 4)) & 9) for i in range(9)])


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    mobile = _rand_mobile()
    r = s.post(f"{API}/auth/otp/send", json={"mobile": mobile})
    assert r.status_code == 200, r.text
    otp = r.json()["dev_otp"]
    r = s.post(f"{API}/auth/otp/verify", json={"mobile": mobile, "otp": otp})
    assert r.status_code == 200, r.text
    r = s.post(f"{API}/auth/profile", json={"name": "TEST_User_it3", "district": "Bengaluru Urban"})
    assert r.status_code == 200, r.text
    return s


# ============== Regression: Mark Settled ==============
class TestSettlementRegression:
    def test_settle_zeros_pending(self, client):
        r = client.post(f"{API}/workers", json={"name": "TEST_W_settle", "skill": "labour", "daily_rate": 400})
        assert r.status_code == 200
        wid = r.json()["id"]
        client.post(f"{API}/attendance", json={"worker_id": wid, "date": "2025-02-01", "status": "present", "overtime_hours": 0})
        client.post(f"{API}/advances", json={"worker_id": wid, "date": "2025-02-01", "amount": 100, "method": "cash"})
        r = client.get(f"{API}/ledger/{wid}")
        assert r.json()["pending"] == 300
        r = client.post(f"{API}/settlements", json={"worker_id": wid, "up_to_date": "2025-02-01", "note": ""})
        assert r.status_code == 200
        r = client.get(f"{API}/ledger/{wid}")
        assert r.json()["pending"] == 0


# ============== Regression: Worker + Contractor Return ==============
class TestReturnRegression:
    def test_worker_return(self, client):
        r = client.post(f"{API}/workers", json={"name": "TEST_W_ret", "skill": "", "daily_rate": 500})
        wid = r.json()["id"]
        client.post(f"{API}/advances", json={"worker_id": wid, "date": "2025-02-02", "amount": 500, "method": "cash"})
        r = client.post(f"{API}/returns", json={"worker_id": wid, "date": "2025-02-03", "amount": 150, "method": "cash"})
        assert r.status_code == 200
        led = client.get(f"{API}/ledger/{wid}").json()
        assert led["total_advance"] == 500
        assert led["total_returned"] == 150
        assert led["net_advance"] == 350

    def test_contractor_return(self, client):
        r = client.post(f"{API}/contractors", json={"name": "TEST_C_ret", "mobile": "9876543210", "notes": ""})
        cid = r.json()["id"]
        client.post(f"{API}/contractor-payments", json={"contractor_id": cid, "date": "2025-02-02", "amount": 1000, "method": "cash"})
        r = client.post(f"{API}/contractor-returns", json={"contractor_id": cid, "date": "2025-02-03", "amount": 250, "method": "cash"})
        assert r.status_code == 200
        led = client.get(f"{API}/contractors/{cid}/ledger").json()
        assert led["total_paid"] == 1000
        assert led["total_returned"] == 250
        assert led["net_paid"] == 750


# ============== NEW: Dashboard pending_list filter ==============
class TestDashboardPendingList:
    def test_pending_list_only_includes_advance_recipients(self, client):
        # Fresh isolated user
        s = requests.Session()
        mobile = _rand_mobile()
        r = s.post(f"{API}/auth/otp/send", json={"mobile": mobile})
        otp = r.json()["dev_otp"]
        s.post(f"{API}/auth/otp/verify", json={"mobile": mobile, "otp": otp})
        s.post(f"{API}/auth/profile", json={"name": "TEST_PendingListUser", "district": "Mysuru"})

        # 2 workers: one with advance, one without
        w_adv = s.post(f"{API}/workers", json={"name": "TEST_W_hasAdv", "skill": "", "daily_rate": 500}).json()
        w_none = s.post(f"{API}/workers", json={"name": "TEST_W_noAdv", "skill": "", "daily_rate": 500}).json()
        s.post(f"{API}/advances", json={"worker_id": w_adv["id"], "date": "2025-02-04", "amount": 200, "method": "cash"})

        # 2 contractors: one with payment, one without
        c_paid = s.post(f"{API}/contractors", json={"name": "TEST_C_hasPay", "mobile": "", "notes": ""}).json()
        c_none = s.post(f"{API}/contractors", json={"name": "TEST_C_noPay", "mobile": "", "notes": ""}).json()
        s.post(f"{API}/contractor-payments", json={"contractor_id": c_paid["id"], "date": "2025-02-04", "amount": 500, "method": "cash"})

        r = s.get(f"{API}/dashboard")
        assert r.status_code == 200
        data = r.json()
        assert "pending_list" in data
        pl = data["pending_list"]
        names = sorted([p["name"] for p in pl])
        assert names == ["TEST_C_hasPay", "TEST_W_hasAdv"], f"pending_list contains wrong entries: {pl}"
        assert len(pl) == 2

        # Structure checks
        for item in pl:
            assert "type" in item and item["type"] in ("worker", "contractor")
            assert "name" in item
            assert "pending" in item

    def test_empty_pending_list_when_no_advances(self, client):
        s = requests.Session()
        mobile = _rand_mobile()
        r = s.post(f"{API}/auth/otp/send", json={"mobile": mobile})
        otp = r.json()["dev_otp"]
        s.post(f"{API}/auth/otp/verify", json={"mobile": mobile, "otp": otp})
        s.post(f"{API}/auth/profile", json={"name": "TEST_EmptyUser", "district": "Mysuru"})
        s.post(f"{API}/workers", json={"name": "TEST_W_empty", "skill": "", "daily_rate": 500})
        r = s.get(f"{API}/dashboard")
        assert r.status_code == 200
        assert r.json()["pending_list"] == []


# ============== NEW: Contractor WhatsApp endpoint ==============
class TestContractorWhatsApp:
    def test_whatsapp_message_contains_required_fields(self, client):
        r = client.post(f"{API}/contractors", json={"name": "TEST_C_WA", "mobile": "9123456780", "notes": ""})
        cid = r.json()["id"]
        # 2 visits
        client.post(f"{API}/contractor-visits", json={"contractor_id": cid, "date": "2025-02-05", "workers_count": 3, "field_crop": "paddy", "notes": ""})
        client.post(f"{API}/contractor-visits", json={"contractor_id": cid, "date": "2025-02-06", "workers_count": 5, "field_crop": "ragi", "notes": ""})
        # payments & return
        client.post(f"{API}/contractor-payments", json={"contractor_id": cid, "date": "2025-02-06", "amount": 2000, "method": "cash"})
        client.post(f"{API}/contractor-returns", json={"contractor_id": cid, "date": "2025-02-07", "amount": 500, "method": "cash"})

        r = client.get(f"{API}/reports/contractor/{cid}/whatsapp?lang=en")
        assert r.status_code == 200, r.text
        j = r.json()
        assert "message" in j and "phone" in j
        assert j["phone"] == "9123456780"
        m = j["message"]
        assert "TEST_C_WA" in m
        assert "Total visits: 2" in m
        assert "Total workers brought: 8" in m
        assert "Total paid: Rs 2000" in m
        assert "Returned: Rs 500" in m
        assert "Net paid: Rs 1500" in m
        assert "Recent visits:" in m
        assert "Recent payments:" in m

    def test_whatsapp_404_when_missing(self, client):
        r = client.get(f"{API}/reports/contractor/nonexistent-id/whatsapp?lang=en")
        assert r.status_code == 404

"""Iteration 7: Editable admin profile (mobile), Feedback system, PDF attendance detail."""
import os
import uuid
import pytest
import requests
from io import BytesIO

try:
    from pypdf import PdfReader
except Exception:
    from PyPDF2 import PdfReader  # fallback

def _read_env():
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip()
    raise RuntimeError("REACT_APP_BACKEND_URL missing")

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _read_env()).rstrip("/")
API = f"{BASE_URL}/api"


def _make_user(name="TEST_User7", district="Mysuru"):
    mobile = f"9{uuid.uuid4().int % 1000000000:09d}"
    r = requests.post(f"{API}/auth/otp/send", json={"mobile": mobile})
    assert r.status_code == 200
    otp = r.json()["dev_otp"]
    r = requests.post(f"{API}/auth/otp/verify", json={"mobile": mobile, "otp": otp})
    assert r.status_code == 200
    tok = r.json()["session_token"]
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {tok}"})
    r = s.post(f"{API}/auth/profile", json={"name": name, "district": district})
    assert r.status_code == 200, r.text
    return s, mobile


@pytest.fixture(scope="module")
def session():
    s, _ = _make_user()
    return s


# ---------------- Profile ----------------
class TestProfile:
    def test_mobile_update_normalizes_10digit(self, session):
        new_mobile = f"9{uuid.uuid4().int % 1000000000:09d}"[:10]
        r = session.post(f"{API}/auth/profile", json={
            "name": "TEST_User7", "district": "Mysuru", "mobile": new_mobile
        })
        assert r.status_code == 200, r.text
        assert r.json()["user"]["mobile"] == "91" + new_mobile
        # Verify via /auth/me
        me = session.get(f"{API}/auth/me").json()
        assert me["mobile"] == "91" + new_mobile

    def test_invalid_district_400(self, session):
        r = session.post(f"{API}/auth/profile", json={
            "name": "TEST_User7", "district": "NotADistrict"
        })
        assert r.status_code == 400

    def test_mobile_conflict_409(self):
        s1, _ = _make_user()
        m2 = f"9{uuid.uuid4().int % 1000000000:09d}"[:10]
        s2, _ = _make_user()
        # give s1 the mobile m2
        r = s1.post(f"{API}/auth/profile", json={"name": "TEST_A", "district": "Mysuru", "mobile": m2})
        assert r.status_code == 200
        # s2 tries the same 10-digit -> normalized -> conflict
        r = s2.post(f"{API}/auth/profile", json={"name": "TEST_B", "district": "Mysuru", "mobile": m2})
        assert r.status_code == 409, r.text


# ---------------- Feedback ----------------
class TestFeedback:
    def test_create_feedback(self, session):
        r = session.post(f"{API}/feedback", json={
            "message": "TEST_App is great", "rating": 5, "category": "general"
        })
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["id"] and d["read"] is False
        assert d["message"] == "TEST_App is great"
        assert d["rating"] == 5
        assert d["category"] == "general"
        assert d["user_id"]

    def test_empty_message_400(self, session):
        r = session.post(f"{API}/feedback", json={"message": "   "})
        assert r.status_code == 400

    def test_list_and_mark_single_read(self, session):
        r = session.post(f"{API}/feedback", json={"message": "TEST_second", "category": "bug"})
        fid = r.json()["id"]
        r = session.get(f"{API}/feedback")
        assert r.status_code == 200
        rows = r.json()
        assert len(rows) >= 2
        # desc sort
        dates = [x["created_at"] for x in rows]
        assert dates == sorted(dates, reverse=True)
        # mark single
        r = session.post(f"{API}/feedback/{fid}/read")
        assert r.status_code == 200
        rows2 = session.get(f"{API}/feedback").json()
        found = next(x for x in rows2 if x["id"] == fid)
        assert found["read"] is True

    def test_read_all(self, session):
        # ensure at least one unread
        session.post(f"{API}/feedback", json={"message": "TEST_third"})
        r = session.post(f"{API}/feedback/read-all")
        assert r.status_code == 200
        rows = session.get(f"{API}/feedback").json()
        assert all(x["read"] for x in rows)

    def test_scoped_per_user(self):
        s1, _ = _make_user()
        s2, _ = _make_user()
        s1.post(f"{API}/feedback", json={"message": "TEST_user1_only"})
        rows2 = s2.get(f"{API}/feedback").json()
        assert all("TEST_user1_only" not in x["message"] for x in rows2)


# ---------------- PDF Attendance detail ----------------
class TestPdfAttendance:
    def test_pdf_has_attendance_section(self, session):
        r = session.post(f"{API}/workers", json={
            "name": "TEST_PdfWorker", "daily_rate": 500
        })
        wid = r.json()["id"]
        session.post(f"{API}/attendance", json={
            "worker_id": wid, "date": "2026-04-01", "status": "present",
            "field_crop": "Paddy", "description": "morning shift"
        })
        session.post(f"{API}/attendance", json={
            "worker_id": wid, "date": "2026-04-02", "status": "overtime",
            "overtime_hours": 3, "field_crop": "Paddy"
        })
        r = session.get(f"{API}/reports/pdf", params={"worker_id": wid})
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("application/pdf")
        pdf = PdfReader(BytesIO(r.content))
        text = "\n".join((p.extract_text() or "") for p in pdf.pages)
        assert "Attendance (date-wise)" in text, text[:2000]
        assert "2026-04-01" in text
        assert "2026-04-02" in text
        # overtime hours 3 should appear
        assert "3" in text
        assert "Paddy" in text
        session.delete(f"{API}/workers/{wid}")


# ---------------- Regression ----------------
class TestRegression:
    def test_mark_settled_zeros(self, session):
        r = session.post(f"{API}/workers", json={"name": "TEST_Reg7", "daily_rate": 500})
        wid = r.json()["id"]
        session.post(f"{API}/attendance", json={"worker_id": wid, "date": "2026-05-01", "status": "present"})
        session.post(f"{API}/attendance", json={"worker_id": wid, "date": "2026-05-02", "status": "present"})
        session.post(f"{API}/advances", json={"worker_id": wid, "date": "2026-05-01", "amount": 200, "method": "cash"})
        r = session.post(f"{API}/settlements", json={"worker_id": wid, "up_to_date": "2026-05-10"})
        sid = r.json()["id"]
        led = session.get(f"{API}/ledger/{wid}").json()
        assert led["days_worked"] == 0
        assert led["pending"] == 0
        assert led["total_advance"] == 0
        # Undo
        session.delete(f"{API}/settlements/{sid}")
        led = session.get(f"{API}/ledger/{wid}").json()
        assert led["days_worked"] == 2
        assert led["total_advance"] == 200
        session.delete(f"{API}/workers/{wid}")

    def test_contractor_settle(self, session):
        r = session.post(f"{API}/contractors", json={"name": "TEST_C7"})
        cid = r.json()["id"]
        session.post(f"{API}/contractor-payments", json={
            "contractor_id": cid, "date": "2026-05-01", "amount": 500, "method": "cash"
        })
        r = session.post(f"{API}/settlements", json={"contractor_id": cid, "up_to_date": "2026-05-05"})
        assert r.json()["amount"] == 500
        led = session.get(f"{API}/contractors/{cid}/ledger").json()
        assert led["net_paid"] == 0
        session.delete(f"{API}/contractors/{cid}")

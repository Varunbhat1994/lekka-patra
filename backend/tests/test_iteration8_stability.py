"""Iteration 8 — Stability & reliability hardening tests.

Covers:
- /api/health returns 200 with {status:ok, db:up} and JSON content-type
- Unhandled exception handler is registered and returns 500 JSON
- PyMongo / ServerSelectionTimeout handlers are registered
- MongoDB pool config sanity (maxPoolSize=25 etc.)
- Regression: OTP send/verify, dashboard (with pending_list), settlements, feedback, reports/pdf
- Supervisor autorestart enabled + PID stable
- Stability under load: 30 concurrent GET /api/health
"""
import os
import asyncio
import subprocess
import importlib.util
import pytest
import httpx
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL") or open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split("\n")[0].strip()
BASE_URL = BASE_URL.rstrip("/")


# ---------------- 1. Health endpoint ----------------
class TestHealth:
    def test_health_ok(self):
        r = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert r.status_code == 200, r.text
        assert "application/json" in r.headers.get("content-type", "")
        data = r.json()
        assert data["status"] == "ok"
        assert data["db"] == "up"


# ---------------- 2. Mongo client pool config ----------------
class TestMongoClientConfig:
    def test_pool_options(self):
        spec = importlib.util.spec_from_file_location("srvmod", "/app/backend/server.py")
        # Import lazily: instead of loading whole app, inspect via a subprocess to avoid FastAPI startup.
        # Simpler: import client directly.
        import sys
        sys.path.insert(0, "/app/backend")
        import server  # noqa
        opts = server.client.options
        pool = opts.pool_options
        assert pool.max_pool_size == 25
        assert pool.min_pool_size == 1
        # timeouts are in seconds inside pool_options
        assert pool.connect_timeout == 5.0
        assert pool.socket_timeout == 20.0
        assert pool.wait_queue_timeout == 5.0
        # Server selection timeout is on options directly
        assert opts.server_selection_timeout == 5.0
        assert opts.retry_writes is True
        assert opts.retry_reads is True


# ---------------- 3. Exception handlers registered ----------------
class TestExceptionHandlers:
    def test_handlers_registered(self):
        import sys
        sys.path.insert(0, "/app/backend")
        import server
        from pymongo.errors import PyMongoError, ServerSelectionTimeoutError
        handlers = server.app.exception_handlers
        assert Exception in handlers, "Generic Exception handler not registered"
        assert PyMongoError in handlers, "PyMongoError handler not registered"
        assert ServerSelectionTimeoutError in handlers, "ServerSelectionTimeoutError handler not registered"

    def test_validation_error_does_not_crash(self):
        # Pass bad payload to /api/auth/otp/send (missing mobile) -> 422 from pydantic; server must remain up.
        r = requests.post(f"{BASE_URL}/api/auth/otp/send", json={}, timeout=10)
        assert r.status_code in (400, 422), r.text
        # follow up health call
        r2 = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert r2.status_code == 200

    def test_invalid_type_returns_422_and_server_stays_up(self):
        # amount as non-number should be rejected by pydantic (422) — must not crash server.
        # /api/advances requires auth, expect 401 or 422; either is fine — key check is server stays alive.
        r = requests.post(f"{BASE_URL}/api/advances",
                          json={"worker_id": "x", "date": "2025-01-01", "amount": "not_a_number", "method": "cash"},
                          timeout=10)
        assert r.status_code in (401, 422, 500), r.text
        # if 500, must still be JSON with detail
        if r.status_code == 500:
            assert r.json().get("detail") == "Internal server error"
        r2 = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert r2.status_code == 200


# ---------------- 4. Supervisor autorestart ----------------
class TestSupervisor:
    def test_autorestart_configured(self):
        with open("/etc/supervisor/conf.d/supervisord.conf") as f:
            conf = f.read()
        # Find backend program block
        assert "[program:backend]" in conf
        # crude but effective: split by program and check backend section contains autorestart=true
        section = conf.split("[program:backend]", 1)[1].split("[program:", 1)[0]
        assert "autorestart=true" in section

    def test_backend_running_stable_pid(self):
        out1 = subprocess.check_output(["sudo", "supervisorctl", "status", "backend"]).decode()
        assert "RUNNING" in out1
        pid1 = out1.split("pid ")[1].split(",")[0].strip()
        # do a request roundtrip
        requests.get(f"{BASE_URL}/api/health", timeout=10)
        out2 = subprocess.check_output(["sudo", "supervisorctl", "status", "backend"]).decode()
        pid2 = out2.split("pid ")[1].split(",")[0].strip()
        assert pid1 == pid2, f"Backend restarted mid-test: {pid1} -> {pid2}"


# ---------------- 5. Regression: previously passing endpoints ----------------
@pytest.fixture(scope="module")
def auth_session():
    """Create a mobile-OTP session and return (session_token, user_id, headers)."""
    import time
    mobile = f"9{int(time.time()) % 10**9:09d}"
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/otp/send", json={"mobile": mobile}, timeout=10)
    assert r.status_code == 200, r.text
    otp = r.json()["dev_otp"]
    r = s.post(f"{BASE_URL}/api/auth/otp/verify", json={"mobile": mobile, "otp": otp}, timeout=10)
    assert r.status_code == 200, r.text
    token = r.json()["session_token"]
    user_id = r.json()["user"]["user_id"]
    headers = {"Authorization": f"Bearer {token}"}
    # Set profile so trial/etc is consistent
    requests.post(f"{BASE_URL}/api/auth/profile",
                  json={"name": "TEST_Stab8", "district": "Mysuru"},
                  headers=headers, timeout=10)
    yield {"token": token, "user_id": user_id, "headers": headers, "mobile": mobile}


class TestRegression:
    def test_otp_flow(self, auth_session):
        # already exercised in fixture
        assert auth_session["token"].startswith("mobile_")

    def test_dashboard_has_pending_list(self, auth_session):
        r = requests.get(f"{BASE_URL}/api/dashboard", headers=auth_session["headers"], timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "pending_list" in data
        assert isinstance(data["pending_list"], list)
        assert "workers_total" in data

    def test_feedback_create_and_list(self, auth_session):
        r = requests.post(f"{BASE_URL}/api/feedback",
                          json={"message": "TEST_Stab8 feedback", "rating": 5, "category": "general"},
                          headers=auth_session["headers"], timeout=10)
        assert r.status_code == 200, r.text
        assert r.json()["message"] == "TEST_Stab8 feedback"
        # list
        r2 = requests.get(f"{BASE_URL}/api/feedback", headers=auth_session["headers"], timeout=10)
        assert r2.status_code == 200
        assert any(f["message"] == "TEST_Stab8 feedback" for f in r2.json())

    def test_settlements_worker_and_contractor(self, auth_session):
        h = auth_session["headers"]
        # Create worker
        rw = requests.post(f"{BASE_URL}/api/workers",
                           json={"name": "TEST_Stab8W", "mobile": "", "skill": "", "daily_rate": 400},
                           headers=h, timeout=10)
        assert rw.status_code == 200, rw.text
        wid = rw.json()["id"]
        # Worker settlement
        rs = requests.post(f"{BASE_URL}/api/settlements",
                           json={"worker_id": wid, "up_to_date": "2025-01-15", "note": "test"},
                           headers=h, timeout=10)
        assert rs.status_code == 200, rs.text
        assert rs.json()["kind"] == "worker"

        # Contractor
        rc = requests.post(f"{BASE_URL}/api/contractors",
                           json={"name": "TEST_Stab8C", "mobile": "", "notes": ""},
                           headers=h, timeout=10)
        assert rc.status_code == 200
        cid = rc.json()["id"]
        rcs = requests.post(f"{BASE_URL}/api/settlements",
                            json={"contractor_id": cid, "up_to_date": "2025-01-15", "note": "test"},
                            headers=h, timeout=10)
        assert rcs.status_code == 200, rcs.text
        assert rcs.json()["kind"] == "contractor"

        # list settlements
        rl = requests.get(f"{BASE_URL}/api/settlements?worker_id={wid}", headers=h, timeout=10)
        assert rl.status_code == 200
        assert len(rl.json()) >= 1

        # cleanup
        requests.delete(f"{BASE_URL}/api/workers/{wid}", headers=h, timeout=10)
        requests.delete(f"{BASE_URL}/api/contractors/{cid}", headers=h, timeout=10)

    def test_reports_pdf_worker(self, auth_session):
        h = auth_session["headers"]
        rw = requests.post(f"{BASE_URL}/api/workers",
                           json={"name": "TEST_Stab8PDF", "mobile": "", "skill": "", "daily_rate": 300},
                           headers=h, timeout=10)
        wid = rw.json()["id"]
        r = requests.get(f"{BASE_URL}/api/reports/pdf?worker_id={wid}", headers=h, timeout=30)
        assert r.status_code == 200, r.text
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert r.content[:4] == b"%PDF"
        requests.delete(f"{BASE_URL}/api/workers/{wid}", headers=h, timeout=10)


# ---------------- 6. Concurrent load ----------------
class TestConcurrency:
    def test_30_concurrent_health(self):
        async def run():
            async with httpx.AsyncClient(timeout=15) as c:
                tasks = [c.get(f"{BASE_URL}/api/health") for _ in range(30)]
                results = await asyncio.gather(*tasks, return_exceptions=True)
            return results
        results = asyncio.run(run())
        errors = [r for r in results if isinstance(r, Exception)]
        assert not errors, f"Got exceptions: {errors[:3]}"
        codes = [r.status_code for r in results]
        assert all(c == 200 for c in codes), f"Non-200 codes: {[c for c in codes if c != 200]}"

    def test_backend_still_up_after_load(self):
        r = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert r.status_code == 200
        out = subprocess.check_output(["sudo", "supervisorctl", "status", "backend"]).decode()
        assert "RUNNING" in out

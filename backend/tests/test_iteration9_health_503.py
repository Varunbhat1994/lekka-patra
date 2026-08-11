"""Iteration 9 — /api/health must return 503 when DB is unreachable.

Follow-up to iter 8:
- Healthy: GET /api/health -> 200 with {status:'ok', db:'up'}
- Unhealthy: monkey-patch server.client.admin.command to raise
  ServerSelectionTimeoutError; assert 503 with {status:'degraded', db:'down', error:...}.
  Uses FastAPI's ASGI in-process client so the patch is effective (external HTTP
  can't inject failure into the running supervisor process).
- Regression: exception handlers still registered; 30 concurrent /api/health -> 200;
  OTP send/verify; /api/dashboard, /api/settlements (worker+contractor), /api/feedback smoke.
"""
import os
import sys
import asyncio
import pytest
import httpx
import requests
from unittest.mock import patch

sys.path.insert(0, "/app/backend")

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL")
            or open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split("\n")[0].strip()).rstrip("/")


# ---------- 1. Healthy path via public URL ----------
class TestHealthy:
    def test_health_200_public(self):
        r = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert r.status_code == 200, r.text
        assert "application/json" in r.headers.get("content-type", "")
        data = r.json()
        assert data == {"status": "ok", "db": "up"}


# ---------- 2. Simulated DB failure via in-process ASGI ----------
class TestUnhealthyInProcess:
    def test_health_503_when_db_ping_fails(self):
        import server
        from pymongo.errors import ServerSelectionTimeoutError

        async def _fail(*a, **kw):
            raise ServerSelectionTimeoutError("simulated: no servers found")

        # motor's `client.admin` may return a fresh proxy per access, so patching
        # the attribute on one instance is unreliable. Replace `server.client` with
        # a stand-in whose `.admin.command` awaits into a failure.
        class _FakeAdmin:
            async def command(self, *a, **kw):
                await _fail()

        class _FakeClient:
            admin = _FakeAdmin()

        real_client = server.client
        server.client = _FakeClient()
        try:
            async def run():
                transport = httpx.ASGITransport(app=server.app)
                async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
                    return await c.get("/api/health")
            r = asyncio.run(run())
        finally:
            server.client = real_client

        assert r.status_code == 503, f"expected 503, got {r.status_code}: {r.text}"
        data = r.json()
        assert data.get("status") == "degraded", data
        assert data.get("db") == "down", data
        assert "error" in data and isinstance(data["error"], str) and len(data["error"]) > 0

    def test_health_recovers_after_patch_removed(self):
        # After the patch context exits above, the live server should still be healthy.
        r = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert r.status_code == 200
        assert r.json()["db"] == "up"


# ---------- 3. Exception handlers still registered ----------
class TestExceptionHandlers:
    def test_handlers_registered(self):
        import server
        from pymongo.errors import PyMongoError, ServerSelectionTimeoutError
        h = server.app.exception_handlers
        assert Exception in h
        assert PyMongoError in h
        assert ServerSelectionTimeoutError in h


# ---------- 4. Concurrency regression ----------
class TestConcurrency:
    def test_30_concurrent_health_all_200(self):
        async def run():
            async with httpx.AsyncClient(timeout=15) as c:
                tasks = [c.get(f"{BASE_URL}/api/health") for _ in range(30)]
                return await asyncio.gather(*tasks, return_exceptions=True)
        results = asyncio.run(run())
        errs = [r for r in results if isinstance(r, Exception)]
        assert not errs, f"errors: {errs[:3]}"
        codes = [r.status_code for r in results]
        assert all(c == 200 for c in codes), f"non-200: {[c for c in codes if c!=200]}"


# ---------- 5. Smoke regression: OTP + dashboard + settlements + feedback ----------
@pytest.fixture(scope="module")
def auth():
    import time
    mobile = f"9{int(time.time()) % 10**9:09d}"
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/otp/send", json={"mobile": mobile}, timeout=10)
    assert r.status_code == 200, r.text
    otp = r.json()["dev_otp"]
    r = s.post(f"{BASE_URL}/api/auth/otp/verify", json={"mobile": mobile, "otp": otp}, timeout=10)
    assert r.status_code == 200, r.text
    token = r.json()["session_token"]
    headers = {"Authorization": f"Bearer {token}"}
    requests.post(f"{BASE_URL}/api/auth/profile",
                  json={"name": "TEST_Iter9", "district": "Mysuru"},
                  headers=headers, timeout=10)
    return {"headers": headers, "mobile": mobile, "token": token}


class TestRegressionSmoke:
    def test_otp_flow(self, auth):
        assert auth["token"].startswith("mobile_")

    def test_dashboard(self, auth):
        r = requests.get(f"{BASE_URL}/api/dashboard", headers=auth["headers"], timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "pending_list" in d and isinstance(d["pending_list"], list)
        assert "workers_total" in d

    def test_feedback(self, auth):
        r = requests.post(f"{BASE_URL}/api/feedback",
                          json={"message": "TEST_Iter9 fb", "rating": 5, "category": "general"},
                          headers=auth["headers"], timeout=10)
        assert r.status_code == 200
        assert r.json()["message"] == "TEST_Iter9 fb"

    def test_settlements_worker_and_contractor(self, auth):
        h = auth["headers"]
        rw = requests.post(f"{BASE_URL}/api/workers",
                           json={"name": "TEST_Iter9W", "mobile": "", "skill": "", "daily_rate": 400},
                           headers=h, timeout=10)
        assert rw.status_code == 200, rw.text
        wid = rw.json()["id"]
        rs = requests.post(f"{BASE_URL}/api/settlements",
                           json={"worker_id": wid, "up_to_date": "2025-01-15", "note": "t"},
                           headers=h, timeout=10)
        assert rs.status_code == 200, rs.text
        assert rs.json()["kind"] == "worker"

        rc = requests.post(f"{BASE_URL}/api/contractors",
                           json={"name": "TEST_Iter9C", "mobile": "", "notes": ""},
                           headers=h, timeout=10)
        assert rc.status_code == 200
        cid = rc.json()["id"]
        rcs = requests.post(f"{BASE_URL}/api/settlements",
                            json={"contractor_id": cid, "up_to_date": "2025-01-15", "note": "t"},
                            headers=h, timeout=10)
        assert rcs.status_code == 200, rcs.text
        assert rcs.json()["kind"] == "contractor"

        # cleanup
        requests.delete(f"{BASE_URL}/api/workers/{wid}", headers=h, timeout=10)
        requests.delete(f"{BASE_URL}/api/contractors/{cid}", headers=h, timeout=10)

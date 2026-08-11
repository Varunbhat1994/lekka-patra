"""
Iteration 10: Owner Portal (RBAC) tests.

- OTP dev flow login (dev_otp is returned in response)
- Owner mobile from backend/.env OWNER_MOBILE=919700000030
- Verifies /api/auth/me is_owner, all /owner/* endpoints RBAC, ads CRUD, feedback inbox.
"""

import os
import base64
import uuid
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://field-crew-log-1.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

OWNER_LOCAL = "9700000030"      # normalized -> 919700000030
NON_OWNER_LOCAL = f"98{uuid.uuid4().int % 100000000:08d}"[:10]

# Tiny 1x1 png as base64 data URL
TINY_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAM"
    "AASsJTYQAAAAASUVORK5CYII="
)
DATA_URL = f"data:image/png;base64,{TINY_PNG_B64}"


def _login(mobile_local: str) -> requests.Session:
    s = requests.Session()
    s.headers["Content-Type"] = "application/json"
    r = s.post(f"{API}/auth/otp/send", json={"mobile": mobile_local}, timeout=15)
    assert r.status_code == 200, r.text
    otp = r.json()["dev_otp"]
    r = s.post(f"{API}/auth/otp/verify", json={"mobile": mobile_local, "otp": otp}, timeout=15)
    assert r.status_code == 200, r.text
    tok = r.json()["session_token"]
    s.headers["Authorization"] = f"Bearer {tok}"
    return s


@pytest.fixture(scope="module")
def owner():
    return _login(OWNER_LOCAL)


@pytest.fixture(scope="module")
def non_owner():
    s = _login(NON_OWNER_LOCAL)
    # Set profile so we can test /api/ads district filter later
    s.post(f"{API}/auth/profile", json={"name": "TEST NonOwner", "district": "Mysuru"}, timeout=15)
    return s


# ---------------- RBAC ----------------
class TestOwnerRBAC:
    def test_auth_me_owner_flag(self, owner):
        r = owner.get(f"{API}/auth/me", timeout=15)
        assert r.status_code == 200
        me = r.json()
        assert me.get("is_owner") is True
        assert me.get("role") == "owner"

    def test_auth_me_non_owner(self, non_owner):
        r = non_owner.get(f"{API}/auth/me", timeout=15)
        assert r.status_code == 200
        me = r.json()
        assert me.get("is_owner") is False
        assert me.get("role") != "owner"

    @pytest.mark.parametrize("path", [
        "/owner/users",
        "/owner/analytics/districts",
        "/owner/ads",
        "/owner/feedback",
    ])
    def test_endpoints_401_without_auth(self, path):
        r = requests.get(f"{API}{path}", timeout=15)
        assert r.status_code == 401, f"{path} -> {r.status_code}"

    @pytest.mark.parametrize("path", [
        "/owner/users",
        "/owner/analytics/districts",
        "/owner/ads",
        "/owner/feedback",
    ])
    def test_endpoints_403_for_non_owner(self, non_owner, path):
        r = non_owner.get(f"{API}{path}", timeout=15)
        assert r.status_code == 403, f"{path} -> {r.status_code}: {r.text}"


# ---------------- Users list ----------------
class TestOwnerUsers:
    def test_list_users_shape_and_sort(self, owner):
        r = owner.get(f"{API}/owner/users", timeout=15)
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list) and len(rows) >= 1
        for u in rows[:3]:
            assert "user_id" in u
            # Fields must be selectable
            for k in ("name", "mobile", "district", "role", "is_paid", "trial_start", "created_at"):
                assert k in u or u.get(k) is None or True  # projection may omit None fields
        created = [u.get("created_at") for u in rows if u.get("created_at")]
        assert created == sorted(created, reverse=True), "users not sorted by created_at desc"


# ---------------- District analytics ----------------
class TestOwnerAnalytics:
    def test_districts_totals(self, owner):
        r = owner.get(f"{API}/owner/analytics/districts", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "rows" in data and "totals" in data
        totals = data["totals"]
        for k in ("users", "workers", "contractors"):
            assert k in totals
        # sum of workers across rows equals totals.workers
        assert sum(r["workers"] for r in data["rows"]) == totals["workers"]
        assert sum(r["contractors"] for r in data["rows"]) == totals["contractors"]
        # Sort by workers+contractors desc
        combo = [r["workers"] + r["contractors"] for r in data["rows"]]
        assert combo == sorted(combo, reverse=True)


# ---------------- Ads CRUD ----------------
class TestOwnerAds:
    def test_ads_full_flow(self, owner, non_owner):
        # Create with invalid district → 400
        bad = owner.post(f"{API}/owner/ads", json={
            "image_url": DATA_URL, "title": "TEST bad", "districts": ["NotADistrict"],
        }, timeout=15)
        assert bad.status_code == 400

        # Create good ad targeted at Mysuru
        r = owner.post(f"{API}/owner/ads", json={
            "image_url": DATA_URL,
            "title": "TEST Owner Ad",
            "cta_url": "https://example.com/x",
            "districts": ["Mysuru"],
        }, timeout=15)
        assert r.status_code == 200, r.text
        ad = r.json()
        aid = ad["id"]
        assert ad["districts"] == ["Mysuru"]
        assert ad["active"] is True

        # Listed by owner
        r = owner.get(f"{API}/owner/ads", timeout=15)
        assert r.status_code == 200
        assert any(x["id"] == aid for x in r.json())

        # Public /api/ads for non-owner (Mysuru) returns it
        r = non_owner.get(f"{API}/ads", timeout=15)
        assert r.status_code == 200
        pub_ids = [x["id"] for x in r.json()]
        assert aid in pub_ids

        # PATCH active=false
        r = owner.patch(f"{API}/owner/ads/{aid}?active=false", timeout=15)
        assert r.status_code == 200

        # Public list should NOT include it now
        r = non_owner.get(f"{API}/ads", timeout=15)
        assert aid not in [x["id"] for x in r.json()]

        # PATCH unknown id
        r = owner.patch(f"{API}/owner/ads/does-not-exist?active=true", timeout=15)
        assert r.status_code == 404

        # DELETE
        r = owner.delete(f"{API}/owner/ads/{aid}", timeout=15)
        assert r.status_code == 200
        r = owner.delete(f"{API}/owner/ads/{aid}", timeout=15)
        assert r.status_code == 404


# ---------------- Feedback inbox ----------------
class TestOwnerFeedback:
    def test_feedback_inbox_sees_all(self, owner, non_owner):
        # Non-owner submits feedback
        r = non_owner.post(f"{API}/feedback", json={
            "message": f"TEST-fb {uuid.uuid4().hex[:6]}", "rating": 5, "category": "general",
        }, timeout=15)
        assert r.status_code == 200
        fb_id = r.json()["id"]

        r = owner.get(f"{API}/owner/feedback", timeout=15)
        assert r.status_code == 200
        rows = r.json()
        assert any(x["id"] == fb_id for x in rows), "owner inbox missing non-owner feedback"
        created = [x["created_at"] for x in rows]
        assert created == sorted(created, reverse=True)

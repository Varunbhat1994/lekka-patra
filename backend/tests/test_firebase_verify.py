"""Backend tests for /api/auth/firebase/verify (Firebase Phone Auth)."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://field-crew-log-1.preview.emergentagent.com").rstrip("/")


class TestFirebaseVerify:
    def test_endpoint_exists_and_rejects_garbage_token(self):
        r = requests.post(
            f"{BASE_URL}/api/auth/firebase/verify",
            json={"id_token": "not-a-real-token"},
            timeout=10,
        )
        # Any 4xx (401/400) proves the endpoint exists and rejects invalid input
        assert r.status_code in (400, 401), r.text
        assert "detail" in r.json()

    def test_rejects_hs256_token_missing_kid(self):
        # HS256 token has no kid header
        tok = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.abc"
        r = requests.post(
            f"{BASE_URL}/api/auth/firebase/verify",
            json={"id_token": tok},
            timeout=10,
        )
        assert r.status_code == 400
        assert "kid" in r.json().get("detail", "").lower()

    def test_requires_id_token_field(self):
        r = requests.post(
            f"{BASE_URL}/api/auth/firebase/verify",
            json={},
            timeout=10,
        )
        assert r.status_code == 422

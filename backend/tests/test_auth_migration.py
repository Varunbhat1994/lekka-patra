"""Phase 1 auth overhaul — migration + guard tests.

Validates:
 - Google shell + matching OTP-only mobile → merge into OTP-only user_id
 - Data (workers/attendance) remains linked to the OTP-only user_id
 - Real conflict (mobile already used by another Google user) → HTTP 409
 - Shell-has-data guard prevents overwriting an active Google user
 - District is now optional (accepted but not required)
"""
import os
import sys
import uuid
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException, Request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core.database import db  # noqa: E402
from routes.auth import set_profile, ProfileIn  # noqa: E402


def _now():
    return datetime.now(timezone.utc)


class _MockResponse:
    def __init__(self):
        self.cookies = {}
    def delete_cookie(self, *a, **k): pass
    def set_cookie(self, *a, **k): pass


def _mock_request(token=None):
    """Minimal Request-shim exposing .cookies + .headers."""
    class _Req:
        def __init__(self, t):
            self.cookies = {"session_token": t} if t else {}
            self.headers = {}
    return _Req(token)


async def _seed_otp_user(mobile_91):
    uid = f"user_{uuid.uuid4().hex[:12]}"
    await db.users.insert_one({
        "user_id": uid, "mobile": mobile_91, "name": "Legacy",
        "language": "en", "trial_start": _now().isoformat(),
        "is_paid": False, "created_at": _now().isoformat(),
    })
    return uid


async def _seed_google_shell(email):
    uid = f"user_{uuid.uuid4().hex[:12]}"
    await db.users.insert_one({
        "user_id": uid, "email": email, "name": "GName", "picture": "",
        "language": "en", "trial_start": _now().isoformat(),
        "is_paid": False, "created_at": _now().isoformat(),
    })
    token = f"tok_{uuid.uuid4().hex}"
    await db.user_sessions.insert_one({
        "user_id": uid, "session_token": token,
        "expires_at": (_now().replace(year=_now().year + 1)).isoformat(),
        "created_at": _now().isoformat(),
    })
    user = await db.users.find_one({"user_id": uid}, {"_id": 0})
    return user, token


async def _seed_worker(user_id):
    wid = str(uuid.uuid4())
    await db.workers.insert_one({
        "id": wid, "user_id": user_id, "name": "W", "mobile": "9111111111",
        "skill": "Field", "daily_rate": 500, "worker_type": "regular",
        "created_at": _now().isoformat(),
    })
    return wid


async def _cleanup(*uids):
    for uid in uids:
        await db.attendance.delete_many({"user_id": uid})
        await db.workers.delete_many({"user_id": uid})
        await db.user_sessions.delete_many({"user_id": uid})
        await db.users.delete_one({"user_id": uid})


@pytest.mark.asyncio
async def test_1_merge_on_matching_otp_mobile():
    old_uid = await _seed_otp_user("919000000101")
    old_wid = await _seed_worker(old_uid)
    google_user, token = await _seed_google_shell("legacy1@t.com")
    new_uid = google_user["user_id"]
    try:
        req = _mock_request(token)
        resp = _MockResponse()
        result = await set_profile(
            payload=ProfileIn(name="Legacy Bhat", mobile="9000000101"),
            request=req, response=resp, user=google_user,
        )
        assert result["merged"] is True
        assert result["merged_into_user_id"] == old_uid
        assert result["user"]["user_id"] == old_uid
        # Session now points at OLD
        s = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
        assert s["user_id"] == old_uid
        # NEW shell gone, worker still linked to OLD
        assert await db.users.count_documents({"user_id": new_uid}) == 0
        assert await db.workers.count_documents({"user_id": old_uid, "id": old_wid}) == 1
        # OLD user record has Google identity
        old = await db.users.find_one({"user_id": old_uid}, {"_id": 0})
        assert old["email"] == "legacy1@t.com"
        assert old["name"] == "Legacy Bhat"
    finally:
        await _cleanup(old_uid, new_uid)


@pytest.mark.asyncio
async def test_2_conflict_with_another_google_user_returns_409():
    other_uid = f"user_{uuid.uuid4().hex[:12]}"
    await db.users.insert_one({
        "user_id": other_uid, "email": "already@t.com",
        "mobile": "919000000202", "name": "Other Google",
        "language": "en", "trial_start": _now().isoformat(),
        "is_paid": False, "created_at": _now().isoformat(),
    })
    google_user, token = await _seed_google_shell("newbie@t.com")
    new_uid = google_user["user_id"]
    try:
        with pytest.raises(HTTPException) as ei:
            await set_profile(
                payload=ProfileIn(name="Newbie", mobile="9000000202"),
                request=_mock_request(token), response=_MockResponse(),
                user=google_user,
            )
        assert ei.value.status_code == 409
    finally:
        await _cleanup(other_uid, new_uid)


@pytest.mark.asyncio
async def test_3_shell_with_data_wont_merge_and_returns_409():
    """If the current Google shell already owns workers, we DO NOT
    merge into an old OTP-only account — that would silently discard
    the shell's data. Instead the request is rejected."""
    old_uid = await _seed_otp_user("919000000303")
    google_user, token = await _seed_google_shell("hasdata@t.com")
    new_uid = google_user["user_id"]
    # Google shell already has a worker
    await _seed_worker(new_uid)
    try:
        with pytest.raises(HTTPException) as ei:
            await set_profile(
                payload=ProfileIn(name="Owns Data", mobile="9000000303"),
                request=_mock_request(token), response=_MockResponse(),
                user=google_user,
            )
        assert ei.value.status_code == 409
    finally:
        await _cleanup(old_uid, new_uid)


@pytest.mark.asyncio
async def test_4_district_optional_ok_without_it():
    google_user, token = await _seed_google_shell("nodist@t.com")
    new_uid = google_user["user_id"]
    try:
        result = await set_profile(
            payload=ProfileIn(name="No District", mobile="9000000404"),
            request=_mock_request(token), response=_MockResponse(),
            user=google_user,
        )
        assert result["ok"] is True
        assert result.get("merged") is None or result.get("merged") is False
        assert result["user"]["mobile"] == "919000000404"
    finally:
        await _cleanup(new_uid)


@pytest.mark.asyncio
async def test_5_mobile_wrong_length_rejected_400():
    google_user, token = await _seed_google_shell("bad@t.com")
    new_uid = google_user["user_id"]
    try:
        with pytest.raises(HTTPException) as ei:
            await set_profile(
                payload=ProfileIn(name="X", mobile="12345"),
                request=_mock_request(token), response=_MockResponse(),
                user=google_user,
            )
        assert ei.value.status_code == 400
    finally:
        await _cleanup(new_uid)


@pytest.mark.asyncio
async def test_6_empty_name_rejected_400():
    google_user, token = await _seed_google_shell("noname@t.com")
    new_uid = google_user["user_id"]
    try:
        with pytest.raises(HTTPException) as ei:
            await set_profile(
                payload=ProfileIn(name="  ", mobile="9000000505"),
                request=_mock_request(token), response=_MockResponse(),
                user=google_user,
            )
        assert ei.value.status_code == 400
    finally:
        await _cleanup(new_uid)

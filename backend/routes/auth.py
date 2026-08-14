"""Authentication route handlers.

Phase 1 (auth overhaul): Google-only authentication. OTP and Firebase
Phone endpoints have been removed. Existing OTP-only accounts still
retain their data — on first Google login the user is prompted for
their name + mobile in ProfileSetup, and if that mobile already
belongs to an existing OTP-only account (email empty) the two accounts
are merged: the pre-existing user_id is preserved (which keeps every
worker/attendance/advance/return/settlement row linked to it) and the
newly-created Google shell is deleted.

Endpoints:
    POST /auth/session   — Emergent-managed Google OAuth exchange
    GET  /auth/me        — current user + access + is_owner
    POST /auth/logout    — clear session cookie
    POST /auth/language  — persist user's UI language
    POST /auth/profile   — set/edit name + mobile (district optional & deprecated)
    GET  /districts      — Karnataka district list (owner portal still uses this)
"""
import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from core.database import db
from core.constants import KARNATAKA_DISTRICTS
from security.authentication import get_current_user
from security.authorization import (
    compute_access,
    is_owner,
    _promote_owner_if_needed,
)
from security.utils import _normalize_mobile

logger = logging.getLogger("farmlog")

router = APIRouter()


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


# ---------------- Pydantic models ----------------

class ProfileIn(BaseModel):
    name: str
    # District is now optional and NOT surfaced in the user UI. It is
    # kept in the schema so (a) legacy tests keep passing and (b) the
    # owner portal (which still targets ads by district) can populate
    # it out-of-band if ever needed.
    district: Optional[str] = None
    mobile: Optional[str] = None


# ---------------- Districts lookup ----------------

@router.get("/districts")
async def list_districts():
    """Owner-portal ad targeting still uses the Karnataka district list."""
    return {"districts": KARNATAKA_DISTRICTS}


# ---------------- Google OAuth (Emergent-managed) ----------------

@router.post("/auth/session")
async def auth_session(request: Request, response: Response):
    body = await request.json()
    session_id = body.get("session_id")
    if not session_id:
        raise HTTPException(400, "session_id required")
    async with httpx.AsyncClient() as c:
        r = await c.get(
            "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": session_id},
        )
        if r.status_code != 200:
            raise HTTPException(401, "Auth failed")
        data = r.json()

    email = data["email"]
    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one({"user_id": user_id},
            {"$set": {"name": data.get("name"), "picture": data.get("picture")}})
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": data.get("name"),
            "picture": data.get("picture"),
            "language": "en",
            "trial_start": _now_utc().isoformat(),
            "is_paid": False,
            "created_at": _now_utc().isoformat(),
        })

    session_token = data["session_token"]
    expires_at = _now_utc() + timedelta(days=7)
    await db.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": session_token,
        "expires_at": expires_at.isoformat(),
        "created_at": _now_utc().isoformat(),
    })

    response.set_cookie(
        key="session_token", value=session_token,
        httponly=True, secure=True, samesite="none",
        max_age=7 * 24 * 3600, path="/",
    )
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    await _promote_owner_if_needed(user_id, mobile=user.get("mobile"), email=user.get("email"))
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    user["access"] = compute_access(user)
    user["is_owner"] = is_owner(user)
    return {"user": user}


@router.get("/auth/me")
async def auth_me(user: dict = Depends(get_current_user)):
    user["access"] = compute_access(user)
    user["is_owner"] = is_owner(user)
    return user


@router.post("/auth/logout")
async def logout(request: Request, response: Response):
    token = request.cookies.get("session_token")
    if token:
        await db.user_sessions.delete_one({"session_token": token})
    response.delete_cookie("session_token", path="/")
    return {"ok": True}


@router.post("/auth/language")
async def set_language(request: Request, user: dict = Depends(get_current_user)):
    body = await request.json()
    lang = body.get("language", "en")
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"language": lang}})
    return {"ok": True, "language": lang}


# ---------------- Migration helper ----------------

async def _current_shell_has_data(user_id: str) -> bool:
    """Return True if the caller has already created any operational data.

    Used to safeguard the merge-on-mobile-match path — we only merge into
    an older OTP-only account when the current Google shell is empty
    (i.e. hasn't started tracking workers/attendance yet). This prevents
    accidentally overwriting user data.
    """
    for coll in (
        "workers", "attendance", "advances", "returns",
        "settlements", "contractors",
        "contractor_visits", "contractor_payments", "contractor_returns",
    ):
        n = await db[coll].count_documents({"user_id": user_id}, limit=1)
        if n:
            return True
    return False


# ---------------- Profile setup ----------------

@router.post("/auth/profile")
async def set_profile(payload: ProfileIn, request: Request, response: Response,
                       user: dict = Depends(get_current_user)):
    """Set or edit the authenticated user's Name + Mobile.

    District is accepted for backwards compatibility but no longer
    surfaced in the UI. Mobile is validated as India 10-digit numeric.
    If mobile matches a pre-existing OTP-only account (email empty),
    the current Google shell is MERGED into the older account so no
    OTP-migrated user is stranded from their data — provided the shell
    has not yet accumulated any operational data.
    """
    if not payload.name.strip():
        raise HTTPException(400, "Name required")

    update: dict = {"name": payload.name.strip()}
    # District: keep-if-provided, no strict validation (legacy behavior).
    if payload.district is not None and payload.district.strip():
        # If a district IS supplied, still verify it is one of ours
        # (owner portal uses this list). Silently ignore blanks/None.
        if payload.district not in KARNATAKA_DISTRICTS:
            raise HTTPException(400, "Invalid district")
        update["district"] = payload.district

    if payload.mobile is not None and str(payload.mobile).strip():
        raw = str(payload.mobile).strip()
        # Frontend contract: 10 digits, no country code, no spaces.
        digits = "".join(ch for ch in raw if ch.isdigit())
        if len(digits) != 10:
            raise HTTPException(400, "Mobile must be exactly 10 digits")
        # Canonical storage form is unchanged from the OTP era to keep
        # foreign matches working (`_normalize_mobile` strips leading '+'
        # and country prefix if present). New Google-flow input has none.
        new_mobile = _normalize_mobile(digits)
        conflict = await db.users.find_one(
            {"mobile": new_mobile, "user_id": {"$ne": user["user_id"]}},
            {"_id": 0},
        )
        if conflict:
            conflict_has_email = bool((conflict.get("email") or "").strip())
            shell_empty = not await _current_shell_has_data(user["user_id"])
            if not conflict_has_email and shell_empty:
                # ---------- MIGRATION MERGE ----------
                # Move the Google identity onto the pre-existing OTP-only
                # user so all workers/attendance/etc. remain linked.
                await db.users.update_one(
                    {"user_id": conflict["user_id"]},
                    {"$set": {
                        "email": user.get("email"),
                        "picture": user.get("picture"),
                        "name": payload.name.strip(),
                        "google_linked_at": _now_utc().isoformat(),
                    }},
                )
                # Reassign the current session token → the older user_id.
                # Accept both cookie and Authorization header, matching
                # `get_current_user`.
                session_token = request.cookies.get("session_token")
                if not session_token:
                    auth = request.headers.get("Authorization", "")
                    if auth.startswith("Bearer "):
                        session_token = auth[7:]
                if session_token:
                    await db.user_sessions.update_many(
                        {"session_token": session_token},
                        {"$set": {"user_id": conflict["user_id"]}},
                    )
                # Discard OTHER sessions of the (empty) Google shell and
                # then the shell itself. We deliberately delete by
                # user_id AFTER re-pointing the current token so the
                # active session survives.
                await db.user_sessions.delete_many({"user_id": user["user_id"]})
                await db.users.delete_one({"user_id": user["user_id"]})
                await _promote_owner_if_needed(
                    conflict["user_id"], mobile=new_mobile,
                    email=user.get("email"),
                )
                merged = await db.users.find_one(
                    {"user_id": conflict["user_id"]}, {"_id": 0}
                )
                merged["access"] = compute_access(merged)
                merged["is_owner"] = is_owner(merged)
                return {"ok": True, "user": merged, "merged": True,
                        "merged_into_user_id": conflict["user_id"]}
            # Real conflict: another Google user has this mobile, OR
            # the current shell already owns data (protect it).
            raise HTTPException(409, "Mobile already used by another account")
        update["mobile"] = new_mobile

    await db.users.update_one({"user_id": user["user_id"]}, {"$set": update})
    updated = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    updated["access"] = compute_access(updated)
    updated["is_owner"] = is_owner(updated)
    return {"ok": True, "user": updated}

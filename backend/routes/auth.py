"""Native mobile+password authentication.

Endpoints:
    POST /auth/register         — create account, auto-login, returns bearer token
    POST /auth/login            — mobile+password, single-active-device
    POST /auth/logout           — revoke current session
    POST /auth/forgot-password  — issue 6-digit reset code (returned in body)
    POST /auth/reset-password   — consume reset code + set new password
    POST /auth/change-mobile    — verify old creds, change mobile on same user_id
    GET  /auth/me               — current user
    POST /auth/language         — persist UI language
    GET  /districts             — Karnataka district list (owner ads)

Security invariants
    - Passwords stored as bcrypt hashes only. Plaintext never persisted or logged.
    - Reset codes stored as bcrypt hashes with 5-minute expiry + 5-attempt cap.
    - user_sessions.session_version co-lives on the user doc as `session_version`.
      Any password-reset / mobile-change / manual logout bumps the version and
      invalidates every currently-issued token for that user_id.
    - Single-active-device: a fresh /login always deletes every other session
      of that user_id before issuing the new token. Old device's next protected
      call sees 401 (session not found).
"""
from __future__ import annotations
import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from core.constants import KARNATAKA_DISTRICTS
from core.database import db
from security.authentication import get_current_user
from security.authorization import (
    compute_access, is_owner, _promote_owner_if_needed,
)
from security.utils import _normalize_mobile


logger = logging.getLogger("farmlog")
router = APIRouter()


# ---------------- helpers ----------------

def _now() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_10digit(raw: str) -> str:
    """Accept a raw mobile-number input and return the canonical 10-digit
    Indian mobile stored on user docs. Raises 400 if the input is not
    exactly 10 digits after stripping non-numerics."""
    if raw is None:
        raise HTTPException(400, "Mobile number required")
    digits = "".join(ch for ch in str(raw) if ch.isdigit())
    if len(digits) != 10:
        raise HTTPException(400, "Enter a valid 10-digit mobile number")
    return _normalize_mobile(digits)


def _hash(secret: str) -> str:
    return bcrypt.hashpw(secret.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def _verify(secret: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(secret.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def _validate_password(pw: str) -> None:
    """Only rule: minimum 6 characters. No character-class requirements."""
    if pw is None or len(pw) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")


async def _issue_session(user_id: str) -> str:
    """Delete every previous session of this user (single-active-device)
    and issue a fresh bearer token. Returns the token to hand to the
    frontend as `Authorization: Bearer <token>`."""
    await db.user_sessions.delete_many({"user_id": user_id})
    token = secrets.token_urlsafe(32)
    await db.user_sessions.insert_one({
        "session_token": token,
        "user_id": user_id,
        "expires_at": (_now() + timedelta(days=30)).isoformat(),
        "created_at": _now().isoformat(),
    })
    return token


async def _bump_session_version_and_revoke(user_id: str) -> None:
    """Password reset / mobile change: invalidate every issued session."""
    await db.user_sessions.delete_many({"user_id": user_id})


def _user_public(u: dict) -> dict:
    """Strip sensitive fields before returning a user doc over the wire."""
    safe = {k: v for k, v in u.items() if k not in (
        "password_hash", "reset_code_hash", "reset_code_expires_at",
        "reset_attempts", "reset_code_created_at",
    )}
    safe["access"] = compute_access(safe)
    safe["is_owner"] = is_owner(safe)
    return safe


# ---------------- pydantic bodies ----------------

class RegisterIn(BaseModel):
    name: str = Field(min_length=1)
    mobile: str
    password: str
    confirm_password: str


class LoginIn(BaseModel):
    mobile: str
    password: str


class ForgotIn(BaseModel):
    mobile: str


class ResetIn(BaseModel):
    mobile: str
    reset_code: str
    new_password: str
    confirm_password: str


class ChangeMobileIn(BaseModel):
    old_mobile: str
    old_password: str
    new_mobile: str
    confirm_new_mobile: str


class LangIn(BaseModel):
    language: str


# ---------------- register ----------------

@router.post("/auth/register")
async def register(body: RegisterIn, response: Response):
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Name required")
    if body.password != body.confirm_password:
        raise HTTPException(400, "Passwords do not match")
    _validate_password(body.password)
    mobile = _normalize_10digit(body.mobile)

    if await db.users.find_one({"mobile": mobile}, {"_id": 1}):
        raise HTTPException(409, "This mobile number is already registered")

    user_id = f"user_{uuid.uuid4().hex[:12]}"
    await db.users.insert_one({
        "user_id": user_id,
        "name": name,
        "mobile": mobile,
        "password_hash": _hash(body.password),
        "language": "en",
        "trial_start": _now().isoformat(),
        "is_paid": False,
        "created_at": _now().isoformat(),
    })
    await _promote_owner_if_needed(user_id, mobile=mobile, email=None)
    token = await _issue_session(user_id)
    # Clear any legacy `session_token` cookie left over from the old
    # Google-OAuth build. Without this, browsers keep sending it and
    # get_current_user 401s despite a valid Bearer token.
    response.delete_cookie("session_token", path="/")
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    return {"ok": True, "token": token, "user": _user_public(user)}


# ---------------- login ----------------

@router.post("/auth/login")
async def login(body: LoginIn, response: Response):
    mobile = _normalize_10digit(body.mobile)
    user = await db.users.find_one({"mobile": mobile}, {"_id": 0})
    # Uniform error message for both "no such user" and "wrong password"
    # so the endpoint cannot be used to enumerate registered mobiles.
    generic = HTTPException(401, "Invalid mobile number or password")
    if not user or not user.get("password_hash"):
        raise generic
    if not _verify(body.password, user["password_hash"]):
        raise generic
    token = await _issue_session(user["user_id"])
    # Clear any legacy `session_token` cookie (see /register).
    response.delete_cookie("session_token", path="/")
    return {"ok": True, "token": token, "user": _user_public(user)}


# ---------------- logout ----------------

@router.post("/auth/logout")
async def logout(request: Request, response: Response):
    # Same precedence as get_current_user: Bearer wins so the correct
    # session is revoked when a stale legacy cookie is also present.
    auth = request.headers.get("Authorization", "")
    token = auth[7:] if auth.startswith("Bearer ") else None
    if not token:
        token = request.cookies.get("session_token")
    if token:
        await db.user_sessions.delete_one({"session_token": token})
    response.delete_cookie("session_token", path="/")
    return {"ok": True}


# ---------------- forgot / reset password ----------------

# Application-controlled reset. There is no external SMS/email provider.
# The generated 6-digit code is returned in the forgot-password response
# body and the frontend auto-populates it into the reset form. This does
# NOT prove ownership of the mobile number.

@router.post("/auth/forgot-password")
async def forgot_password(body: ForgotIn):
    mobile = _normalize_10digit(body.mobile)
    user = await db.users.find_one({"mobile": mobile}, {"_id": 0, "user_id": 1})
    if not user:
        raise HTTPException(404, "No account is registered with this mobile number")

    code = f"{secrets.randbelow(1_000_000):06d}"
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {
            "reset_code_hash": _hash(code),
            "reset_code_expires_at": (_now() + timedelta(minutes=5)).isoformat(),
            "reset_code_created_at": _now().isoformat(),
            "reset_attempts": 0,
        }},
    )
    # The code is deliberately never logged.
    return {"ok": True, "reset_code": code, "expires_in_seconds": 300}


@router.post("/auth/reset-password")
async def reset_password(body: ResetIn):
    if body.new_password != body.confirm_password:
        raise HTTPException(400, "Passwords do not match")
    _validate_password(body.new_password)
    mobile = _normalize_10digit(body.mobile)
    user = await db.users.find_one({"mobile": mobile}, {"_id": 0})
    if not user or not user.get("reset_code_hash"):
        raise HTTPException(400, "Reset code is invalid or has expired")

    # Rate-limit incorrect attempts (max 5).
    if int(user.get("reset_attempts", 0)) >= 5:
        raise HTTPException(429, "Too many attempts. Request a new reset code.")

    # Expiry.
    try:
        exp = datetime.fromisoformat(user["reset_code_expires_at"])
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if exp < _now():
            raise HTTPException(400, "Reset code is invalid or has expired")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(400, "Reset code is invalid or has expired")

    if not _verify(body.reset_code.strip(), user["reset_code_hash"]):
        await db.users.update_one({"user_id": user["user_id"]},
                                  {"$inc": {"reset_attempts": 1}})
        raise HTTPException(400, "Reset code is invalid or has expired")

    # Consume the code, set new password, revoke every existing session.
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"password_hash": _hash(body.new_password)},
         "$unset": {"reset_code_hash": "", "reset_code_expires_at": "",
                    "reset_code_created_at": "", "reset_attempts": ""}},
    )
    await _bump_session_version_and_revoke(user["user_id"])
    return {"ok": True}


# ---------------- change mobile / account recovery ----------------

@router.post("/auth/change-mobile")
async def change_mobile(body: ChangeMobileIn, response: Response):
    if body.new_mobile != body.confirm_new_mobile and \
       _normalize_10digit(body.new_mobile) != _normalize_10digit(body.confirm_new_mobile):
        raise HTTPException(400, "New mobile numbers do not match")

    old = _normalize_10digit(body.old_mobile)
    new = _normalize_10digit(body.new_mobile)
    if old == new:
        raise HTTPException(400, "New mobile must be different from old mobile")

    user = await db.users.find_one({"mobile": old}, {"_id": 0})
    if not user or not user.get("password_hash") \
            or not _verify(body.old_password, user["password_hash"]):
        raise HTTPException(401, "Invalid mobile number or password")

    if await db.users.find_one({"mobile": new, "user_id": {"$ne": user["user_id"]}},
                               {"_id": 1}):
        raise HTTPException(409, "This mobile number is already registered")

    # Same user_id, mobile changed. All application data (workers,
    # attendance, ledger, settlements, contractor rows, PDFs, reports)
    # is joined on user_id and therefore stays linked verbatim.
    await db.users.update_one({"user_id": user["user_id"]},
                              {"$set": {"mobile": new}})
    # Recovery invalidates old sessions on principle (user's identity
    # attribute changed) and issues a fresh token so the flow ends
    # authenticated on the calling device.
    token = await _issue_session(user["user_id"])
    # Clear any legacy `session_token` cookie (see /register).
    response.delete_cookie("session_token", path="/")
    updated = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return {"ok": True, "token": token, "user": _user_public(updated)}


# ---------------- me / language / districts ----------------

@router.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return _user_public(user)


@router.post("/auth/language")
async def set_language(body: LangIn, user: dict = Depends(get_current_user)):
    lang = body.language or "en"
    await db.users.update_one({"user_id": user["user_id"]},
                              {"$set": {"language": lang}})
    return {"ok": True, "language": lang}


@router.get("/districts")
async def list_districts():
    return {"districts": KARNATAKA_DISTRICTS}

"""Authentication route handlers.

Owns every existing /auth/* endpoint plus the /districts lookup:
    POST /auth/session          — Emergent-managed Google OAuth exchange
    GET  /auth/me               — current user + access + is_owner
    POST /auth/logout           — clear session cookie
    POST /auth/language         — persist user's UI language
    POST /auth/otp/send         — dummy OTP generator
    POST /auth/otp/verify       — verify OTP, mint session
    POST /auth/firebase/verify  — verify Firebase Phone Auth ID token
    POST /auth/profile          — set name + district (+ optional mobile)
    GET  /districts             — Karnataka district list

Behavior is preserved bit-for-bit from the original implementation in
server.py. This module only rearranges code; it does not modify auth
logic, token formats, cookie flags, request/response schemas, or
error responses.
"""
import os
import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

import httpx
import jwt
from cachetools import TTLCache
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

class OtpSendIn(BaseModel):
    mobile: str


class OtpVerifyIn(BaseModel):
    mobile: str
    otp: str


class ProfileIn(BaseModel):
    name: str
    district: str
    mobile: Optional[str] = None


class FirebaseIdTokenIn(BaseModel):
    id_token: str


# ---------------- Districts lookup ----------------

@router.get("/districts")
async def list_districts():
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


# ---------------- Mobile OTP Auth (dummy) ----------------

@router.post("/auth/otp/send")
async def otp_send(payload: OtpSendIn):
    mobile = _normalize_mobile(payload.mobile)
    if len(mobile) < 10:
        raise HTTPException(400, "Invalid mobile number")
    import random
    otp = f"{random.randint(0, 999999):06d}"
    await db.otps.update_one(
        {"mobile": mobile},
        {"$set": {
            "mobile": mobile, "otp": otp,
            "expires_at": (_now_utc() + timedelta(minutes=5)).isoformat(),
            "attempts": 0,
            "created_at": _now_utc().isoformat(),
        }},
        upsert=True,
    )
    # DEV MODE: return OTP directly. Wire a real SMS provider (Twilio/MSG91)
    # here for production.
    return {"ok": True, "mobile": mobile, "dev_otp": otp}


@router.post("/auth/otp/verify")
async def otp_verify(payload: OtpVerifyIn, response: Response):
    mobile = _normalize_mobile(payload.mobile)
    rec = await db.otps.find_one({"mobile": mobile}, {"_id": 0})
    if not rec:
        raise HTTPException(400, "OTP not requested")
    exp = rec["expires_at"]
    if isinstance(exp, str):
        exp = datetime.fromisoformat(exp)
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if exp < _now_utc():
        raise HTTPException(400, "OTP expired")
    if rec.get("attempts", 0) >= 5:
        raise HTTPException(429, "Too many attempts")
    if rec["otp"] != payload.otp.strip():
        await db.otps.update_one({"mobile": mobile}, {"$inc": {"attempts": 1}})
        raise HTTPException(400, "Invalid OTP")

    await db.otps.delete_one({"mobile": mobile})

    existing = await db.users.find_one({"mobile": mobile}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": user_id,
            "mobile": mobile,
            "name": "",
            "district": "",
            "language": "en",
            "trial_start": _now_utc().isoformat(),
            "is_paid": False,
            "created_at": _now_utc().isoformat(),
        })

    session_token = f"mobile_{uuid.uuid4().hex}"
    await db.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": session_token,
        "expires_at": (_now_utc() + timedelta(days=30)).isoformat(),
        "created_at": _now_utc().isoformat(),
    })
    response.set_cookie(
        key="session_token", value=session_token,
        httponly=True, secure=True, samesite="none",
        max_age=30 * 24 * 3600, path="/",
    )
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    # Promote owner if configured
    await _promote_owner_if_needed(user_id, user.get("mobile"))
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    user["access"] = compute_access(user)
    user["is_owner"] = is_owner(user)
    needs_profile = not (user.get("name") and user.get("district"))
    return {"user": user, "session_token": session_token, "needs_profile": needs_profile}


# ---------------- Firebase Phone Auth ----------------

_FIREBASE_PROJECT_ID = os.environ.get("FIREBASE_PROJECT_ID", "")
_FIREBASE_JWKS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/[email protected]"
_firebase_certs_cache: TTLCache = TTLCache(maxsize=1, ttl=3600)


async def _get_firebase_certs():
    if "certs" in _firebase_certs_cache:
        return _firebase_certs_cache["certs"]
    async with httpx.AsyncClient(timeout=5) as c:
        r = await c.get(_FIREBASE_JWKS_URL)
        r.raise_for_status()
        certs = r.json()
    _firebase_certs_cache["certs"] = certs
    return certs


@router.post("/auth/firebase/verify")
async def firebase_verify(payload: FirebaseIdTokenIn, response: Response):
    if not _FIREBASE_PROJECT_ID:
        raise HTTPException(500, "Firebase project not configured")
    token = payload.id_token
    try:
        unverified_header = jwt.get_unverified_header(token)
        kid = unverified_header.get("kid")
        if not kid:
            raise HTTPException(400, "Missing kid in token header")
        certs = await _get_firebase_certs()
        cert_pem = certs.get(kid)
        if not cert_pem:
            # cert rotated — invalidate cache and retry once
            _firebase_certs_cache.clear()
            certs = await _get_firebase_certs()
            cert_pem = certs.get(kid)
        if not cert_pem:
            raise HTTPException(401, "Unknown signing key")
        # Load public key from x509 cert
        from cryptography.x509 import load_pem_x509_certificate
        cert_obj = load_pem_x509_certificate(cert_pem.encode())
        public_key = cert_obj.public_key()
        claims = jwt.decode(
            token,
            public_key,
            algorithms=["RS256"],
            audience=_FIREBASE_PROJECT_ID,
            issuer=f"https://securetoken.google.com/{_FIREBASE_PROJECT_ID}",
            options={"require": ["exp", "iat", "sub", "aud", "iss"]},
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except jwt.InvalidTokenError as e:
        raise HTTPException(401, f"Invalid token: {e}")
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("firebase verify failed: %s", e)
        raise HTTPException(500, "Verification failed")

    phone_number = claims.get("phone_number") or ""
    if not phone_number:
        raise HTTPException(400, "Firebase token has no phone_number claim")
    mobile = _normalize_mobile(phone_number)

    existing = await db.users.find_one({"mobile": mobile}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": user_id,
            "mobile": mobile,
            "firebase_uid": claims.get("sub", ""),
            "name": "",
            "district": "",
            "language": "en",
            "trial_start": _now_utc().isoformat(),
            "is_paid": False,
            "created_at": _now_utc().isoformat(),
        })

    session_token = f"mobile_{uuid.uuid4().hex}"
    await db.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": session_token,
        "expires_at": (_now_utc() + timedelta(days=30)).isoformat(),
        "created_at": _now_utc().isoformat(),
    })
    response.set_cookie(
        key="session_token", value=session_token,
        httponly=True, secure=True, samesite="none",
        max_age=30 * 24 * 3600, path="/",
    )
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    await _promote_owner_if_needed(user_id, user.get("mobile"))
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    user["access"] = compute_access(user)
    user["is_owner"] = is_owner(user)
    needs_profile = not (user.get("name") and user.get("district"))
    return {"user": user, "session_token": session_token, "needs_profile": needs_profile}


# ---------------- Profile setup ----------------

@router.post("/auth/profile")
async def set_profile(payload: ProfileIn, user: dict = Depends(get_current_user)):
    if payload.district not in KARNATAKA_DISTRICTS:
        raise HTTPException(400, "Invalid district")
    if not payload.name.strip():
        raise HTTPException(400, "Name required")
    update = {"name": payload.name.strip(), "district": payload.district}
    if payload.mobile is not None and payload.mobile.strip():
        new_mobile = _normalize_mobile(payload.mobile)
        if len(new_mobile) < 10:
            raise HTTPException(400, "Invalid mobile")
        # Check uniqueness (other users can't own the same mobile)
        conflict = await db.users.find_one(
            {"mobile": new_mobile, "user_id": {"$ne": user["user_id"]}}, {"_id": 0}
        )
        if conflict:
            raise HTTPException(409, "Mobile already used by another account")
        update["mobile"] = new_mobile
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": update})
    updated = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    updated["access"] = compute_access(updated)
    return {"ok": True, "user": updated}

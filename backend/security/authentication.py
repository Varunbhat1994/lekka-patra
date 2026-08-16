"""Session-cookie / bearer-token authentication.

Provides the shared FastAPI dependency `get_current_user` that every
protected route relies on. Do NOT create alternative authentication
dependencies elsewhere — extend this one if new behavior is required.

Behavior is preserved bit-for-bit from the original implementation in
server.py:
    - Accepts a `session_token` cookie, falling back to an
      `Authorization: Bearer <token>` header
    - Looks up the session in `db.user_sessions` and the user in
      `db.users`
    - Raises 401 for missing / invalid / expired sessions / missing user

Post-auth side effect: `last_active_at` is refreshed on the user
document AT MOST once per 15 minutes per user. This powers the Owner
Portal user-activity view without amplifying database writes on every
authenticated request. Existing users without a `last_active_at` field
are handled backwards-compatibly by the owner endpoint (see
routes/owner.py:_activity_status).
"""
from datetime import datetime, timezone

from fastapi import HTTPException, Request

from core.database import db


# Minimum interval between `last_active_at` refreshes for the same user.
# Any authenticated activity within this window is deliberately skipped
# to avoid per-request write amplification (frontend polls, dashboards,
# session hydration, etc.).
LAST_ACTIVE_THROTTLE_SECONDS = 15 * 60


def _parse_iso_utc(v):
    if not v:
        return None
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    try:
        dt = datetime.fromisoformat(v)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


async def _touch_last_active(user: dict) -> None:
    """Refresh `last_active_at` if the last refresh is older than the
    throttle window. Fire-and-forget: any exception here MUST NOT break
    the auth dependency (activity tracking is best-effort telemetry, not
    part of the auth invariant)."""
    try:
        now = datetime.now(timezone.utc)
        prev = _parse_iso_utc(user.get("last_active_at"))
        if prev is not None and (now - prev).total_seconds() < LAST_ACTIVE_THROTTLE_SECONDS:
            return
        await db.users.update_one(
            {"user_id": user["user_id"]},
            {"$set": {"last_active_at": now.isoformat()}},
        )
        # Mirror the freshly-written value onto the in-memory user dict so
        # downstream code / responses this same request already see it.
        user["last_active_at"] = now.isoformat()
    except Exception:
        # Never propagate — tracking must not degrade authentication.
        pass


async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("session_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    sess = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not sess:
        raise HTTPException(status_code=401, detail="Invalid session")
    exp = sess["expires_at"]
    if isinstance(exp, str):
        exp = datetime.fromisoformat(exp)
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if exp < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Session expired")
    user = await db.users.find_one({"user_id": sess["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    await _touch_last_active(user)
    return user

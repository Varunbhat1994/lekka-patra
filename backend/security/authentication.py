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
"""
from datetime import datetime, timezone

from fastapi import HTTPException, Request

from core.database import db


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
    return user

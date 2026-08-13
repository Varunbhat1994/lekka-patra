"""User feedback routes."""
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.database import db
from security.authentication import get_current_user


router = APIRouter()


def now_utc():
    return datetime.now(timezone.utc)


class FeedbackIn(BaseModel):
    message: str
    rating: Optional[int] = None
    category: Optional[str] = "general"

@router.post("/feedback")
async def create_feedback(f: FeedbackIn, user: dict = Depends(get_current_user)):
    if not (f.message or "").strip():
        raise HTTPException(400, "Message required")
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["user_id"],
        "user_name": user.get("name") or "",
        "user_mobile": user.get("mobile") or "",
        "message": f.message.strip()[:2000],
        "rating": int(f.rating) if f.rating else None,
        "category": (f.category or "general")[:32],
        "read": False,
        "created_at": now_utc().isoformat(),
    }
    await db.feedback.insert_one(doc)
    doc.pop("_id", None)
    return doc

@router.get("/feedback")
async def list_feedback(user: dict = Depends(get_current_user), only_unread: bool = False):
    q = {"user_id": user["user_id"]}
    if only_unread:
        q["read"] = False
    rows = await db.feedback.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)
    return rows

@router.post("/feedback/{fid}/read")
async def mark_feedback_read(fid: str, user: dict = Depends(get_current_user)):
    await db.feedback.update_one(
        {"id": fid, "user_id": user["user_id"]}, {"$set": {"read": True}}
    )
    return {"ok": True}

@router.post("/feedback/read-all")
async def mark_all_feedback_read(user: dict = Depends(get_current_user)):
    await db.feedback.update_many(
        {"user_id": user["user_id"], "read": False}, {"$set": {"read": True}}
    )
    return {"ok": True}

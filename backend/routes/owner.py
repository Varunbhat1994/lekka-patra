"""Owner Portal (RBAC-restricted) routes."""
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.database import db
from core.constants import KARNATAKA_DISTRICTS
from security.authorization import require_owner


router = APIRouter()


def now_utc():
    return datetime.now(timezone.utc)


class OwnerAdIn(BaseModel):
    image_url: str  # data URL or public URL
    title: Optional[str] = ""
    subtitle: Optional[str] = ""
    cta_label: Optional[str] = ""
    cta_url: Optional[str] = ""
    districts: Optional[List[str]] = None  # None = all districts
    active: bool = True

@router.get("/owner/users")
async def owner_users(user: dict = Depends(require_owner)):
    rows = await db.users.find(
        {}, {"_id": 0, "user_id": 1, "name": 1, "mobile": 1, "email": 1,
             "district": 1, "language": 1, "role": 1, "is_paid": 1,
             "trial_start": 1, "created_at": 1},
    ).sort("created_at", -1).to_list(2000)
    return rows

@router.get("/owner/analytics/districts")
async def owner_district_analytics(user: dict = Depends(require_owner)):
    """Total workers + contractors per district (aggregated across all users)."""
    users = await db.users.find({}, {"_id": 0, "user_id": 1, "district": 1}).to_list(2000)
    by_uid = {u["user_id"]: (u.get("district") or "Uncategorized") for u in users}
    workers = await db.workers.find({}, {"_id": 0, "user_id": 1}).to_list(20000)
    contractors = await db.contractors.find({}, {"_id": 0, "user_id": 1}).to_list(20000)
    from collections import defaultdict
    tally = defaultdict(lambda: {"workers": 0, "contractors": 0, "users": 0})
    for u in users:
        tally[by_uid[u["user_id"]]]["users"] += 1
    for w in workers:
        tally[by_uid.get(w["user_id"], "Uncategorized")]["workers"] += 1
    for c in contractors:
        tally[by_uid.get(c["user_id"], "Uncategorized")]["contractors"] += 1
    rows = [{"district": d, **v} for d, v in tally.items()]
    rows.sort(key=lambda r: (r["workers"] + r["contractors"]), reverse=True)
    return {"rows": rows,
            "totals": {
                "users": len(users),
                "workers": len(workers),
                "contractors": len(contractors),
            }}

@router.get("/owner/ads")
async def owner_ads_list(user: dict = Depends(require_owner)):
    rows = await db.ads.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return rows

@router.post("/owner/ads")
async def owner_ads_create(payload: OwnerAdIn, user: dict = Depends(require_owner)):
    image_url = payload.image_url or ""
    # basic size guard for base64 data URLs (~1.5 MB max encoded → ~1 MB image)
    if image_url.startswith("data:") and len(image_url) > 1_800_000:
        raise HTTPException(413, "Image too large — please compress to under 1 MB")
    districts = payload.districts
    if districts is not None:
        bad = [d for d in districts if d not in KARNATAKA_DISTRICTS]
        if bad:
            raise HTTPException(400, f"Invalid districts: {bad}")
        if not districts:
            districts = None  # empty list → treat as global
    doc = {
        "id": str(uuid.uuid4()),
        "image_url": image_url,
        "title": payload.title or "",
        "subtitle": payload.subtitle or "",
        "cta_label": payload.cta_label or "",
        "cta_url": payload.cta_url or "",
        "districts": districts,
        "active": bool(payload.active),
        "owner_uploaded": True,
        "created_at": now_utc().isoformat(),
    }
    await db.ads.insert_one(doc)
    doc.pop("_id", None)
    return doc

@router.delete("/owner/ads/{aid}")
async def owner_ads_delete(aid: str, user: dict = Depends(require_owner)):
    res = await db.ads.delete_one({"id": aid})
    if res.deleted_count == 0:
        raise HTTPException(404, "Ad not found")
    return {"ok": True}

@router.patch("/owner/ads/{aid}")
async def owner_ads_toggle(aid: str, active: bool, user: dict = Depends(require_owner)):
    res = await db.ads.update_one({"id": aid}, {"$set": {"active": active}})
    if res.matched_count == 0:
        raise HTTPException(404, "Ad not found")
    return {"ok": True}

@router.get("/owner/feedback")
async def owner_feedback(user: dict = Depends(require_owner)):
    rows = await db.feedback.find({}, {"_id": 0}).sort("created_at", -1).to_list(2000)
    return rows

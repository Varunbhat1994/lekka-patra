"""Ads (district-targeted) routes and seed data.

`_seed_ads()` is invoked from server.py's startup event. `/ads` returns
ads targeted to the caller's district, falling back to global ads.
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from core.database import db
from security.authentication import get_current_user


router = APIRouter()


def now_utc():
    return datetime.now(timezone.utc)


AD_SEED = [
    # image, title, subtitle, cta_label, cta_url, districts (None = all)
    {"image_url": "https://images.unsplash.com/photo-1625246333195-78d9c38ad449?w=1200",
     "title": "Arecanut Fertilizer Combo", "subtitle": "20% off · Coastal blend",
     "cta_label": "Shop Now", "cta_url": "https://example.com/arecanut-fertilizer",
     "districts": ["Dakshina Kannada", "Udupi", "Uttara Kannada", "Shivamogga"]},
    {"image_url": "https://images.unsplash.com/photo-1523348837708-15d4a09cfac2?w=1200",
     "title": "Paddy Seeds — MTU 1010", "subtitle": "Certified · Rain-ready",
     "cta_label": "Book Now", "cta_url": "https://example.com/paddy-seeds",
     "districts": ["Mandya", "Mysuru", "Raichur", "Ballari", "Koppal", "Davanagere"]},
    {"image_url": "https://images.unsplash.com/photo-1592982537447-6f2a6a0c8b1b?w=1200",
     "title": "Sugarcane Drip Kit", "subtitle": "Save 30% water",
     "cta_label": "Get Quote", "cta_url": "https://example.com/drip-kit",
     "districts": ["Mandya", "Belagavi", "Bagalkot", "Vijayapura"]},
    {"image_url": "https://images.unsplash.com/photo-1595855759920-86582396756a?w=1200",
     "title": "Coffee Pulper Discount", "subtitle": "Only for Malnad districts",
     "cta_label": "Explore", "cta_url": "https://example.com/coffee-pulper",
     "districts": ["Kodagu", "Chikkamagaluru", "Hassan", "Shivamogga"]},
    {"image_url": "https://images.unsplash.com/photo-1560493676-04071c5f467b?w=1200",
     "title": "Cotton Seeds — BG II", "subtitle": "Trusted by 10k+ farmers",
     "cta_label": "Order", "cta_url": "https://example.com/cotton-seeds",
     "districts": ["Kalaburagi", "Raichur", "Yadgir", "Ballari", "Haveri", "Dharwad"]},
    {"image_url": "https://images.unsplash.com/photo-1560493676-04071c5f467b?w=1200",
     "title": "Ragi Grain Support", "subtitle": "MSP updates & buyers",
     "cta_label": "Learn", "cta_url": "https://example.com/ragi",
     "districts": ["Tumakuru", "Ramanagara", "Chitradurga", "Kolar", "Chikkaballapur"]},
    {"image_url": "https://images.unsplash.com/photo-1500595046743-cd271d694d30?w=1200",
     "title": "Dairy Feed 50kg", "subtitle": "Free delivery this week",
     "cta_label": "Buy",  "cta_url": "https://example.com/dairy-feed",
     "districts": None},  # all districts
    {"image_url": "https://images.unsplash.com/photo-1464226184884-fa280b87c399?w=1200",
     "title": "Farm Loan @ 4%", "subtitle": "Govt subsidy · Apply online",
     "cta_label": "Apply", "cta_url": "https://example.com/loan",
     "districts": None},
]

async def _seed_ads():
    if await db.ads.count_documents({}) > 0:
        return
    docs = []
    for a in AD_SEED:
        docs.append({
            "id": str(uuid.uuid4()),
            "image_url": a["image_url"],
            "title": a["title"],
            "subtitle": a["subtitle"],
            "cta_label": a["cta_label"],
            "cta_url": a["cta_url"],
            "districts": a["districts"],   # None => global
            "active": True,
            "created_at": now_utc().isoformat(),
        })
    await db.ads.insert_many(docs)

@router.get("/ads")
async def list_ads(user: dict = Depends(get_current_user)):
    district = user.get("district") or ""
    q = {"active": True, "$or": [{"districts": None}, {"districts": district}]}
    rows = await db.ads.find(q, {"_id": 0}).to_list(50)
    if not rows:
        rows = await db.ads.find({"active": True, "districts": None}, {"_id": 0}).to_list(50)
    return rows

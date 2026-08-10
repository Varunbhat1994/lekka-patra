from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends, Query
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os, io, uuid, logging, httpx
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime, timezone, timedelta

from emergentintegrations.payments.stripe.checkout import (
    StripeCheckout, CheckoutSessionRequest,
)

# --- reports ---
from openpyxl import Workbook
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api = APIRouter(prefix="/api")

# ---------------- Helpers ----------------
def now_utc():
    return datetime.now(timezone.utc)

def iso(dt):
    return dt.isoformat() if isinstance(dt, datetime) else dt

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
    if exp < now_utc():
        raise HTTPException(status_code=401, detail="Session expired")
    user = await db.users.find_one({"user_id": sess["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user

def compute_access(user: dict) -> dict:
    """Return trial/subscription state."""
    if user.get("is_paid"):
        return {"is_paid": True, "trial_active": False, "trial_days_left": 0, "locked": False}
    trial_start = user.get("trial_start")
    if isinstance(trial_start, str):
        trial_start = datetime.fromisoformat(trial_start)
    if trial_start and trial_start.tzinfo is None:
        trial_start = trial_start.replace(tzinfo=timezone.utc)
    if not trial_start:
        return {"is_paid": False, "trial_active": False, "trial_days_left": 0, "locked": True}
    elapsed = (now_utc() - trial_start).total_seconds()
    days_left = max(0, 5 - int(elapsed // 86400))
    trial_active = elapsed < 5 * 86400
    return {"is_paid": False, "trial_active": trial_active,
            "trial_days_left": days_left, "locked": not trial_active}

async def require_write_access(user: dict = Depends(get_current_user)) -> dict:
    acc = compute_access(user)
    if acc["locked"]:
        raise HTTPException(status_code=402, detail="Trial expired. Purchase required.")
    return user

# ---------------- Models ----------------
class Worker(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    name: str
    mobile: Optional[str] = ""
    skill: Optional[str] = ""
    daily_rate: float
    created_at: datetime = Field(default_factory=now_utc)

class WorkerIn(BaseModel):
    name: str
    mobile: Optional[str] = ""
    skill: Optional[str] = ""
    daily_rate: float

class Attendance(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    worker_id: str
    date: str  # YYYY-MM-DD
    status: str  # present, half_day, absent, overtime
    overtime_hours: float = 0
    field_crop: Optional[str] = ""
    description: Optional[str] = ""
    created_at: datetime = Field(default_factory=now_utc)

class AttendanceIn(BaseModel):
    worker_id: str
    date: str
    status: str
    overtime_hours: float = 0
    field_crop: Optional[str] = ""
    description: Optional[str] = ""

class Advance(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    worker_id: str
    date: str
    amount: float
    method: str  # cash / upi
    notes: Optional[str] = ""
    created_at: datetime = Field(default_factory=now_utc)

class AdvanceIn(BaseModel):
    worker_id: str
    date: str
    amount: float
    method: str
    notes: Optional[str] = ""

class SettlementIn(BaseModel):
    worker_id: str
    up_to_date: str
    note: Optional[str] = ""

# ---------------- Auth ----------------
@api.post("/auth/session")
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
            "trial_start": now_utc().isoformat(),
            "is_paid": False,
            "created_at": now_utc().isoformat(),
        })

    session_token = data["session_token"]
    expires_at = now_utc() + timedelta(days=7)
    await db.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": session_token,
        "expires_at": expires_at.isoformat(),
        "created_at": now_utc().isoformat(),
    })

    response.set_cookie(
        key="session_token", value=session_token,
        httponly=True, secure=True, samesite="none",
        max_age=7*24*3600, path="/",
    )
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    user["access"] = compute_access(user)
    return {"user": user}

@api.get("/auth/me")
async def auth_me(user: dict = Depends(get_current_user)):
    user["access"] = compute_access(user)
    return user

@api.post("/auth/logout")
async def logout(request: Request, response: Response):
    token = request.cookies.get("session_token")
    if token:
        await db.user_sessions.delete_one({"session_token": token})
    response.delete_cookie("session_token", path="/")
    return {"ok": True}

@api.post("/auth/language")
async def set_language(request: Request, user: dict = Depends(get_current_user)):
    body = await request.json()
    lang = body.get("language", "en")
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"language": lang}})
    return {"ok": True, "language": lang}

# ---------------- Mobile OTP Auth ----------------
KARNATAKA_DISTRICTS = [
    "Bagalkot","Ballari","Belagavi","Bengaluru Rural","Bengaluru Urban","Bidar",
    "Chamarajanagar","Chikkaballapur","Chikkamagaluru","Chitradurga","Dakshina Kannada",
    "Davanagere","Dharwad","Gadag","Hassan","Haveri","Kalaburagi","Kodagu","Kolar",
    "Koppal","Mandya","Mysuru","Raichur","Ramanagara","Shivamogga","Tumakuru",
    "Udupi","Uttara Kannada","Vijayanagara","Vijayapura","Yadgir",
]

def _normalize_mobile(m: str) -> str:
    m = "".join(ch for ch in (m or "") if ch.isdigit())
    if len(m) == 10:
        m = "91" + m
    return m

class OtpSendIn(BaseModel):
    mobile: str

class OtpVerifyIn(BaseModel):
    mobile: str
    otp: str

class ProfileIn(BaseModel):
    name: str
    district: str

@api.get("/districts")
async def list_districts():
    return {"districts": KARNATAKA_DISTRICTS}

@api.post("/auth/otp/send")
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
            "expires_at": (now_utc() + timedelta(minutes=5)).isoformat(),
            "attempts": 0,
            "created_at": now_utc().isoformat(),
        }},
        upsert=True,
    )
    # DEV MODE: return OTP directly. Wire a real SMS provider (Twilio/MSG91) here for production.
    return {"ok": True, "mobile": mobile, "dev_otp": otp}

@api.post("/auth/otp/verify")
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
    if exp < now_utc():
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
            "trial_start": now_utc().isoformat(),
            "is_paid": False,
            "created_at": now_utc().isoformat(),
        })

    session_token = f"mobile_{uuid.uuid4().hex}"
    await db.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": session_token,
        "expires_at": (now_utc() + timedelta(days=30)).isoformat(),
        "created_at": now_utc().isoformat(),
    })
    response.set_cookie(
        key="session_token", value=session_token,
        httponly=True, secure=True, samesite="none",
        max_age=30*24*3600, path="/",
    )
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    user["access"] = compute_access(user)
    needs_profile = not (user.get("name") and user.get("district"))
    return {"user": user, "session_token": session_token, "needs_profile": needs_profile}

@api.post("/auth/profile")
async def set_profile(payload: ProfileIn, user: dict = Depends(get_current_user)):
    if payload.district not in KARNATAKA_DISTRICTS:
        raise HTTPException(400, "Invalid district")
    if not payload.name.strip():
        raise HTTPException(400, "Name required")
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"name": payload.name.strip(), "district": payload.district}},
    )
    updated = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    updated["access"] = compute_access(updated)
    return {"ok": True, "user": updated}

# ---------------- Ads (district-targeted) ----------------
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

@app.on_event("startup")
async def _startup_seed():
    await _seed_ads()

@api.get("/ads")
async def list_ads(user: dict = Depends(get_current_user)):
    district = user.get("district") or ""
    q = {"active": True, "$or": [{"districts": None}, {"districts": district}]}
    rows = await db.ads.find(q, {"_id": 0}).to_list(50)
    if not rows:
        rows = await db.ads.find({"active": True, "districts": None}, {"_id": 0}).to_list(50)
    return rows



# ---------------- Workers ----------------
@api.get("/workers")
async def list_workers(user: dict = Depends(get_current_user)):
    workers = await db.workers.find({"user_id": user["user_id"]}, {"_id": 0}).to_list(1000)
    return workers

@api.post("/workers")
async def create_worker(w: WorkerIn, user: dict = Depends(require_write_access)):
    obj = Worker(user_id=user["user_id"], **w.model_dump())
    doc = obj.model_dump()
    doc["created_at"] = doc["created_at"].isoformat()
    await db.workers.insert_one(doc)
    return obj

@api.put("/workers/{worker_id}")
async def update_worker(worker_id: str, w: WorkerIn, user: dict = Depends(require_write_access)):
    res = await db.workers.update_one(
        {"id": worker_id, "user_id": user["user_id"]},
        {"$set": w.model_dump()},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Worker not found")
    return {"ok": True}

@api.delete("/workers/{worker_id}")
async def delete_worker(worker_id: str, user: dict = Depends(require_write_access)):
    await db.workers.delete_one({"id": worker_id, "user_id": user["user_id"]})
    await db.attendance.delete_many({"worker_id": worker_id, "user_id": user["user_id"]})
    await db.advances.delete_many({"worker_id": worker_id, "user_id": user["user_id"]})
    return {"ok": True}

# ---------------- Attendance ----------------
@api.get("/attendance")
async def list_attendance(
    user: dict = Depends(get_current_user),
    date: Optional[str] = None,
    worker_id: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
):
    q = {"user_id": user["user_id"]}
    if date:
        q["date"] = date
    if worker_id:
        q["worker_id"] = worker_id
    if start and end:
        q["date"] = {"$gte": start, "$lte": end}
    rows = await db.attendance.find(q, {"_id": 0}).to_list(5000)
    return rows

@api.post("/attendance")
async def upsert_attendance(a: AttendanceIn, user: dict = Depends(require_write_access)):
    # Upsert per (worker_id, date)
    existing = await db.attendance.find_one({
        "user_id": user["user_id"], "worker_id": a.worker_id, "date": a.date
    }, {"_id": 0})
    if existing:
        await db.attendance.update_one(
            {"id": existing["id"]},
            {"$set": a.model_dump()},
        )
        return {"ok": True, "id": existing["id"]}
    obj = Attendance(user_id=user["user_id"], **a.model_dump())
    doc = obj.model_dump()
    doc["created_at"] = doc["created_at"].isoformat()
    await db.attendance.insert_one(doc)
    return obj

@api.delete("/attendance/{att_id}")
async def del_attendance(att_id: str, user: dict = Depends(require_write_access)):
    await db.attendance.delete_one({"id": att_id, "user_id": user["user_id"]})
    return {"ok": True}

# ---------------- Advances / Ledger ----------------
@api.get("/advances")
async def list_advances(user: dict = Depends(get_current_user), worker_id: Optional[str] = None):
    q = {"user_id": user["user_id"]}
    if worker_id:
        q["worker_id"] = worker_id
    rows = await db.advances.find(q, {"_id": 0}).sort("date", -1).to_list(5000)
    return rows

@api.post("/advances")
async def create_advance(a: AdvanceIn, user: dict = Depends(require_write_access)):
    obj = Advance(user_id=user["user_id"], **a.model_dump())
    doc = obj.model_dump()
    doc["created_at"] = doc["created_at"].isoformat()
    await db.advances.insert_one(doc)
    return obj

@api.delete("/advances/{adv_id}")
async def del_advance(adv_id: str, user: dict = Depends(require_write_access)):
    await db.advances.delete_one({"id": adv_id, "user_id": user["user_id"]})
    return {"ok": True}

@api.post("/settlements")
async def settle(s: SettlementIn, user: dict = Depends(require_write_access)):
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["user_id"],
        "worker_id": s.worker_id,
        "up_to_date": s.up_to_date,
        "note": s.note or "",
        "created_at": now_utc().isoformat(),
    }
    await db.settlements.insert_one(doc)
    return {"ok": True, "id": doc["id"]}

@api.get("/settlements")
async def list_settlements(user: dict = Depends(get_current_user), worker_id: Optional[str] = None):
    q = {"user_id": user["user_id"]}
    if worker_id:
        q["worker_id"] = worker_id
    rows = await db.settlements.find(q, {"_id": 0}).sort("up_to_date", -1).to_list(1000)
    return rows

# ---------------- Ledger computation ----------------
def _wage_units(status: str, overtime_hours: float, daily_rate: float) -> float:
    if status == "present":
        return daily_rate
    if status == "half_day":
        return daily_rate * 0.5
    if status == "overtime":
        # 1 day + (overtime_hours / 8) day equivalent
        return daily_rate + daily_rate * (overtime_hours / 8.0)
    return 0.0

async def compute_worker_ledger(user_id: str, worker: dict, start: Optional[str] = None, end: Optional[str] = None):
    q = {"user_id": user_id, "worker_id": worker["id"]}
    if start and end:
        q["date"] = {"$gte": start, "$lte": end}
    att = await db.attendance.find(q, {"_id": 0}).to_list(5000)
    total_earned = 0.0
    days_worked = 0.0
    for a in att:
        u = _wage_units(a["status"], a.get("overtime_hours", 0), worker["daily_rate"])
        total_earned += u
        if a["status"] == "present": days_worked += 1
        elif a["status"] == "half_day": days_worked += 0.5
        elif a["status"] == "overtime": days_worked += 1 + a.get("overtime_hours", 0)/8.0
    adv_q = {"user_id": user_id, "worker_id": worker["id"]}
    advances = await db.advances.find(adv_q, {"_id": 0}).to_list(5000)
    total_advance = sum(a["amount"] for a in advances)
    return {
        "worker": worker,
        "days_worked": round(days_worked, 2),
        "total_earned": round(total_earned, 2),
        "total_advance": round(total_advance, 2),
        "pending": round(total_earned - total_advance, 2),
        "attendance": att,
        "advances": advances,
    }

@api.get("/ledger/{worker_id}")
async def ledger(worker_id: str, user: dict = Depends(get_current_user)):
    worker = await db.workers.find_one({"id": worker_id, "user_id": user["user_id"]}, {"_id": 0})
    if not worker:
        raise HTTPException(404, "Worker not found")
    return await compute_worker_ledger(user["user_id"], worker)

# ---------------- Dashboard ----------------
@api.get("/dashboard")
async def dashboard(user: dict = Depends(get_current_user)):
    today = now_utc().strftime("%Y-%m-%d")
    workers = await db.workers.find({"user_id": user["user_id"]}, {"_id": 0}).to_list(1000)
    workers_by_id = {w["id"]: w for w in workers}

    today_att = await db.attendance.find({"user_id": user["user_id"], "date": today}, {"_id": 0}).to_list(1000)
    present_today = sum(1 for a in today_att if a["status"] in ("present", "half_day", "overtime"))
    est_wage_today = 0.0
    for a in today_att:
        w = workers_by_id.get(a["worker_id"])
        if not w: continue
        est_wage_today += _wage_units(a["status"], a.get("overtime_hours", 0), w["daily_rate"])

    # Totals
    all_att = await db.attendance.find({"user_id": user["user_id"]}, {"_id": 0}).to_list(20000)
    all_adv = await db.advances.find({"user_id": user["user_id"]}, {"_id": 0}).to_list(20000)
    total_earned = 0.0
    for a in all_att:
        w = workers_by_id.get(a["worker_id"])
        if not w: continue
        total_earned += _wage_units(a["status"], a.get("overtime_hours", 0), w["daily_rate"])
    total_advance = sum(a["amount"] for a in all_adv)
    outstanding_advance = total_advance
    pending_wage = round(total_earned - total_advance, 2)

    # Monthly by field/crop (last 6 months)
    from collections import defaultdict
    monthly = defaultdict(lambda: defaultdict(float))
    for a in all_att:
        w = workers_by_id.get(a["worker_id"])
        if not w: continue
        month = a["date"][:7]
        crop = a.get("field_crop") or "Uncategorized"
        monthly[month][crop] += _wage_units(a["status"], a.get("overtime_hours", 0), w["daily_rate"])
    # Convert to list
    months_sorted = sorted(monthly.keys())[-6:]
    chart = []
    all_crops = set()
    for m in months_sorted:
        for c in monthly[m].keys():
            all_crops.add(c)
    for m in months_sorted:
        row = {"month": m}
        for c in all_crops:
            row[c] = round(monthly[m].get(c, 0), 2)
        chart.append(row)

    return {
        "workers_total": len(workers),
        "present_today": present_today,
        "estimated_wage_today": round(est_wage_today, 2),
        "outstanding_advance": round(outstanding_advance, 2),
        "pending_wage": pending_wage,
        "chart": chart,
        "crops": sorted(list(all_crops)),
    }

# ---------------- Reports ----------------
@api.get("/reports/pdf")
async def report_pdf(user: dict = Depends(get_current_user), worker_id: Optional[str] = None):
    workers_query = {"user_id": user["user_id"]}
    if worker_id:
        workers_query["id"] = worker_id
    workers = await db.workers.find(workers_query, {"_id": 0}).to_list(1000)

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, title="Farm Labor Report")
    styles = getSampleStyleSheet()
    story = []
    story.append(Paragraph("Farm Labor Report", styles["Title"]))
    story.append(Paragraph(f"Owner: {user.get('name','')} · {user.get('email','')}", styles["Normal"]))
    story.append(Paragraph(f"Generated: {now_utc().strftime('%Y-%m-%d %H:%M UTC')}", styles["Normal"]))
    story.append(Spacer(1, 12))

    for w in workers:
        led = await compute_worker_ledger(user["user_id"], w)
        story.append(Paragraph(f"<b>{w['name']}</b> ({w.get('skill','')}) — Rate: Rs {w['daily_rate']}", styles["Heading3"]))
        summary = [
            ["Days Worked", "Total Earned", "Advance Paid", "Pending"],
            [led["days_worked"], f"Rs {led['total_earned']}", f"Rs {led['total_advance']}", f"Rs {led['pending']}"],
        ]
        t = Table(summary, hAlign="LEFT")
        t.setStyle(TableStyle([
            ("BACKGROUND", (0,0), (-1,0), colors.HexColor("#2f6b3b")),
            ("TEXTCOLOR", (0,0), (-1,0), colors.white),
            ("GRID", (0,0), (-1,-1), 0.5, colors.grey),
            ("FONTNAME", (0,0), (-1,0), "Helvetica-Bold"),
            ("PADDING", (0,0), (-1,-1), 6),
        ]))
        story.append(t)
        story.append(Spacer(1, 16))

    doc.build(story)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=farm_report.pdf"})

@api.get("/reports/excel")
async def report_excel(user: dict = Depends(get_current_user), worker_id: Optional[str] = None):
    wb = Workbook()
    ws = wb.active
    ws.title = "Summary"
    ws.append(["Worker", "Skill", "Daily Rate", "Days Worked", "Total Earned", "Advance", "Pending"])
    workers_query = {"user_id": user["user_id"]}
    if worker_id:
        workers_query["id"] = worker_id
    workers = await db.workers.find(workers_query, {"_id": 0}).to_list(1000)
    for w in workers:
        led = await compute_worker_ledger(user["user_id"], w)
        ws.append([w["name"], w.get("skill",""), w["daily_rate"],
                   led["days_worked"], led["total_earned"], led["total_advance"], led["pending"]])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=farm_report.xlsx"})

@api.get("/reports/whatsapp/{worker_id}")
async def whatsapp_text(worker_id: str, user: dict = Depends(get_current_user), lang: str = "en"):
    worker = await db.workers.find_one({"id": worker_id, "user_id": user["user_id"]}, {"_id": 0})
    if not worker:
        raise HTTPException(404, "Worker not found")
    led = await compute_worker_ledger(user["user_id"], worker)
    if lang == "kn":
        msg = (
            f"ನಮಸ್ಕಾರ {worker['name']},\n"
            f"ಒಟ್ಟು ಕೆಲಸದ ದಿನಗಳು: {led['days_worked']}\n"
            f"ಒಟ್ಟು ಸಂಬಳ: ರೂ {led['total_earned']}\n"
            f"ಮುಂಗಡ ಪಾವತಿ: ರೂ {led['total_advance']}\n"
            f"ಬಾಕಿ: ರೂ {led['pending']}"
        )
    else:
        msg = (
            f"Hi {worker['name']},\n"
            f"Days Worked: {led['days_worked']}\n"
            f"Total Earned: Rs {led['total_earned']}\n"
            f"Advance Paid: Rs {led['total_advance']}\n"
            f"Pending: Rs {led['pending']}"
        )
    return {"message": msg, "phone": worker.get("mobile", "")}

# ---------------- Payments (Stripe Flow B) ----------------
LIFETIME_PRICE = float(os.environ.get("LIFETIME_PRICE_INR", "499"))

class CheckoutIn(BaseModel):
    origin_url: str

@api.post("/payments/checkout")
async def create_checkout(req: CheckoutIn, request: Request, user: dict = Depends(get_current_user)):
    host_url = str(request.base_url)
    webhook_url = f"{host_url}api/webhook/stripe"
    checkout = StripeCheckout(api_key=os.environ["STRIPE_API_KEY"], webhook_url=webhook_url)

    success_url = f"{req.origin_url}/payment/success?session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{req.origin_url}/payment/cancel"

    session_req = CheckoutSessionRequest(
        amount=LIFETIME_PRICE,
        currency="inr",
        success_url=success_url,
        cancel_url=cancel_url,
        metadata={"user_id": user["user_id"], "product": "lifetime"},
    )
    session = await checkout.create_checkout_session(session_req)

    await db.payment_transactions.insert_one({
        "session_id": session.session_id,
        "user_id": user["user_id"],
        "amount": LIFETIME_PRICE,
        "currency": "inr",
        "status": "initiated",
        "payment_status": "pending",
        "created_at": now_utc().isoformat(),
        "updated_at": now_utc().isoformat(),
    })
    return {"checkout_url": session.url, "session_id": session.session_id}

@api.get("/payments/status/{session_id}")
async def payment_status(session_id: str, request: Request):
    record = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
    if not record:
        raise HTTPException(404, "Transaction not found")
    if record.get("payment_status") != "paid":
        host_url = str(request.base_url)
        webhook_url = f"{host_url}api/webhook/stripe"
        checkout = StripeCheckout(api_key=os.environ["STRIPE_API_KEY"], webhook_url=webhook_url)
        try:
            s = await checkout.get_checkout_status(session_id)
            if s.payment_status == "paid" or s.status == "complete":
                await db.payment_transactions.update_one(
                    {"session_id": session_id, "payment_status": {"$ne": "paid"}},
                    {"$set": {"status": "completed", "payment_status": "paid",
                              "updated_at": now_utc().isoformat()}},
                )
                await db.users.update_one(
                    {"user_id": record["user_id"]},
                    {"$set": {"is_paid": True, "paid_at": now_utc().isoformat()}},
                )
                record = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
        except Exception as e:
            logging.warning(f"stripe status err: {e}")
    return {
        "session_id": record["session_id"],
        "status": record["status"],
        "payment_status": record["payment_status"],
    }

@api.post("/webhook/stripe")
async def stripe_webhook(request: Request):
    body = await request.body()
    sig = request.headers.get("Stripe-Signature", "")
    host_url = str(request.base_url)
    webhook_url = f"{host_url}api/webhook/stripe"
    checkout = StripeCheckout(api_key=os.environ["STRIPE_API_KEY"], webhook_url=webhook_url)
    try:
        result = await checkout.handle_webhook(body, sig)
    except Exception as e:
        raise HTTPException(400, f"Webhook error: {e}")
    if result.payment_status == "paid":
        await db.payment_transactions.update_one(
            {"session_id": result.session_id, "payment_status": {"$ne": "paid"}},
            {"$set": {"status": "completed", "payment_status": "paid",
                      "updated_at": now_utc().isoformat()}},
        )
        user_id = (result.metadata or {}).get("user_id")
        if user_id:
            await db.users.update_one({"user_id": user_id},
                {"$set": {"is_paid": True, "paid_at": now_utc().isoformat()}})
    return {"ok": True}

# ---------------- Health ----------------
@api.get("/")
async def root():
    return {"status": "ok", "app": "Farm Labor Tracker"}

app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

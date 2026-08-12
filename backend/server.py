from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends, Query
from fastapi.responses import StreamingResponse, JSONResponse
from starlette.middleware.cors import CORSMiddleware
import os, io, uuid, logging, json
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

# Shared infrastructure — importing core.database also imports core.config,
# which runs load_dotenv() so all subsequent os.environ reads in this
# module resolve correctly. Keep this import BEFORE any other os.environ
# access.
from core.database import client, db

# Security package (Step 4 extraction). Owns session verification, paywall,
# and role-based owner checks. Do not redefine these anywhere else.
from security.authentication import get_current_user
from security.authorization import (
    compute_access,
    require_write_access,
    is_owner,
    require_owner,
    _owner_mobile,
    _owner_email,
)
from core.constants import KARNATAKA_DISTRICTS

# Route modules (Step 5+ extraction). Each mounts onto `api` below.
from routes.auth import router as auth_router
from routes.workers import router as workers_router
from routes.attendance import router as attendance_router
from routes.advances import router as advances_router
from routes.contractors import router as contractors_router

app = FastAPI()
api = APIRouter(prefix="/api")
api.include_router(auth_router)
api.include_router(workers_router)
api.include_router(attendance_router)
api.include_router(advances_router)
api.include_router(contractors_router)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("farmlog")

# ---------------- Helpers ----------------
def now_utc():
    return datetime.now(timezone.utc)

def iso(dt):
    return dt.isoformat() if isinstance(dt, datetime) else dt

# ---------------- Models ----------------
class SettlementIn(BaseModel):
    worker_id: Optional[str] = None
    contractor_id: Optional[str] = None
    up_to_date: str
    note: Optional[str] = ""


# ---------------- Feedback ----------------
class FeedbackIn(BaseModel):
    message: str
    rating: Optional[int] = None
    category: Optional[str] = "general"

@api.post("/feedback")
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

@api.get("/feedback")
async def list_feedback(user: dict = Depends(get_current_user), only_unread: bool = False):
    q = {"user_id": user["user_id"]}
    if only_unread:
        q["read"] = False
    rows = await db.feedback.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)
    return rows

@api.post("/feedback/{fid}/read")
async def mark_feedback_read(fid: str, user: dict = Depends(get_current_user)):
    await db.feedback.update_one(
        {"id": fid, "user_id": user["user_id"]}, {"$set": {"read": True}}
    )
    return {"ok": True}

@api.post("/feedback/read-all")
async def mark_all_feedback_read(user: dict = Depends(get_current_user)):
    await db.feedback.update_many(
        {"user_id": user["user_id"], "read": False}, {"$set": {"read": True}}
    )
    return {"ok": True}

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
    # Promote pre-existing owner account (idempotent) so a re-deploy picks it up.
    om = _owner_mobile()
    if om:
        await db.users.update_many({"mobile": om}, {"$set": {"role": "owner"}})
    oe = _owner_email()
    if oe:
        # case-insensitive email match
        import re as _re
        await db.users.update_many(
            {"email": {"$regex": f"^{_re.escape(oe)}$", "$options": "i"}},
            {"$set": {"role": "owner"}},
        )

@api.get("/ads")
async def list_ads(user: dict = Depends(get_current_user)):
    district = user.get("district") or ""
    q = {"active": True, "$or": [{"districts": None}, {"districts": district}]}
    rows = await db.ads.find(q, {"_id": 0}).to_list(50)
    if not rows:
        rows = await db.ads.find({"active": True, "districts": None}, {"_id": 0}).to_list(50)
    return rows




@api.post("/settlements")
async def settle(s: SettlementIn, user: dict = Depends(require_write_access)):
    """Zero out the pending balance for a worker OR contractor by recording
    the current pending amount as a settlement. Ledger treats settlements
    as money paid out."""
    if not s.worker_id and not s.contractor_id:
        raise HTTPException(400, "worker_id or contractor_id required")

    if s.worker_id:
        worker = await db.workers.find_one({"id": s.worker_id, "user_id": user["user_id"]}, {"_id": 0})
        if not worker:
            raise HTTPException(404, "Worker not found")
        led = await compute_worker_ledger(user["user_id"], worker)
        pending = max(0.0, led["pending"])
        doc = {
            "id": str(uuid.uuid4()),
            "user_id": user["user_id"],
            "worker_id": s.worker_id,
            "up_to_date": s.up_to_date,
            "amount": round(pending, 2),
            "note": s.note or "",
            "created_at": now_utc().isoformat(),
        }
        await db.settlements.insert_one(doc)
        doc.pop("_id", None)
        return {"ok": True, "id": doc["id"], "amount": doc["amount"], "kind": "worker"}

    # Contractor settle: zero out net_paid by recording a return equal to net_paid.
    contractor = await db.contractors.find_one({"id": s.contractor_id, "user_id": user["user_id"]}, {"_id": 0})
    if not contractor:
        raise HTTPException(404, "Contractor not found")
    payments = await db.contractor_payments.find(
        {"contractor_id": s.contractor_id, "user_id": user["user_id"]}, {"_id": 0}
    ).to_list(2000)
    returns = await db.contractor_returns.find(
        {"contractor_id": s.contractor_id, "user_id": user["user_id"]}, {"_id": 0}
    ).to_list(2000)
    net_paid = round(sum(p["amount"] for p in payments) - sum(r["amount"] for r in returns), 2)
    net_paid = max(0.0, net_paid)
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user["user_id"],
        "contractor_id": s.contractor_id,
        "up_to_date": s.up_to_date,
        "amount": round(net_paid, 2),
        "note": s.note or "",
        "kind": "contractor_settle",
        "created_at": now_utc().isoformat(),
    }
    await db.settlements.insert_one(doc)
    # Also record it as a return so contractor_ledger.net_paid becomes 0.
    if net_paid > 0:
        await db.contractor_returns.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": user["user_id"],
            "contractor_id": s.contractor_id,
            "date": s.up_to_date,
            "amount": net_paid,
            "method": "settlement",
            "notes": "Auto-recorded on Mark Settled",
            "settlement_id": doc["id"],
            "created_at": now_utc().isoformat(),
        })
    doc.pop("_id", None)
    return {"ok": True, "id": doc["id"], "amount": doc["amount"], "kind": "contractor"}

@api.get("/settlements")
async def list_settlements(user: dict = Depends(get_current_user), worker_id: Optional[str] = None, contractor_id: Optional[str] = None):
    q = {"user_id": user["user_id"]}
    if worker_id:
        q["worker_id"] = worker_id
    if contractor_id:
        q["contractor_id"] = contractor_id
    rows = await db.settlements.find(q, {"_id": 0}).sort("up_to_date", -1).to_list(1000)
    return rows

@api.delete("/settlements/{sid}")
async def del_settlement(sid: str, user: dict = Depends(require_write_access)):
    """Reverse a settlement (in case cash was never actually paid)."""
    # If it was a contractor settlement, also remove its auto-return
    await db.contractor_returns.delete_many({"user_id": user["user_id"], "settlement_id": sid})
    res = await db.settlements.delete_one({"id": sid, "user_id": user["user_id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Settlement not found")
    return {"ok": True}

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
    # Find the latest settlement cutoff date so we only count activity AFTER it.
    all_settlements = await db.settlements.find(
        {"user_id": user_id, "worker_id": worker["id"]}, {"_id": 0}
    ).sort("up_to_date", -1).to_list(5000)
    cutoff = all_settlements[0]["up_to_date"] if all_settlements else None

    q = {"user_id": user_id, "worker_id": worker["id"]}
    if start and end:
        q["date"] = {"$gte": start, "$lte": end}
    elif cutoff:
        q["date"] = {"$gt": cutoff}
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
    if cutoff:
        adv_q_dated = {**adv_q, "date": {"$gt": cutoff}}
    else:
        adv_q_dated = adv_q
    advances = await db.advances.find(adv_q_dated, {"_id": 0}).to_list(5000)
    total_advance = sum(a["amount"] for a in advances)
    returns = await db.advance_returns.find(adv_q_dated, {"_id": 0}).sort("date", -1).to_list(5000)
    total_returned = sum(r["amount"] for r in returns)
    total_settled = sum(s.get("amount", 0) or 0 for s in all_settlements)
    net_advance = total_advance - total_returned
    return {
        "worker": worker,
        "days_worked": round(days_worked, 2),
        "total_earned": round(total_earned, 2),
        "total_advance": round(total_advance, 2),
        "total_returned": round(total_returned, 2),
        "total_settled": round(total_settled, 2),
        "net_advance": round(net_advance, 2),
        "pending": round(total_earned - net_advance, 2),
        "settled_up_to": cutoff,
        "attendance": att,
        "advances": advances,
        "returns": returns,
        "settlements": all_settlements,
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
        "pending_list": await _compute_pending_list(user["user_id"], workers),
    }

async def _compute_pending_list(user_id: str, workers: list) -> list:
    """List of {name, pending, type} for workers/contractors who have received an advance/payment."""
    items = []
    # Workers with advance given
    for w in workers:
        advs = await db.advances.find({"user_id": user_id, "worker_id": w["id"]}, {"_id": 0}).to_list(1000)
        if not advs:
            continue
        led = await compute_worker_ledger(user_id, w)
        items.append({
            "type": "worker",
            "name": w["name"],
            "pending": led["pending"],
            "advance": led["total_advance"],
        })
    # Contractors with payment given
    contractors = await db.contractors.find({"user_id": user_id}, {"_id": 0}).to_list(500)
    for c in contractors:
        payments = await db.contractor_payments.find({"user_id": user_id, "contractor_id": c["id"]}, {"_id": 0}).to_list(1000)
        if not payments:
            continue
        returns = await db.contractor_returns.find({"user_id": user_id, "contractor_id": c["id"]}, {"_id": 0}).to_list(1000)
        total_paid = sum(p["amount"] for p in payments)
        total_returned = sum(r["amount"] for r in returns)
        net_paid = round(total_paid - total_returned, 2)
        items.append({
            "type": "contractor",
            "name": c["name"],
            "pending": net_paid,
            "advance": round(total_paid, 2),
        })
    return items

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
            ["Days Worked", "Total Earned", "Advance", "Returned", "Settled", "Pending"],
            [led["days_worked"], f"Rs {led['total_earned']}",
             f"Rs {led['total_advance']}", f"Rs {led['total_returned']}",
             f"Rs {led.get('total_settled', 0)}", f"Rs {led['pending']}"],
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

        # Date-wise attendance log
        if led["attendance"]:
            story.append(Spacer(1, 6))
            story.append(Paragraph("<b>Attendance (date-wise)</b>", styles["Normal"]))
            att_rows = [["Date", "Status", "OT hrs", "Field/Crop", "Description"]]
            for a in sorted(led["attendance"], key=lambda x: x["date"]):
                att_rows.append([
                    a["date"],
                    a["status"].replace("_", " ").title(),
                    a.get("overtime_hours", 0) or "",
                    a.get("field_crop", ""),
                    (a.get("description", "") or "")[:60],
                ])
            att_tab = Table(att_rows, hAlign="LEFT")
            att_tab.setStyle(TableStyle([
                ("BACKGROUND", (0,0), (-1,0), colors.HexColor("#eeeeee")),
                ("GRID", (0,0), (-1,-1), 0.25, colors.grey),
                ("FONTSIZE", (0,0), (-1,-1), 9),
                ("PADDING", (0,0), (-1,-1), 4),
            ]))
            story.append(att_tab)

        if led["advances"] or led["returns"]:
            story.append(Spacer(1, 6))
            story.append(Paragraph("<b>Advances & Returns</b>", styles["Normal"]))
            rows = [["Date", "Type", "Amount", "Method", "Notes"]]
            for a in sorted(led["advances"], key=lambda x: x["date"]):
                rows.append([a["date"], "Advance", f"Rs {a['amount']}", a.get("method", ""), a.get("notes", "")])
            for r in sorted(led["returns"], key=lambda x: x["date"]):
                rows.append([r["date"], "Return", f"Rs {r['amount']}", r.get("method", ""), r.get("notes", "")])
            tab = Table(rows, hAlign="LEFT")
            tab.setStyle(TableStyle([
                ("BACKGROUND", (0,0), (-1,0), colors.HexColor("#eeeeee")),
                ("GRID", (0,0), (-1,-1), 0.25, colors.grey),
                ("FONTSIZE", (0,0), (-1,-1), 9),
                ("PADDING", (0,0), (-1,-1), 4),
            ]))
            story.append(tab)
        story.append(Spacer(1, 16))

    doc.build(story)
    buf.seek(0)
    fname = "farm_report.pdf" if not worker_id else f"worker_{worker_id[:8]}.pdf"
    return StreamingResponse(buf, media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={fname}"})

@api.get("/reports/excel")
async def report_excel(user: dict = Depends(get_current_user), worker_id: Optional[str] = None):
    wb = Workbook()
    ws = wb.active
    ws.title = "Summary"
    ws.append(["Worker", "Skill", "Daily Rate", "Days Worked", "Total Earned", "Advance", "Returned", "Settled", "Pending"])
    workers_query = {"user_id": user["user_id"]}
    if worker_id:
        workers_query["id"] = worker_id
    workers = await db.workers.find(workers_query, {"_id": 0}).to_list(1000)
    for w in workers:
        led = await compute_worker_ledger(user["user_id"], w)
        ws.append([w["name"], w.get("skill",""), w["daily_rate"],
                   led["days_worked"], led["total_earned"],
                   led["total_advance"], led["total_returned"],
                   led.get("total_settled", 0), led["pending"]])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    fname = "farm_report.xlsx" if not worker_id else f"worker_{worker_id[:8]}.xlsx"
    return StreamingResponse(buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={fname}"})

@api.get("/reports/contractor/{cid}/pdf")
async def contractor_pdf(cid: str, user: dict = Depends(get_current_user)):
    contractor = await db.contractors.find_one({"id": cid, "user_id": user["user_id"]}, {"_id": 0})
    if not contractor:
        raise HTTPException(404, "Contractor not found")
    visits = await db.contractor_visits.find(
        {"contractor_id": cid, "user_id": user["user_id"]}, {"_id": 0}
    ).sort("date", 1).to_list(2000)
    payments = await db.contractor_payments.find(
        {"contractor_id": cid, "user_id": user["user_id"]}, {"_id": 0}
    ).sort("date", 1).to_list(2000)
    returns = await db.contractor_returns.find(
        {"contractor_id": cid, "user_id": user["user_id"]}, {"_id": 0}
    ).sort("date", 1).to_list(2000)
    total_workers = sum(v.get("workers_count", 0) for v in visits)
    total_paid = sum(p["amount"] for p in payments)
    total_returned = sum(r["amount"] for r in returns)
    net_paid = total_paid - total_returned

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, title=f"Contractor · {contractor['name']}")
    styles = getSampleStyleSheet()
    story = [
        Paragraph(f"Contractor Report — {contractor['name']}", styles["Title"]),
        Paragraph(f"Mobile: {contractor.get('mobile','—')}", styles["Normal"]),
        Paragraph(f"Generated: {now_utc().strftime('%Y-%m-%d %H:%M UTC')}", styles["Normal"]),
        Spacer(1, 12),
    ]
    summary = [
        ["Visits", "Total Workers", "Total Paid", "Returned", "Net Paid"],
        [len(visits), total_workers, f"Rs {total_paid}", f"Rs {total_returned}", f"Rs {round(net_paid,2)}"],
    ]
    t = Table(summary, hAlign="LEFT")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,0), colors.HexColor("#2f6b3b")),
        ("TEXTCOLOR", (0,0), (-1,0), colors.white),
        ("GRID", (0,0), (-1,-1), 0.5, colors.grey),
        ("PADDING", (0,0), (-1,-1), 6),
    ]))
    story.append(t)
    story.append(Spacer(1, 14))

    if visits:
        story.append(Paragraph("<b>Visits</b>", styles["Heading4"]))
        rows = [["Date", "Workers", "Field/Crop", "Notes"]]
        for v in visits:
            rows.append([v["date"], v.get("workers_count", 0), v.get("field_crop",""), v.get("notes","")])
        vt = Table(rows, hAlign="LEFT")
        vt.setStyle(TableStyle([
            ("BACKGROUND", (0,0), (-1,0), colors.HexColor("#eeeeee")),
            ("GRID", (0,0), (-1,-1), 0.25, colors.grey),
            ("FONTSIZE", (0,0), (-1,-1), 9),
            ("PADDING", (0,0), (-1,-1), 4),
        ]))
        story.append(vt)
        story.append(Spacer(1, 12))

    if payments or returns:
        story.append(Paragraph("<b>Payments & Returns</b>", styles["Heading4"]))
        rows = [["Date", "Type", "Amount", "Method", "Notes"]]
        for p in payments:
            rows.append([p["date"], "Payment", f"Rs {p['amount']}", p.get("method",""), p.get("notes","")])
        for r in returns:
            rows.append([r["date"], "Return", f"Rs {r['amount']}", r.get("method",""), r.get("notes","")])
        pt = Table(rows, hAlign="LEFT")
        pt.setStyle(TableStyle([
            ("BACKGROUND", (0,0), (-1,0), colors.HexColor("#eeeeee")),
            ("GRID", (0,0), (-1,-1), 0.25, colors.grey),
            ("FONTSIZE", (0,0), (-1,-1), 9),
            ("PADDING", (0,0), (-1,-1), 4),
        ]))
        story.append(pt)

    doc.build(story)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=contractor_{cid[:8]}.pdf"})

@api.get("/reports/contractor/{cid}/excel")
async def contractor_excel(cid: str, user: dict = Depends(get_current_user)):
    contractor = await db.contractors.find_one({"id": cid, "user_id": user["user_id"]}, {"_id": 0})
    if not contractor:
        raise HTTPException(404, "Contractor not found")
    visits = await db.contractor_visits.find(
        {"contractor_id": cid, "user_id": user["user_id"]}, {"_id": 0}
    ).sort("date", 1).to_list(2000)
    payments = await db.contractor_payments.find(
        {"contractor_id": cid, "user_id": user["user_id"]}, {"_id": 0}
    ).sort("date", 1).to_list(2000)
    returns = await db.contractor_returns.find(
        {"contractor_id": cid, "user_id": user["user_id"]}, {"_id": 0}
    ).sort("date", 1).to_list(2000)

    wb = Workbook()
    s1 = wb.active
    s1.title = "Summary"
    s1.append(["Contractor", contractor["name"]])
    s1.append(["Mobile", contractor.get("mobile", "")])
    s1.append(["Visits", len(visits)])
    s1.append(["Total Workers Brought", sum(v.get("workers_count", 0) for v in visits)])
    s1.append(["Total Paid", sum(p["amount"] for p in payments)])
    s1.append(["Total Returned", sum(r["amount"] for r in returns)])

    s2 = wb.create_sheet("Visits")
    s2.append(["Date", "Workers", "Field/Crop", "Notes"])
    for v in visits:
        s2.append([v["date"], v.get("workers_count", 0), v.get("field_crop",""), v.get("notes","")])

    s3 = wb.create_sheet("Payments")
    s3.append(["Date", "Amount", "Method", "Notes"])
    for p in payments:
        s3.append([p["date"], p["amount"], p.get("method",""), p.get("notes","")])

    s4 = wb.create_sheet("Returns")
    s4.append(["Date", "Amount", "Method", "Notes"])
    for r in returns:
        s4.append([r["date"], r["amount"], r.get("method",""), r.get("notes","")])

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=contractor_{cid[:8]}.xlsx"})

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

@api.get("/reports/contractor/{cid}/whatsapp")
async def contractor_whatsapp(cid: str, user: dict = Depends(get_current_user), lang: str = "en"):
    contractor = await db.contractors.find_one({"id": cid, "user_id": user["user_id"]}, {"_id": 0})
    if not contractor:
        raise HTTPException(404, "Contractor not found")
    visits = await db.contractor_visits.find(
        {"contractor_id": cid, "user_id": user["user_id"]}, {"_id": 0}
    ).sort("date", -1).to_list(500)
    payments = await db.contractor_payments.find(
        {"contractor_id": cid, "user_id": user["user_id"]}, {"_id": 0}
    ).sort("date", -1).to_list(500)
    returns = await db.contractor_returns.find(
        {"contractor_id": cid, "user_id": user["user_id"]}, {"_id": 0}
    ).sort("date", -1).to_list(500)
    total_workers = sum(v.get("workers_count", 0) for v in visits)
    total_paid = sum(p["amount"] for p in payments)
    total_returned = sum(r["amount"] for r in returns)
    net_paid = round(total_paid - total_returned, 2)

    recent_visits = visits[:5]
    recent_pays = payments[:5]

    if lang == "kn":
        lines = [
            f"ನಮಸ್ಕಾರ {contractor['name']},",
            "",
            f"ಒಟ್ಟು ಭೇಟಿಗಳು: {len(visits)}",
            f"ಒಟ್ಟು ಕಾರ್ಮಿಕರು: {total_workers}",
            f"ಒಟ್ಟು ಪಾವತಿ: ರೂ {total_paid}",
            f"ವಾಪಸಾತಿ: ರೂ {total_returned}",
            f"ನಿವ್ವಳ ಪಾವತಿ: ರೂ {net_paid}",
        ]
        if recent_visits:
            lines += ["", "ಇತ್ತೀಚಿನ ಭೇಟಿಗಳು:"]
            for v in recent_visits:
                lines.append(f"• {v['date']} — {v.get('workers_count', 0)} ಕಾರ್ಮಿಕರು ({v.get('field_crop','—')})")
        if recent_pays:
            lines += ["", "ಇತ್ತೀಚಿನ ಪಾವತಿಗಳು:"]
            for p in recent_pays:
                lines.append(f"• {p['date']} — ರೂ {p['amount']} ({p.get('method','')})")
    else:
        lines = [
            f"Hi {contractor['name']},",
            "",
            f"Total visits: {len(visits)}",
            f"Total workers brought: {total_workers}",
            f"Total paid: Rs {total_paid}",
            f"Returned: Rs {total_returned}",
            f"Net paid: Rs {net_paid}",
        ]
        if recent_visits:
            lines += ["", "Recent visits:"]
            for v in recent_visits:
                lines.append(f"• {v['date']} — {v.get('workers_count', 0)} workers ({v.get('field_crop','—')})")
        if recent_pays:
            lines += ["", "Recent payments:"]
            for p in recent_pays:
                lines.append(f"• {p['date']} — Rs {p['amount']} ({p.get('method','')})")
    return {"message": "\n".join(lines), "phone": contractor.get("mobile", "")}

# ---------------- Payments (Razorpay) ----------------
import razorpay
import hmac
import hashlib
import json as _json  # for webhook payload parsing

LIFETIME_PRICE = float(os.environ.get("LIFETIME_PRICE_INR", "499"))
_RAZORPAY_KEY_ID = os.environ.get("RAZORPAY_KEY_ID", "")
_RAZORPAY_KEY_SECRET = os.environ.get("RAZORPAY_KEY_SECRET", "")
_RAZORPAY_WEBHOOK_SECRET = os.environ.get("RAZORPAY_WEBHOOK_SECRET", "")

def _razorpay_client():
    if not (_RAZORPAY_KEY_ID and _RAZORPAY_KEY_SECRET):
        raise HTTPException(500, "Razorpay is not configured on the server")
    return razorpay.Client(auth=(_RAZORPAY_KEY_ID, _RAZORPAY_KEY_SECRET))

@api.post("/payments/order")
async def create_order(user: dict = Depends(get_current_user)):
    """Create a Razorpay order for the lifetime purchase."""
    client_rzp = _razorpay_client()
    amount_paise = int(LIFETIME_PRICE * 100)
    receipt = f"farmlog_{user['user_id'][:12]}_{int(now_utc().timestamp())}"[:40]
    order = client_rzp.order.create({
        "amount": amount_paise,
        "currency": "INR",
        "receipt": receipt,
        "payment_capture": 1,
        "notes": {"user_id": user["user_id"], "product": "lifetime"},
    })
    await db.payment_transactions.insert_one({
        "provider": "razorpay",
        "order_id": order["id"],
        "session_id": order["id"],  # backwards compat
        "user_id": user["user_id"],
        "amount": LIFETIME_PRICE,
        "currency": "INR",
        "status": "initiated",
        "payment_status": "pending",
        "created_at": now_utc().isoformat(),
        "updated_at": now_utc().isoformat(),
    })
    return {
        "order_id": order["id"],
        "amount": amount_paise,
        "currency": "INR",
        "key_id": _RAZORPAY_KEY_ID,
        "prefill": {
            "name": user.get("name", ""),
            "contact": user.get("mobile", ""),
            "email": user.get("email", "") or "",
        },
    }

class VerifyIn(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str

@api.post("/payments/verify")
async def verify_payment(payload: VerifyIn, user: dict = Depends(get_current_user)):
    """Verify Razorpay signature client-side (order|payment|signature triplet)."""
    expected = hmac.new(
        _RAZORPAY_KEY_SECRET.encode(),
        f"{payload.razorpay_order_id}|{payload.razorpay_payment_id}".encode(),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected, payload.razorpay_signature):
        raise HTTPException(400, "Invalid signature")

    txn = await db.payment_transactions.find_one(
        {"order_id": payload.razorpay_order_id, "user_id": user["user_id"]}, {"_id": 0}
    )
    if not txn:
        raise HTTPException(404, "Order not found")

    await db.payment_transactions.update_one(
        {"order_id": payload.razorpay_order_id},
        {"$set": {
            "payment_id": payload.razorpay_payment_id,
            "signature": payload.razorpay_signature,
            "status": "completed",
            "payment_status": "paid",
            "plan": "annual",
            "updated_at": now_utc().isoformat(),
        }},
    )
    # Extend subscription: if already active, add another year; else start from now.
    cur = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    existing_exp = cur.get("subscription_expires_at") if cur else None
    base = now_utc()
    if isinstance(existing_exp, str) and existing_exp:
        try:
            e = datetime.fromisoformat(existing_exp)
            if e.tzinfo is None: e = e.replace(tzinfo=timezone.utc)
            if e > base: base = e
        except Exception:
            pass
    new_expiry = (base + timedelta(days=365)).isoformat()
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {
            "is_paid": True,
            "paid_at": now_utc().isoformat(),
            "subscription_expires_at": new_expiry,
            "subscription_plan": "annual",
        }},
    )
    return {"ok": True, "payment_status": "paid", "subscription_expires_at": new_expiry}

@api.post("/webhook/razorpay")
async def razorpay_webhook(request: Request):
    """Optional webhook for out-of-band confirmation."""
    body = await request.body()
    if _RAZORPAY_WEBHOOK_SECRET:
        signature = request.headers.get("X-Razorpay-Signature", "")
        expected = hmac.new(
            _RAZORPAY_WEBHOOK_SECRET.encode(), body, hashlib.sha256
        ).hexdigest()
        if not hmac.compare_digest(expected, signature):
            raise HTTPException(400, "Invalid webhook signature")
    try:
        event = json.loads(body.decode() or "{}")
    except Exception:
        raise HTTPException(400, "Invalid webhook payload")
    payload = ((event.get("payload") or {}).get("payment") or {}).get("entity") or {}
    order_id = payload.get("order_id")
    if event.get("event") == "payment.captured" and order_id:
        txn = await db.payment_transactions.find_one({"order_id": order_id}, {"_id": 0})
        if txn:
            await db.payment_transactions.update_one(
                {"order_id": order_id},
                {"$set": {"status": "completed", "payment_status": "paid",
                          "payment_id": payload.get("id"),
                          "plan": "annual",
                          "updated_at": now_utc().isoformat()}},
            )
            cur = await db.users.find_one({"user_id": txn["user_id"]}, {"_id": 0})
            existing_exp = (cur or {}).get("subscription_expires_at")
            base = now_utc()
            if isinstance(existing_exp, str) and existing_exp:
                try:
                    e = datetime.fromisoformat(existing_exp)
                    if e.tzinfo is None: e = e.replace(tzinfo=timezone.utc)
                    if e > base: base = e
                except Exception:
                    pass
            new_expiry = (base + timedelta(days=365)).isoformat()
            await db.users.update_one(
                {"user_id": txn["user_id"]},
                {"$set": {"is_paid": True, "paid_at": now_utc().isoformat(),
                          "subscription_expires_at": new_expiry,
                          "subscription_plan": "annual"}},
            )
    return {"ok": True}

# ---------------- Payments (Stripe - kept for backwards compat, unused by UI) ----------------

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

# ---------------- Owner Portal (RBAC-restricted) ----------------
class OwnerAdIn(BaseModel):
    image_url: str  # data URL or public URL
    title: Optional[str] = ""
    subtitle: Optional[str] = ""
    cta_label: Optional[str] = ""
    cta_url: Optional[str] = ""
    districts: Optional[List[str]] = None  # None = all districts
    active: bool = True

@api.get("/owner/users")
async def owner_users(user: dict = Depends(require_owner)):
    rows = await db.users.find(
        {}, {"_id": 0, "user_id": 1, "name": 1, "mobile": 1, "email": 1,
             "district": 1, "language": 1, "role": 1, "is_paid": 1,
             "trial_start": 1, "created_at": 1},
    ).sort("created_at", -1).to_list(2000)
    return rows

@api.get("/owner/analytics/districts")
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

@api.get("/owner/ads")
async def owner_ads_list(user: dict = Depends(require_owner)):
    rows = await db.ads.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return rows

@api.post("/owner/ads")
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

@api.delete("/owner/ads/{aid}")
async def owner_ads_delete(aid: str, user: dict = Depends(require_owner)):
    res = await db.ads.delete_one({"id": aid})
    if res.deleted_count == 0:
        raise HTTPException(404, "Ad not found")
    return {"ok": True}

@api.patch("/owner/ads/{aid}")
async def owner_ads_toggle(aid: str, active: bool, user: dict = Depends(require_owner)):
    res = await db.ads.update_one({"id": aid}, {"$set": {"active": active}})
    if res.matched_count == 0:
        raise HTTPException(404, "Ad not found")
    return {"ok": True}

@api.get("/owner/feedback")
async def owner_feedback(user: dict = Depends(require_owner)):
    rows = await db.feedback.find({}, {"_id": 0}).sort("created_at", -1).to_list(2000)
    return rows

# ---------------- Health ----------------
@api.get("/")
async def root():
    return {"status": "ok", "app": "Lekka Patra"}

@api.get("/health")
async def health():
    """Lightweight health probe. Verifies DB reachability with a short ping.
    Returns 200 when healthy, 503 when the DB is unreachable so uptime
    monitors can flag the incident."""
    try:
        await client.admin.command("ping")
        return {"status": "ok", "db": "up"}
    except Exception as e:
        logger.warning("health check db down: %s", e)
        return JSONResponse(
            status_code=503,
            content={"status": "degraded", "db": "down", "error": str(e)[:200]},
        )

app.include_router(api)

# ---- Global exception hardening ----
from fastapi.exceptions import RequestValidationError
from pymongo.errors import PyMongoError, ServerSelectionTimeoutError

@app.exception_handler(ServerSelectionTimeoutError)
async def _mongo_timeout_handler(request: Request, exc: ServerSelectionTimeoutError):
    logger.error("mongo timeout on %s: %s", request.url.path, exc)
    return JSONResponse(
        status_code=503,
        content={"detail": "Database temporarily unavailable. Please retry."},
    )

@app.exception_handler(PyMongoError)
async def _mongo_error_handler(request: Request, exc: PyMongoError):
    logger.error("mongo error on %s: %s", request.url.path, exc)
    return JSONResponse(
        status_code=503,
        content={"detail": "Database error. Please retry."},
    )

@app.exception_handler(Exception)
async def _unhandled_exception_handler(request: Request, exc: Exception):
    # Preserve HTTPException status codes handled by FastAPI's built-in handler.
    logger.exception("unhandled error on %s: %s", request.url.path, exc)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

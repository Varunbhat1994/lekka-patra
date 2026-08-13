"""Payments — Razorpay (active) and Stripe (legacy, unused by UI).

The Razorpay flow (order → verify → optional webhook) is the live
subscription path. Stripe endpoints are preserved bit-for-bit because
their import (`emergentintegrations.payments.stripe.checkout`) still
loads at module import time and `payment_transactions.session_id` is
their idempotency key.
"""
import hmac
import hashlib
import json
import logging
import os
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

import razorpay
from emergentintegrations.payments.stripe.checkout import (
    StripeCheckout, CheckoutSessionRequest,
)

from core.database import db
from security.authentication import get_current_user


router = APIRouter()
logger = logging.getLogger("farmlog")


def now_utc():
    return datetime.now(timezone.utc)


# ---------------- Payments (Razorpay) ----------------
import json as _json  # for webhook payload parsing

LIFETIME_PRICE = float(os.environ.get("LIFETIME_PRICE_INR", "499"))
_RAZORPAY_KEY_ID = os.environ.get("RAZORPAY_KEY_ID", "")
_RAZORPAY_KEY_SECRET = os.environ.get("RAZORPAY_KEY_SECRET", "")
_RAZORPAY_WEBHOOK_SECRET = os.environ.get("RAZORPAY_WEBHOOK_SECRET", "")

def _razorpay_client():
    if not (_RAZORPAY_KEY_ID and _RAZORPAY_KEY_SECRET):
        raise HTTPException(500, "Razorpay is not configured on the server")
    return razorpay.Client(auth=(_RAZORPAY_KEY_ID, _RAZORPAY_KEY_SECRET))

@router.post("/payments/order")
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

@router.post("/payments/verify")
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

@router.post("/webhook/razorpay")
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

@router.post("/payments/checkout")
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

@router.get("/payments/status/{session_id}")
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

@router.post("/webhook/stripe")
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


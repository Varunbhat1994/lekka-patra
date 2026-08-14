"""Authorization and access-control.

Implements:
    - the paywall / trial gate: `compute_access`, `require_write_access`
    - role-based owner checks: `is_owner`, `require_owner`,
      `_promote_owner_if_needed`
    - env-driven owner identity resolvers: `_owner_mobile`, `_owner_email`

All computation here is deterministic and read-only against the shared
Mongo `db` handle. Behavior is preserved bit-for-bit from the original
implementation in server.py.
"""
import os
from datetime import datetime, timezone
from typing import Optional

from fastapi import Depends, HTTPException

from core.database import db
from security.authentication import get_current_user
from security.utils import _normalize_mobile


TRIAL_DAYS = 15


# Phase 3 free-model pivot: when FREE_MODE=1 (default), the trial/subscription
# gate is disabled — every authenticated user has full write access. Payment
# routes (routes/payments.py) and subscription state fields on the user record
# remain untouched so subscription can be re-enabled by setting FREE_MODE=0.
def _free_mode_enabled() -> bool:
    return (os.environ.get("FREE_MODE", "1") or "1").strip() not in ("0", "false", "False", "")


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def compute_access(user: dict) -> dict:
    """Return trial/subscription state. Annual subscription supersedes trial.

    In FREE_MODE (default), always returns unlocked / paid-equivalent access
    so no client-side or server-side gate can block normal app functionality.
    Subscription/trial fields on the user document remain untouched and can be
    reactivated by flipping FREE_MODE=0.
    """
    if _free_mode_enabled():
        return {
            "is_paid": True,
            "trial_active": False,
            "trial_days_left": 0,
            "locked": False,
            "subscription_active": True,
            "subscription_days_left": 9999,
            "free_mode": True,
        }
    # Active subscription?
    sub_exp = user.get("subscription_expires_at")
    if isinstance(sub_exp, str) and sub_exp:
        try:
            sub_exp_dt = datetime.fromisoformat(sub_exp)
            if sub_exp_dt.tzinfo is None:
                sub_exp_dt = sub_exp_dt.replace(tzinfo=timezone.utc)
            if sub_exp_dt > _now_utc():
                days_left = max(0, int((sub_exp_dt - _now_utc()).total_seconds() // 86400))
                return {
                    "is_paid": True,
                    "trial_active": False,
                    "trial_days_left": 0,
                    "locked": False,
                    "subscription_active": True,
                    "subscription_days_left": days_left,
                    "subscription_expires_at": sub_exp,
                }
        except Exception:
            pass
    # Legacy lifetime users
    if user.get("is_paid") and not user.get("subscription_expires_at"):
        return {"is_paid": True, "trial_active": False, "trial_days_left": 0, "locked": False,
                "subscription_active": True, "subscription_days_left": 9999}
    trial_start = user.get("trial_start")
    if isinstance(trial_start, str):
        trial_start = datetime.fromisoformat(trial_start)
    if trial_start and trial_start.tzinfo is None:
        trial_start = trial_start.replace(tzinfo=timezone.utc)
    if not trial_start:
        return {"is_paid": False, "trial_active": False, "trial_days_left": 0, "locked": True,
                "subscription_active": False, "subscription_days_left": 0}
    elapsed = (_now_utc() - trial_start).total_seconds()
    days_left = max(0, TRIAL_DAYS - int(elapsed // 86400))
    trial_active = elapsed < TRIAL_DAYS * 86400
    return {"is_paid": False, "trial_active": trial_active,
            "trial_days_left": days_left, "locked": not trial_active,
            "subscription_active": False, "subscription_days_left": 0}


async def require_write_access(user: dict = Depends(get_current_user)) -> dict:
    acc = compute_access(user)
    if acc["locked"]:
        raise HTTPException(status_code=402, detail="Trial expired. Purchase required.")
    return user


# ---------------- Owner (RBAC) ----------------

def _owner_mobile() -> str:
    """Normalized mobile of the primary admin. Empty string disables the portal."""
    return _normalize_mobile(os.environ.get("OWNER_MOBILE", ""))


def _owner_email() -> str:
    return (os.environ.get("OWNER_EMAIL", "") or "").strip().lower()


def is_owner(user: dict) -> bool:
    if user.get("role") == "owner":
        return True
    om = _owner_mobile()
    if om and user.get("mobile") == om:
        return True
    oe = _owner_email()
    if oe and (user.get("email") or "").strip().lower() == oe:
        return True
    return False


async def require_owner(user: dict = Depends(get_current_user)) -> dict:
    if not is_owner(user):
        raise HTTPException(status_code=403, detail="Forbidden")
    return user


async def _promote_owner_if_needed(
    user_id: str,
    mobile: Optional[str] = None,
    email: Optional[str] = None,
) -> None:
    """Idempotently mark the OWNER_MOBILE or OWNER_EMAIL user with role=owner."""
    om = _owner_mobile()
    oe = _owner_email()
    if (om and mobile == om) or (oe and (email or "").strip().lower() == oe):
        await db.users.update_one({"user_id": user_id}, {"$set": {"role": "owner"}})

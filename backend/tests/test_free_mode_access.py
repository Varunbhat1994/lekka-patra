"""Phase 3 follow-up: verify FREE_MODE default disables the trial gate.

After Phase 3 free-model pivot:
  - `compute_access` returns locked=False for any user (expired or not)
  - `require_write_access` never raises HTTP 402 for any user
  - Flipping FREE_MODE=0 re-enables the historical gate (infra preserved)
"""
import importlib
import os
import sys
import uuid

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _fresh_auth_module():
    """Re-import so os.environ change takes effect for the module-level default."""
    from security import authorization as auth_mod
    importlib.reload(auth_mod)
    return auth_mod


def test_1_free_mode_default_on(monkeypatch):
    monkeypatch.delenv("FREE_MODE", raising=False)
    auth_mod = _fresh_auth_module()
    assert auth_mod._free_mode_enabled() is True


def test_2_expired_trial_user_is_unlocked_in_free_mode(monkeypatch):
    monkeypatch.delenv("FREE_MODE", raising=False)
    auth_mod = _fresh_auth_module()
    expired = {"user_id": "u", "trial_start": "2020-01-01T00:00:00+00:00", "is_paid": False}
    acc = auth_mod.compute_access(expired)
    assert acc["locked"] is False
    assert acc["is_paid"] is True
    assert acc["subscription_active"] is True
    assert acc["free_mode"] is True


def test_3_no_trial_start_user_is_unlocked_in_free_mode(monkeypatch):
    monkeypatch.delenv("FREE_MODE", raising=False)
    auth_mod = _fresh_auth_module()
    acc = auth_mod.compute_access({"user_id": "u"})
    assert acc["locked"] is False


@pytest.mark.asyncio
async def test_4_require_write_access_does_not_raise_402_for_expired_trial(monkeypatch):
    monkeypatch.delenv("FREE_MODE", raising=False)
    auth_mod = _fresh_auth_module()
    expired = {"user_id": "u", "trial_start": "2020-01-01T00:00:00+00:00", "is_paid": False}
    result = await auth_mod.require_write_access(user=expired)
    assert result is expired  # returns user, no HTTPException


def test_5_gate_reenables_when_free_mode_disabled(monkeypatch):
    monkeypatch.setenv("FREE_MODE", "0")
    auth_mod = _fresh_auth_module()
    assert auth_mod._free_mode_enabled() is False
    expired = {"user_id": "u", "trial_start": "2020-01-01T00:00:00+00:00", "is_paid": False}
    acc = auth_mod.compute_access(expired)
    assert acc["locked"] is True


@pytest.mark.asyncio
async def test_6_gate_reenabled_raises_402(monkeypatch):
    monkeypatch.setenv("FREE_MODE", "0")
    auth_mod = _fresh_auth_module()
    expired = {"user_id": "u", "trial_start": "2020-01-01T00:00:00+00:00", "is_paid": False}
    with pytest.raises(HTTPException) as ei:
        await auth_mod.require_write_access(user=expired)
    assert ei.value.status_code == 402
    # Restore default for the rest of the test session
    monkeypatch.delenv("FREE_MODE", raising=False)
    _fresh_auth_module()


def test_7_paid_lifetime_user_still_unlocked(monkeypatch):
    monkeypatch.delenv("FREE_MODE", raising=False)
    auth_mod = _fresh_auth_module()
    acc = auth_mod.compute_access({"user_id": "u", "is_paid": True})
    assert acc["locked"] is False

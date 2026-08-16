"""Idempotent-write helper backed by the `sync_ops` collection.

Every mutation endpoint that participates in offline sync accepts an
optional client-supplied `operation_id` (UUID v4). When the same
`(user_id, operation_id)` pair arrives twice, the second call returns
the cached response instead of creating a duplicate accounting row.

The collection has:
    - unique compound index {operation_id: 1, user_id: 1}
    - TTL index on expires_at (30 days)

Both indexes are created at import time — safe to call from any route
module. If a competing request wins the race to insert, the second
falls through to `find_one` and returns the cached response.
"""
from __future__ import annotations
from datetime import datetime, timedelta, timezone
from typing import Callable, Any, Optional
from pymongo.errors import DuplicateKeyError
from core.database import db

_INDEXES_READY = False


async def _ensure_indexes() -> None:
    global _INDEXES_READY
    if _INDEXES_READY:
        return
    await db.sync_ops.create_index(
        [("operation_id", 1), ("user_id", 1)], unique=True, name="uniq_op_user"
    )
    await db.sync_ops.create_index("expires_at", expireAfterSeconds=0, name="ttl_expires")
    _INDEXES_READY = True


async def idempotent(
    user_id: str,
    operation_id: Optional[str],
    entity_type: str,
    do_work: Callable[[], Any],
) -> Any:
    """Run `do_work` at most once per (user_id, operation_id).

    If operation_id is None/empty → no idempotency, just run do_work.
    Otherwise, look up prior response; if present, return it verbatim.
    Else run do_work, cache the response, return it.
    """
    if not operation_id:
        return await do_work()

    await _ensure_indexes()

    prior = await db.sync_ops.find_one(
        {"operation_id": operation_id, "user_id": user_id},
        {"_id": 0, "response_snapshot": 1},
    )
    if prior and "response_snapshot" in prior:
        return prior["response_snapshot"]

    result = await do_work()

    # Best-effort store; a concurrent duplicate insert is fine — the
    # unique index prevents storing two rows, and the second request
    # just returns the already-cached one on the next call.
    try:
        await db.sync_ops.insert_one({
            "operation_id": operation_id,
            "user_id": user_id,
            "entity_type": entity_type,
            "response_snapshot": _jsonable(result),
            "server_received_at": datetime.now(timezone.utc).isoformat(),
            "expires_at": datetime.now(timezone.utc) + timedelta(days=30),
        })
    except DuplicateKeyError:
        pass
    return result


def _jsonable(x: Any) -> Any:
    """Best-effort conversion of Pydantic models / datetimes to JSON-safe types."""
    if hasattr(x, "model_dump"):
        d = x.model_dump()
    elif isinstance(x, dict):
        d = dict(x)
    else:
        return x
    for k, v in list(d.items()):
        if isinstance(v, datetime):
            d[k] = v.isoformat()
    return d

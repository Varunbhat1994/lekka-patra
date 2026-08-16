// Sync engine: drains SYNC_QUEUE when the device is online.
//
// Triggers (Step 2 §2/§3):
//   1. App boot (called from AppContext once accountScope resolves).
//   2. online event.
//   3. document.visibilitychange → visible.
//   4. Manual "Sync now" tap (exposed via drainQueue export).
//
// Each op is drained serially per account_scope so the backend's
// (user_id, worker_id, date) attendance upsert cannot race with itself.
// Retries are safe because every op carries a unique operation_id
// that the backend's sync_ops idempotency ledger honors.
//
// Backoff: 5s → 15s → 60s → 5m → 30m capped. 4xx dependency errors
// (404/409/403) flip the op to `requires_review` immediately — no
// silent drop. 401 pauses draining globally until reauth.

import axios from "axios";
import {
  getDB, listByScope, put, findByServerId, STORES,
} from "./index";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const BACKOFF_MS = [5_000, 15_000, 60_000, 5 * 60_000, 30 * 60_000];

const running = new Set();          // account_scopes currently draining

function backoffFor(retryCount) {
  return BACKOFF_MS[Math.min(retryCount, BACKOFF_MS.length - 1)];
}
function nowIso() { return new Date().toISOString(); }
function nextIso(ms) { return new Date(Date.now() + ms).toISOString(); }

/**
 * Drain pending queue operations for one account_scope. Serial.
 * Returns {attempted, synced, failed, requires_review}.
 * No-op if the scope is already draining.
 */
export async function drainQueue(accountScope) {
  if (!accountScope) return { attempted: 0, synced: 0, failed: 0, requires_review: 0 };
  if (running.has(accountScope)) return { attempted: 0, synced: 0, failed: 0, requires_review: 0 };
  running.add(accountScope);
  const summary = { attempted: 0, synced: 0, failed: 0, requires_review: 0 };
  try {
    const all = await listByScope(STORES.SYNC_QUEUE, accountScope);
    // Order by local_created_at ascending — respects the order the
    // user actually made the changes. Parents are enqueued before
    // children so this ordering is safe for the create→attendance path.
    const drainable = all
      .filter((op) => op.sync_status === "pending" || op.sync_status === "failed")
      .filter((op) => !op.next_retry_at || op.next_retry_at <= nowIso())
      .sort((a, b) => (a.local_created_at || "").localeCompare(b.local_created_at || ""));

    // Track local_id → server_id remapping so a child op referencing
    // a locally-created worker/contractor can be rewritten before send.
    const idMap = new Map();
    // Preload existing local→server mappings from IDB so an ATTENDANCE
    // op created after its parent WORKER already synced also works.
    for (const store of [STORES.WORKERS, STORES.CONTRACTORS]) {
      const rows = await listByScope(store, accountScope);
      for (const r of rows) {
        if (r.local_id && r.server_id && r.local_id !== r.server_id) {
          idMap.set(r.local_id, r.server_id);
        }
      }
    }

    for (const op of drainable) {
      summary.attempted += 1;
      // Mark syncing before any network attempt so a refresh mid-flight
      // resumes correctly (worst case we retry — safe via operation_id).
      await putQueue(accountScope, { ...op, sync_status: "syncing", last_attempt_at: nowIso() });
      try {
        const result = await executeOp(accountScope, op, idMap);
        // Success — mark synced, apply id remap if server assigned one.
        await putQueue(accountScope, {
          ...op,
          sync_status: "synced",
          server_received_at: nowIso(),
          last_error: null,
        });
        if (op.local_ref && result?.id && result.id !== op.local_ref) {
          idMap.set(op.local_ref, result.id);
          await mirrorServerId(accountScope, op.entity_type, op.local_ref, result.id, result);
        }
        // For successful delete ops, drop the local mirror so lists
        // don't keep showing a "pending_delete" ghost row forever.
        if (op.operation_type === "delete" && op.local_ref) {
          const store =
            op.entity_type === "advances" ? STORES.ADVANCES
            : op.entity_type === "advance_returns" ? STORES.ADVANCE_RETURNS
            : op.entity_type === "workers" ? STORES.WORKERS
            : op.entity_type === "contractors" ? STORES.CONTRACTORS
            : op.entity_type === "attendance" ? STORES.ATTENDANCE
            : op.entity_type === "contractor_visits" ? STORES.CONTRACTOR_VISITS
            : op.entity_type === "contractor_payments" ? STORES.CONTRACTOR_PAYMENTS
            : op.entity_type === "contractor_returns" ? STORES.CONTRACTOR_RETURNS
            : null;
          if (store) {
            const db = await getDB();
            await db.delete(store, op.local_ref);
          }
        }
        summary.synced += 1;
      } catch (err) {
        const status = err?.response?.status;
        const isConflict = status && [400, 403, 404, 409].includes(status);
        const isAuth = status === 401;
        const nextRetry = (op.retry_count || 0) + 1;
        if (isConflict) {
          await putQueue(accountScope, {
            ...op,
            sync_status: "requires_review",
            retry_count: nextRetry,
            last_error: { status, detail: safeDetail(err) },
          });
          summary.requires_review += 1;
        } else if (isAuth) {
          // Global pause — leave as pending, do not increment retry.
          await putQueue(accountScope, { ...op, sync_status: "pending" });
          break;
        } else {
          await putQueue(accountScope, {
            ...op,
            sync_status: "failed",
            retry_count: nextRetry,
            last_error: { status: status || null, detail: safeDetail(err) },
            next_retry_at: nextIso(backoffFor(nextRetry - 1)),
          });
          summary.failed += 1;
        }
      }
    }
    // Update sync_metadata
    await put(STORES.SYNC_METADATA, accountScope, {
      account_scope: accountScope,
      last_sync_at: nowIso(),
      last_summary: summary,
    });
    return summary;
  } finally {
    running.delete(accountScope);
  }
}

async function executeOp(scope, op, idMap) {
  const { entity_type, operation_type, payload = {}, target_server_id } = op;

  // Rewrite parent references from local_id → server_id if we've seen
  // the mapping (either preloaded from IDB or built earlier in this drain).
  const rewritten = { ...payload };
  if (rewritten.worker_id && idMap.has(rewritten.worker_id)) {
    rewritten.worker_id = idMap.get(rewritten.worker_id);
  }
  if (rewritten.contractor_id && idMap.has(rewritten.contractor_id)) {
    rewritten.contractor_id = idMap.get(rewritten.contractor_id);
  }
  // Attach the queue's operation_id as the client-idempotency key.
  rewritten.operation_id = op.operation_id;

  const serverId = idMap.get(target_server_id) || target_server_id;

  if (entity_type === "workers") {
    if (operation_type === "create") return (await axios.post(`${API}/workers`, rewritten)).data;
    if (operation_type === "update") return (await axios.put(`${API}/workers/${serverId}`, rewritten)).data;
  }
  if (entity_type === "contractors") {
    if (operation_type === "create") return (await axios.post(`${API}/contractors`, rewritten)).data;
    if (operation_type === "update") return (await axios.put(`${API}/contractors/${serverId}`, rewritten)).data;
  }
  if (entity_type === "attendance") {
    // POST /attendance handles both insert and update via upsert.
    return (await axios.post(`${API}/attendance`, rewritten)).data;
  }
  if (entity_type === "advances") {
    if (operation_type === "create") return (await axios.post(`${API}/advances`, rewritten)).data;
    if (operation_type === "delete") {
      await axios.delete(`${API}/advances/${serverId}`);
      return { ok: true };
    }
  }
  if (entity_type === "advance_returns") {
    if (operation_type === "create") return (await axios.post(`${API}/returns`, rewritten)).data;
    if (operation_type === "delete") {
      await axios.delete(`${API}/returns/${serverId}`);
      return { ok: true };
    }
  }
  if (entity_type === "settlements") {
    // POST /settlements will revalidate against the live ledger when
    // the payload carries client_earned_snapshot / client_advance_snapshot.
    // A mismatch surfaces as HTTP 409 → drainQueue marks the op as
    // requires_review and preserves the draft row for manual review.
    if (operation_type === "create") return (await axios.post(`${API}/settlements`, rewritten)).data;
  }
  if (entity_type === "contractor_visits") {
    if (operation_type === "create") return (await axios.post(`${API}/contractor-visits`, rewritten)).data;
    if (operation_type === "delete") {
      await axios.delete(`${API}/contractor-visits/${serverId}`);
      return { ok: true };
    }
  }
  if (entity_type === "contractor_payments") {
    if (operation_type === "create") return (await axios.post(`${API}/contractor-payments`, rewritten)).data;
    if (operation_type === "delete") {
      await axios.delete(`${API}/contractor-payments/${serverId}`);
      return { ok: true };
    }
  }
  if (entity_type === "contractor_returns") {
    if (operation_type === "create") return (await axios.post(`${API}/contractor-returns`, rewritten)).data;
    if (operation_type === "delete") {
      await axios.delete(`${API}/contractor-returns/${serverId}`);
      return { ok: true };
    }
  }
  throw new Error(`unknown op ${entity_type}/${operation_type}`);
}

async function putQueue(scope, op) {
  await put(STORES.SYNC_QUEUE, scope, op);
}

async function mirrorServerId(scope, entityType, localId, serverId, serverRow) {
  const storeName = entityType === "workers" ? STORES.WORKERS
                  : entityType === "contractors" ? STORES.CONTRACTORS
                  : entityType === "attendance" ? STORES.ATTENDANCE
                  : entityType === "advances" ? STORES.ADVANCES
                  : entityType === "advance_returns" ? STORES.ADVANCE_RETURNS
                  : entityType === "settlements" ? STORES.SETTLEMENTS
                  : entityType === "contractor_visits" ? STORES.CONTRACTOR_VISITS
                  : entityType === "contractor_payments" ? STORES.CONTRACTOR_PAYMENTS
                  : entityType === "contractor_returns" ? STORES.CONTRACTOR_RETURNS
                  : null;
  if (!storeName) return;
  const db = await getDB();
  const cached = await db.get(storeName, localId);
  if (!cached) return;
  const merged = { ...cached, ...(serverRow || {}), local_id: localId, server_id: serverId, sync_status: "synced" };
  await put(storeName, scope, merged);
}

function safeDetail(err) {
  try {
    // FastAPI HTTPException(detail=dict) surfaces as
    //   err.response.data.detail = {code, ...}
    // Preserve the object VERBATIM so downstream review UIs can render
    // structured fields (client/server sub-dicts). Only stringify when
    // detail is a plain string.
    const detail = err?.response?.data?.detail;
    if (detail && typeof detail === "object") return detail;
    if (typeof detail === "string") return detail.slice(0, 300);
    return String(err?.message || "unknown").slice(0, 300);
  } catch { return "error"; }
}

/**
 * Install lifecycle triggers: online, visibilitychange, boot.
 * Returns an unsubscribe function.
 */
export function installSyncTriggers(getScope) {
  const drainNow = () => {
    const scope = getScope();
    if (!scope || typeof navigator !== "undefined" && !navigator.onLine) return;
    drainQueue(scope).catch(() => {});
  };
  window.addEventListener("online", drainNow);
  const onVis = () => { if (document.visibilityState === "visible") drainNow(); };
  document.addEventListener("visibilitychange", onVis);
  // Kick once on install (boot)
  drainNow();
  return () => {
    window.removeEventListener("online", drainNow);
    document.removeEventListener("visibilitychange", onVis);
  };
}

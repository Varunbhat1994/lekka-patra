// Account-scoped IndexedDB repository helpers.
//
// Every function here REQUIRES an `account_scope` argument and refuses
// to operate without one (or with an empty string). This is the
// primary on-device tenant guard — combined with the composite
// `[account_scope, ...]` indexes declared in schema.js, cross-account
// reads become mechanically impossible in normal application code.
//
// The backend remains the ultimate source of truth: every write MUST
// still round-trip through ownership-scoped endpoints. These helpers
// only cache/queue.

import { getDB } from "./db";
import { STORES } from "./schema";

// Stores whose keyPath is `account_scope` itself — for these, a
// standard get(scope) returns the single row directly.
const SINGLE_ROW_STORES = new Set([
  STORES.DASHBOARD_CACHE,
  STORES.SYNC_METADATA,
  STORES.LOCAL_ACCOUNTS,
]);

function requireScope(scope) {
  if (typeof scope !== "string" || scope.length === 0) {
    throw new Error("[offline/repo] account_scope required");
  }
}

/**
 * Generate a client-side UUID (v4). Uses the browser's crypto.randomUUID
 * where available (universally in modern engines).
 */
export function uuid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback (never expected to run in production; browsers we support
  // ship randomUUID).
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Put a single row into a store. Adds/refreshes `local_updated_at`;
 * preserves `local_created_at` if already present. Returns the stored
 * row.
 */
export async function put(store, scope, row) {
  requireScope(scope);
  if (!row || typeof row !== "object") {
    throw new Error("[offline/repo.put] row required");
  }
  const db = await getDB();
  const enriched = {
    ...row,
    account_scope: scope,
    local_created_at: row.local_created_at || nowIso(),
    local_updated_at: nowIso(),
  };
  await db.put(store, enriched);
  return enriched;
}

/**
 * Bulk put — one transaction, N rows. Used by hydration steps to
 * populate a store from a fetched list.
 */
export async function putAll(store, scope, rows) {
  requireScope(scope);
  if (!Array.isArray(rows)) throw new Error("[offline/repo.putAll] rows array required");
  if (rows.length === 0) return 0;
  const db = await getDB();
  const tx = db.transaction(store, "readwrite");
  const now = nowIso();
  await Promise.all(
    rows.map((r) =>
      tx.store.put({
        ...r,
        account_scope: scope,
        local_created_at: r.local_created_at || now,
        local_updated_at: now,
      })
    )
  );
  await tx.done;
  return rows.length;
}

/**
 * List all rows in a store scoped to `scope`. Uses `by_scope` index
 * where available; for single-row stores keyed on account_scope, this
 * returns an array of 0 or 1 rows.
 */
export async function listByScope(store, scope) {
  requireScope(scope);
  const db = await getDB();
  if (SINGLE_ROW_STORES.has(store)) {
    const row = await db.get(store, scope);
    return row ? [row] : [];
  }
  return db.getAllFromIndex(store, "by_scope", scope);
}

/**
 * Return a single account-scoped row keyed on account_scope
 * (dashboard_cache, sync_metadata, local_accounts).
 */
export async function getSingle(store, scope) {
  requireScope(scope);
  if (!SINGLE_ROW_STORES.has(store)) {
    throw new Error(`[offline/repo.getSingle] ${store} is not a single-row store`);
  }
  const db = await getDB();
  return (await db.get(store, scope)) || null;
}

/**
 * Get a row by (scope, server_id) using the `by_scope_server` index
 * present on every cached-entity store. Returns null when absent.
 */
export async function findByServerId(store, scope, serverId) {
  requireScope(scope);
  if (!serverId) return null;
  const db = await getDB();
  const row = await db.getFromIndex(store, "by_scope_server", [scope, serverId]);
  return row || null;
}

/**
 * Attendance-specific lookup: (scope, worker_id, date). Mirrors the
 * backend app-layer upsert key. Returns the single row or null.
 */
export async function findAttendance(scope, workerId, date) {
  requireScope(scope);
  if (!workerId || !date) return null;
  const db = await getDB();
  const row = await db.getFromIndex(
    STORES.ATTENDANCE,
    "by_scope_worker_date",
    [scope, workerId, date]
  );
  return row || null;
}

/**
 * Delete a row by local primary key. Only touches this device's copy —
 * for delete-on-server operations, enqueue a delete op via ./repo.js
 * queue helpers (to be added in the sync-engine checkpoint).
 */
export async function deleteByKey(store, key) {
  const db = await getDB();
  await db.delete(store, key);
}

/**
 * Wipe every row in every store for an account_scope. Used by:
 *   - "Log out and clear local data" (only invoked with an explicit
 *     confirmation UI; not silent)
 *   - test cleanup
 * Does NOT delete rows belonging to any OTHER account.
 */
export async function wipeAccount(scope) {
  requireScope(scope);
  const db = await getDB();
  const storeNames = Array.from(db.objectStoreNames);
  const tx = db.transaction(storeNames, "readwrite");
  for (const name of storeNames) {
    const store = tx.objectStore(name);
    if (SINGLE_ROW_STORES.has(name)) {
      await store.delete(scope);
      continue;
    }
    if (!store.indexNames.contains("by_scope")) continue;
    let cursor = await store.index("by_scope").openCursor(IDBKeyRange.only(scope));
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
  }
  await tx.done;
}

/**
 * Count rows in a store for one account (used by the offline status
 * pill "N pending" indicator and by tests).
 */
export async function countByScope(store, scope) {
  requireScope(scope);
  const db = await getDB();
  if (SINGLE_ROW_STORES.has(store)) {
    const row = await db.get(store, scope);
    return row ? 1 : 0;
  }
  return db.countFromIndex(store, "by_scope", scope);
}

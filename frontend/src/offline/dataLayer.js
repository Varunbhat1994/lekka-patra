// Offline-first data layer for Workers, Contractors, Attendance.
//
// Every function is account-scoped. Reads mirror server responses into
// IDB on success; read from IDB on network failure. Writes attempt the
// server first; on failure they persist to IDB and enqueue a sync
// operation with a unique operation_id.
//
// LOCKED SEMANTICS (do not weaken):
//   * Attendance daily_rate_snapshot: on OFFLINE saves, the wage cached
//     in workers[worker_id].daily_rate at the moment of submit is
//     captured and persisted BOTH on the local IDB row and on the
//     queue op's payload as `daily_rate_snapshot`. On ONLINE saves,
//     the client does NOT send daily_rate_snapshot — the backend's
//     existing "capture worker.daily_rate on insert" path stands
//     unchanged. There is no `daily_rate_snapshot_local` field.
//   * Attendance idempotency reuses the existing (user_id, worker_id,
//     date) app-layer upsert on the backend. On the client, we look up
//     any existing row via the by_scope_worker_date IDB index and
//     update it in place — never a duplicate local row.
//   * Every function's first argument is accountScope; helpers in
//     repo.js throw if the scope is missing. accountScope must be the
//     one AppContext derived from /auth/me — never a UI value.

import axios from "axios";
import {
  put, putAll, listByScope, findByServerId, findAttendance, uuid, STORES,
  deleteByKey,
} from "./index";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const nowIso = () => new Date().toISOString();

function requireScope(scope) {
  if (!scope) throw new Error("[offline/dataLayer] account_scope required");
}

/**
 * Persist a queue op. Never overwrites an existing operation_id.
 * The queue schema matches what post-offline-storage-layer declared.
 */
async function enqueue(scope, entity_type, operation_type, payload, extras = {}) {
  const op = {
    operation_id: uuid(),
    entity_type,
    operation_type,
    payload,
    depends_on: [],
    sync_status: "pending",
    retry_count: 0,
    local_created_at: nowIso(),
    ...extras,
  };
  await put(STORES.SYNC_QUEUE, scope, op);
  return op;
}

/** Strip local metadata before handing rows back to callers. */
function stripLocalMeta(row) {
  const {
    account_scope, local_id, sync_status, local_created_at, local_updated_at,
    server_updated_at,
    ...rest
  } = row;
  if (!rest.id && row.server_id) rest.id = row.server_id;
  if (!rest.id && row.local_id) rest.id = row.local_id;
  return rest;
}

// ---------- WORKERS ----------------------------------------------------

export async function listWorkers(scope) {
  requireScope(scope);
  try {
    const { data } = await axios.get(`${API}/workers`);
    const rows = (data || []).map((w) => ({
      local_id: w.id, server_id: w.id, ...w, sync_status: "synced",
    }));
    await putAll(STORES.WORKERS, scope, rows);
    return data || [];
  } catch (err) {
    const cached = await listByScope(STORES.WORKERS, scope);
    return cached.map(stripLocalMeta);
  }
}

export async function createWorker(scope, form) {
  requireScope(scope);
  try {
    const { data } = await axios.post(`${API}/workers`, form);
    await put(STORES.WORKERS, scope, {
      local_id: data.id, server_id: data.id, ...data, sync_status: "synced",
    });
    return data;
  } catch (err) {
    const local_id = uuid();
    const row = {
      local_id, server_id: null, ...form,
      created_at: nowIso(), sync_status: "local_only",
    };
    await put(STORES.WORKERS, scope, row);
    await enqueue(scope, "workers", "create", form, { local_ref: local_id });
    return { id: local_id, ...form, created_at: row.created_at };
  }
}

export async function updateWorker(scope, id, form) {
  requireScope(scope);
  try {
    const { data } = await axios.put(`${API}/workers/${id}`, form);
    const cached = await findByServerId(STORES.WORKERS, scope, id);
    await put(STORES.WORKERS, scope, {
      ...(cached || {}),
      local_id: cached?.local_id || id, server_id: id,
      ...form, sync_status: "synced",
    });
    return data || { ok: true };
  } catch (err) {
    const cached = await findByServerId(STORES.WORKERS, scope, id);
    const local_id = cached?.local_id || id;
    await put(STORES.WORKERS, scope, {
      ...(cached || {}),
      local_id, server_id: cached?.server_id || id,
      ...form, sync_status: "dirty",
    });
    await enqueue(scope, "workers", "update", form, {
      local_ref: local_id,
      target_server_id: cached?.server_id || id,
      baseline_updated_at: cached?.server_updated_at || null,
    });
    return { ok: true, queued: true };
  }
}

// ---------- CONTRACTORS -----------------------------------------------

export async function listContractors(scope) {
  requireScope(scope);
  try {
    const { data } = await axios.get(`${API}/contractors`);
    const rows = (data || []).map((c) => ({
      local_id: c.id, server_id: c.id, ...c, sync_status: "synced",
    }));
    await putAll(STORES.CONTRACTORS, scope, rows);
    return data || [];
  } catch (err) {
    const cached = await listByScope(STORES.CONTRACTORS, scope);
    return cached.map(stripLocalMeta);
  }
}

export async function createContractor(scope, form) {
  requireScope(scope);
  try {
    const { data } = await axios.post(`${API}/contractors`, form);
    await put(STORES.CONTRACTORS, scope, {
      local_id: data.id, server_id: data.id, ...data, sync_status: "synced",
    });
    return data;
  } catch (err) {
    const local_id = uuid();
    const row = {
      local_id, server_id: null, ...form,
      created_at: nowIso(), sync_status: "local_only",
    };
    await put(STORES.CONTRACTORS, scope, row);
    await enqueue(scope, "contractors", "create", form, { local_ref: local_id });
    return { id: local_id, ...form, created_at: row.created_at };
  }
}

export async function updateContractor(scope, id, form) {
  requireScope(scope);
  try {
    const { data } = await axios.put(`${API}/contractors/${id}`, form);
    const cached = await findByServerId(STORES.CONTRACTORS, scope, id);
    await put(STORES.CONTRACTORS, scope, {
      ...(cached || {}),
      local_id: cached?.local_id || id, server_id: id,
      ...form, sync_status: "synced",
    });
    return data || { ok: true };
  } catch (err) {
    const cached = await findByServerId(STORES.CONTRACTORS, scope, id);
    const local_id = cached?.local_id || id;
    await put(STORES.CONTRACTORS, scope, {
      ...(cached || {}),
      local_id, server_id: cached?.server_id || id,
      ...form, sync_status: "dirty",
    });
    await enqueue(scope, "contractors", "update", form, {
      local_ref: local_id,
      target_server_id: cached?.server_id || id,
      baseline_updated_at: cached?.server_updated_at || null,
    });
    return { ok: true, queued: true };
  }
}

// ---------- ATTENDANCE -------------------------------------------------

export async function listAttendanceByDate(scope, date) {
  requireScope(scope);
  try {
    const { data } = await axios.get(`${API}/attendance`, { params: { date } });
    const rows = (data || []).map((a) => ({
      local_id: a.id, server_id: a.id, ...a, sync_status: "synced",
    }));
    await putAll(STORES.ATTENDANCE, scope, rows);
    return data || [];
  } catch (err) {
    const all = await listByScope(STORES.ATTENDANCE, scope);
    return all.filter((a) => a.date === date).map(stripLocalMeta);
  }
}

/**
 * Save attendance for (worker_id, date). Reuses existing backend upsert.
 *
 * ONLINE path: sends the same payload as before — no daily_rate_snapshot
 * on the wire — so the backend's existing "capture worker.daily_rate on
 * insert" behavior is bit-for-bit unchanged.
 *
 * OFFLINE path: captures the cached worker's daily_rate at THIS EXACT
 * MOMENT and stamps it as daily_rate_snapshot on both the local IDB
 * row and the queued payload. Never recomputed at sync time.
 */
export async function saveAttendance(scope, form) {
  requireScope(scope);
  if (!form.worker_id || !form.date) {
    throw new Error("saveAttendance requires worker_id and date");
  }

  // Look up existing row FIRST — mirrors backend (user_id, worker_id,
  // date) upsert. Two offline saves for the same (worker, date) hit
  // the same local_id, so no duplicate local row is ever created.
  const existing = await findAttendance(scope, form.worker_id, form.date);

  try {
    // ONLINE: preserve existing behavior exactly. Do NOT send
    // daily_rate_snapshot. Server captures worker.daily_rate on insert.
    const { data } = await axios.post(`${API}/attendance`, form);
    const serverRow = data || {};
    const merged = {
      ...(existing || {}),
      local_id: existing?.local_id || serverRow.id || uuid(),
      server_id: serverRow.id || existing?.server_id || null,
      ...form,
      // Preserve any existing snapshot (backend never overwrites on
      // update). If server returned one (INSERT path), use its value.
      daily_rate_snapshot:
        serverRow.daily_rate_snapshot != null
          ? serverRow.daily_rate_snapshot
          : (existing?.daily_rate_snapshot ?? null),
      sync_status: "synced",
    };
    await put(STORES.ATTENDANCE, scope, merged);
    return serverRow;
  } catch (err) {
    // OFFLINE: capture cached worker rate NOW as daily_rate_snapshot.
    // This value travels on the queue payload and will be persisted
    // verbatim by the backend on INSERT when the sync engine drains
    // (backend now accepts daily_rate_snapshot for offline INSERTs).
    // If a row already exists locally, preserve its snapshot exactly —
    // never overwrite (mirrors backend UPDATE invariant).
    let snapshot = existing?.daily_rate_snapshot;
    if (snapshot == null) {
      // Prefer server_id lookup, but fall back to local_id for
      // offline-created workers whose server_id isn't assigned yet.
      let cachedWorker = await findByServerId(STORES.WORKERS, scope, form.worker_id);
      if (!cachedWorker) {
        const db = await (await import("./db")).getDB();
        cachedWorker = await db.get(STORES.WORKERS, form.worker_id);
      }
      const raw = cachedWorker?.daily_rate;
      snapshot =
        typeof raw === "number" && isFinite(raw) && raw >= 0 ? raw : null;
    }
    const local_id = existing?.local_id || uuid();
    const row = {
      ...(existing || {}),
      local_id,
      server_id: existing?.server_id || null,
      ...form,
      daily_rate_snapshot: snapshot,
      sync_status: existing?.sync_status === "synced" ? "dirty" : "local_only",
    };
    await put(STORES.ATTENDANCE, scope, row);
    // Queue payload carries the entry-time snapshot so the future sync
    // engine sends it to the backend on INSERT.
    const queuedPayload = { ...form };
    if (snapshot != null) queuedPayload.daily_rate_snapshot = snapshot;
    await enqueue(
      scope,
      "attendance",
      existing?.server_id ? "update" : "create",
      queuedPayload,
      {
        local_ref: local_id,
        target_server_id: existing?.server_id || null,
      }
    );
    return { id: local_id, ...form, daily_rate_snapshot: snapshot, queued: true };
  }
}

// ---------- ADVANCES ---------------------------------------------------
//
// Money-critical writes. Same offline-first semantics as workers/
// contractors: online → server → mirror to IDB; offline → local row
// with `local_id` + queue op with a fresh operation_id.
//
// Parent-reference remapping (worker_id local_id → server_id after the
// worker's own create op syncs) is handled centrally by syncEngine's
// `idMap` at drain time — dataLayer just stores the current best id.

export async function listAdvances(scope, worker_id) {
  requireScope(scope);
  const params = worker_id ? { worker_id } : {};
  try {
    const { data } = await axios.get(`${API}/advances`, { params });
    const rows = (data || []).map((a) => ({
      local_id: a.id, server_id: a.id, ...a, sync_status: "synced",
    }));
    await putAll(STORES.ADVANCES, scope, rows);
    return data || [];
  } catch (err) {
    const all = await listByScope(STORES.ADVANCES, scope);
    const filtered = worker_id ? all.filter((r) => r.worker_id === worker_id) : all;
    return filtered.map(stripLocalMeta);
  }
}

export async function createAdvance(scope, form) {
  requireScope(scope);
  try {
    const { data } = await axios.post(`${API}/advances`, form);
    await put(STORES.ADVANCES, scope, {
      local_id: data.id, server_id: data.id, ...data, sync_status: "synced",
    });
    return data;
  } catch (err) {
    const local_id = uuid();
    const row = {
      local_id, server_id: null, ...form,
      created_at: nowIso(), sync_status: "local_only",
    };
    await put(STORES.ADVANCES, scope, row);
    await enqueue(scope, "advances", "create", form, { local_ref: local_id });
    return { id: local_id, ...form, created_at: row.created_at, queued: true };
  }
}

export async function deleteAdvance(scope, id) {
  requireScope(scope);
  try {
    await axios.delete(`${API}/advances/${id}`);
    // Remove local mirror by server_id if present.
    const cached = await findByServerId(STORES.ADVANCES, scope, id);
    if (cached) await deleteByKey(STORES.ADVANCES, cached.local_id);
    return { ok: true };
  } catch (err) {
    // Offline path: mark local row as pending-delete + enqueue a delete
    // op targeting the server_id. If the row was never synced (no
    // server_id) we can drop it locally and skip the queue entry.
    const cached = await findByServerId(STORES.ADVANCES, scope, id);
    if (!cached) {
      // Might be a local-only row — try lookup by local_id.
      const db = await (await import("./db")).getDB();
      const localRow = await db.get(STORES.ADVANCES, id);
      if (localRow && !localRow.server_id) {
        await deleteByKey(STORES.ADVANCES, id);
        // Also drop any pending create op for this local_id so we
        // don't sync a delete-of-nothing later.
        const queue = await listByScope(STORES.SYNC_QUEUE, scope);
        for (const op of queue) {
          if (op.entity_type === "advances"
              && op.operation_type === "create"
              && op.local_ref === id
              && op.sync_status !== "synced") {
            await deleteByKey(STORES.SYNC_QUEUE, op.operation_id);
          }
        }
        return { ok: true, queued: false };
      }
    }
    if (cached) {
      await put(STORES.ADVANCES, scope, { ...cached, sync_status: "pending_delete" });
      await enqueue(scope, "advances", "delete", { id }, {
        local_ref: cached.local_id,
        target_server_id: id,
      });
    }
    return { ok: true, queued: true };
  }
}

// ---------- ADVANCE RETURNS -------------------------------------------

export async function listReturns(scope, worker_id) {
  requireScope(scope);
  const params = worker_id ? { worker_id } : {};
  try {
    const { data } = await axios.get(`${API}/returns`, { params });
    const rows = (data || []).map((r) => ({
      local_id: r.id, server_id: r.id, ...r, sync_status: "synced",
    }));
    await putAll(STORES.ADVANCE_RETURNS, scope, rows);
    return data || [];
  } catch (err) {
    const all = await listByScope(STORES.ADVANCE_RETURNS, scope);
    const filtered = worker_id ? all.filter((r) => r.worker_id === worker_id) : all;
    return filtered.map(stripLocalMeta);
  }
}

export async function createReturn(scope, form) {
  requireScope(scope);
  try {
    const { data } = await axios.post(`${API}/returns`, form);
    await put(STORES.ADVANCE_RETURNS, scope, {
      local_id: data.id, server_id: data.id, ...data, sync_status: "synced",
    });
    return data;
  } catch (err) {
    const local_id = uuid();
    const row = {
      local_id, server_id: null, ...form,
      created_at: nowIso(), sync_status: "local_only",
    };
    await put(STORES.ADVANCE_RETURNS, scope, row);
    await enqueue(scope, "advance_returns", "create", form, { local_ref: local_id });
    return { id: local_id, ...form, created_at: row.created_at, queued: true };
  }
}

export async function deleteReturn(scope, id) {
  requireScope(scope);
  try {
    await axios.delete(`${API}/returns/${id}`);
    const cached = await findByServerId(STORES.ADVANCE_RETURNS, scope, id);
    if (cached) await deleteByKey(STORES.ADVANCE_RETURNS, cached.local_id);
    return { ok: true };
  } catch (err) {
    const cached = await findByServerId(STORES.ADVANCE_RETURNS, scope, id);
    if (!cached) {
      const db = await (await import("./db")).getDB();
      const localRow = await db.get(STORES.ADVANCE_RETURNS, id);
      if (localRow && !localRow.server_id) {
        await deleteByKey(STORES.ADVANCE_RETURNS, id);
        const queue = await listByScope(STORES.SYNC_QUEUE, scope);
        for (const op of queue) {
          if (op.entity_type === "advance_returns"
              && op.operation_type === "create"
              && op.local_ref === id
              && op.sync_status !== "synced") {
            await deleteByKey(STORES.SYNC_QUEUE, op.operation_id);
          }
        }
        return { ok: true, queued: false };
      }
    }
    if (cached) {
      await put(STORES.ADVANCE_RETURNS, scope, { ...cached, sync_status: "pending_delete" });
      await enqueue(scope, "advance_returns", "delete", { id }, {
        local_ref: cached.local_id,
        target_server_id: id,
      });
    }
    return { ok: true, queued: true };
  }
}


// ---------- SETTLEMENTS (offline DRAFT + server revalidation) ----------
//
// Offline settlement policy (Section §2 of FINAL SCOPE):
//   * Online → POST /settlements immediately. Optionally include the
//     client's ledger snapshot; the server accepts and revalidates.
//   * Offline → write a "draft_pending_sync" row into STORES.SETTLEMENTS
//     and enqueue a create op WITH the client snapshot on the payload.
//     When the sync engine drains, the backend revalidates against the
//     live ledger; on mismatch it returns 409, which the engine
//     translates to sync_status=requires_review — no silent write.
//
// The snapshot travels VERBATIM (no recomputation at sync time), just
// like daily_rate_snapshot on attendance. This is the accounting
// invariant: what the user believed at the moment of entry is what the
// server verifies against.

export async function saveSettlement(scope, form, snapshot = null) {
  requireScope(scope);
  const payload = { ...form };
  if (snapshot && (snapshot.earned != null || snapshot.net_advance != null)) {
    if (snapshot.earned != null) payload.client_earned_snapshot = snapshot.earned;
    if (snapshot.net_advance != null) payload.client_advance_snapshot = snapshot.net_advance;
    if (snapshot.cached_at) payload.cached_at = snapshot.cached_at;
  }
  try {
    const { data } = await axios.post(`${API}/settlements`, payload);
    // Server accepted (either no snapshot or snapshot matched live ledger).
    await put(STORES.SETTLEMENTS, scope, {
      local_id: data.id, server_id: data.id, ...data, sync_status: "synced",
    });
    return data;
  } catch (err) {
    // Online 409 = server revalidation failed. Do NOT queue this —
    // surface immediately so the UI can force a re-open with fresh data.
    const status = err?.response?.status;
    if (status === 409) {
      const detail = err.response?.data?.detail || {};
      const e = new Error("settlement_revalidation_failed");
      e.code = detail?.code || "settlement_revalidation_failed";
      e.server = detail?.server;
      e.client = detail?.client;
      throw e;
    }
    // Network-style failure → offline draft path.
    const local_id = uuid();
    const now = nowIso();
    const draft = {
      local_id,
      server_id: null,
      ...form,
      // Carry the snapshot on the local draft so a Sync Review UI can
      // display "cached at X · earned believed Y" without hitting the
      // server.
      client_earned_snapshot: snapshot?.earned ?? null,
      client_advance_snapshot: snapshot?.net_advance ?? null,
      cached_at: snapshot?.cached_at || now,
      created_at: now,
      sync_status: "draft_pending_sync",
    };
    await put(STORES.SETTLEMENTS, scope, draft);
    await enqueue(scope, "settlements", "create", payload, { local_ref: local_id });
    return { id: local_id, ...form, queued: true, draft: true };
  }
}


// ---------- READ-THROUGH CACHES (§P1 offline UX) ------------------------
//
// Every helper below is a pure read: online → server, mirror the raw
// response into IDB with a compact wrapper carrying `cached_at`, then
// return the raw server payload. Offline → return the last cached
// snapshot verbatim, with a `_stale: true` marker + `_cached_at` so the
// UI can render a "last synced at X" hint. Returns null when the cache
// is also empty (first-time offline for this exact key).
//
// Cache keys mirror schema.js:
//   worker_ledger_cache:      "<scope>|<worker_id>|<range>"
//   contractor_ledger_cache:  "<scope>|<contractor_id>|<range>"
//   calendar_cache:           "<scope>|<worker_id>|<year>|<month>"
//   dashboard_cache:          keyed on account_scope (single row)
//
// Range key convention: "" (empty) for current-cycle, or "YYYY" /
// "YYYY-MM" for history filters.

async function readCache(store, cacheKey, scope) {
  const db = await (await import("./db")).getDB();
  const row = await db.get(store, cacheKey);
  if (!row || row.account_scope !== scope) return null;
  return { ...row.snapshot, _stale: true, _cached_at: row.cached_at };
}

async function writeCache(store, cacheKey, scope, extraKeys, snapshot) {
  await put(store, scope, {
    cache_key: cacheKey,
    account_scope: scope,
    ...extraKeys,
    snapshot,
    cached_at: nowIso(),
  });
}

export async function getWorkerLedger(scope, workerId, range = "") {
  requireScope(scope);
  const cacheKey = `${scope}|${workerId}|${range}`;
  const url = range
    ? `${API}/ledger/${workerId}${range}`
    : `${API}/ledger/${workerId}`;
  try {
    const { data } = await axios.get(url);
    await writeCache(STORES.WORKER_LEDGER_CACHE, cacheKey, scope, { worker_id: workerId }, data);
    return data;
  } catch (err) {
    return await readCache(STORES.WORKER_LEDGER_CACHE, cacheKey, scope);
  }
}

export async function getContractorLedger(scope, contractorId, range = "") {
  requireScope(scope);
  const cacheKey = `${scope}|${contractorId}|${range}`;
  const url = range
    ? `${API}/contractors/${contractorId}/ledger${range}`
    : `${API}/contractors/${contractorId}/ledger`;
  try {
    const { data } = await axios.get(url);
    await writeCache(STORES.CONTRACTOR_LEDGER_CACHE, cacheKey, scope, { contractor_id: contractorId }, data);
    return data;
  } catch (err) {
    return await readCache(STORES.CONTRACTOR_LEDGER_CACHE, cacheKey, scope);
  }
}

export async function getDashboardSnapshot(scope) {
  requireScope(scope);
  try {
    const { data } = await axios.get(`${API}/dashboard`);
    await put(STORES.DASHBOARD_CACHE, scope, {
      account_scope: scope, snapshot: data, cached_at: nowIso(),
    });
    return data;
  } catch (err) {
    const db = await (await import("./db")).getDB();
    const row = await db.get(STORES.DASHBOARD_CACHE, scope);
    if (!row) return null;
    return { ...row.snapshot, _stale: true, _cached_at: row.cached_at };
  }
}

export async function getCalendarMonth(scope, workerId, year, month) {
  requireScope(scope);
  const cacheKey = `${scope}|${workerId}|${year}|${month}`;
  try {
    const { data } = await axios.get(
      `${API}/calendar/month?worker_id=${workerId}&year=${year}&month=${month}`
    );
    await writeCache(
      STORES.CALENDAR_CACHE, cacheKey, scope,
      { worker_id: workerId, year, month }, data
    );
    return data;
  } catch (err) {
    const cached = await readCache(STORES.CALENDAR_CACHE, cacheKey, scope);
    if (cached) return cached;
    // Fallback: reconstruct records from the ATTENDANCE store for this
    // month. Better than a blank grid — the user has entered these
    // attendance rows themselves during the offline session.
    const all = await listByScope(STORES.ATTENDANCE, scope);
    const y = String(year);
    const m = String(month).padStart(2, "0");
    const records = all
      .filter((a) => a.worker_id === workerId && (a.date || "").startsWith(`${y}-${m}`))
      .map((a) => ({ date: a.date, status: a.status, overtime_hours: a.overtime_hours || 0 }));
    return { records, _stale: true, _cached_at: null };
  }
}

export async function getCalendarDate(scope, date) {
  requireScope(scope);
  try {
    const { data } = await axios.get(`${API}/calendar/date?date=${date}`);
    return data;
  } catch (err) {
    // Reconstruct from local ATTENDANCE + WORKERS caches. Purely
    // offline — no server call. Guarantees the day-sheet still opens.
    const [att, workers] = await Promise.all([
      listByScope(STORES.ATTENDANCE, scope),
      listByScope(STORES.WORKERS, scope),
    ]);
    const workerById = new Map();
    for (const w of workers) {
      workerById.set(w.server_id || w.local_id, w);
    }
    const rowsForDate = att.filter((a) => a.date === date);
    const out = rowsForDate.map((a) => {
      const w = workerById.get(a.worker_id) || {};
      return {
        worker_id: a.worker_id,
        name: w.name || "—",
        daily_rate: w.daily_rate ?? null,
        status: a.status,
        overtime_hours: a.overtime_hours || 0,
        daily_rate_snapshot: a.daily_rate_snapshot ?? null,
      };
    });
    return { workers: out, _stale: true };
  }
}


// ---------- CONTRACTOR VISITS / PAYMENTS / RETURNS ---------------------
//
// Same offline-first pattern as advances/returns:
//   online  → POST /server → mirror {local_id, server_id} into IDB.
//   offline → assign local_id, write to IDB with sync_status=local_only,
//             enqueue one create op with operation_id + local_ref.
// Delete follows the advance/return convention:
//   * local-only row → drop IDB + cancel pending create op.
//   * synced row     → mark pending_delete + enqueue delete op.
//
// Backend routes already carry the (contractor_id, user_id) ownership
// check inside the idempotent(...) block, so replayed ops after network
// glitches are safe. See routes/contractors.py add_visit/add_cpayment/
// add_creturn.
//
// Nothing here needs a new isolation mechanism: every put() call routes
// through repo.js which stamps account_scope. Cross-account leaks are
// mechanically prevented by the by_scope_contractor index.

// -- visits ------------------------------------------------------------

export async function listContractorVisits(scope, contractor_id) {
  requireScope(scope);
  try {
    const { data } = await axios.get(`${API}/contractor-visits`, {
      params: { contractor_id },
    });
    const rows = (data || []).map((v) => ({
      local_id: v.id, server_id: v.id, ...v, sync_status: "synced",
    }));
    await putAll(STORES.CONTRACTOR_VISITS, scope, rows);
    return data || [];
  } catch (err) {
    const all = await listByScope(STORES.CONTRACTOR_VISITS, scope);
    return all
      .filter((r) => r.contractor_id === contractor_id && r.sync_status !== "pending_delete")
      .map(stripLocalMeta);
  }
}

export async function createContractorVisit(scope, form) {
  requireScope(scope);
  try {
    const { data } = await axios.post(`${API}/contractor-visits`, form);
    await put(STORES.CONTRACTOR_VISITS, scope, {
      local_id: data.id, server_id: data.id, ...data, sync_status: "synced",
    });
    return data;
  } catch (err) {
    const local_id = uuid();
    const row = {
      local_id, server_id: null, ...form,
      created_at: nowIso(), sync_status: "local_only",
    };
    await put(STORES.CONTRACTOR_VISITS, scope, row);
    await enqueue(scope, "contractor_visits", "create", form, { local_ref: local_id });
    return { id: local_id, ...form, created_at: row.created_at, queued: true };
  }
}

export async function deleteContractorVisit(scope, id) {
  requireScope(scope);
  return _deleteContractorRow(
    scope, id,
    STORES.CONTRACTOR_VISITS, "contractor_visits",
    `/contractor-visits`,
  );
}

// -- payments ----------------------------------------------------------

export async function listContractorPayments(scope, contractor_id) {
  requireScope(scope);
  try {
    const { data } = await axios.get(`${API}/contractor-payments`, {
      params: { contractor_id },
    });
    const rows = (data || []).map((p) => ({
      local_id: p.id, server_id: p.id, ...p, sync_status: "synced",
    }));
    await putAll(STORES.CONTRACTOR_PAYMENTS, scope, rows);
    return data || [];
  } catch (err) {
    const all = await listByScope(STORES.CONTRACTOR_PAYMENTS, scope);
    return all
      .filter((r) => r.contractor_id === contractor_id && r.sync_status !== "pending_delete")
      .map(stripLocalMeta);
  }
}

export async function createContractorPayment(scope, form) {
  requireScope(scope);
  try {
    const { data } = await axios.post(`${API}/contractor-payments`, form);
    await put(STORES.CONTRACTOR_PAYMENTS, scope, {
      local_id: data.id, server_id: data.id, ...data, sync_status: "synced",
    });
    return data;
  } catch (err) {
    const local_id = uuid();
    const row = {
      local_id, server_id: null, ...form,
      created_at: nowIso(), sync_status: "local_only",
    };
    await put(STORES.CONTRACTOR_PAYMENTS, scope, row);
    await enqueue(scope, "contractor_payments", "create", form, { local_ref: local_id });
    return { id: local_id, ...form, created_at: row.created_at, queued: true };
  }
}

export async function deleteContractorPayment(scope, id) {
  requireScope(scope);
  return _deleteContractorRow(
    scope, id,
    STORES.CONTRACTOR_PAYMENTS, "contractor_payments",
    `/contractor-payments`,
  );
}

// -- returns -----------------------------------------------------------

export async function listContractorReturns(scope, contractor_id) {
  requireScope(scope);
  try {
    const { data } = await axios.get(`${API}/contractor-returns`, {
      params: { contractor_id },
    });
    const rows = (data || []).map((r) => ({
      local_id: r.id, server_id: r.id, ...r, sync_status: "synced",
    }));
    await putAll(STORES.CONTRACTOR_RETURNS, scope, rows);
    return data || [];
  } catch (err) {
    const all = await listByScope(STORES.CONTRACTOR_RETURNS, scope);
    return all
      .filter((r) => r.contractor_id === contractor_id && r.sync_status !== "pending_delete")
      .map(stripLocalMeta);
  }
}

export async function createContractorReturn(scope, form) {
  requireScope(scope);
  try {
    const { data } = await axios.post(`${API}/contractor-returns`, form);
    await put(STORES.CONTRACTOR_RETURNS, scope, {
      local_id: data.id, server_id: data.id, ...data, sync_status: "synced",
    });
    return data;
  } catch (err) {
    const local_id = uuid();
    const row = {
      local_id, server_id: null, ...form,
      created_at: nowIso(), sync_status: "local_only",
    };
    await put(STORES.CONTRACTOR_RETURNS, scope, row);
    await enqueue(scope, "contractor_returns", "create", form, { local_ref: local_id });
    return { id: local_id, ...form, created_at: row.created_at, queued: true };
  }
}

export async function deleteContractorReturn(scope, id) {
  requireScope(scope);
  return _deleteContractorRow(
    scope, id,
    STORES.CONTRACTOR_RETURNS, "contractor_returns",
    `/contractor-returns`,
  );
}

// Shared delete logic for the three contractor-child entities. Mirrors
// deleteAdvance/deleteReturn: if the row is synced, mark pending_delete
// + enqueue a delete op targeting the server_id; if it was local-only
// and its create op is still pending, drop both.
async function _deleteContractorRow(scope, id, store, entityType, urlPrefix) {
  try {
    await axios.delete(`${API}${urlPrefix}/${id}`);
    const cached = await findByServerId(store, scope, id);
    if (cached) await deleteByKey(store, cached.local_id);
    return { ok: true };
  } catch (err) {
    const cached = await findByServerId(store, scope, id);
    if (!cached) {
      const db = await (await import("./db")).getDB();
      const localRow = await db.get(store, id);
      if (localRow && !localRow.server_id) {
        await deleteByKey(store, id);
        const queue = await listByScope(STORES.SYNC_QUEUE, scope);
        for (const op of queue) {
          if (op.entity_type === entityType
              && op.operation_type === "create"
              && op.local_ref === id
              && op.sync_status !== "synced") {
            await deleteByKey(STORES.SYNC_QUEUE, op.operation_id);
          }
        }
        return { ok: true, queued: false };
      }
    }
    if (cached) {
      await put(store, scope, { ...cached, sync_status: "pending_delete" });
      await enqueue(scope, entityType, "delete", { id }, {
        local_ref: cached.local_id,
        target_server_id: id,
      });
    }
    return { ok: true, queued: true };
  }
}

// -- ledger merge (offline visibility) --------------------------------
//
// Immediately after an offline create, the just-persisted local row
// must be reflected in the contractor ledger view. `getContractorLedger`
// returns the last SERVER snapshot, so we union the local-only rows on
// top and recompute the summary totals. On the online path, the server
// already includes the row (idempotent-safe on replay) so the union is
// a no-op.
export async function getContractorLedgerWithLocal(scope, contractorId, range = "") {
  requireScope(scope);
  const led = await getContractorLedger(scope, contractorId, range);
  if (!led) return null;

  const [localVisits, localPays, localReturns] = await Promise.all([
    listByScope(STORES.CONTRACTOR_VISITS, scope),
    listByScope(STORES.CONTRACTOR_PAYMENTS, scope),
    listByScope(STORES.CONTRACTOR_RETURNS, scope),
  ]);

  // The server-side ledger row set is authoritative for anything with a
  // server_id. Local-only rows (no server_id) are additive. Rows marked
  // pending_delete are subtracted from the server-side lists.
  const serverIdsInLedger = (arr) => new Set((arr || []).map((r) => r.id));

  const localExtraVisits = localVisits.filter(
    (r) => r.contractor_id === contractorId
        && r.sync_status === "local_only"
        && !serverIdsInLedger(led.visits).has(r.local_id),
  ).map(stripLocalMeta);
  const localExtraPays = localPays.filter(
    (r) => r.contractor_id === contractorId
        && r.sync_status === "local_only"
        && !serverIdsInLedger(led.payments).has(r.local_id),
  ).map(stripLocalMeta);
  const localExtraReturns = localReturns.filter(
    (r) => r.contractor_id === contractorId
        && r.sync_status === "local_only"
        && !serverIdsInLedger(led.returns).has(r.local_id),
  ).map(stripLocalMeta);

  const pendingDeleteVisitIds = new Set(
    localVisits.filter((r) => r.sync_status === "pending_delete").map((r) => r.server_id),
  );
  const pendingDeletePayIds = new Set(
    localPays.filter((r) => r.sync_status === "pending_delete").map((r) => r.server_id),
  );
  const pendingDeleteReturnIds = new Set(
    localReturns.filter((r) => r.sync_status === "pending_delete").map((r) => r.server_id),
  );

  const visits = [
    ...(led.visits || []).filter((v) => !pendingDeleteVisitIds.has(v.id)),
    ...localExtraVisits,
  ].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const payments = [
    ...(led.payments || []).filter((p) => !pendingDeletePayIds.has(p.id)),
    ...localExtraPays,
  ].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const returns = [
    ...(led.returns || []).filter((r) => !pendingDeleteReturnIds.has(r.id)),
    ...localExtraReturns,
  ].sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  const total_paid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const total_returned = returns.reduce((s, r) => s + Number(r.amount || 0), 0);
  const total_visits = visits.length;
  const total_workers_brought = visits.reduce(
    (s, v) => s + Number(v.workers_count || 0), 0,
  );
  const net_paid = Math.max(0, total_paid - total_returned);
  const total_settled = Number(led.total_settled || 0);
  const final_balance = -(net_paid); // contractor branch (see services/ledger.py)

  return {
    ...led,
    visits, payments, returns,
    total_visits, total_workers_brought,
    total_paid: round2(total_paid),
    total_returned: round2(total_returned),
    net_paid: round2(net_paid),
    total_settled: round2(total_settled),
    final_balance: round2(final_balance),
    _has_local_edits:
      localExtraVisits.length + localExtraPays.length + localExtraReturns.length
      + pendingDeleteVisitIds.size + pendingDeletePayIds.size + pendingDeleteReturnIds.size > 0,
  };
}

function round2(n) { return Math.round(Number(n) * 100) / 100; }


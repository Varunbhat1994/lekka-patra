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


// Hydration state machine + local_accounts write-through.
// The ONLY safe entry into offline mode — has_authenticated_at_least_once
// flips true only after every step below succeeds (Step 2 §11 + Q2).
import axios from "axios";
import { getDB, put, putAll, getSingle, STORES } from "./index";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export const HYDRATION_STEPS = [
  "auth_me", "workers", "contractors", "settlements",
  "attendance_90d", "contractor_records_90d", "dashboard",
];
const KEY = "hydration_progress";
const nowIso = () => new Date().toISOString();

async function loadBag() {
  const db = await getDB();
  const row = await db.get(STORES.APP_META, KEY);
  return row?.progress || {};
}
async function saveBag(bag) {
  const db = await getDB();
  await db.put(STORES.APP_META, { key: KEY, progress: bag, updated_at: nowIso() });
}

export async function getHydrationProgress(scope) {
  const bag = await loadBag();
  const s = bag[scope] || {};
  const steps = {};
  for (const k of HYDRATION_STEPS) steps[k] = !!s[k];
  return {
    steps,
    completed_at: s.completed_at || null,
    resume_from: HYDRATION_STEPS.find((k) => !steps[k]) || null,
    total: HYDRATION_STEPS.length,
    done: HYDRATION_STEPS.filter((k) => steps[k]).length,
  };
}
async function markDone(scope, step) {
  const bag = await loadBag();
  const s = bag[scope] || {};
  s[step] = true;
  s.updated_at = nowIso();
  if (HYDRATION_STEPS.every((k) => !!s[k])) s.completed_at = nowIso();
  bag[scope] = s;
  await saveBag(bag);
}

export async function getLocalAccount(scope) {
  return await getSingle(STORES.LOCAL_ACCOUNTS, scope);
}
export async function isOfflineReady(scope) {
  const a = await getLocalAccount(scope);
  return !!(a && a.has_authenticated_at_least_once === true);
}

function isoDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

const STEP_FNS = {
  auth_me: async (ctx) => {
    const { data } = await axios.get(`${API}/auth/me`);
    if (!data || !data.user_id) throw new Error("auth_me: no user_id");
    ctx.user = data;
  },
  workers: async (ctx) => {
    const { data } = await axios.get(`${API}/workers`);
    const rows = (data || []).map((w) => ({ local_id: w.id, server_id: w.id, ...w, sync_status: "synced" }));
    await putAll(STORES.WORKERS, ctx.scope, rows);
    ctx.workers = rows;
  },
  contractors: async (ctx) => {
    const { data } = await axios.get(`${API}/contractors`);
    const rows = (data || []).map((c) => ({ local_id: c.id, server_id: c.id, ...c, sync_status: "synced" }));
    await putAll(STORES.CONTRACTORS, ctx.scope, rows);
    ctx.contractors = rows;
  },
  settlements: async (ctx) => {
    const { data } = await axios.get(`${API}/settlements`);
    const rows = (data || []).map((s) => ({ local_id: s.id, server_id: s.id, ...s, sync_status: "synced" }));
    await putAll(STORES.SETTLEMENTS, ctx.scope, rows);
  },
  attendance_90d: async (ctx) => {
    const start = isoDaysAgo(90), end = isoDaysAgo(0);
    const workers = ctx.workers || (await axios.get(`${API}/workers`)).data || [];
    const all = [];
    for (const w of workers) {
      const { data } = await axios.get(`${API}/attendance`, { params: { worker_id: w.id, start, end } });
      for (const a of data || []) all.push({ local_id: a.id, server_id: a.id, ...a, sync_status: "synced" });
    }
    await putAll(STORES.ATTENDANCE, ctx.scope, all);
  },
  contractor_records_90d: async (ctx) => {
    const contractors = ctx.contractors || (await axios.get(`${API}/contractors`)).data || [];
    const v = [], p = [], r = [];
    for (const c of contractors) {
      const [vs, ps, rs] = await Promise.all([
        axios.get(`${API}/contractor-visits`, { params: { contractor_id: c.id } }).then((x) => x.data || []),
        axios.get(`${API}/contractor-payments`, { params: { contractor_id: c.id } }).then((x) => x.data || []),
        axios.get(`${API}/contractor-returns`, { params: { contractor_id: c.id } }).then((x) => x.data || []),
      ]);
      for (const x of vs) v.push({ local_id: x.id, server_id: x.id, ...x, sync_status: "synced" });
      for (const x of ps) p.push({ local_id: x.id, server_id: x.id, ...x, sync_status: "synced" });
      for (const x of rs) r.push({ local_id: x.id, server_id: x.id, ...x, sync_status: "synced" });
    }
    await putAll(STORES.CONTRACTOR_VISITS, ctx.scope, v);
    await putAll(STORES.CONTRACTOR_PAYMENTS, ctx.scope, p);
    await putAll(STORES.CONTRACTOR_RETURNS, ctx.scope, r);
  },
  dashboard: async (ctx) => {
    const { data } = await axios.get(`${API}/dashboard`);
    await put(STORES.DASHBOARD_CACHE, ctx.scope, {
      account_scope: ctx.scope, snapshot: data, cached_at: nowIso(),
    });
  },
};

/**
 * Run the hydration state machine.
 * Idempotent — completed steps are skipped unless forceRefresh=true.
 * onProgress({step, done, total, phase}) reports progress for UI.
 */
export async function runHydration(scope, opts = {}) {
  if (!scope) throw new Error("runHydration: scope required");
  const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : () => {};
  const ctx = { scope, user: opts.user || null };
  let p = await getHydrationProgress(scope);
  onProgress({ step: null, done: p.done, total: p.total, phase: "start" });

  for (const step of HYDRATION_STEPS) {
    if (p.steps[step] && !opts.forceRefresh) continue;
    onProgress({ step, done: p.done, total: p.total, phase: "running" });
    try {
      await STEP_FNS[step](ctx);
    } catch (err) {
      onProgress({ step, done: p.done, total: p.total, phase: "failed", error: err });
      throw err;
    }
    await markDone(scope, step);
    p = await getHydrationProgress(scope);
    onProgress({ step, done: p.done, total: p.total, phase: "step_done" });
  }

  // Only flip the gate when every step succeeded.
  const user = ctx.user;
  if (user && user.user_id) {
    await put(STORES.LOCAL_ACCOUNTS, scope, {
      account_scope: scope,
      user_id: user.user_id,
      email: user.email || "",
      name: user.name || "",
      mobile: user.mobile || "",
      has_authenticated_at_least_once: true,
      last_online_at: nowIso(),
    });
  }
  onProgress({ step: null, done: HYDRATION_STEPS.length, total: HYDRATION_STEPS.length, phase: "complete" });
  return await getHydrationProgress(scope);
}

export async function markLastOnline(scope, user) {
  if (!scope || !user?.user_id) return;
  const existing = (await getLocalAccount(scope)) || {};
  await put(STORES.LOCAL_ACCOUNTS, scope, {
    ...existing,
    account_scope: scope,
    user_id: user.user_id,
    email: user.email || existing.email || "",
    name: user.name || existing.name || "",
    mobile: user.mobile || existing.mobile || "",
    has_authenticated_at_least_once: !!existing.has_authenticated_at_least_once,
    last_online_at: nowIso(),
  });
}

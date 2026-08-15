// IndexedDB schema for offline-first support.
//
// Design source of truth: Step 1B (approved). Do NOT add stores here
// without an explicit design update — this file is the single place
// the DB shape is declared, and any drift will produce silent bugs
// via missing indexes on subsequent reads.
//
// Every store carries `account_scope` (SHA-256 of user_id at first
// successful hydration) so cross-tenant reads are impossible without
// providing the correct scope on every query. Backend still validates
// ownership on writes — see security/authentication.py — so
// account_scope is purely an on-device tenant partition.

export const DB_NAME = "lekka_patra";

// Bump on any schema change. Every bump MUST have a corresponding
// migration branch in `upgrade()` inside db.js — never rely on
// "createObjectStore if missing" tricks; declare the exact upgrade
// path deterministically.
export const DB_VERSION = 1;

// Store name constants — imported everywhere else to avoid stringly
// typed references drifting.
export const STORES = Object.freeze({
  // Cached backend entities.
  WORKERS: "workers",
  CONTRACTORS: "contractors",
  ATTENDANCE: "attendance",
  ADVANCES: "advances",
  ADVANCE_RETURNS: "advance_returns",
  CONTRACTOR_VISITS: "contractor_visits",
  CONTRACTOR_PAYMENTS: "contractor_payments",
  CONTRACTOR_RETURNS: "contractor_returns",
  // Settlement is READ-ONLY offline (locked policy, Section 10) —
  // cached list only, never a write target.
  SETTLEMENTS: "settlements",

  // Derived read caches — one snapshot per key.
  WORKER_LEDGER_CACHE: "worker_ledger_cache",
  CONTRACTOR_LEDGER_CACHE: "contractor_ledger_cache",
  DASHBOARD_CACHE: "dashboard_cache",
  CALENDAR_CACHE: "calendar_cache",

  // Sync infrastructure.
  SYNC_QUEUE: "sync_queue",
  SYNC_METADATA: "sync_metadata",

  // Device-local (not synced).
  LOCAL_ACCOUNTS: "local_accounts",
  APP_META: "app_meta",
});

// Schema declaration: every store, its keyPath, and its indexes.
// Consumed by db.js `upgrade()` and by dev-time diagnostics.
export const STORE_DEFS = [
  // --- Cached entities ------------------------------------------------
  {
    name: STORES.WORKERS,
    keyPath: "local_id",
    indexes: [
      { name: "by_scope", keyPath: "account_scope" },
      // Composite: fast per-account lookup by server_id after sync.
      { name: "by_scope_server", keyPath: ["account_scope", "server_id"] },
      { name: "by_scope_sync", keyPath: ["account_scope", "sync_status"] },
    ],
  },
  {
    name: STORES.CONTRACTORS,
    keyPath: "local_id",
    indexes: [
      { name: "by_scope", keyPath: "account_scope" },
      { name: "by_scope_server", keyPath: ["account_scope", "server_id"] },
      { name: "by_scope_sync", keyPath: ["account_scope", "sync_status"] },
    ],
  },
  {
    name: STORES.ATTENDANCE,
    keyPath: "local_id",
    indexes: [
      { name: "by_scope", keyPath: "account_scope" },
      { name: "by_scope_server", keyPath: ["account_scope", "server_id"] },
      // Mirrors the backend app-layer uniqueness of (user_id, worker_id, date)
      // scoped to this device's account. Reads and offline conflict
      // detection use this composite key.
      {
        name: "by_scope_worker_date",
        keyPath: ["account_scope", "worker_id", "date"],
      },
      { name: "by_scope_worker", keyPath: ["account_scope", "worker_id"] },
      { name: "by_scope_date", keyPath: ["account_scope", "date"] },
    ],
  },
  {
    name: STORES.ADVANCES,
    keyPath: "local_id",
    indexes: [
      { name: "by_scope", keyPath: "account_scope" },
      { name: "by_scope_server", keyPath: ["account_scope", "server_id"] },
      { name: "by_scope_worker", keyPath: ["account_scope", "worker_id"] },
    ],
  },
  {
    name: STORES.ADVANCE_RETURNS,
    keyPath: "local_id",
    indexes: [
      { name: "by_scope", keyPath: "account_scope" },
      { name: "by_scope_server", keyPath: ["account_scope", "server_id"] },
      { name: "by_scope_worker", keyPath: ["account_scope", "worker_id"] },
    ],
  },
  {
    name: STORES.CONTRACTOR_VISITS,
    keyPath: "local_id",
    indexes: [
      { name: "by_scope", keyPath: "account_scope" },
      { name: "by_scope_server", keyPath: ["account_scope", "server_id"] },
      { name: "by_scope_contractor", keyPath: ["account_scope", "contractor_id"] },
    ],
  },
  {
    name: STORES.CONTRACTOR_PAYMENTS,
    keyPath: "local_id",
    indexes: [
      { name: "by_scope", keyPath: "account_scope" },
      { name: "by_scope_server", keyPath: ["account_scope", "server_id"] },
      { name: "by_scope_contractor", keyPath: ["account_scope", "contractor_id"] },
    ],
  },
  {
    name: STORES.CONTRACTOR_RETURNS,
    keyPath: "local_id",
    indexes: [
      { name: "by_scope", keyPath: "account_scope" },
      { name: "by_scope_server", keyPath: ["account_scope", "server_id"] },
      { name: "by_scope_contractor", keyPath: ["account_scope", "contractor_id"] },
    ],
  },
  {
    name: STORES.SETTLEMENTS,
    keyPath: "local_id",
    indexes: [
      { name: "by_scope", keyPath: "account_scope" },
      { name: "by_scope_server", keyPath: ["account_scope", "server_id"] },
      { name: "by_scope_worker", keyPath: ["account_scope", "worker_id"] },
      { name: "by_scope_contractor", keyPath: ["account_scope", "contractor_id"] },
    ],
  },

  // --- Derived caches -------------------------------------------------
  // Ledger caches key on (account_scope, entity_id, range_key) so
  // current-cycle and per-range history snapshots co-exist without
  // clobbering each other.
  {
    name: STORES.WORKER_LEDGER_CACHE,
    keyPath: "cache_key", // "<scope>|<worker_id>|<range>"
    indexes: [
      { name: "by_scope", keyPath: "account_scope" },
      { name: "by_scope_worker", keyPath: ["account_scope", "worker_id"] },
    ],
  },
  {
    name: STORES.CONTRACTOR_LEDGER_CACHE,
    keyPath: "cache_key",
    indexes: [
      { name: "by_scope", keyPath: "account_scope" },
      { name: "by_scope_contractor", keyPath: ["account_scope", "contractor_id"] },
    ],
  },
  {
    name: STORES.DASHBOARD_CACHE,
    // One snapshot per account.
    keyPath: "account_scope",
    indexes: [],
  },
  {
    name: STORES.CALENDAR_CACHE,
    keyPath: "cache_key", // "<scope>|<worker_id>|<year>|<month>"
    indexes: [
      { name: "by_scope", keyPath: "account_scope" },
      { name: "by_scope_worker", keyPath: ["account_scope", "worker_id"] },
    ],
  },

  // --- Sync infrastructure -------------------------------------------
  {
    name: STORES.SYNC_QUEUE,
    keyPath: "operation_id",
    indexes: [
      { name: "by_scope", keyPath: "account_scope" },
      { name: "by_scope_status", keyPath: ["account_scope", "sync_status"] },
      { name: "by_scope_created", keyPath: ["account_scope", "local_created_at"] },
      { name: "by_scope_entity", keyPath: ["account_scope", "entity_type"] },
    ],
  },
  {
    name: STORES.SYNC_METADATA,
    // Single row per account holding last_sync_at, last_full_sync_at,
    // last_failed_at, pending_count, requires_review_count.
    keyPath: "account_scope",
    indexes: [],
  },

  // --- Device-local ---------------------------------------------------
  {
    name: STORES.LOCAL_ACCOUNTS,
    // One row per account that has ever hydrated on this device.
    keyPath: "account_scope",
    indexes: [
      { name: "by_user", keyPath: "user_id" },
    ],
  },
  {
    name: STORES.APP_META,
    // Key/value bag: schema_version, cache_version, build_hash,
    // hydration_progress by account, etc.
    keyPath: "key",
    indexes: [],
  },
];

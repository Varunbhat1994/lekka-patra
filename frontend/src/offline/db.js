// IndexedDB open + versioned upgrade path for offline-first support.
//
// The schema is defined in ./schema.js. This module ONLY handles:
//   1. Opening the database with the current DB_VERSION
//   2. Deterministic per-version upgrade migrations
//   3. Returning a shared IDBPDatabase instance for the app's lifetime
//
// Reads/writes live in ./repo.js so this file stays small and
// auditable. Any schema change must be reflected in schema.js AND
// a new `if (oldVersion < N)` branch here.

import { openDB } from "idb";
import { DB_NAME, DB_VERSION, STORE_DEFS, STORES } from "./schema";

let _dbPromise = null;

/**
 * Open (or return the already-open) IndexedDB instance.
 * Idempotent — safe to call from anywhere in the app; subsequent
 * callers await the same promise.
 */
export function getDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, newVersion, tx) {
      // Version 1: initial schema. Every store declared in
      // STORE_DEFS is created with its full index set.
      if (oldVersion < 1) {
        for (const def of STORE_DEFS) {
          if (db.objectStoreNames.contains(def.name)) continue;
          const store = db.createObjectStore(def.name, { keyPath: def.keyPath });
          for (const idx of def.indexes || []) {
            store.createIndex(idx.name, idx.keyPath, {
              unique: !!idx.unique,
              multiEntry: !!idx.multiEntry,
            });
          }
        }
      }
      // Future: `if (oldVersion < 2) { ... }` — add migrations here.
    },
    blocked() {
      // Another tab is holding an older version open. This is rare in
      // production because we bump versions only alongside a full
      // deploy; log but do not throw.
      // eslint-disable-next-line no-console
      console.warn("[offline] IDB open blocked by another tab holding an older version");
    },
    blocking() {
      // We are the older version blocking a new-version tab. Close so
      // the newer tab can upgrade.
      // eslint-disable-next-line no-console
      console.warn("[offline] IDB version blocked by this tab; closing");
      if (_dbPromise) {
        _dbPromise.then((db) => db.close()).catch(() => {});
        _dbPromise = null;
      }
    },
    terminated() {
      _dbPromise = null;
    },
  });
  return _dbPromise;
}

/**
 * Close the shared connection. Only used by tests / account teardown.
 * Subsequent `getDB()` calls will re-open lazily.
 */
export async function closeDB() {
  if (!_dbPromise) return;
  try {
    const db = await _dbPromise;
    db.close();
  } finally {
    _dbPromise = null;
  }
}

/**
 * Development helper: return the actual set of stores + indexes
 * present in the open DB. Used by the diagnostic tool in repo.js and
 * by browser-console verification during initial rollout.
 */
export async function describeDB() {
  const db = await getDB();
  const out = { name: db.name, version: db.version, stores: {} };
  for (const name of Array.from(db.objectStoreNames)) {
    const tx = db.transaction(name, "readonly");
    const store = tx.objectStore(name);
    out.stores[name] = {
      keyPath: store.keyPath,
      indexes: Array.from(store.indexNames).map((n) => {
        const idx = store.index(n);
        return { name: n, keyPath: idx.keyPath, unique: idx.unique };
      }),
    };
  }
  return out;
}

// Re-export the schema constants for convenience.
export { STORES, DB_NAME, DB_VERSION };

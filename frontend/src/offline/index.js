// Public entry point for the offline-first storage subsystem.
//
// Other app modules should import from here rather than reaching into
// individual files, so we can evolve the internal structure without
// churning imports across the codebase.
//
// This checkpoint (post-offline-storage-layer) exposes ONLY the
// storage foundation. Sync engine, hydration flow, and page-level
// wiring land in subsequent checkpoints per Section 20.

export { getDB, closeDB, describeDB, STORES, DB_NAME, DB_VERSION } from "./db";
export {
  put,
  putAll,
  listByScope,
  getSingle,
  findByServerId,
  findAttendance,
  deleteByKey,
  wipeAccount,
  countByScope,
  uuid,
} from "./repo";
export { computeAccountScope } from "./accountScope";
export {
  runHydration, getHydrationProgress, getLocalAccount,
  isOfflineReady, markLastOnline, HYDRATION_STEPS,
} from "./hydration";
export {
  listWorkers, createWorker, updateWorker,
  listContractors, createContractor, updateContractor,
  listAttendanceByDate, saveAttendance,
} from "./dataLayer";

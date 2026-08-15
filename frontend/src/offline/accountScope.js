// Account scope = SHA-256(user_id) — derived once at first successful
// hydration and stamped on every IDB row + queue op (Step 1F).
//
// Purpose: on-device tenant partition. If two Google accounts ever
// share the same browser profile, their offline caches and queues
// remain provably separate because every store's composite indexes
// begin with account_scope.
//
// The backend never trusts account_scope — it still derives user_id
// from the session cookie. account_scope is a client-side isolation
// guard only.

/**
 * Compute SHA-256(user_id) as a lowercase hex string.
 * Uses the browser's SubtleCrypto — available in every browser the
 * app supports (React 19 requires a modern engine).
 */
export async function computeAccountScope(userId) {
  if (typeof userId !== "string" || userId.length === 0) {
    throw new Error("computeAccountScope: userId must be a non-empty string");
  }
  const enc = new TextEncoder().encode(userId);
  const digest = await crypto.subtle.digest("SHA-256", enc);
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

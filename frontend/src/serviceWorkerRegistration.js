// Service worker registration + "update available" plumbing.
//
// Registers /service-worker.js under a build-hash-tagged URL param so
// the browser refetches the SW file whenever a new build ships. When
// a new SW is waiting, we surface an "Update available" toast the
// user can tap to activate immediately (postMessage SKIP_WAITING).

import { toast } from "sonner";

// Populated at build time by CRA — REACT_APP_BUILD_HASH may be set in
// the frontend .env; otherwise we fall back to the timestamp of first
// load, which is stable enough for a single client session and never
// leaks to production because the guard below still gates dev.
const BUILD_HASH =
  process.env.REACT_APP_BUILD_HASH || String(Math.floor(Date.now() / 1000));

/**
 * Register the service worker. Safe to call from any environment.
 * In development, we skip registration so hot-reload isn't shadowed
 * by cached shell responses.
 */
export function registerServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  if (process.env.NODE_ENV !== "production") return;

  const swUrl = `/service-worker.js?v=${encodeURIComponent(BUILD_HASH)}`;

  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register(swUrl, { scope: "/" });

      // If a new worker is already waiting, prompt immediately.
      if (reg.waiting) promptUpdate(reg);

      reg.addEventListener("updatefound", () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener("statechange", () => {
          if (nw.state === "installed" && navigator.serviceWorker.controller) {
            promptUpdate(reg);
          }
        });
      });

      // Re-check periodically (browsers do this too, but be explicit).
      setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[sw] registration failed", e);
    }

    // When the active worker changes, the new one has taken over.
    // Reload once so all clients pick up the new bundle atomically.
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  });
}

function promptUpdate(reg) {
  toast("Update available", {
    description: "Tap to load the latest version.",
    action: {
      label: "Update",
      onClick: () => {
        if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
      },
    },
    duration: Infinity,
  });
}

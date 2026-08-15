/* eslint-disable no-restricted-globals */
// Lekka Patra service worker.
//
// Responsibilities in this checkpoint (post-offline-pwa-shell):
//   * App shell (navigation requests) → cache-first fallback with
//     background revalidation.
//   * Versioned static assets (CRA hashed JS/CSS + /icons/*) →
//     cache-first (immutable).
//   * /api/** → NetworkOnly. Offline reads are served from IndexedDB
//     by app logic, not by the SW. Never cache authenticated API
//     responses here.
//   * On activate, evict every lp-shell-* cache whose version does
//     not match this SW's BUILD_HASH.
//   * Handle SKIP_WAITING message so the SPA "Update available" toast
//     can hand control to the new version.

// Derive the build hash from the ?v= query param on the SW's own URL.
// The registrar (serviceWorkerRegistration.js) always registers with
// `?v=<BUILD_HASH>`, so each deploy produces a distinct SW URL AND a
// distinct in-file version constant — enabling activate-time eviction
// of stale caches without any post-build string substitution.
const SW_VERSION =
  (new URL(self.location.href).searchParams.get("v")) || "dev";
const SHELL_CACHE = `lp-shell-${SW_VERSION}`;
const ASSET_CACHE = `lp-static-${SW_VERSION}`;

const APP_SHELL_URLS = ["/", "/index.html", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(APP_SHELL_URLS)).catch(() => {})
  );
  // Do NOT skipWaiting here — the SPA prompts the user first, then
  // messages SKIP_WAITING so the swap is user-consented.
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => (k.startsWith("lp-shell-") || k.startsWith("lp-static-")) &&
                       k !== SHELL_CACHE && k !== ASSET_CACHE)
        .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

function isApiRequest(url) {
  return url.pathname.startsWith("/api/");
}

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/favicon.ico"
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;                 // never cache mutations
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;  // let cross-origin pass through
  if (isApiRequest(url)) return;                    // NetworkOnly for /api/**

  // Navigation requests (SPA route reloads) → shell cache fallback.
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const net = await fetch(req);
        // Refresh the shell cache in the background.
        const cache = await caches.open(SHELL_CACHE);
        cache.put("/index.html", net.clone()).catch(() => {});
        return net;
      } catch {
        const cache = await caches.open(SHELL_CACHE);
        const cached =
          (await cache.match("/index.html")) ||
          (await cache.match("/"));
        if (cached) return cached;
        return new Response(
          "<h1>Offline</h1><p>Reopen when you have a connection.</p>",
          { headers: { "Content-Type": "text/html" }, status: 503 }
        );
      }
    })());
    return;
  }

  // Versioned static assets → cache-first.
  if (isStaticAsset(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(ASSET_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const net = await fetch(req);
        if (net.ok) cache.put(req, net.clone()).catch(() => {});
        return net;
      } catch (e) {
        return hit || Response.error();
      }
    })());
    return;
  }

  // Everything else on same origin: try network then cache.
  event.respondWith((async () => {
    try { return await fetch(req); }
    catch {
      const c = await caches.match(req);
      return c || Response.error();
    }
  })());
});

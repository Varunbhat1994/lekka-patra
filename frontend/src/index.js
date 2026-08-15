import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/index.css";
import App from "@/App";
import * as offline from "@/offline";
import { registerServiceWorker } from "@/serviceWorkerRegistration";

// Dev/QA hook: expose the offline storage API on `window` so the
// browser console can drive the post-offline-storage-layer verification
// (open DB, roundtrip a record, prove account-scope isolation) without
// any UI wiring in this checkpoint. Subsequent checkpoints will consume
// these functions directly from the modules.
//
// Gated behind NODE_ENV so the debug surface never ships in production
// builds (CRA/webpack DefinePlugin replaces process.env.NODE_ENV at
// build time and dead-code-eliminates the entire block).
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  window.__offline = offline;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);

registerServiceWorker();

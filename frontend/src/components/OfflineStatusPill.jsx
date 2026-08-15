// Minimal offline / sync status pill (Step 2 §15).
//
// Renders ONE small pill in the AppShell header — never redesigns the
// existing UI. Six states are declared in Step 2 §15; this checkpoint
// wires the three that can be represented without the sync engine:
//   ONLINE, OFFLINE, PENDING SYNC N.
// The remaining states (SYNCING, SYNC COMPLETE, SYNC FAILED,
// REQUIRES REVIEW) light up in later checkpoints when the sync engine
// begins draining SYNC_QUEUE.

import { useEffect, useState } from "react";
import { useApp } from "@/context/AppContext";
import { listByScope, STORES } from "@/offline";

export default function OfflineStatusPill() {
  const { accountScope, isOnline } = useApp();
  const [pending, setPending] = useState(0);

  useEffect(() => {
    if (!accountScope) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const q = await listByScope(STORES.SYNC_QUEUE, accountScope);
        if (!cancelled) setPending(q.filter((o) => o.sync_status === "pending" || o.sync_status === "failed").length);
      } catch { /* ignore */ }
    };
    tick();
    const id = setInterval(tick, 10_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [accountScope, isOnline]);

  if (!accountScope) return null;

  let label, cls, testid;
  if (!isOnline) {
    label = pending > 0 ? `Offline · ${pending} pending` : "Offline";
    cls = "bg-neutral-200 text-neutral-700";
    testid = "offline-pill";
  } else if (pending > 0) {
    label = `Pending sync ${pending}`;
    cls = "bg-amber-100 text-amber-800";
    testid = "pending-pill";
  } else {
    label = "Online";
    cls = "bg-emerald-100 text-emerald-800";
    testid = "online-pill";
  }
  return (
    <span
      data-testid={testid}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {label}
    </span>
  );
}

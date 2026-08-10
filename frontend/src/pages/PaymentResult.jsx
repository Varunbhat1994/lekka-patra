import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import { useApp } from "@/context/AppContext";
import { Button } from "@/components/ui/button";
import { CheckCircle, XCircle, Spinner } from "@phosphor-icons/react";

export function PaymentSuccess() {
  const { API, refresh } = useApp();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [status, setStatus] = useState("polling");
  const sessionId = params.get("session_id");

  useEffect(() => {
    if (!sessionId) return;
    let attempts = 0;
    const iv = setInterval(async () => {
      attempts += 1;
      try {
        const { data } = await axios.get(`${API}/payments/status/${sessionId}`);
        if (data.payment_status === "paid") {
          clearInterval(iv);
          setStatus("paid");
          await refresh();
          setTimeout(() => nav("/dashboard"), 1500);
        } else if (attempts > 30) {
          clearInterval(iv);
          setStatus("timeout");
        }
      } catch { /* keep polling */ }
    }, 2000);
    return () => clearInterval(iv);
  }, [sessionId, API, nav, refresh]);

  return (
    <div className="min-h-screen grid place-items-center bg-[hsl(var(--background))] px-6">
      <div className="max-w-sm w-full text-center rounded-2xl border border-border bg-card p-8">
        {status === "polling" && (
          <>
            <Spinner size={48} weight="duotone" className="mx-auto animate-spin text-[hsl(var(--primary))]"/>
            <h2 className="mt-4 text-xl font-semibold">Confirming payment…</h2>
            <p className="mt-2 text-sm text-muted-foreground">This takes a few seconds.</p>
          </>
        )}
        {status === "paid" && (
          <>
            <CheckCircle size={56} weight="fill" className="mx-auto text-[hsl(var(--primary))]"/>
            <h2 className="mt-4 text-2xl font-semibold">Payment successful</h2>
            <p className="mt-2 text-sm text-muted-foreground">Lifetime access unlocked.</p>
          </>
        )}
        {status === "timeout" && (
          <>
            <XCircle size={56} weight="fill" className="mx-auto text-[hsl(var(--accent))]"/>
            <h2 className="mt-4 text-2xl font-semibold">Still pending</h2>
            <p className="mt-2 text-sm text-muted-foreground">Refresh in a minute.</p>
            <Button className="mt-4" onClick={() => nav("/dashboard")}>Go to dashboard</Button>
          </>
        )}
      </div>
    </div>
  );
}

export function PaymentCancel() {
  const nav = useNavigate();
  return (
    <div className="min-h-screen grid place-items-center bg-[hsl(var(--background))] px-6">
      <div className="max-w-sm w-full text-center rounded-2xl border border-border bg-card p-8">
        <XCircle size={56} weight="fill" className="mx-auto text-muted-foreground"/>
        <h2 className="mt-4 text-2xl font-semibold">Payment cancelled</h2>
        <p className="mt-2 text-sm text-muted-foreground">You can try again anytime.</p>
        <Button className="mt-4 bg-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/90" onClick={() => nav("/paywall")}>Try again</Button>
      </div>
    </div>
  );
}

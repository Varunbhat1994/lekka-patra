import { useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { useApp } from "@/context/AppContext";
import { Button } from "@/components/ui/button";
import { CheckCircle, Sparkle, ArrowLeft } from "@phosphor-icons/react";

export default function Paywall() {
  const { t, API, user } = useApp();
  const nav = useNavigate();
  const [loading, setLoading] = useState(false);

  const start = async () => {
    setLoading(true);
    try {
      const { data } = await axios.post(`${API}/payments/checkout`, {
        origin_url: window.location.origin,
      });
      window.location.href = data.checkout_url;
    } catch (e) {
      console.error(e);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[hsl(var(--background))]">
      <div className="mx-auto max-w-md min-h-screen border-x border-border/60 flex flex-col">
        <div className="relative h-56 overflow-hidden">
          <img src="https://images.unsplash.com/photo-1586819158505-d7f6227d19d4" alt="" className="absolute inset-0 w-full h-full object-cover"/>
          <div className="absolute inset-0 bg-gradient-to-b from-black/30 to-[hsl(var(--background))]"/>
          <button data-testid="paywall-back" onClick={() => nav(-1)}
            className="absolute top-5 left-5 h-9 w-9 rounded-full bg-white/85 backdrop-blur grid place-items-center">
            <ArrowLeft size={18}/>
          </button>
        </div>

        <div className="px-6 -mt-8 relative flex-1 flex flex-col">
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-[hsl(var(--primary))] font-semibold">
              <Sparkle size={14} weight="fill"/>Lifetime Access
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">{t("unlock_lifetime")}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{t("lifetime_desc")}</p>

            <div className="mt-6 flex items-baseline gap-2">
              <span className="text-4xl font-semibold tracking-tight">₹499</span>
              <span className="text-sm text-muted-foreground">{t("lifetime_price").replace("₹499","").trim() || "one-time"}</span>
            </div>

            <ul className="mt-6 space-y-3">
              {[
                "Unlimited workers & attendance",
                "Advance & wage ledger",
                "PDF & Excel reports",
                "WhatsApp share (English & Kannada)",
                "Cloud sync across devices",
              ].map(f => (
                <li key={f} className="flex items-start gap-3 text-sm">
                  <CheckCircle size={18} weight="fill" className="text-[hsl(var(--primary))] mt-0.5 shrink-0"/>
                  <span>{f}</span>
                </li>
              ))}
            </ul>

            <Button
              data-testid="paywall-pay-btn"
              onClick={start}
              disabled={loading || user?.access?.is_paid}
              className="w-full mt-6 min-h-[56px] rounded-xl bg-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/90 text-base font-semibold"
            >
              {user?.access?.is_paid ? "Already Purchased" : loading ? "…" : `${t("pay_now")} · ₹499`}
            </Button>
            <p className="mt-3 text-[11px] text-center text-muted-foreground">
              Secured by Stripe · UPI, Cards, Netbanking
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

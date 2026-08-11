import { useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { useApp } from "@/context/AppContext";
import { Button } from "@/components/ui/button";
import { CheckCircle, Sparkle, ArrowLeft } from "@phosphor-icons/react";
import { toast } from "sonner";

const RAZORPAY_SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";

function loadRazorpayScript() {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const s = document.createElement("script");
    s.src = RAZORPAY_SCRIPT;
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

export default function Paywall() {
  const { t, API, user, refresh } = useApp();
  const nav = useNavigate();
  const [loading, setLoading] = useState(false);

  const start = async () => {
    setLoading(true);
    try {
      const ok = await loadRazorpayScript();
      if (!ok) {
        toast.error("Failed to load Razorpay");
        setLoading(false);
        return;
      }
      const { data: order } = await axios.post(`${API}/payments/order`, {});
      const rzp = new window.Razorpay({
        key: order.key_id,
        amount: order.amount,
        currency: order.currency,
        name: "Lekka Patra",
        description: "Lifetime access",
        order_id: order.order_id,
        prefill: order.prefill || {},
        theme: { color: "#2f6b3b" },
        handler: async (response) => {
          try {
            await axios.post(`${API}/payments/verify`, {
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            });
            await refresh();
            nav("/payment/success", { replace: true });
          } catch (e) {
            toast.error("Payment verification failed");
            nav("/payment/cancel", { replace: true });
          }
        },
        modal: {
          ondismiss: () => setLoading(false),
        },
      });
      rzp.on("payment.failed", () => {
        toast.error("Payment failed. Please try again.");
        setLoading(false);
      });
      rzp.open();
    } catch (e) {
      console.error(e);
      toast.error(e.response?.data?.detail || "Failed to start payment");
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
              <Sparkle size={14} weight="fill"/>Annual Plan · ₹99 / year
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">{t("unlock_lifetime")}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{t("lifetime_desc")}</p>

            <div className="mt-6 flex items-baseline gap-2">
              <span className="text-4xl font-semibold tracking-tight">₹99</span>
              <span className="text-sm text-muted-foreground">/ year</span>
            </div>

            <ul className="mt-6 space-y-3">
              {[
                "Unlimited workers & attendance",
                "Advance & wage ledger",
                "PDF & Excel reports",
                "WhatsApp share (English & Kannada)",
                "Cloud sync across devices",
                "Cancel anytime by not renewing",
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
              disabled={loading || user?.access?.subscription_active}
              className="w-full mt-6 min-h-[56px] rounded-xl bg-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/90 text-base font-semibold"
            >
              {user?.access?.subscription_active
                ? `Active · ${user?.access?.subscription_days_left} days left`
                : loading ? "…" : `${t("pay_now")} · ₹99 / year`}
            </Button>
            <p className="mt-3 text-[11px] text-center text-muted-foreground">
              Secured by Razorpay · UPI, Cards, Netbanking, Wallets
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

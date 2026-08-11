import { useApp } from "@/context/AppContext";
import { useNavigate } from "react-router-dom";
import { Clock, Sparkle } from "@phosphor-icons/react";

export default function TrialBanner() {
  const { user, t } = useApp();
  const nav = useNavigate();
  if (!user) return null;
  const acc = user.access || {};
  if (acc.subscription_active) return null;

  if (acc.locked) {
    return (
      <button
        data-testid="paywall-banner"
        onClick={() => nav("/paywall")}
        className="w-full text-left rounded-xl border border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/10 px-4 py-3 flex items-center gap-3 active:scale-[0.99] transition-transform"
      >
        <div className="h-9 w-9 rounded-lg bg-[hsl(var(--accent))] text-white grid place-items-center">
          <Sparkle size={18} weight="fill"/>
        </div>
        <div className="flex-1">
          <div className="text-sm font-medium">{t("trial_expired")}</div>
          <div className="text-xs text-muted-foreground">{t("read_only_desc")}</div>
        </div>
        <div className="text-xs font-semibold text-[hsl(var(--accent))] uppercase tracking-wider">
          {t("upgrade")}
        </div>
      </button>
    );
  }
  return (
    <button
      data-testid="trial-banner"
      onClick={() => nav("/paywall")}
      className="w-full text-left rounded-xl border border-border bg-secondary/40 px-4 py-3 flex items-center gap-3"
    >
      <div className="h-9 w-9 rounded-lg bg-[hsl(var(--primary))] text-white grid place-items-center">
        <Clock size={18} weight="duotone"/>
      </div>
      <div className="flex-1">
        <div className="text-sm font-medium">{acc.trial_days_left} {t("trial_days_left")}</div>
        <div className="text-xs text-muted-foreground">{t("lifetime_desc")}</div>
      </div>
      <div className="text-xs font-semibold text-[hsl(var(--primary))] uppercase tracking-wider">
        {t("upgrade")}
      </div>
    </button>
  );
}

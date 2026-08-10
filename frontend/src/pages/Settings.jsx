import AppShell from "@/components/AppShell";
import TrialBanner from "@/components/TrialBanner";
import { useApp } from "@/context/AppContext";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { SignOut, Translate, Check, Sparkle } from "@phosphor-icons/react";

export default function Settings() {
  const { t, user, lang, setLanguage, logout } = useApp();
  const nav = useNavigate();
  const acc = user?.access || {};

  return (
    <AppShell title={t("settings")}>
      <div className="space-y-4">
        <TrialBanner />

        <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
          {user?.picture ? (
            <img src={user.picture} alt="" className="h-12 w-12 rounded-full border border-border"/>
          ) : <div className="h-12 w-12 rounded-full bg-secondary"/>}
          <div className="flex-1 min-w-0">
            <div className="font-medium truncate">{user?.name}</div>
            <div className="text-xs text-muted-foreground truncate">{user?.email}</div>
          </div>
          {acc.is_paid && (
            <div className="text-[10px] uppercase tracking-wider bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))] px-2 py-1 rounded-full font-semibold flex items-center gap-1">
              <Sparkle size={12} weight="fill"/>Lifetime
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground mb-3">
            <Translate size={16} weight="duotone"/>{t("language")}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[{c:"en", n:"English"},{c:"kn", n:"ಕನ್ನಡ"}].map(l => (
              <button
                key={l.c}
                data-testid={`settings-lang-${l.c}`}
                onClick={() => setLanguage(l.c)}
                className={`min-h-[52px] rounded-lg border text-sm font-medium flex items-center justify-center gap-2 ${
                  lang===l.c ? "bg-[hsl(var(--primary))] text-white border-transparent" : "bg-white border-border"
                }`}
              >
                {lang===l.c && <Check size={14} weight="bold"/>}
                {l.n}
              </button>
            ))}
          </div>
        </div>

        {!acc.is_paid && (
          <button
            data-testid="settings-upgrade"
            onClick={() => nav("/paywall")}
            className="w-full rounded-xl border border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5 p-4 text-left"
          >
            <div className="text-xs uppercase tracking-[0.18em] text-[hsl(var(--primary))] font-semibold">{t("upgrade")}</div>
            <div className="text-lg font-semibold mt-1">{t("unlock_lifetime")}</div>
            <div className="text-xs text-muted-foreground">{t("lifetime_price")}</div>
          </button>
        )}

        <Button
          data-testid="logout-btn"
          onClick={async () => { await logout(); nav("/login"); }}
          variant="outline"
          className="w-full min-h-[52px] rounded-xl border-[hsl(var(--accent))] text-[hsl(var(--accent))] hover:bg-[hsl(var(--accent))]/10"
        >
          <SignOut size={18} weight="duotone" className="mr-2"/>{t("logout")}
        </Button>

        <div className="text-center text-[11px] text-muted-foreground pt-4">
          FarmLog · v1.0
        </div>
      </div>
    </AppShell>
  );
}

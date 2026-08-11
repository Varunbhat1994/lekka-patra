import { useApp } from "@/context/AppContext";
import { Button } from "@/components/ui/button";
import { GoogleLogo, Plant, DeviceMobile } from "@phosphor-icons/react";
import { useNavigate } from "react-router-dom";

export default function Login() {
  const { t, lang } = useApp();
  const nav = useNavigate();

  const signin = () => {
    // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
    const redirectUrl = window.location.origin + "/dashboard";
    window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
  };

  return (
    <div className="min-h-screen bg-[hsl(var(--background))]">
      <div className="mx-auto max-w-md min-h-screen relative flex flex-col">
        <div className="relative h-72 overflow-hidden">
          <img
            src="https://images.unsplash.com/photo-1500382017468-9049fed747ef"
            alt="field"
            className="absolute inset-0 w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-black/30 to-[hsl(var(--background))]"/>
          <div className="absolute top-6 left-6 flex items-center gap-2 text-white">
            <div className="h-9 w-9 rounded-lg bg-white/20 backdrop-blur-md grid place-items-center border border-white/30">
              <Plant size={20} weight="duotone" />
            </div>
            <span className="font-semibold tracking-tight">Lekka Patra</span>
          </div>
        </div>

        <div className="px-6 -mt-8 relative flex-1 flex flex-col">
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              {lang === "kn" ? "ಸ್ವಾಗತ" : "Welcome"}
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">
              {t("app_name")}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">{t("tagline")}</p>

            <Button
              data-testid="google-signin-btn"
              onClick={signin}
              className="w-full mt-6 min-h-[52px] rounded-xl bg-[hsl(var(--foreground))] text-white hover:bg-[hsl(var(--foreground))]/90"
            >
              <GoogleLogo size={20} weight="bold" className="mr-2"/>
              {t("google_signin")}
            </Button>

            <div className="my-4 flex items-center gap-3 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              <div className="h-px bg-border flex-1"/> or <div className="h-px bg-border flex-1"/>
            </div>

            <Button
              data-testid="mobile-signin-btn"
              onClick={() => nav("/otp")}
              variant="outline"
              className="w-full min-h-[52px] rounded-xl border-[hsl(var(--primary))] text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/5"
            >
              <DeviceMobile size={20} weight="duotone" className="mr-2"/>
              {lang === "kn" ? "ಮೊಬೈಲ್ ಸಂಖ್ಯೆಯಿಂದ" : "Continue with mobile"}
            </Button>

            <button
              data-testid="lang-switch-btn"
              onClick={() => nav("/")}
              className="mt-3 w-full text-xs text-muted-foreground hover:underline"
            >
              {lang === "kn" ? "ಭಾಷೆ ಬದಲಾಯಿಸಿ" : "Change language"}
            </button>
          </div>

          <div className="mt-8 space-y-3 text-sm">
            <FeatureRow txt={lang === "kn" ? "15 ದಿನಗಳ ಉಚಿತ ಟ್ರಯಲ್" : "15-day free trial"} />
            <FeatureRow txt={lang === "kn" ? "ಡೇಟಾ ಕ್ಲೌಡ್‌ನಲ್ಲಿ ಸಂಗ್ರಹ" : "Data saved to cloud"} />
            <FeatureRow txt={lang === "kn" ? "PDF / Excel ರಫ್ತು" : "PDF & Excel export"} />
          </div>
        </div>
      </div>
    </div>
  );
}

function FeatureRow({ txt }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-2 w-2 rounded-full bg-[hsl(var(--primary))]"/>
      <span>{txt}</span>
    </div>
  );
}

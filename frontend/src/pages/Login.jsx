import { useApp } from "@/context/AppContext";
import { Button } from "@/components/ui/button";
import { GoogleLogo, Plant } from "@phosphor-icons/react";
import { useNavigate } from "react-router-dom";

// Inline leafy hero motif (softer version of the Dashboard leaves).
function LoginHero() {
  return (
    <svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg"
         className="w-full h-full" preserveAspectRatio="xMidYMid slice"
         aria-hidden="true">
      <defs>
        <linearGradient id="lg" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="hsl(140 45% 42%)"/>
          <stop offset="1" stopColor="hsl(150 50% 30%)"/>
        </linearGradient>
        <linearGradient id="hills" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="hsl(140 30% 78%)"/>
          <stop offset="1" stopColor="hsl(140 30% 62%)"/>
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="400" height="220" fill="url(#lg)"/>
      {/* Sun */}
      <circle cx="330" cy="50" r="26" fill="hsl(45 90% 78%)" opacity="0.9"/>
      {/* Hills */}
      <path d="M0 160 Q 100 120 180 150 T 400 140 V 220 H 0 Z" fill="url(#hills)" opacity="0.55"/>
      <path d="M0 180 Q 120 150 240 170 T 400 180 V 220 H 0 Z" fill="url(#hills)" opacity="0.75"/>
      {/* Farm workers silhouettes */}
      <g fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.85">
        <circle cx="120" cy="150" r="9"/>
        <path d="M120 159 v22 M111 170 h18"/>
        <path d="M120 181 l-6 20 M120 181 l6 20"/>
        <circle cx="160" cy="150" r="9"/>
        <path d="M160 159 v22 M151 170 h18"/>
        <path d="M160 181 l-6 20 M160 181 l6 20"/>
        <path d="M170 152 l 26 -18"/>
        <path d="M195 132 l6 3 -3 6"/>
      </g>
      {/* Sprout */}
      <g fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" opacity="0.9">
        <path d="M260 200 v-16"/>
        <path d="M260 190 C 254 186 250 184 246 184"/>
        <path d="M260 190 C 266 186 270 184 274 184"/>
      </g>
    </svg>
  );
}

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

        {/* Hero */}
        <div className="relative h-64 overflow-hidden">
          <LoginHero />
          <div className="absolute top-6 left-6 flex items-center gap-2 text-white">
            <div className="h-10 w-10 rounded-xl bg-white/20 backdrop-blur-md grid place-items-center border border-white/30">
              <Plant size={22} weight="duotone" />
            </div>
            <span className="text-lg font-semibold tracking-tight">Lekka Patra</span>
          </div>
        </div>

        {/* Card */}
        <div className="px-6 -mt-10 relative flex-1 flex flex-col">
          <div className="rounded-2xl border border-border bg-card p-6 shadow-xl">
            <div className="text-xs uppercase tracking-[0.24em] text-[hsl(var(--primary))] font-semibold">
              {lang === "kn" ? "ಸ್ವಾಗತ" : "Welcome"}
            </div>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground">
              {t("app_name")}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
              {t("tagline")}
            </p>

            <Button
              data-testid="google-signin-btn"
              onClick={signin}
              className="w-full mt-6 min-h-[54px] rounded-2xl bg-[hsl(var(--primary))] text-white hover:bg-[hsl(var(--primary))]/90 text-base font-semibold shadow-md"
            >
              <GoogleLogo size={22} weight="bold" className="mr-2"/>
              {t("google_signin")}
            </Button>

            <button
              data-testid="lang-switch-btn"
              onClick={() => nav("/")}
              className="mt-4 w-full text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              {lang === "kn" ? "ಭಾಷೆ ಬದಲಾಯಿಸಿ" : "Change language"}
            </button>
          </div>

          <div className="mt-8 space-y-3 text-sm">
            <FeatureRow txt={lang === "kn" ? "ಸಂಪೂರ್ಣ ಉಚಿತ · ಎಲ್ಲಾ ವೈಶಿಷ್ಟ್ಯಗಳು" : "Completely free · All features included"} />
            <FeatureRow txt={lang === "kn" ? "ಡೇಟಾ ಕ್ಲೌಡ್‌ನಲ್ಲಿ ಸಂಗ್ರಹ" : "Data saved to cloud"} />
            <FeatureRow txt={lang === "kn" ? "PDF ವರದಿಗಳು" : "PDF reports"} />
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

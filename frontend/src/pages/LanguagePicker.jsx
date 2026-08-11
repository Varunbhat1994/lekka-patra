import { useNavigate } from "react-router-dom";
import { useApp } from "@/context/AppContext";
import { Button } from "@/components/ui/button";
import { Plant, Leaf } from "@phosphor-icons/react";

export default function LanguagePicker() {
  const { setLanguage, t } = useApp();
  const nav = useNavigate();
  const pick = (l) => { setLanguage(l); nav("/login"); };

  return (
    <div className="min-h-screen bg-[hsl(var(--background))] relative overflow-hidden">
      <div className="absolute inset-0 opacity-[0.08] pointer-events-none" style={{
        backgroundImage: "radial-gradient(circle at 25% 20%, hsl(142 60% 45% / 0.4) 0, transparent 40%), radial-gradient(circle at 75% 80%, hsl(15 65% 60% / 0.35) 0, transparent 40%)",
      }}/>
      <div className="relative mx-auto max-w-md min-h-screen px-6 py-12 flex flex-col">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-[hsl(var(--primary))] text-white grid place-items-center">
            <Plant size={22} weight="duotone" />
          </div>
          <div>
            <div className="text-xl font-semibold tracking-tight">Lekka Patra</div>
            <div className="text-xs text-muted-foreground uppercase tracking-[0.2em]">ಲೆಕ್ಕ ಪತ್ರ</div>
          </div>
        </div>

        <div className="mt-16">
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-3">Step 01</div>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight leading-tight">
            {t("choose_language")}
            <span className="block text-[hsl(var(--primary))] mt-1">ನಿಮ್ಮ ಭಾಷೆ</span>
          </h1>
          <p className="mt-4 text-muted-foreground text-sm">
            Track labor attendance, wages, and advances — designed for farm owners.
          </p>
        </div>

        <div className="mt-12 space-y-3">
          <button
            data-testid="lang-en-btn"
            onClick={() => pick("en")}
            className="w-full min-h-[64px] border border-border rounded-xl px-5 flex items-center justify-between active:scale-[0.98] transition-transform bg-white hover:bg-secondary/50"
          >
            <div className="text-left">
              <div className="font-medium text-lg">English</div>
              <div className="text-xs text-muted-foreground">Continue in English</div>
            </div>
            <Leaf size={22} weight="duotone" className="text-[hsl(var(--primary))]"/>
          </button>
          <button
            data-testid="lang-kn-btn"
            onClick={() => pick("kn")}
            className="w-full min-h-[64px] border border-border rounded-xl px-5 flex items-center justify-between active:scale-[0.98] transition-transform bg-white hover:bg-secondary/50"
          >
            <div className="text-left">
              <div className="font-medium text-lg">ಕನ್ನಡ</div>
              <div className="text-xs text-muted-foreground">ಕನ್ನಡದಲ್ಲಿ ಮುಂದುವರೆಸಿ</div>
            </div>
            <Leaf size={22} weight="duotone" className="text-[hsl(var(--primary))]"/>
          </button>
        </div>

        <div className="mt-auto pt-12 text-xs text-muted-foreground/70">
          Made for agriculturists · Works offline-first · Cloud sync
        </div>
      </div>
    </div>
  );
}

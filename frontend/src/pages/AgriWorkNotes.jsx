// My Work Notes & Expenses — Coming Soon.
//
// UI-only. The rest of Lekka Patra is green-primary; this screen keeps
// the app's design language (rounded cards, subtle shadows, tabular
// number-forward look) while communicating a polished "not yet
// available" state. No API calls, no local storage writes, no fake
// data forms.
import React from "react";
import { useNavigate } from "react-router-dom";
import AppShell from "@/components/AppShell";
import { useApp } from "@/context/AppContext";
import { ArrowLeft } from "@phosphor-icons/react";

export default function AgriWorkNotes() {
  const { lang } = useApp();
  const nav = useNavigate();
  const kn = lang === "kn";

  return (
    <AppShell>
      <div
        data-testid="work-notes-coming-soon-screen"
        className="flex flex-col gap-4 pt-1 pb-6"
      >
        {/* Header row with back arrow */}
        <div className="flex items-center gap-2">
          <button
            data-testid="work-notes-back-btn"
            onClick={() => nav(-1)}
            className="w-9 h-9 rounded-full grid place-items-center hover:bg-secondary active:scale-95 transition"
            aria-label="Back"
          >
            <ArrowLeft size={18} className="text-[hsl(220_15%_25%)]"/>
          </button>
          <div className="text-[15px] font-semibold text-[hsl(220_15%_18%)]">
            {kn ? "ನನ್ನ ಕೆಲಸ ಟಿಪ್ಪಣಿ ಮತ್ತು ವೆಚ್ಚಗಳು" : "My Work Notes & Expenses"}
          </div>
        </div>

        {/* Illustrated hero card */}
        <div
          className="relative overflow-hidden rounded-3xl border border-[hsl(170_40%_88%)] px-6 pt-8 pb-9 text-center"
          style={{
            background:
              "linear-gradient(180deg, hsl(170 55% 96%) 0%, hsl(150 45% 94%) 100%)",
          }}
        >
          {/* Soft decorative rings */}
          <span className="absolute -top-6 -right-6 w-24 h-24 rounded-full bg-[hsl(170_60%_88%)]/60"/>
          <span className="absolute -bottom-8 -left-6 w-28 h-28 rounded-full bg-[hsl(150_60%_88%)]/50"/>

          {/* Central illustration */}
          <div className="relative mx-auto w-24 h-24 rounded-full bg-white shadow-[0_10px_30px_-8px_rgba(20,90,80,0.25)] grid place-items-center mb-5">
            <svg viewBox="0 0 64 64" width="52" height="52" fill="none">
              <rect x="14" y="12" width="32" height="42" rx="4" stroke="#2FA091" strokeWidth="2.2" fill="#E1F5F1"/>
              <rect x="22" y="6"  width="16" height="8"  rx="2" stroke="#2FA091" strokeWidth="2.2" fill="#fff"/>
              <path d="M20 24h20M20 32h14M20 40h8" stroke="#2FA091" strokeWidth="2" strokeLinecap="round"/>
              <path d="M36 44l6-6 5 5-6 6z"          stroke="#2FA091" strokeWidth="2" fill="#fff"/>
              <path d="M42 38l3 3"                    stroke="#2FA091" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </div>

          {/* Pill */}
          <div className="relative inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/70 backdrop-blur-sm border border-[hsl(170_45%_82%)] text-[hsl(170_60%_25%)] text-[10px] font-bold uppercase tracking-[0.2em] mb-3">
            <span className="w-1.5 h-1.5 rounded-full bg-[hsl(170_60%_45%)]"/>
            {kn ? "ಶೀಘ್ರದಲ್ಲಿ" : "Coming Soon"}
          </div>

          {/* Title */}
          <div className="relative text-[22px] font-bold text-[hsl(220_18%_15%)] leading-tight">
            {kn ? "ನನ್ನ ಕೆಲಸ ಟಿಪ್ಪಣಿ" : "My Work Notes"}
            <br/>
            <span className="text-[hsl(170_55%_30%)]">
              &amp; {kn ? "ವೆಚ್ಚಗಳು" : "Expenses"}
            </span>
          </div>

          <p className="relative mt-3 text-[12.5px] text-[hsl(220_10%_35%)] max-w-[280px] mx-auto leading-relaxed">
            {kn
              ? "ದೈನಂದಿನ ಕೆಲಸ ಟಿಪ್ಪಣಿಗಳು, ಜ್ಞಾಪನೆಗಳು ಮತ್ತು ಕ್ಷೇತ್ರ ವೆಚ್ಚಗಳನ್ನು ಒಂದೇ ಸ್ಥಳದಲ್ಲಿ. ನಾವು ಶೀಘ್ರವಾಗಿ ತರುತ್ತಿದ್ದೇವೆ."
              : "Daily work notes, quick reminders and field-level expenses — all in one clean space. We're crafting it for you."}
          </p>
        </div>

        {/* Feature preview list — 3 bullets, quiet + intentional */}
        <div className="rounded-2xl border border-[hsl(220_15%_92%)] bg-white p-4 space-y-3">
          <div className="text-[10px] uppercase tracking-[0.22em] text-[hsl(220_10%_45%)] font-semibold">
            {kn ? "ಏನನ್ನು ನಿರೀಕ್ಷಿಸಬಹುದು" : "What to expect"}
          </div>
          {[
            {
              title: kn ? "ದೈನಂದಿನ ಕೆಲಸದ ಲಾಗ್" : "Daily work logs",
              body:  kn ? "ಪ್ರತಿದಿನದ ಕೆಲಸಗಳನ್ನು ಸಣ್ಣ ಟಿಪ್ಪಣಿಗಳಂತೆ ಸೆರೆಹಿಡಿಯಿರಿ." : "Capture what happened each day as short notes.",
            },
            {
              title: kn ? "ಕ್ಷೇತ್ರ-ಮಟ್ಟದ ವೆಚ್ಚಗಳು" : "Field-level expenses",
              body:  kn ? "ಕಾರ್ಮಿಕ, ಸಾಮಗ್ರಿ ಮತ್ತು ಇತರ ವೆಚ್ಚಗಳನ್ನು ಜೋಡಿಸಿ." : "Attach labor, material and other spends per field.",
            },
            {
              title: kn ? "ಶಾಂತವಾದ ಸಾರಾಂಶ" : "Quiet monthly summary",
              body:  kn ? "ತಿಂಗಳಿಗೊಮ್ಮೆ ಸ್ಪಷ್ಟ ಸಾರಾಂಶ — ಗದ್ದಲವಿಲ್ಲದೆ." : "A clean monthly view — without the noise.",
            },
          ].map((f, i) => (
            <div key={i} className="flex items-start gap-3">
              <div className="mt-0.5 w-6 h-6 rounded-full bg-[hsl(170_55%_92%)] text-[hsl(170_60%_28%)] grid place-items-center text-[11px] font-bold shrink-0">
                {i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-[hsl(220_15%_18%)] leading-tight">
                  {f.title}
                </div>
                <div className="mt-0.5 text-[11.5px] text-[hsl(220_10%_45%)] leading-snug">
                  {f.body}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="text-center text-[10.5px] text-[hsl(220_8%_55%)] pt-1">
          {kn
            ? "ಈ ಆವೃತ್ತಿಯಲ್ಲಿ ಈ ವೈಶಿಷ್ಟ್ಯ ಇನ್ನೂ ಲಭ್ಯವಿಲ್ಲ."
            : "This feature isn't available in the current release."}
        </div>
      </div>
    </AppShell>
  );
}

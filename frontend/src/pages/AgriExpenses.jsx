// Agri Expenses — first screen.
//
// Fixed 6-card list matching the approved Google-AI-Studio reference:
//   1. Harvesting             — yellow trees
//   2. Spray                  — green tractor + field
//   3. Transport              — blue delivery truck
//   4. Machineries            — orange tractor
//   5. Others                 — purple target
//   6. My Work Notes & Expenses — teal notepad
//
// UI-ONLY. No backend calls, no ledger, no storage. Tapping the last
// card opens a "Coming Soon" screen; the other five cards are inert
// placeholders (the reference itself shows them as forward-looking
// options, and the task is explicitly scoped as UI-only until the
// underlying features exist).
import React from "react";
import { useNavigate } from "react-router-dom";
import AppShell from "@/components/AppShell";
import { useApp } from "@/context/AppContext";
import { toast } from "sonner";

// ---------- inline illustrations (kept lightweight to fit on one screen) --

const IconHarvesting = () => (
  <svg viewBox="0 0 64 44" width="52" height="36" fill="none">
    <ellipse cx="32" cy="34" rx="26" ry="6" fill="#F6C36A" opacity=".55"/>
    <path d="M18 30c1-6 3-10 6-12" stroke="#7B9C3B" strokeWidth="2" strokeLinecap="round"/>
    <circle cx="20" cy="16" r="7"  fill="#B7D97A"/>
    <circle cx="30" cy="12" r="8"  fill="#8FC24D"/>
    <circle cx="40" cy="16" r="7"  fill="#B7D97A"/>
    <path d="M20 22v10M30 20v14M40 22v10" stroke="#6B8A2E" strokeWidth="2" strokeLinecap="round"/>
    <path d="M8 36h48" stroke="#C99C4D" strokeWidth="2" strokeLinecap="round"/>
  </svg>
);

const IconSpray = () => (
  <svg viewBox="0 0 64 44" width="54" height="36" fill="none">
    <path d="M4 34h56" stroke="#5FA85B" strokeWidth="1.8" strokeLinecap="round"/>
    <path d="M8 38c8-4 20-4 28 0M30 40c6-2 14-2 22 0" stroke="#5FA85B" strokeWidth="1.6" strokeLinecap="round"/>
    <rect x="20" y="16" width="24" height="12" rx="2.5" stroke="#2E7A4C" strokeWidth="2" fill="#E6F6E6"/>
    <path d="M22 16v-4h10v4" stroke="#2E7A4C" strokeWidth="2" fill="none"/>
    <circle cx="26" cy="30" r="4" stroke="#2E7A4C" strokeWidth="2" fill="#E6F6E6"/>
    <circle cx="42" cy="30" r="4" stroke="#2E7A4C" strokeWidth="2" fill="#E6F6E6"/>
    <path d="M44 22l8-4" stroke="#2E7A4C" strokeWidth="2" strokeLinecap="round"/>
  </svg>
);

const IconTransport = () => (
  <svg viewBox="0 0 64 44" width="54" height="36" fill="none">
    <rect x="6"  y="14" width="28" height="18" rx="2" stroke="#2C6BB8" strokeWidth="2" fill="#D9E9FA"/>
    <path d="M34 20h12l6 6v6H34z" stroke="#2C6BB8" strokeWidth="2" fill="#D9E9FA"/>
    <circle cx="16" cy="34" r="4" stroke="#2C6BB8" strokeWidth="2" fill="#fff"/>
    <circle cx="42" cy="34" r="4" stroke="#2C6BB8" strokeWidth="2" fill="#fff"/>
  </svg>
);

const IconMachinery = () => (
  <svg viewBox="0 0 64 44" width="54" height="36" fill="none">
    <rect x="6"  y="14" width="34" height="14" rx="2" stroke="#D66B2A" strokeWidth="2" fill="#FCE1CE"/>
    <path d="M40 18h10l4 8v2H40z" stroke="#D66B2A" strokeWidth="2" fill="#FCE1CE"/>
    <path d="M12 18h22M12 22h22" stroke="#D66B2A" strokeWidth="1.6" strokeLinecap="round"/>
    <circle cx="18" cy="32" r="4" stroke="#D66B2A" strokeWidth="2" fill="#fff"/>
    <circle cx="46" cy="32" r="4" stroke="#D66B2A" strokeWidth="2" fill="#fff"/>
  </svg>
);

const IconOthers = () => (
  <svg viewBox="0 0 44 44" width="40" height="40" fill="none">
    <circle cx="22" cy="22" r="18" stroke="#7C4CB8" strokeWidth="2"/>
    <circle cx="22" cy="22" r="11" stroke="#7C4CB8" strokeWidth="2"/>
    <circle cx="22" cy="22" r="4"  fill="#7C4CB8"/>
  </svg>
);

const IconNotes = () => (
  <svg viewBox="0 0 44 44" width="40" height="40" fill="none">
    <rect x="10" y="8" width="22" height="28" rx="2" stroke="#2FA091" strokeWidth="2" fill="#E1F5F1"/>
    <rect x="16" y="4" width="10" height="4" rx="1"  stroke="#2FA091" strokeWidth="2" fill="#fff"/>
    <path d="M15 18h12M15 23h9" stroke="#2FA091" strokeWidth="1.8" strokeLinecap="round"/>
    <path d="M22 30l4-4 4 4-4 4z" stroke="#2FA091" strokeWidth="1.8" fill="#fff"/>
  </svg>
);

const ExpenseCard = ({ title, subtitle, Icon, tint, onClick, testid }) => (
  <button
    type="button"
    data-testid={testid}
    onClick={onClick}
    className="w-full text-left bg-white rounded-2xl border border-[hsl(45_20%_92%)] shadow-[0_1px_2px_rgba(15,23,42,0.04)] px-4 py-3.5 flex items-center gap-3 active:scale-[0.995] transition-transform"
  >
    <div className="flex-1 min-w-0">
      <div className="text-[15px] font-semibold text-[hsl(220_15%_18%)] leading-tight">
        {title}
      </div>
      <div className="mt-1 text-[11.5px] text-[hsl(220_10%_45%)] leading-snug pr-2">
        {subtitle}
      </div>
    </div>
    <div
      className="shrink-0 w-14 h-14 rounded-full grid place-items-center"
      style={{ backgroundColor: tint }}
    >
      <Icon/>
    </div>
  </button>
);

export default function AgriExpenses() {
  const { lang } = useApp();
  const nav = useNavigate();
  const kn = lang === "kn";

  const inert = () => toast(kn ? "ಶೀಘ್ರದಲ್ಲಿ" : "Coming soon");

  const items = [
    {
      testid: "agri-harvesting",
      title: kn ? "ಕೊಯ್ಲು" : "Harvesting",
      subtitle: kn
        ? "ನಿರ್ಧರಿಸಿ ಮತ್ತು ಪಾಲುಗಳನ್ನು ದಾಖಲಿಸಿ"
        : "Determine and then record and allocate portions",
      Icon: IconHarvesting,
      tint: "hsl(38 85% 92%)",
      onClick: inert,
    },
    {
      testid: "agri-spray",
      title: kn ? "ಸಿಂಪಡಣೆ" : "Spray",
      subtitle: kn
        ? "ಕಳೆ ಮತ್ತು ಸುರಕ್ಷಿತ ಆಯ್ಕೆಗಳಿಗಾಗಿ ಸಿಂಪಡಿಸಿ"
        : "Spray your the dead weed and safe options",
      Icon: IconSpray,
      tint: "hsl(140 55% 92%)",
      onClick: inert,
    },
    {
      testid: "agri-transport",
      title: kn ? "ಸಾಗಣೆ" : "Transport",
      subtitle: kn
        ? "ವಿಶ್ವಾಸಾರ್ಹ ವಿತರಣೆ/ಸಾಗಣೆ ಆಯ್ಕೆಗಳು"
        : "Negotiate reliable delivery/carry options",
      Icon: IconTransport,
      tint: "hsl(215 88% 94%)",
      onClick: inert,
    },
    {
      testid: "agri-machineries",
      title: kn ? "ಯಂತ್ರೋಪಕರಣಗಳು" : "Machineries",
      subtitle: kn
        ? "ನಿಮ್ಮ ಬೆಳೆಗೆ ಯಂತ್ರ ಸೇವೆಯನ್ನು ಬಳಸಿ"
        : "Continue mach service to use your cropping",
      Icon: IconMachinery,
      tint: "hsl(25 85% 93%)",
      onClick: inert,
    },
    {
      testid: "agri-others",
      title: kn ? "ಇತರ" : "Others",
      subtitle: kn
        ? "ಇತರ ಕೃಷಿ ವೆಚ್ಚಗಳು ಮತ್ತು ವಿವಿಧ ದಾಖಲೆಗಳು"
        : "Other farm expenses and miscellaneous records",
      Icon: IconOthers,
      tint: "hsl(268 70% 94%)",
      onClick: inert,
    },
    {
      testid: "agri-work-notes",
      title: kn ? "ನನ್ನ ಕೆಲಸ ಟಿಪ್ಪಣಿ ಮತ್ತು ವೆಚ್ಚಗಳು" : "My Work Notes & Expenses",
      subtitle: kn
        ? "ದಿನನಿತ್ಯದ ಕೆಲಸದ ದಾಖಲೆ ಮತ್ತು ಕಾರ್ಮಿಕ ವೆಚ್ಚಗಳು"
        : "Record daily work logs and field labor expenses",
      Icon: IconNotes,
      tint: "hsl(170 55% 92%)",
      onClick: () => nav("/agri-expenses/work-notes"),
    },
  ];

  return (
    <AppShell>
      <div data-testid="agri-expenses-screen" className="flex flex-col gap-2.5 pt-2 pb-4">
        {/* Header — small green sprout in a soft green circle + title/subtitle */}
        <div className="flex items-center gap-3 pb-1">
          <div className="w-10 h-10 rounded-full bg-[hsl(140_55%_92%)] grid place-items-center">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M12 21V9" stroke="#3E8B4F" strokeWidth="2" strokeLinecap="round"/>
              <path d="M12 9c0-3 2-5 5-5-.2 3-2 5-5 5z" fill="#7CC386"/>
              <path d="M12 12c0-3-2-5-5-5 .2 3 2 5 5 5z" fill="#3E8B4F"/>
            </svg>
          </div>
          <div className="min-w-0">
            <div className="text-[17px] font-bold text-[hsl(220_15%_15%)] leading-tight">
              {kn ? "ನನ್ನ ಕೃಷಿ" : "My Farm"}
            </div>
            <div className="text-[11px] text-[hsl(220_10%_50%)] leading-tight">
              {kn ? "ಕೃಷಿ ವೆಚ್ಚಗಳು" : "Agri Expenses"}
            </div>
          </div>
        </div>

        {items.map((it) => (
          <ExpenseCard key={it.testid} {...it}/>
        ))}
      </div>
    </AppShell>
  );
}

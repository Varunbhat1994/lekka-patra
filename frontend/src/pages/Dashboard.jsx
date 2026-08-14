import { useEffect, useState } from "react";
import axios from "axios";
import AppShell from "@/components/AppShell";
import FeedbackBell from "@/components/FeedbackBell";
import AttendanceCalendar from "@/components/AttendanceCalendar";
import { useApp } from "@/context/AppContext";

function greetingForHour(hour, lang) {
  // Local-time buckets per spec:
  // 05:00–11:59 → Good Morning
  // 12:00–16:59 → Good Afternoon
  // 17:00–20:59 → Good Evening
  // 21:00–04:59 → Good Night
  if (hour >= 5 && hour < 12) return lang === "kn" ? "ಶುಭೋದಯ" : "Good Morning";
  if (hour >= 12 && hour < 17) return lang === "kn" ? "ಶುಭ ಮಧ್ಯಾಹ್ನ" : "Good Afternoon";
  if (hour >= 17 && hour < 21) return lang === "kn" ? "ಶುಭ ಸಂಜೆ" : "Good Evening";
  return lang === "kn" ? "ಶುಭ ರಾತ್ರಿ" : "Good Night";
}

// Inline SVG illustration — two farm workers with hoes. Kept as component
// so we can reuse and adjust color via `currentColor`.
function FarmWorkersIllustration({ className = "" }) {
  return (
    <svg viewBox="0 0 200 160" fill="none" xmlns="http://www.w3.org/2000/svg"
         className={className} aria-hidden="true">
      <g stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none">
        {/* Worker 1 */}
        <circle cx="60" cy="52" r="14"/>
        <path d="M46 46c0-8 6-14 14-14s14 6 14 14"/>
        <path d="M46 46l-4-4M74 46l4-4"/>
        <path d="M50 66l-10 30h40l-10-30"/>
        <path d="M50 96v40M70 96v40"/>
        {/* Worker 2 (with hoe) */}
        <circle cx="120" cy="52" r="14"/>
        <path d="M106 46c0-8 6-14 14-14s14 6 14 14"/>
        <path d="M106 46l-4-4M134 46l4-4"/>
        <path d="M110 66l-10 30h40l-10-30"/>
        <path d="M110 96v40M130 96v40"/>
        {/* Hoe */}
        <path d="M140 44l30-24"/>
        <path d="M168 18l10 4-4 10z"/>
        {/* Ground / plant sprout */}
        <path d="M22 140h156"/>
        <path d="M92 132c0-6 3-10 8-10s8 4 8 10"/>
        <path d="M100 132v-14"/>
      </g>
    </svg>
  );
}

// Inline SVG — small tractor for the Agri Expenses Coming Soon card.
function TractorIllustration({ className = "" }) {
  return (
    <svg viewBox="0 0 200 120" fill="none" xmlns="http://www.w3.org/2000/svg"
         className={className} aria-hidden="true">
      <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none">
        {/* Rolling hills */}
        <path d="M0 90 Q 40 70, 80 90 T 200 90"/>
        <path d="M0 110 Q 60 92, 120 108 T 200 110"/>
        {/* Tractor body */}
        <path d="M70 78 h40 v14 h-40z"/>
        <path d="M110 78 v-14 h20 l6 14"/>
        {/* Wheels */}
        <circle cx="86" cy="94" r="8"/>
        <circle cx="128" cy="94" r="10"/>
        {/* Chimney */}
        <path d="M78 70 v-10 h6 v10"/>
      </g>
    </svg>
  );
}

// Inline SVG — leafy hero decoration (top-right of greeting).
function LeafDecor({ className = "" }) {
  return (
    <svg viewBox="0 0 160 120" xmlns="http://www.w3.org/2000/svg"
         className={className} aria-hidden="true">
      <g fill="currentColor" opacity="0.35">
        <path d="M120 20 C 100 30, 90 60, 100 90 C 120 80, 140 60, 140 30 z"/>
        <path d="M90 40 C 70 46, 62 66, 70 88 C 88 82, 100 66, 100 46 z"/>
      </g>
      <g stroke="currentColor" strokeWidth="1.5" opacity="0.6" fill="none">
        <path d="M110 25 C 105 45, 105 70, 108 88"/>
        <path d="M82 44 C 78 60, 76 78, 78 88"/>
      </g>
    </svg>
  );
}

export default function Dashboard() {
  const { t, user, API, lang } = useApp();
  const [data, setData] = useState(null);
  // Local-time greeting; re-check every minute so it flips at 05:00 / 12:00
  // / 17:00 / 21:00 boundaries without a manual refresh.
  const [hour, setHour] = useState(() => new Date().getHours());
  useEffect(() => {
    const id = setInterval(() => setHour(new Date().getHours()), 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // Match the Reports peach background on Dashboard too (per Stage 1).
  useEffect(() => {
    document.body.classList.add("reports-page");
    return () => document.body.classList.remove("reports-page");
  }, []);

  useEffect(() => {
    axios.get(`${API}/dashboard`).then(r => setData(r.data)).catch(()=>{});
  }, [API]);

  const firstName = user?.name?.split(" ")[0] || "";
  const farmLabel = firstName ? `${firstName}'s Farm` : "My Farm";
  const presentCount = data?.present_today ?? 0;

  return (
    <AppShell title={t("dashboard")} right={<FeedbackBell />}>
      <div className="space-y-2">

        {/* Greeting + light leafy hero */}
        <div
          data-testid="dashboard-greeting"
          className="relative overflow-hidden rounded-2xl px-1 pt-1 pb-1"
        >
          <LeafDecor className="absolute -right-2 -top-2 w-40 h-28 text-[hsl(var(--primary))]"/>
          <div className="relative">
            <div className="text-sm text-muted-foreground flex items-center gap-1">
              {greetingForHour(hour, lang)} <span aria-hidden="true">🌤️</span>
            </div>
            <div className="mt-0.5 text-3xl font-bold tracking-tight text-[hsl(var(--primary))]">
              {farmLabel}
            </div>
          </div>
        </div>

        {/* Present Today — emerald gradient hero with worker illustration */}
        <div
          data-testid="stat-present"
          className="relative overflow-hidden rounded-2xl p-3 text-white shadow-lg"
          style={{
            background:
              "linear-gradient(135deg, hsl(140 55% 34%) 0%, hsl(150 60% 28%) 100%)",
          }}
        >
          <FarmWorkersIllustration
            className="absolute right-2 top-1 w-36 h-28 text-white/25"
          />
          <div className="relative flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-white/20 grid place-items-center backdrop-blur-sm">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="8" r="4" stroke="white" strokeWidth="2"/>
                <path d="M4 20c0-4 3.5-7 8-7s8 3 8 7" stroke="white" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </div>
            <div className="uppercase tracking-[0.2em] text-xs font-semibold text-white/90">
              {t("present_today")}
            </div>
          </div>
          <div className="relative mt-2 text-4xl font-bold leading-none">
            {presentCount}
          </div>
          <div className="relative mt-1.5 text-sm text-white/85">
            {lang === "kn" ? "ಕಾರ್ಮಿಕರು ಹಾಜರು" : "Workers Present"}
          </div>
        </div>

        <AttendanceCalendar />

        {/* Agri Expenses Coming Soon — warm illustrated card */}
        <div
          data-testid="agri-expenses-coming-soon"
          className="relative overflow-hidden rounded-2xl border border-[hsl(45_60%_82%)] p-3"
          style={{
            background:
              "linear-gradient(180deg, hsl(45 65% 96%) 0%, hsl(35 60% 92%) 100%)",
          }}
        >
          <TractorIllustration
            className="absolute right-2 bottom-1 w-36 h-20 text-[hsl(35_55%_55%)] opacity-70"
          />
          <div className="relative flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-[hsl(45_65%_88%)] grid place-items-center shrink-0">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M12 3v18M6 8c0 3 3 5 6 5s6-2 6-5" stroke="hsl(35 60% 40%)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <circle cx="12" cy="16" r="3.5" stroke="hsl(35 60% 40%)" strokeWidth="1.8" fill="white"/>
                <text x="12" y="18.4" textAnchor="middle" fontSize="4.5" fontWeight="700" fill="hsl(35 60% 40%)">₹</text>
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] uppercase tracking-[0.22em] text-[hsl(35_60%_40%)] font-semibold">
                Agri Expenses
              </div>
              <div className="mt-0.5 text-2xl font-bold text-[hsl(30_45%_25%)]">
                Coming Soon
              </div>
              <div className="mt-0.5 text-xs text-[hsl(30_25%_40%)] max-w-[60%]">
                {lang === "kn"
                  ? "ನಿಮ್ಮ ಕೃಷಿ ವೆಚ್ಚಗಳನ್ನು ಒಂದೇ ಸ್ಥಳದಲ್ಲಿ ನಿರ್ವಹಿಸಿ"
                  : "Manage your farm expenses in one place"}
              </div>
            </div>
            <span className="ml-2 shrink-0 self-start px-2 py-1 rounded-full bg-[hsl(35_75%_88%)] text-[hsl(30_60%_35%)] text-[9px] uppercase font-bold tracking-wider">
              Coming Soon
            </span>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

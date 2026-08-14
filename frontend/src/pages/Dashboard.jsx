import { useEffect, useState } from "react";
import axios from "axios";
import AppShell from "@/components/AppShell";
import TrialBanner from "@/components/TrialBanner";
import AdCarousel from "@/components/AdCarousel";
import FeedbackBell from "@/components/FeedbackBell";
import AttendanceCalendar from "@/components/AttendanceCalendar";
import { useApp } from "@/context/AppContext";
import { CheckCircle, Plant } from "@phosphor-icons/react";

export default function Dashboard() {
  const { t, user, API } = useApp();
  const [data, setData] = useState(null);

  useEffect(() => {
    axios.get(`${API}/dashboard`).then(r => setData(r.data)).catch(()=>{});
  }, [API]);

  return (
    <AppShell title={t("dashboard")} right={<FeedbackBell />}>
      <div className="space-y-4">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            {new Date().toLocaleDateString(undefined, { weekday: "long" })}
          </div>
          <div className="text-2xl font-semibold tracking-tight mt-1">
            {user?.name?.split(" ")[0] ? `${user.name.split(" ")[0]}'s Farm` : "My Farm"}
          </div>
        </div>

        <TrialBanner />

        {/* Only Present Today remains from the four legacy stat cards. */}
        <div className="grid grid-cols-1">
          <StatCard
            tid="stat-present"
            icon={CheckCircle}
            label={t("present_today")}
            val={data?.present_today ?? "—"}
          />
        </div>

        <AttendanceCalendar />

        {/* Agri Expenses — Coming Soon (visual placeholder only) */}
        <div
          data-testid="agri-expenses-coming-soon"
          className="rounded-xl border border-dashed border-[hsl(var(--primary))]/40 bg-[hsl(var(--primary))]/5 p-5 flex items-center gap-4"
        >
          <div className="w-11 h-11 rounded-full bg-[hsl(var(--primary))]/15 flex items-center justify-center">
            <Plant size={22} weight="duotone" className="text-[hsl(var(--primary))]"/>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold">Agri Expenses</div>
            <div className="text-xs text-muted-foreground mt-0.5">Coming Soon</div>
          </div>
        </div>

        <AdCarousel />
      </div>
    </AppShell>
  );
}

function StatCard({ tid, icon: Icon, label, val }) {
  return (
    <div data-testid={tid} className="rounded-xl border border-border bg-card p-4 overflow-hidden">
      <Icon size={22} weight="duotone" className="text-[hsl(var(--primary))]"/>
      <div className="mt-3 text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{val}</div>
    </div>
  );
}

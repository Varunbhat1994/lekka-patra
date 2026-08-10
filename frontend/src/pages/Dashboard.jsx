import { useEffect, useState } from "react";
import axios from "axios";
import AppShell from "@/components/AppShell";
import TrialBanner from "@/components/TrialBanner";
import AdCarousel from "@/components/AdCarousel";
import PendingWageMarquee from "@/components/PendingWageMarquee";
import { useApp } from "@/context/AppContext";
import { UsersThree, CheckCircle, CurrencyInr, Wallet } from "@phosphor-icons/react";

export default function Dashboard() {
  const { t, user, API } = useApp();
  const [data, setData] = useState(null);

  useEffect(() => {
    axios.get(`${API}/dashboard`).then(r => setData(r.data)).catch(()=>{});
  }, [API]);

  return (
    <AppShell title={t("dashboard")}>
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

        <div className="grid grid-cols-2 gap-3">
          <StatCard tid="stat-workers" icon={UsersThree} label={t("workers_total")} val={data?.workers_total ?? "—"} />
          <StatCard tid="stat-present" icon={CheckCircle} label={t("present_today")} val={data?.present_today ?? "—"} />
          <StatCard tid="stat-today-wage" icon={CurrencyInr} label={t("est_wage_today")} val={data ? `₹${data.estimated_wage_today}` : "—"} />
          <StatCard
            tid="stat-pending"
            icon={Wallet}
            label={t("pending_wage")}
            val={data ? `₹${data.pending_wage}` : "—"}
            marquee={<PendingWageMarquee items={data?.pending_list || []} />}
          />
        </div>

        <AdCarousel />
      </div>
    </AppShell>
  );
}

function StatCard({ tid, icon: Icon, label, val, marquee }) {
  return (
    <div data-testid={tid} className="rounded-xl border border-border bg-card p-4 overflow-hidden">
      <Icon size={22} weight="duotone" className="text-[hsl(var(--primary))]"/>
      <div className="mt-3 text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{val}</div>
      {marquee}
    </div>
  );
}

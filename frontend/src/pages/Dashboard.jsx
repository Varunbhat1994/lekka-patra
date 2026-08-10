import { useEffect, useState } from "react";
import axios from "axios";
import AppShell from "@/components/AppShell";
import TrialBanner from "@/components/TrialBanner";
import AdCarousel from "@/components/AdCarousel";
import { useApp } from "@/context/AppContext";
import { UsersThree, CheckCircle, CurrencyInr, Wallet } from "@phosphor-icons/react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";

const COLORS = ["#2f6b3b", "#c76a4b", "#3f5e6f", "#8ea86a", "#b89654", "#6b4b8a"];

export default function Dashboard() {
  const { t, user, API } = useApp();
  const [data, setData] = useState(null);

  useEffect(() => {
    axios.get(`${API}/dashboard`).then(r => setData(r.data)).catch(()=>{});
  }, [API]);

  const cards = [
    { key: "workers_total", val: data?.workers_total ?? "—", icon: UsersThree, tid: "stat-workers" },
    { key: "present_today", val: data?.present_today ?? "—", icon: CheckCircle, tid: "stat-present" },
    { key: "est_wage_today", val: data ? `₹${data.estimated_wage_today}` : "—", icon: CurrencyInr, tid: "stat-today-wage" },
    { key: "pending_wage", val: data ? `₹${data.pending_wage}` : "—", icon: Wallet, tid: "stat-pending" },
  ];

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
          {cards.map(c => (
            <div key={c.key} data-testid={c.tid} className="rounded-xl border border-border bg-card p-4">
              <c.icon size={22} weight="duotone" className="text-[hsl(var(--primary))]"/>
              <div className="mt-3 text-xs uppercase tracking-[0.18em] text-muted-foreground">{t(c.key)}</div>
              <div className="mt-1 text-2xl font-semibold tracking-tight">{c.val}</div>
            </div>
          ))}
        </div>

        <AdCarousel />
      </div>
    </AppShell>
  );
}

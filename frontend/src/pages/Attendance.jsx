import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import AppShell from "@/components/AppShell";
import TrialBanner from "@/components/TrialBanner";
import { useApp } from "@/context/AppContext";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { CheckCircle, Clock, XCircle, Timer, User } from "@phosphor-icons/react";

const STATUSES = [
  { key: "present", label_key: "present", icon: CheckCircle, color: "hsl(var(--primary))" },
  { key: "half_day", label_key: "half_day", icon: Clock, color: "#b89654" },
  { key: "absent", label_key: "absent", icon: XCircle, color: "hsl(var(--accent))" },
  { key: "overtime", label_key: "overtime", icon: Timer, color: "#3f5e6f" },
];

export default function Attendance() {
  const { t, user, API } = useApp();
  const locked = user?.access?.locked;
  const [date, setDate] = useState(() => new Date().toISOString().slice(0,10));
  const [workers, setWorkers] = useState([]);
  const [att, setAtt] = useState({}); // worker_id -> {status, overtime_hours, field_crop, description}

  const load = useCallback(async () => {
    const [w, a] = await Promise.all([
      axios.get(`${API}/workers`),
      axios.get(`${API}/attendance`, { params: { date } }),
    ]);
    setWorkers(w.data);
    const map = {};
    a.data.forEach(x => { map[x.worker_id] = x; });
    setAtt(map);
  }, [API, date]);

  useEffect(() => { load(); }, [load]);

  const setStatus = async (workerId, status) => {
    if (locked) return toast.error("Trial expired");
    const cur = att[workerId] || {};
    const payload = {
      worker_id: workerId,
      date,
      status,
      overtime_hours: cur.overtime_hours || 0,
      field_crop: cur.field_crop || "",
      description: cur.description || "",
    };
    try {
      await axios.post(`${API}/attendance`, payload);
      setAtt({ ...att, [workerId]: { ...payload } });
      toast.success(t("saved"));
    } catch { toast.error("Failed"); }
  };

  const setField = async (workerId, key, value) => {
    if (locked) return;
    const cur = att[workerId] || { worker_id: workerId, date, status: "present", overtime_hours: 0 };
    const payload = { ...cur, worker_id: workerId, date, [key]: value };
    setAtt({ ...att, [workerId]: payload });
  };

  const persist = async (workerId) => {
    if (locked) return;
    const cur = att[workerId];
    if (!cur?.status) return;
    try {
      await axios.post(`${API}/attendance`, {
        worker_id: workerId,
        date,
        status: cur.status,
        overtime_hours: parseFloat(cur.overtime_hours || 0),
        field_crop: cur.field_crop || "",
        description: cur.description || "",
      });
    } catch { toast.error("Failed"); }
  };

  return (
    <AppShell title={t("attendance")}>
      <div className="space-y-4">
        <TrialBanner />
        <div className="rounded-xl border border-border bg-card p-3 flex items-center gap-3">
          <Label className="text-xs uppercase tracking-[0.15em] text-muted-foreground">{t("date")}</Label>
          <input
            data-testid="attendance-date"
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="flex-1 bg-transparent outline-none text-sm min-h-[40px]"
          />
        </div>

        {workers.length === 0 && (
          <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
            {t("no_workers")}
          </div>
        )}

        {(() => {
          const regular = workers.filter(w => (w.worker_type || "regular") !== "temporary");
          const temporary = workers.filter(w => (w.worker_type || "regular") === "temporary");

          const renderRow = (w) => {
            const cur = att[w.id] || {};
            return (
              <div key={w.id} data-testid={`att-worker-${w.id}`} className="rounded-xl border border-border bg-card p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))] grid place-items-center">
                    <User size={20} weight="duotone"/>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{w.name}</div>
                    <div className="text-xs text-muted-foreground">₹{w.daily_rate}/day · {w.skill || "—"}</div>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-2">
                  {STATUSES.map(s => {
                    const active = cur.status === s.key;
                    return (
                      <button
                        key={s.key}
                        data-testid={`att-${w.id}-${s.key}`}
                        disabled={locked}
                        onClick={() => setStatus(w.id, s.key)}
                        className={`min-h-[64px] rounded-lg border flex flex-col items-center justify-center gap-1 text-[10px] uppercase tracking-wider transition-all active:scale-[0.97] ${
                          active
                            ? "border-transparent text-white"
                            : "border-border bg-white text-muted-foreground hover:bg-secondary/40"
                        }`}
                        style={active ? { backgroundColor: s.color } : {}}
                      >
                        <s.icon size={20} weight={active ? "fill" : "duotone"}/>
                        {t(s.label_key)}
                      </button>
                    );
                  })}
                </div>

                {cur.status === "overtime" && (
                  <Input
                    data-testid={`att-${w.id}-hours`}
                    type="number"
                    placeholder={t("overtime_hours")}
                    value={cur.overtime_hours || ""}
                    onChange={e => setField(w.id, "overtime_hours", e.target.value)}
                    onBlur={() => persist(w.id)}
                    className="min-h-[44px]"
                  />
                )}

                {cur.status && cur.status !== "absent" && (
                  <div className="grid grid-cols-1 gap-2">
                    <Input
                      data-testid={`att-${w.id}-crop`}
                      placeholder={t("field_crop")}
                      value={cur.field_crop || ""}
                      onChange={e => setField(w.id, "field_crop", e.target.value)}
                      onBlur={() => persist(w.id)}
                      className="min-h-[44px]"
                    />
                    <Textarea
                      data-testid={`att-${w.id}-desc`}
                      placeholder={t("work_description")}
                      value={cur.description || ""}
                      onChange={e => setField(w.id, "description", e.target.value)}
                      onBlur={() => persist(w.id)}
                      className="min-h-[44px]"
                    />
                  </div>
                )}
              </div>
            );
          };

          const SectionHeader = ({ label, count, tone, testId }) => (
            <div
              data-testid={testId}
              className="sticky top-0 z-10 -mx-1 px-1 py-2 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/70"
            >
              <div className="flex items-center gap-3">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${tone === "temporary" ? "bg-[#b89654]" : "bg-[hsl(var(--primary))]"}`}
                />
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground/80">
                  {label}
                </h3>
                <span className="text-[11px] text-muted-foreground">· {count}</span>
                <div className="flex-1 h-px bg-border" />
              </div>
            </div>
          );

          return (
            <div className="space-y-6">
              {regular.length > 0 && (
                <section className="space-y-3">
                  <SectionHeader
                    label={t("regular_workers")}
                    count={regular.length}
                    tone="regular"
                    testId="section-regular-workers"
                  />
                  <div className="space-y-3">{regular.map(renderRow)}</div>
                </section>
              )}

              {temporary.length > 0 && (
                <section className="space-y-3">
                  <SectionHeader
                    label={t("temporary_workers")}
                    count={temporary.length}
                    tone="temporary"
                    testId="section-temporary-workers"
                  />
                  <div className="space-y-3">{temporary.map(renderRow)}</div>
                </section>
              )}
            </div>
          );
        })()}
      </div>
    </AppShell>
  );
}

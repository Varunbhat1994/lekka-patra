import { useEffect, useState, useCallback, useMemo } from "react";
import axios from "axios";
import AppShell from "@/components/AppShell";
import TrialBanner from "@/components/TrialBanner";
import { useApp } from "@/context/AppContext";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { CheckCircle, Clock, XCircle, Timer, User, FloppyDisk, ArrowUUpLeft } from "@phosphor-icons/react";

const STATUSES = [
  { key: "present", label_key: "present", icon: CheckCircle, color: "hsl(var(--primary))" },
  { key: "half_day", label_key: "half_day", icon: Clock, color: "#b89654" },
  { key: "absent", label_key: "absent", icon: XCircle, color: "hsl(var(--accent))" },
  { key: "overtime", label_key: "overtime", icon: Timer, color: "#3f5e6f" },
];

// Normalize what the server returns (or an empty draft) into the row shape
// the UI edits. Undefined status means "no attendance yet".
function normalize(row) {
  return {
    status: row?.status ?? "",
    overtime_hours: row?.overtime_hours ?? 0,
    overtime_amount: row?.overtime_amount ?? "",
    manual_wage: row?.manual_wage ?? "",
    field_crop: row?.field_crop ?? "",
    description: row?.description ?? "",
  };
}

function isDirty(server, draft) {
  const s = normalize(server);
  const d = normalize(draft);
  return (
    s.status !== d.status ||
    String(s.overtime_hours) !== String(d.overtime_hours) ||
    String(s.overtime_amount) !== String(d.overtime_amount) ||
    String(s.manual_wage) !== String(d.manual_wage) ||
    s.field_crop !== d.field_crop ||
    s.description !== d.description
  );
}

export default function Attendance() {
  const { t, lang, user, API } = useApp();
  const locked = false;
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [workers, setWorkers] = useState([]);
  const [server, setServer] = useState({}); // worker_id -> last-known server row
  const [drafts, setDrafts] = useState({});  // worker_id -> unsaved edits
  const [saving, setSaving] = useState({}); // worker_id -> in-flight bool

  const load = useCallback(async () => {
    const [w, a] = await Promise.all([
      axios.get(`${API}/workers`),
      axios.get(`${API}/attendance`, { params: { date } }),
    ]);
    setWorkers(w.data);
    const srv = {};
    a.data.forEach(x => { srv[x.worker_id] = x; });
    setServer(srv);
    // Reset drafts to server state on every reload.
    const d = {};
    w.data.forEach(worker => { d[worker.id] = normalize(srv[worker.id]); });
    setDrafts(d);
  }, [API, date]);

  useEffect(() => { load(); }, [load]);

  const setDraft = (workerId, patch) => {
    if (locked) return;
    setDrafts(prev => ({
      ...prev,
      [workerId]: { ...normalize(prev[workerId]), ...patch },
    }));
  };

  const cancelDraft = (workerId) => {
    setDrafts(prev => ({ ...prev, [workerId]: normalize(server[workerId]) }));
  };

  const saveDraft = async (workerId) => {
    if (saving[workerId]) return; // guard double-click
    const d = drafts[workerId];
    if (!d?.status) {
      toast.error(lang === "kn" ? "ಸ್ಥಿತಿ ಆಯ್ಕೆಮಾಡಿ" : "Select a status first");
      return;
    }
    // Client-side validation: non-negative manual amounts.
    if (d.manual_wage !== "" && d.manual_wage != null && Number(d.manual_wage) < 0) {
      toast.error(lang === "kn" ? "ಮೊತ್ತ ಋಣಾತ್ಮಕವಾಗಿರಬಾರದು" : "Amount cannot be negative");
      return;
    }
    if (d.overtime_amount !== "" && d.overtime_amount != null && Number(d.overtime_amount) < 0) {
      toast.error(lang === "kn" ? "ಮೊತ್ತ ಋಣಾತ್ಮಕವಾಗಿರಬಾರದು" : "Amount cannot be negative");
      return;
    }
    setSaving(prev => ({ ...prev, [workerId]: true }));
    try {
      const payload = {
        worker_id: workerId,
        date,
        status: d.status,
        overtime_hours: parseFloat(d.overtime_hours || 0) || 0,
        overtime_amount:
          d.overtime_amount === "" || d.overtime_amount == null
            ? null
            : Number(d.overtime_amount),
        manual_wage:
          d.manual_wage === "" || d.manual_wage == null
            ? null
            : Number(d.manual_wage),
        field_crop: d.field_crop || "",
        description: d.description || "",
      };
      await axios.post(`${API}/attendance`, payload);
      // On success: rehydrate server snapshot for this worker only.
      setServer(prev => ({
        ...prev,
        [workerId]: { ...prev[workerId], ...payload, worker_id: workerId },
      }));
      toast.success(t("saved"));
    } catch (err) {
      const msg = err?.response?.data?.detail || "Save failed";
      toast.error(String(msg));
      // Keep the draft intact so the user doesn't lose their input.
    } finally {
      setSaving(prev => ({ ...prev, [workerId]: false }));
    }
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
            const cur = drafts[w.id] || normalize();
            const dirty = isDirty(server[w.id], cur);
            const inFlight = !!saving[w.id];
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
                  {dirty && (
                    <span
                      data-testid={`att-${w.id}-unsaved`}
                      className="text-[10px] font-semibold uppercase tracking-wider text-[#b89654] bg-[#b89654]/10 rounded-full px-2 py-1"
                    >
                      {lang === "kn" ? "ಉಳಿಸಿಲ್ಲ" : "Unsaved"}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-4 gap-2">
                  {STATUSES.map(s => {
                    const active = cur.status === s.key;
                    return (
                      <button
                        key={s.key}
                        data-testid={`att-${w.id}-${s.key}`}
                        disabled={locked}
                        onClick={() => setDraft(w.id, { status: s.key })}
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

                {cur.status === "half_day" && (
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {lang === "kn" ? "ಅರ್ಧ ದಿನದ ಮೊತ್ತ (ಐಚ್ಛಿಕ)" : "Half-day amount (₹, optional)"}
                    </Label>
                    <Input
                      data-testid={`att-${w.id}-manual-wage`}
                      type="number"
                      min="0"
                      inputMode="decimal"
                      placeholder={`${lang === "kn" ? "ಡೀಫಾಲ್ಟ್" : "Default"}: ₹${Math.round((w.daily_rate || 0) * 0.5)}`}
                      value={cur.manual_wage ?? ""}
                      onChange={e => setDraft(w.id, { manual_wage: e.target.value })}
                      className="min-h-[44px]"
                    />
                  </div>
                )}

                {cur.status === "overtime" && (
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {lang === "kn" ? "ಓವರ್‌ಟೈಮ್ ಮೊತ್ತ (₹)" : "Overtime amount (₹)"}
                    </Label>
                    <Input
                      data-testid={`att-${w.id}-ot-amount`}
                      type="number"
                      min="0"
                      inputMode="decimal"
                      placeholder={lang === "kn" ? "ಬೋನಸ್ ಮೊತ್ತ" : "Bonus amount"}
                      value={cur.overtime_amount ?? ""}
                      onChange={e => setDraft(w.id, { overtime_amount: e.target.value })}
                      className="min-h-[44px]"
                    />
                    <div className="text-[10px] text-muted-foreground">
                      {lang === "kn"
                        ? `ಗಳಿಕೆ = ₹${w.daily_rate} + ${cur.overtime_amount || 0}`
                        : `Earning = ₹${w.daily_rate} + ${cur.overtime_amount || 0}`}
                    </div>
                  </div>
                )}

                {cur.status && cur.status !== "absent" && (
                  <div className="grid grid-cols-1 gap-2">
                    <Input
                      data-testid={`att-${w.id}-crop`}
                      placeholder={t("field_crop")}
                      value={cur.field_crop || ""}
                      onChange={e => setDraft(w.id, { field_crop: e.target.value })}
                      className="min-h-[44px]"
                    />
                    <Textarea
                      data-testid={`att-${w.id}-desc`}
                      placeholder={t("work_description")}
                      value={cur.description || ""}
                      onChange={e => setDraft(w.id, { description: e.target.value })}
                      className="min-h-[44px]"
                    />
                  </div>
                )}

                <div className="flex items-center gap-2 pt-1">
                  <Button
                    data-testid={`att-${w.id}-save`}
                    disabled={!dirty || inFlight || locked}
                    onClick={() => saveDraft(w.id)}
                    className="flex-1 min-h-[42px] bg-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/90"
                  >
                    <FloppyDisk size={16} className="mr-1"/>
                    {inFlight
                      ? (lang === "kn" ? "ಉಳಿಸುತ್ತಿದೆ…" : "Saving…")
                      : (lang === "kn" ? "ಉಳಿಸಿ" : "Save")}
                  </Button>
                  <Button
                    data-testid={`att-${w.id}-cancel`}
                    disabled={!dirty || inFlight}
                    onClick={() => cancelDraft(w.id)}
                    variant="outline"
                    className="min-h-[42px]"
                  >
                    <ArrowUUpLeft size={16} className="mr-1"/>
                    {lang === "kn" ? "ರದ್ದು" : "Cancel"}
                  </Button>
                </div>
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

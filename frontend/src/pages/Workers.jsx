import { useEffect, useState } from "react";
import axios from "axios";
import AppShell from "@/components/AppShell";
import TrialBanner from "@/components/TrialBanner";
import { useApp } from "@/context/AppContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Plus, PencilSimple, Trash, User } from "@phosphor-icons/react";
import ContractorsSection from "@/pages/ContractorsSection";

const empty = { name: "", mobile: "", skill: "", daily_rate: "" };

export default function Workers() {
  const { t, user, API } = useApp();
  const locked = false;
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);

  const load = () => axios.get(`${API}/workers`).then(r => setItems(r.data));
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.name || !form.daily_rate) return toast.error("Name & wage required");
    const payload = { ...form, daily_rate: parseFloat(form.daily_rate), worker_type: form.worker_type || "regular" };
    try {
      if (editing) await axios.put(`${API}/workers/${editing.id}`, payload);
      else await axios.post(`${API}/workers`, payload);
      setOpen(false); setEditing(null); setForm(empty);
      toast.success(t("saved"));
      load();
    } catch (e) {
      toast.error("Failed to save");
    }
  };

  const del = async (w) => {
    if (!window.confirm(`Delete ${w.name}?`)) return;
    try {
      await axios.delete(`${API}/workers/${w.id}`);
      load();
    } catch { toast.error("Failed"); }
  };

  return (
    <AppShell
      title={t("workers")}
      right={
        !locked && (
          <Button data-testid="add-worker-btn" size="sm" onClick={() => { setEditing(null); setForm(empty); setOpen(true); }}
            className="rounded-full bg-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/90">
            <Plus size={16} weight="bold" className="mr-1"/>{t("add_worker")}
          </Button>
        )
      }
    >
      <div className="space-y-3">
        <TrialBanner />

        {items.length === 0 && (
          <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
            {t("no_workers")}
          </div>
        )}

        <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
          {items.map(w => (
            <div key={w.id} data-testid={`worker-row-${w.id}`} className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))] grid place-items-center">
                <User size={20} weight="duotone"/>
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate flex items-center gap-2">
                  <span className="truncate">{w.name}</span>
                  <span
                    className={`shrink-0 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${
                      (w.worker_type || "regular") === "temporary"
                        ? "border-[#b89654]/40 bg-[#b89654]/10 text-[#8a6b2e]"
                        : "border-[hsl(var(--primary))]/30 bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]"
                    }`}
                    data-testid={`worker-type-badge-${w.id}`}
                  >
                    {t((w.worker_type || "regular") === "temporary" ? "temporary" : "regular")}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {w.skill || "—"} · ₹{w.daily_rate}/day{w.mobile ? ` · ${w.mobile}` : ""}
                </div>
              </div>
              {!locked && (
                <>
                  <button data-testid={`edit-worker-${w.id}`} onClick={() => { setEditing(w); setForm({ ...empty, ...w, worker_type: w.worker_type || "regular" }); setOpen(true); }}
                    className="h-9 w-9 grid place-items-center rounded-lg hover:bg-secondary text-muted-foreground">
                    <PencilSimple size={16}/>
                  </button>
                  <button data-testid={`del-worker-${w.id}`} onClick={() => del(w)}
                    className="h-9 w-9 grid place-items-center rounded-lg hover:bg-[hsl(var(--accent))]/10 text-[hsl(var(--accent))]">
                    <Trash size={16}/>
                  </button>
                </>
              )}
            </div>
          ))}
        </div>

        <ContractorsSection />
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[92%] rounded-xl">
          <DialogHeader>
            <DialogTitle>{editing ? t("edit_worker") : t("add_worker")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Field label={t("name")}><Input data-testid="worker-name-input" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} className="min-h-[48px]"/></Field>
            <Field label={t("mobile")}><Input data-testid="worker-mobile-input" value={form.mobile} onChange={e=>setForm({...form,mobile:e.target.value})} className="min-h-[48px]"/></Field>
            <Field label={t("skill")}><Input data-testid="worker-skill-input" value={form.skill} onChange={e=>setForm({...form,skill:e.target.value})} className="min-h-[48px]" placeholder="e.g. Arecanut harvester"/></Field>
            <Field label={t("daily_rate")}><Input data-testid="worker-rate-input" type="number" value={form.daily_rate} onChange={e=>setForm({...form,daily_rate:e.target.value})} className="min-h-[48px]"/></Field>
            <Field label={t("worker_type")}>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("worker_type")}>
                {[
                  { key: "regular", label: t("regular") },
                  { key: "temporary", label: t("temporary") },
                ].map(opt => {
                  const active = (form.worker_type || "regular") === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      data-testid={`worker-type-${opt.key}`}
                      onClick={() => setForm({ ...form, worker_type: opt.key })}
                      aria-pressed={active}
                      className={`min-h-[48px] rounded-lg border text-sm font-medium transition-all active:scale-[0.98] ${
                        active
                          ? "border-transparent bg-[hsl(var(--primary))] text-white"
                          : "border-border bg-white text-muted-foreground hover:bg-secondary/40"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </Field>
          </div>
          <DialogFooter className="gap-2">
            <Button data-testid="cancel-worker-btn" variant="outline" onClick={()=>setOpen(false)}>{t("cancel")}</Button>
            <Button data-testid="save-worker-btn" onClick={save} className="bg-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/90">{t("save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function Field({ label, children }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-[0.15em] text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

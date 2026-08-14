import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { useApp } from "@/context/AppContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Plus, HardHat, CalendarPlus, CurrencyInr, Trash,
  Users, Wallet, X, ArrowLeft, FilePdf, ArrowUUpLeft, ClockCounterClockwise, Check,
} from "@phosphor-icons/react";

const emptyContractor = { name: "", mobile: "", notes: "" };
const today = () => new Date().toISOString().slice(0, 10);

export default function ContractorsSection() {
  const { t, user, API, lang } = useApp();
  const nav = useNavigate();
  const locked = false;
  const [contractors, setContractors] = useState([]);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(emptyContractor);
  const [detailId, setDetailId] = useState(null);

  const load = () => axios.get(`${API}/contractors`).then(r => setContractors(r.data));
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.name) return toast.error(lang === "kn" ? "ಹೆಸರು ಬೇಕು" : "Name required");
    try {
      await axios.post(`${API}/contractors`, form);
      setAddOpen(false); setForm(emptyContractor);
      toast.success(t("saved"));
      load();
    } catch { toast.error("Failed"); }
  };

  const del = async (c) => {
    if (!window.confirm(`Delete ${c.name}?`)) return;
    await axios.delete(`${API}/contractors/${c.id}`);
    load();
  };

  return (
    <>
      <div className="mt-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              {lang === "kn" ? "ಗುತ್ತಿಗೆದಾರರು" : "Contractors"}
            </div>
            <div className="text-[11px] text-muted-foreground/80 mt-0.5">
              {lang === "kn" ? "ದಿನವಾರು ಕಾರ್ಮಿಕರ ಮತ್ತು ಪಾವತಿಗಳ ಟ್ರ್ಯಾಕಿಂಗ್" : "Track workers brought & payments given"}
            </div>
          </div>
          {!locked && (
            <Button data-testid="add-contractor-btn" size="sm"
              onClick={() => { setForm(emptyContractor); setAddOpen(true); }}
              className="rounded-full bg-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground))]/90">
              <Plus size={16} weight="bold" className="mr-1"/>
              {lang === "kn" ? "ಸೇರಿಸಿ" : "Add"}
            </Button>
          )}
        </div>

        {contractors.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card p-6 text-center text-xs text-muted-foreground">
            {lang === "kn"
              ? "ಇನ್ನೂ ಗುತ್ತಿಗೆದಾರರಿಲ್ಲ. ಅವರು ತಂದ ಕಾರ್ಮಿಕರ ಸಂಖ್ಯೆ ಮತ್ತು ಪಾವತಿಗಳನ್ನು ಟ್ರ್ಯಾಕ್ ಮಾಡಲು ಒಬ್ಬರನ್ನು ಸೇರಿಸಿ."
              : "No contractors yet. Add one to track how many workers they brought and payments given."}
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
            {contractors.map(c => (
              <button
                key={c.id}
                data-testid={`contractor-row-${c.id}`}
                onClick={() => setDetailId(c.id)}
                className="w-full text-left p-4 flex items-center gap-3 hover:bg-secondary/30 transition-colors"
              >
                <div className="h-10 w-10 rounded-full bg-[hsl(var(--foreground))]/8 text-[hsl(var(--foreground))] grid place-items-center">
                  <HardHat size={20} weight="duotone"/>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{c.name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {c.mobile || (lang === "kn" ? "ಸಂಖ್ಯೆ ಇಲ್ಲ" : "No mobile")}
                    {c.notes ? ` · ${c.notes}` : ""}
                  </div>
                </div>
                {!locked && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); del(c); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); del(c); } }}
                    data-testid={`del-contractor-${c.id}`}
                    className="h-9 w-9 grid place-items-center rounded-lg hover:bg-[hsl(var(--accent))]/10 text-[hsl(var(--accent))] cursor-pointer"
                  >
                    <Trash size={16}/>
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Add contractor dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-[92%] rounded-xl">
          <DialogHeader>
            <DialogTitle>
              {lang === "kn" ? "ಗುತ್ತಿಗೆದಾರ ಸೇರಿಸಿ" : "Add Contractor"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs uppercase tracking-[0.15em] text-muted-foreground">{t("name")}</Label>
              <Input data-testid="contractor-name-input" value={form.name} onChange={e=>setForm({...form, name:e.target.value})} className="min-h-[48px]"/>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-[0.15em] text-muted-foreground">{t("mobile")}</Label>
              <Input data-testid="contractor-mobile-input" value={form.mobile} onChange={e=>setForm({...form, mobile:e.target.value})} className="min-h-[48px]"/>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-[0.15em] text-muted-foreground">{t("notes")}</Label>
              <Textarea data-testid="contractor-notes-input" value={form.notes} onChange={e=>setForm({...form, notes:e.target.value})}/>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={()=>setAddOpen(false)}>{t("cancel")}</Button>
            <Button data-testid="save-contractor-btn" onClick={save}
              className="bg-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/90">{t("save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {detailId && (
        <ContractorDetail
          id={detailId}
          onClose={() => { setDetailId(null); load(); }}
        />
      )}
    </>
  );
}

// -------- Contractor detail sheet with two tabs --------
function ContractorDetail({ id, onClose }) {
  const { API, user, lang, t } = useApp();
  const nav = useNavigate();
  const locked = user?.access?.locked;
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("visits");
  const [visitForm, setVisitForm] = useState({ date: today(), workers_count: "", field_crop: "", notes: "" });
  const [payMode, setPayMode] = useState("payment"); // "payment" | "return"
  const [payForm, setPayForm] = useState({ date: today(), amount: "", method: "cash", notes: "" });

  const load = () => axios.get(`${API}/contractors/${id}/ledger`).then(r => setData(r.data));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  const addVisit = async () => {
    if (!visitForm.workers_count) return toast.error(lang === "kn" ? "ಸಂಖ್ಯೆ ಬೇಕು" : "Count required");
    await axios.post(`${API}/contractor-visits`, {
      contractor_id: id,
      date: visitForm.date,
      workers_count: parseInt(visitForm.workers_count, 10) || 0,
      field_crop: visitForm.field_crop,
      notes: visitForm.notes,
    });
    setVisitForm({ date: today(), workers_count: "", field_crop: "", notes: "" });
    toast.success(t("saved"));
    load();
  };

  const addPayment = async () => {
    if (!payForm.amount) return toast.error(lang === "kn" ? "ಮೊತ್ತ ಬೇಕು" : "Amount required");
    const path = payMode === "return" ? "/contractor-returns" : "/contractor-payments";
    await axios.post(`${API}${path}`, {
      contractor_id: id,
      date: payForm.date,
      amount: parseFloat(payForm.amount),
      method: payForm.method,
      notes: payForm.notes,
    });
    setPayForm({ date: today(), amount: "", method: "cash", notes: "" });
    toast.success(t("saved"));
    load();
  };

  const delVisit = async (vid) => {
    await axios.delete(`${API}/contractor-visits/${vid}`);
    load();
  };
  const delPayment = async (pid) => {
    await axios.delete(`${API}/contractor-payments/${pid}`);
    load();
  };
  const delReturn = async (rid) => {
    await axios.delete(`${API}/contractor-returns/${rid}`);
    load();
  };

  const downloadFile = async (path, filename) => {
    const url = `${API}${path}`;
    const r = await axios.get(url, { responseType: "blob" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(r.data);
    link.download = filename;
    link.click();
  };

  const settleContractor = async () => {
    if (!window.confirm(`Mark ${data?.contractor?.name || ""} settled?`)) return;
    try {
      await axios.post(`${API}/settlements`, {
        contractor_id: id,
        up_to_date: today(),
      });
      // Optimistically zero net_paid + final_balance; bump total_settled
      setData(prev => prev ? {
        ...prev,
        net_paid: 0,
        final_balance: 0,
        total_returned: (prev.total_returned || 0) + (prev.net_paid || 0),
        total_settled: (prev.total_settled || 0) + (prev.net_paid || 0),
      } : prev);
      toast.success(lang === "kn" ? "ಇತ್ಯರ್ಥ ದಾಖಲಿಸಲಾಗಿದೆ" : "Settled");
      load();
    } catch { toast.error("Failed"); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[hsl(var(--background))] overflow-y-auto"
         data-testid="contractor-detail">
      <div className="mx-auto max-w-md min-h-screen border-x border-border/60">
        <header className="sticky top-0 z-10 bg-white/90 backdrop-blur-xl border-b border-border">
          <div className="px-4 h-14 flex items-center gap-3">
            <button data-testid="contractor-back-btn" onClick={onClose}
              className="h-9 w-9 -ml-1 rounded-full grid place-items-center hover:bg-secondary">
              <ArrowLeft size={20}/>
            </button>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                {lang === "kn" ? "ಗುತ್ತಿಗೆದಾರ" : "Contractor"}
              </div>
              <div className="font-semibold truncate">{data?.contractor?.name || "…"}</div>
            </div>
          </div>
        </header>

        <div className="px-5 pt-4 pb-24 space-y-4">
          <div className="grid grid-cols-3 gap-2">
            <SummaryStat icon={CalendarPlus}
              label={lang === "kn" ? "ದಿನಗಳು" : "Visits"}
              val={data?.total_visits ?? "—"} />
            <SummaryStat icon={Users}
              label={lang === "kn" ? "ಒಟ್ಟು ಕಾರ್ಮಿಕರು" : "Total workers"}
              val={data?.total_workers_brought ?? "—"} />
            <SummaryStat icon={Wallet}
              label={lang === "kn" ? "ನಿವ್ವಳ ಪಾವತಿ" : "Net paid"}
              val={data ? `₹${data.net_paid ?? data.total_paid}` : "—"} accent />
          </div>
          {data && (data.total_returned || 0) > 0 && (
            <div className="text-[11px] text-muted-foreground -mt-2">
              {lang === "kn" ? "ವಾಪಸಾತಿ" : "Returned"}: <span className="text-[hsl(var(--primary))] font-semibold">₹{data.total_returned}</span>
              <span className="mx-1">·</span>
              {lang === "kn" ? "ಒಟ್ಟು ಪಾವತಿ" : "Total paid"}: ₹{data.total_paid}
            </div>
          )}
          {data && (() => {
            const fb = Number(data.final_balance ?? 0);
            if (fb > 0) {
              return (
                <div className="text-xs font-semibold text-[hsl(var(--primary))]" data-testid="contractor-balance-msg">
                  {lang === "kn" ? `ನೀವು ಗುತ್ತಿಗೆದಾರರಿಗೆ ₹${fb} ಸಾಲ` : `You owe contractor ₹${fb}`}
                </div>
              );
            }
            if (fb < 0) {
              return (
                <div className="text-xs font-semibold text-red-600" data-testid="contractor-balance-msg">
                  {lang === "kn" ? `ಗುತ್ತಿಗೆದಾರ ನಿಮಗೆ ₹${-fb} ಸಾಲ` : `Contractor owes you ₹${-fb}`}
                </div>
              );
            }
            return (
              <div className="text-xs text-muted-foreground" data-testid="contractor-balance-msg">
                {lang === "kn" ? "ಸಮತೋಲನ" : "Balanced"}
              </div>
            );
          })()}

          <div className="flex flex-wrap gap-2">
            <Button data-testid="contractor-pdf-btn"
              onClick={() => downloadFile(`/reports/contractor/${id}/pdf`, `${data?.contractor?.name || "contractor"}.pdf`)}
              variant="outline" className="flex-1 min-w-[calc(50%-4px)] min-h-[40px] rounded-lg">
              <FilePdf size={16} className="mr-1"/>PDF
            </Button>
            <Button data-testid="contractor-history-btn"
              onClick={() => nav(`/history/contractor/${id}`)}
              variant="outline" className="flex-1 min-w-[calc(50%-4px)] min-h-[40px] rounded-lg">
              <ClockCounterClockwise size={16} weight="duotone" className="mr-1"/>History
            </Button>
            {!locked && (
              <Button data-testid="contractor-settle-btn"
                onClick={settleContractor}
                className="basis-full w-full min-h-[40px] rounded-lg bg-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/90 whitespace-normal leading-tight">
                <Check size={16} className="mr-1 shrink-0"/>
                <span className="truncate">
                  {lang === "kn" ? "ಇತ್ಯರ್ಥ ಎಂದು ಗುರುತಿಸಿ" : "Mark settled"}
                </span>
              </Button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 p-1 bg-secondary/50 rounded-lg">
            <button data-testid="tab-visits-btn" onClick={() => setTab("visits")}
              className={`min-h-[40px] rounded-md text-sm font-medium ${tab === "visits" ? "bg-white shadow-sm" : "text-muted-foreground"}`}>
              {lang === "kn" ? "ಭೇಟಿಗಳು" : "Visits"}
            </button>
            <button data-testid="tab-payments-btn" onClick={() => setTab("payments")}
              className={`min-h-[40px] rounded-md text-sm font-medium ${tab === "payments" ? "bg-white shadow-sm" : "text-muted-foreground"}`}>
              {lang === "kn" ? "ಪಾವತಿಗಳು" : "Payments"}
            </button>
          </div>

          {tab === "visits" && (
            <>
              {!locked && (
                <div className="rounded-xl border border-border bg-card p-3 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <Input data-testid="visit-date" type="date" value={visitForm.date}
                      onChange={e => setVisitForm({...visitForm, date: e.target.value})}
                      className="min-h-[44px]"/>
                    <Input data-testid="visit-count" type="number" inputMode="numeric"
                      placeholder={lang === "kn" ? "ಎಷ್ಟು ಕಾರ್ಮಿಕರು" : "Workers count"}
                      value={visitForm.workers_count}
                      onChange={e => setVisitForm({...visitForm, workers_count: e.target.value})}
                      className="min-h-[44px]"/>
                  </div>
                  <Input data-testid="visit-crop" placeholder={t("field_crop")}
                    value={visitForm.field_crop}
                    onChange={e => setVisitForm({...visitForm, field_crop: e.target.value})}
                    className="min-h-[44px]"/>
                  <Textarea data-testid="visit-notes" placeholder={t("notes")}
                    value={visitForm.notes}
                    onChange={e => setVisitForm({...visitForm, notes: e.target.value})}/>
                  <Button data-testid="add-visit-btn" onClick={addVisit}
                    className="w-full min-h-[44px] rounded-lg bg-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/90">
                    <Plus size={16} className="mr-1"/>{lang === "kn" ? "ಭೇಟಿ ಸೇರಿಸಿ" : "Add visit"}
                  </Button>
                </div>
              )}

              <div className="space-y-2">
                {data?.visits?.length ? data.visits.map(v => (
                  <div key={v.id} data-testid={`visit-${v.id}`} className="rounded-lg border border-border bg-card px-3 py-3 flex items-center gap-3">
                    <div className="h-9 w-9 rounded-md bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))] grid place-items-center font-semibold text-sm">
                      {v.workers_count}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">
                        {v.date} · {v.workers_count} {lang === "kn" ? "ಕಾರ್ಮಿಕರು" : "workers"}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {v.field_crop || "—"}{v.notes ? ` · ${v.notes}` : ""}
                      </div>
                    </div>
                    {!locked && (
                      <button onClick={() => delVisit(v.id)}
                        className="h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:bg-[hsl(var(--accent))]/10 hover:text-[hsl(var(--accent))]">
                        <X size={14}/>
                      </button>
                    )}
                  </div>
                )) : (
                  <div className="text-center text-xs text-muted-foreground py-6">
                    {lang === "kn" ? "ಇನ್ನೂ ಭೇಟಿಗಳಿಲ್ಲ" : "No visits yet"}
                  </div>
                )}
              </div>
            </>
          )}

          {tab === "payments" && (
            <>
              {!locked && (
                <div className="rounded-xl border border-border bg-card p-3 space-y-2">
                  <div className="grid grid-cols-2 gap-2 p-1 bg-secondary/50 rounded-lg">
                    <button data-testid="cpay-mode-payment" onClick={() => setPayMode("payment")}
                      className={`min-h-[36px] rounded-md text-xs font-medium transition-colors ${payMode === "payment" ? "bg-white shadow-sm" : "text-muted-foreground"}`}>
                      {lang === "kn" ? "ಪಾವತಿ" : "Payment out"}
                    </button>
                    <button data-testid="cpay-mode-return" onClick={() => setPayMode("return")}
                      className={`min-h-[36px] rounded-md text-xs font-medium transition-colors ${payMode === "return" ? "bg-white shadow-sm" : "text-muted-foreground"}`}>
                      {lang === "kn" ? "ವಾಪಸಾತಿ" : "Return in"}
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input data-testid="pay-date" type="date" value={payForm.date}
                      onChange={e => setPayForm({...payForm, date: e.target.value})}
                      className="min-h-[44px]"/>
                    <Input data-testid="pay-amount" type="number" inputMode="decimal"
                      placeholder={t("amount")}
                      value={payForm.amount}
                      onChange={e => setPayForm({...payForm, amount: e.target.value})}
                      className="min-h-[44px]"/>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {["cash", "upi"].map(m => (
                      <button key={m} data-testid={`pay-method-${m}`} onClick={() => setPayForm({...payForm, method: m})}
                        className={`min-h-[40px] rounded-lg border text-sm ${
                          payForm.method === m ? "bg-[hsl(var(--primary))] text-white border-transparent" : "bg-white border-border text-muted-foreground"
                        }`}>{t(m)}</button>
                    ))}
                  </div>
                  <Textarea data-testid="pay-notes" placeholder={t("notes")}
                    value={payForm.notes}
                    onChange={e => setPayForm({...payForm, notes: e.target.value})}/>
                  <Button data-testid="add-payment-btn" onClick={addPayment}
                    className="w-full min-h-[44px] rounded-lg bg-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/90">
                    {payMode === "return"
                      ? <><ArrowUUpLeft size={16} className="mr-1"/>{lang === "kn" ? "ವಾಪಸಾತಿ ಸೇರಿಸಿ" : "Record return"}</>
                      : <><CurrencyInr size={16} className="mr-1"/>{lang === "kn" ? "ಪಾವತಿ ಸೇರಿಸಿ" : "Record payment"}</>
                    }
                  </Button>
                </div>
              )}

              <div className="space-y-2">
                {data?.payments?.length ? data.payments.map(p => (
                  <div key={p.id} data-testid={`payment-${p.id}`} className="rounded-lg border border-border bg-card px-3 py-3 flex items-center gap-3">
                    <div className="h-9 w-9 rounded-md bg-[hsl(var(--accent))]/10 text-[hsl(var(--accent))] grid place-items-center">
                      <Wallet size={16} weight="duotone"/>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">
                        ₹{p.amount} <span className="text-muted-foreground text-xs">· {p.method?.toUpperCase()}</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {p.date}{p.notes ? ` · ${p.notes}` : ""}
                      </div>
                    </div>
                    {!locked && (
                      <button onClick={() => delPayment(p.id)}
                        className="h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:bg-[hsl(var(--accent))]/10 hover:text-[hsl(var(--accent))]">
                        <X size={14}/>
                      </button>
                    )}
                  </div>
                )) : null}

                {data?.returns?.map(r => (
                  <div key={r.id} data-testid={`creturn-${r.id}`} className="rounded-lg border border-[hsl(var(--primary))]/30 bg-[hsl(var(--primary))]/5 px-3 py-3 flex items-center gap-3">
                    <div className="h-9 w-9 rounded-md bg-[hsl(var(--primary))]/15 text-[hsl(var(--primary))] grid place-items-center">
                      <ArrowUUpLeft size={16} weight="duotone"/>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-[hsl(var(--primary))]">
                        + ₹{r.amount} <span className="text-muted-foreground text-xs">· {r.method?.toUpperCase()}</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {r.date} · {lang === "kn" ? "ವಾಪಸಾತಿ" : "Return"}{r.notes ? ` · ${r.notes}` : ""}
                      </div>
                    </div>
                    {!locked && (
                      <button onClick={() => delReturn(r.id)}
                        className="h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:bg-[hsl(var(--accent))]/10 hover:text-[hsl(var(--accent))]">
                        <X size={14}/>
                      </button>
                    )}
                  </div>
                ))}

                {!(data?.payments?.length || data?.returns?.length) && (
                  <div className="text-center text-xs text-muted-foreground py-6">
                    {lang === "kn" ? "ಇನ್ನೂ ಪಾವತಿಗಳಿಲ್ಲ" : "No payments yet"}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryStat({ icon: Icon, label, val, accent }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <Icon size={16} weight="duotone" className={accent ? "text-[hsl(var(--accent))]" : "text-[hsl(var(--primary))]"}/>
      <div className="mt-1.5 text-[9px] uppercase tracking-wider text-muted-foreground truncate">{label}</div>
      <div className={`mt-0.5 text-sm font-semibold ${accent ? "text-[hsl(var(--accent))]" : ""}`}>{val}</div>
    </div>
  );
}

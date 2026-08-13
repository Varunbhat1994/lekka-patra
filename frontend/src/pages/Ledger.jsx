import { useEffect, useState } from "react";
import axios from "axios";
import AppShell from "@/components/AppShell";
import TrialBanner from "@/components/TrialBanner";
import { useApp } from "@/context/AppContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { CaretRight, User, Wallet, WhatsappLogo, FilePdf, MicrosoftExcelLogo, Plus, ArrowUUpLeft, ArrowCounterClockwise } from "@phosphor-icons/react";

export default function Ledger() {
  const { t, user, API, lang } = useApp();
  const locked = user?.access?.locked;
  const [workers, setWorkers] = useState([]);
  const [ledgers, setLedgers] = useState({});
  const [selected, setSelected] = useState(null);
  const [advOpen, setAdvOpen] = useState(false);
  const [mode, setMode] = useState("advance"); // "advance" | "return"
  const [adv, setAdv] = useState({ amount: "", method: "cash", notes: "", date: new Date().toISOString().slice(0,10) });

  // Settle-dialog state — kept in a separate object so we don't collide with
  // the advance/return dialog. `worker` holds the row being settled, `led`
  // is a snapshot of that worker's ledger at open time (used for display so
  // the numbers don't shift while the user edits the amount).
  const [settleOpen, setSettleOpen] = useState(false);
  const [settleForm, setSettleForm] = useState({ worker: null, led: null, mode: "actual_paid", actual: "" });

  // History filter — year/month. Empty = current-cycle view.
  const [histYear, setHistYear] = useState("");
  const [histMonth, setHistMonth] = useState("");

  const rangeParams = () => {
    if (!histYear) return "";
    const y = parseInt(histYear, 10);
    if (histMonth) {
      const m = parseInt(histMonth, 10);
      const first = `${y}-${String(m).padStart(2,"0")}-01`;
      const nextMonth = m === 12 ? new Date(y+1, 0, 1) : new Date(y, m, 1);
      const last = new Date(nextMonth.getTime() - 86400000).toISOString().slice(0,10);
      return `?start=${first}&end=${last}`;
    }
    return `?start=${y}-01-01&end=${y}-12-31`;
  };

  const loadAll = async () => {
    const w = await axios.get(`${API}/workers`);
    setWorkers(w.data);
    const q = rangeParams();
    const results = await Promise.all(w.data.map(x => axios.get(`${API}/ledger/${x.id}${q}`).then(r=>r.data).catch(()=>null)));
    const map = {};
    w.data.forEach((x, i) => { if (results[i]) map[x.id] = results[i]; });
    setLedgers(map);
  };
  useEffect(() => { loadAll(); }, [histYear, histMonth]);

  const openAdvance = (w, initialMode = "advance") => {
    setSelected(w);
    setMode(initialMode);
    setAdv({ amount: "", method: "cash", notes: "", date: new Date().toISOString().slice(0,10) });
    setAdvOpen(true);
  };
  const saveAdvance = async () => {
    if (!adv.amount) return toast.error("Amount required");
    const path = mode === "return" ? "/returns" : "/advances";
    try {
      await axios.post(`${API}${path}`, {
        worker_id: selected.id,
        date: adv.date,
        amount: parseFloat(adv.amount),
        method: adv.method,
        notes: adv.notes,
      });
      setAdvOpen(false);
      toast.success(mode === "return" ? (lang === "kn" ? "ವಾಪಸಾತಿ ಉಳಿಸಲಾಗಿದೆ" : "Return saved") : t("saved"));
      loadAll();
    } catch { toast.error("Failed"); }
  };

  const openSettle = async (w) => {
    // Always use CURRENT-cycle ledger for settle (ignore history filter).
    let l;
    try {
      const r = await axios.get(`${API}/ledger/${w.id}`);
      l = r.data;
    } catch { l = ledgers[w.id]; }
    const earned = Math.max(0, Number(l?.pending ?? 0));
    setSettleForm({ worker: w, led: l, mode: "actual_paid", actual: String(earned) });
    setSettleOpen(true);
  };

  const settle = async () => {
    const w = settleForm.worker;
    if (!w) return;
    const body = {
      worker_id: w.id,
      up_to_date: new Date().toISOString().slice(0, 10),
      mode: settleForm.mode,
      note: "",
    };
    if (settleForm.mode === "actual_paid") {
      const parsed = parseFloat(settleForm.actual);
      if (!(parsed >= 0)) {
        toast.error(lang === "kn" ? "ಸರಿಯಾದ ಮೊತ್ತ ನಮೂದಿಸಿ" : "Enter a valid amount");
        return;
      }
      body.actual_paid = parsed;
    }
    try {
      const r = await axios.post(`${API}/settlements`, body);
      const d = r.data || {};
      setSettleOpen(false);
      if (d.worker_owes_user > 0) {
        toast.success(lang === "kn" ? `ಇತ್ಯರ್ಥ ಆಗಿದೆ · ಕಾರ್ಮಿಕ ನಿಮಗೆ ₹${d.worker_owes_user} ಸಾಲ` : `Settled · Worker owes you ₹${d.worker_owes_user}`);
      } else if (d.new_advance_created > 0) {
        toast.success(lang === "kn" ? `ಇತ್ಯರ್ಥ · ಹೊಸ ಮುಂಗಡ ₹${d.new_advance_created}` : `Settled · New advance ₹${d.new_advance_created} created`);
      } else {
        toast.success(lang === "kn" ? "ಇತ್ಯರ್ಥಗೊಂಡಿದೆ" : "Settled");
      }
      loadAll();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed");
    }
  };

  const undoSettle = async (w, settlement) => {
    if (!settlement?.id) return;
    if (!window.confirm(lang === "kn"
      ? `${w.name} ರವರ ₹${settlement.amount} ಇತ್ಯರ್ಥವನ್ನು ರದ್ದುಮಾಡಬೇಕೆ?`
      : `Undo settlement of ₹${settlement.amount} for ${w.name}?`
    )) return;
    try {
      await axios.delete(`${API}/settlements/${settlement.id}`);
      toast.success(lang === "kn" ? "ಇತ್ಯರ್ಥ ರದ್ದುಗೊಳಿಸಲಾಗಿದೆ" : "Settlement reversed");
      loadAll();
    } catch { toast.error("Failed"); }
  };

  const downloadFile = async (path, filename) => {
    const url = `${API}${path}`;
    const r = await axios.get(url, { responseType: "blob" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(r.data);
    link.download = filename;
    link.click();
  };

  const whatsappShare = async (w) => {
    const { data } = await axios.get(`${API}/reports/whatsapp/${w.id}?lang=${lang || "en"}`);
    const phone = (data.phone || "").replace(/[^\d]/g, "");
    const text = encodeURIComponent(data.message);
    const url = phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`;
    window.open(url, "_blank");
  };

  return (
    <AppShell title={t("ledger")}>
      <div className="space-y-4">
        <TrialBanner />

        <div className="flex gap-2">
          <Button data-testid="export-pdf-btn" onClick={() => downloadFile(`/reports/pdf${rangeParams()}`, "farm_report.pdf")}
            variant="outline" className="flex-1 min-h-[44px] rounded-lg">
            <FilePdf size={18} weight="duotone" className="mr-1"/>{t("export_pdf")}
          </Button>
          <Button data-testid="export-excel-btn" onClick={() => downloadFile(`/reports/excel${rangeParams()}`, "farm_report.xlsx")}
            variant="outline" className="flex-1 min-h-[44px] rounded-lg">
            <MicrosoftExcelLogo size={18} weight="duotone" className="mr-1"/>{t("export_excel")}
          </Button>
        </div>

        {/* Year / Month history filter — empty = current cycle */}
        <div className="rounded-xl border border-border bg-card p-3 flex items-center gap-2" data-testid="history-filter">
          <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
            {lang === "kn" ? "ಇತಿಹಾಸ" : "History"}
          </div>
          <select
            data-testid="history-year"
            value={histYear}
            onChange={(e) => { setHistYear(e.target.value); if (!e.target.value) setHistMonth(""); }}
            className="min-h-[36px] rounded-md border border-border bg-white px-2 text-sm flex-1"
          >
            <option value="">{lang === "kn" ? "ಪ್ರಸ್ತುತ" : "Current"}</option>
            {(() => {
              const now = new Date().getFullYear();
              const years = [];
              for (let y = now; y >= now - 5; y--) years.push(y);
              return years.map(y => <option key={y} value={y}>{y}</option>);
            })()}
          </select>
          <select
            data-testid="history-month"
            value={histMonth}
            onChange={(e) => setHistMonth(e.target.value)}
            disabled={!histYear}
            className="min-h-[36px] rounded-md border border-border bg-white px-2 text-sm flex-1 disabled:opacity-50"
          >
            <option value="">{lang === "kn" ? "ಪೂರ್ಣ ವರ್ಷ" : "Full year"}</option>
            {["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].map((m,i) => (
              <option key={i} value={i+1}>{m}</option>
            ))}
          </select>
        </div>

        {workers.length === 0 && (
          <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
            {t("no_workers")}
          </div>
        )}

        <div className="space-y-3">
          {workers.map(w => {
            const l = ledgers[w.id];
            return (
              <div key={w.id} data-testid={`ledger-row-${w.id}`} className="rounded-xl border border-border bg-card p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))] grid place-items-center">
                    <User size={20} weight="duotone"/>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{w.name}</div>
                    <div className="text-xs text-muted-foreground">₹{w.daily_rate}/day</div>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-2 text-center">
                  <Stat label={t("days_worked")} val={l?.days_worked ?? "—"} />
                  <Stat label={t("total_earned")} val={l ? `₹${l.total_earned}` : "—"} />
                  <Stat label={lang === "kn" ? "ನಿವ್ವಳ ಮುಂಗಡ" : "Net advance"} val={l ? `₹${l.net_advance ?? l.total_advance}` : "—"} accent />
                  <Stat label={t("pending")} val={l ? `₹${l.pending}` : "—"} primary />
                </div>
                {l && (l.total_returned || 0) > 0 && (
                  <div className="text-[11px] text-muted-foreground -mt-1">
                    {lang === "kn" ? "ವಾಪಸಾತಿ" : "Returned"}: <span className="text-[hsl(var(--primary))] font-semibold">₹{l.total_returned}</span>
                    <span className="mx-1">·</span>
                    {lang === "kn" ? "ಒಟ್ಟು ಮುಂಗಡ" : "Total advance"}: ₹{l.total_advance}
                  </div>
                )}

                <div className="flex flex-wrap gap-2 pt-1">
                  {!locked && (
                    <Button data-testid={`add-adv-${w.id}`} onClick={() => openAdvance(w, "advance")} size="sm" variant="outline" className="flex-1 min-w-[calc(50%-4px)] rounded-lg">
                      <Plus size={14} className="mr-1"/>{lang === "kn" ? "ಮುಂಗಡ" : "Advance"}
                    </Button>
                  )}
                  {!locked && (
                    <Button data-testid={`add-ret-${w.id}`} onClick={() => openAdvance(w, "return")} size="sm" variant="outline"
                      className="flex-1 min-w-[calc(50%-4px)] rounded-lg border-[hsl(var(--primary))] text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/5">
                      <ArrowUUpLeft size={14} className="mr-1"/>{lang === "kn" ? "ವಾಪಸಾತಿ" : "Return"}
                    </Button>
                  )}
                  <Button data-testid={`pdf-${w.id}`} onClick={() => downloadFile(`/reports/pdf?worker_id=${w.id}`, `${w.name}.pdf`)}
                    size="sm" variant="outline" className="flex-1 min-w-[calc(50%-4px)] rounded-lg">
                    <FilePdf size={14} className="mr-1"/>PDF
                  </Button>
                  <Button data-testid={`wa-${w.id}`} onClick={() => whatsappShare(w)} size="sm" variant="outline" className="flex-1 min-w-[calc(50%-4px)] rounded-lg">
                    <WhatsappLogo size={14} weight="duotone" className="mr-1"/>WhatsApp
                  </Button>
                  {!locked && (
                    <Button data-testid={`settle-${w.id}`} onClick={() => openSettle(w)} size="sm"
                      className="basis-full w-full rounded-lg bg-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/90 whitespace-normal h-auto min-h-[36px] py-1.5 leading-tight">
                      <Wallet size={14} className="mr-1 shrink-0"/>
                      <span className="truncate">{t("mark_settled")}</span>
                    </Button>
                  )}
                  {!locked && l?.settlements?.length > 0 && (
                    <Button data-testid={`undo-settle-${w.id}`} onClick={() => undoSettle(w, l.settlements[0])} size="sm"
                      variant="outline"
                      className="basis-full w-full rounded-lg border-[hsl(var(--accent))] text-[hsl(var(--accent))] hover:bg-[hsl(var(--accent))]/10 min-h-[36px]">
                      <ArrowCounterClockwise size={14} className="mr-1 shrink-0"/>
                      <span className="truncate">
                        {lang === "kn" ? "ಕೊನೆಯ ಇತ್ಯರ್ಥ ರದ್ದುಮಾಡಿ" : "Undo last settlement"}
                        {` · ₹${l.settlements[0].amount || 0}`}
                      </span>
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Dialog open={advOpen} onOpenChange={setAdvOpen}>
        <DialogContent className="max-w-[92%] rounded-xl">
          <DialogHeader>
            <DialogTitle>
              {mode === "return"
                ? (lang === "kn" ? "ವಾಪಸಾತಿ ದಾಖಲಿಸಿ" : "Record Return")
                : t("record_advance")} — {selected?.name}
            </DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-2 p-1 bg-secondary/50 rounded-lg">
            <button data-testid="mode-advance-btn" onClick={() => setMode("advance")}
              className={`min-h-[40px] rounded-md text-sm font-medium transition-colors ${mode === "advance" ? "bg-white shadow-sm text-foreground" : "text-muted-foreground"}`}>
              {lang === "kn" ? "ಮುಂಗಡ" : "Advance out"}
            </button>
            <button data-testid="mode-return-btn" onClick={() => setMode("return")}
              className={`min-h-[40px] rounded-md text-sm font-medium transition-colors ${mode === "return" ? "bg-white shadow-sm text-foreground" : "text-muted-foreground"}`}>
              {lang === "kn" ? "ವಾಪಸಾತಿ" : "Return in"}
            </button>
          </div>

          <div className="space-y-3">
            <div>
              <Label className="text-xs uppercase tracking-[0.15em] text-muted-foreground">{t("amount")}</Label>
              <Input data-testid="adv-amount" type="number" value={adv.amount} onChange={e=>setAdv({...adv, amount:e.target.value})} className="min-h-[48px]"/>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-[0.15em] text-muted-foreground">{t("date")}</Label>
              <Input data-testid="adv-date" type="date" value={adv.date} onChange={e=>setAdv({...adv, date:e.target.value})} className="min-h-[48px]"/>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-[0.15em] text-muted-foreground">{t("method")}</Label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                {["cash","upi"].map(m => (
                  <button key={m} data-testid={`adv-method-${m}`} onClick={()=>setAdv({...adv, method:m})}
                    className={`min-h-[44px] rounded-lg border text-sm ${adv.method===m ? "bg-[hsl(var(--primary))] text-white border-transparent" : "bg-white border-border text-muted-foreground"}`}>
                    {t(m)}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-[0.15em] text-muted-foreground">{t("notes")}</Label>
              <Textarea data-testid="adv-notes" value={adv.notes} onChange={e=>setAdv({...adv, notes:e.target.value})}/>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={()=>setAdvOpen(false)}>{t("cancel")}</Button>
            <Button data-testid="save-adv-btn" onClick={saveAdvance} className="bg-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/90">{t("save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Settle dialog — separate from advance/return */}
      <Dialog open={settleOpen} onOpenChange={setSettleOpen}>
        <DialogContent className="max-w-[92%] rounded-xl">
          <DialogHeader>
            <DialogTitle data-testid="settle-dialog-title">
              {lang === "kn" ? "ಇತ್ಯರ್ಥಗೊಳಿಸಿ" : "Settle"} — {settleForm.worker?.name}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-border bg-secondary/40 p-3">
                <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                  {lang === "kn" ? "ಈ ಅವಧಿಯ ಗಳಿಕೆ" : "Earned this period"}
                </div>
                <div className="text-lg font-semibold text-[hsl(var(--primary))] mt-1" data-testid="settle-current-payable">
                  ₹{Math.max(0, Number(settleForm.led?.pending ?? 0))}
                </div>
              </div>
              <div className="rounded-lg border border-border bg-secondary/40 p-3">
                <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                  {lang === "kn" ? "ಬಾಕಿ ಮುಂಗಡ" : "Pending advance"}
                </div>
                <div className="text-lg font-semibold text-[hsl(var(--accent))] mt-1" data-testid="settle-pending-advance">
                  ₹{Math.max(0, Number(settleForm.led?.net_advance ?? 0))}
                </div>
              </div>
            </div>

            {/* Mode toggle — Adjust from advance vs Pay in cash */}
            <div className="grid grid-cols-2 gap-2" role="radiogroup">
              {[
                { key: "actual_paid",     label: lang==="kn" ? "ನಗದು ಪಾವತಿ"   : "Pay in cash" },
                { key: "adjust_advance",  label: lang==="kn" ? "ಮುಂಗಡದಿಂದ ಕಳೆ" : "Adjust from advance" },
              ].map(opt => {
                const active = settleForm.mode === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    data-testid={`settle-mode-${opt.key}`}
                    onClick={() => setSettleForm({ ...settleForm, mode: opt.key })}
                    aria-pressed={active}
                    className={`min-h-[44px] rounded-lg border text-sm font-medium transition-all active:scale-[0.98] ${
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

            {settleForm.mode === "actual_paid" ? (
              <div>
                <Label className="text-xs uppercase tracking-[0.15em] text-muted-foreground">
                  {lang === "kn" ? "ಇಂದು ಪಾವತಿಸಿದ ಮೊತ್ತ" : "Actual amount paid today"}
                </Label>
                <Input
                  data-testid="settle-amount-input"
                  type="number"
                  inputMode="decimal"
                  value={settleForm.actual}
                  onChange={(e) => setSettleForm({ ...settleForm, actual: e.target.value })}
                  className="min-h-[48px] text-lg"
                />
                {(() => {
                  const earned = Math.max(0, Number(settleForm.led?.pending ?? 0));
                  const actual = Number(settleForm.actual || 0);
                  if (actual > earned) {
                    const extra = actual - earned;
                    return (
                      <p className="text-[11px] text-[hsl(var(--accent))] mt-1" data-testid="settle-preview">
                        {lang === "kn"
                          ? `ಹೆಚ್ಚುವರಿ ₹${extra} ಹೊಸ ಮುಂಗಡವಾಗಿ ದಾಖಲಾಗುತ್ತದೆ`
                          : `Extra ₹${extra} will be recorded as a new advance`}
                      </p>
                    );
                  }
                  if (actual < earned) {
                    return (
                      <p className="text-[11px] text-red-600 mt-1" data-testid="settle-preview">
                        {lang === "kn"
                          ? "ಗಳಿಸಿದ ಮೊತ್ತಕ್ಕಿಂತ ಕಡಿಮೆ. 'ಮುಂಗಡದಿಂದ ಕಳೆ' ಆಯ್ಕೆ ಬಳಸಿ ಅಥವಾ ಗಳಿಸಿದ ಮೊತ್ತ ಪಾವತಿಸಿ."
                          : "Less than earned. Use 'Adjust from advance' or pay at least the earned amount."}
                      </p>
                    );
                  }
                  return (
                    <p className="text-[11px] text-muted-foreground mt-1" data-testid="settle-preview">
                      {lang === "kn" ? "ನಿಖರವಾಗಿ ಗಳಿಸಿದ ಮೊತ್ತ ಪಾವತಿ" : "Paying exactly the earned amount"}
                    </p>
                  );
                })()}
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-secondary/30 p-3" data-testid="settle-preview">
                {(() => {
                  const earned = Math.max(0, Number(settleForm.led?.pending ?? 0));
                  const adv = Math.max(0, Number(settleForm.led?.net_advance ?? 0));
                  const owes = adv - earned;
                  if (owes > 0) {
                    return (
                      <p className="text-sm">
                        {lang === "kn"
                          ? `ಇತ್ಯರ್ಥ ನಂತರ: `
                          : `After settle: `}
                        <span className="font-semibold text-[hsl(var(--accent))]">
                          {lang === "kn" ? `ಕಾರ್ಮಿಕ ನಿಮಗೆ ₹${owes} ಸಾಲ` : `Worker owes you ₹${owes}`}
                        </span>
                      </p>
                    );
                  }
                  if (owes < 0) {
                    return (
                      <p className="text-sm">
                        {lang === "kn"
                          ? `ಇತ್ಯರ್ಥ ನಂತರ: `
                          : `After settle: `}
                        <span className="font-semibold text-red-600">
                          {lang === "kn" ? `ನೀವು ಕಾರ್ಮಿಕರಿಗೆ ₹${-owes} ಸಾಲ` : `You owe worker ₹${-owes}`}
                        </span>
                      </p>
                    );
                  }
                  return (
                    <p className="text-sm text-muted-foreground">
                      {lang === "kn" ? "ಇತ್ಯರ್ಥ ನಂತರ ಎಲ್ಲಾ ಬ್ಯಾಲೆನ್ಸ್ ಶೂನ್ಯ" : "Balances fully settled (₹0)"}
                    </p>
                  );
                })()}
                <p className="text-[11px] text-muted-foreground mt-1">
                  {lang === "kn"
                    ? "ನಗದು ವಿನಿಮಯವಿಲ್ಲ. ಗಳಿಸಿದ ಮೊತ್ತವನ್ನು ಮುಂಗಡದಿಂದ ಕಳೆಯಲಾಗುತ್ತದೆ."
                    : "No cash exchanged. Earned amount is deducted from the advance."}
                </p>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setSettleOpen(false)}>
              {t("cancel")}
            </Button>
            <Button
              data-testid="confirm-settle-btn"
              onClick={settle}
              className="bg-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/90"
            >
              {lang === "kn" ? "ಇತ್ಯರ್ಥಗೊಳಿಸಿ" : "Confirm Settlement"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function Stat({ label, val, primary, accent }) {
  return (
    <div className="border border-border rounded-lg p-2 min-w-0">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground leading-tight break-words">{label}</div>
      <div className={`text-sm font-semibold mt-0.5 truncate ${primary ? "text-[hsl(var(--primary))]" : accent ? "text-[hsl(var(--accent))]" : ""}`}>{val}</div>
    </div>
  );
}

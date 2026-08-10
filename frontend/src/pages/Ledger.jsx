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

  const loadAll = async () => {
    const w = await axios.get(`${API}/workers`);
    setWorkers(w.data);
    const results = await Promise.all(w.data.map(x => axios.get(`${API}/ledger/${x.id}`).then(r=>r.data).catch(()=>null)));
    const map = {};
    w.data.forEach((x, i) => { if (results[i]) map[x.id] = results[i]; });
    setLedgers(map);
  };
  useEffect(() => { loadAll(); }, []);

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

  const settle = async (w) => {
    if (!window.confirm(`Mark ${w.name} settled up to today?`)) return;
    try {
      await axios.post(`${API}/settlements`, {
        worker_id: w.id,
        up_to_date: new Date().toISOString().slice(0,10),
        note: "",
      });
      // Optimistic: settlement acts as cutoff → everything before today counts as closed.
      setLedgers(prev => ({
        ...prev,
        [w.id]: prev[w.id] ? {
          ...prev[w.id],
          days_worked: 0,
          total_earned: 0,
          total_advance: 0,
          total_returned: 0,
          net_advance: 0,
          pending: 0,
          total_settled: (prev[w.id].total_settled ?? 0) + (prev[w.id].pending ?? 0),
        } : prev[w.id],
      }));
      toast.success(lang === "kn" ? "ಇತ್ಯರ್ಥ ದಾಖಲಿಸಲಾಗಿದೆ" : "Settled");
      loadAll();
    } catch { toast.error("Failed"); }
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
          <Button data-testid="export-pdf-btn" onClick={() => downloadFile("/reports/pdf", "farm_report.pdf")}
            variant="outline" className="flex-1 min-h-[44px] rounded-lg">
            <FilePdf size={18} weight="duotone" className="mr-1"/>{t("export_pdf")}
          </Button>
          <Button data-testid="export-excel-btn" onClick={() => downloadFile("/reports/excel", "farm_report.xlsx")}
            variant="outline" className="flex-1 min-h-[44px] rounded-lg">
            <MicrosoftExcelLogo size={18} weight="duotone" className="mr-1"/>{t("export_excel")}
          </Button>
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
                    <Button data-testid={`settle-${w.id}`} onClick={() => settle(w)} size="sm"
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

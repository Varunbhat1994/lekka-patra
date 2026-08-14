import { useEffect, useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import AppShell from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { ArrowLeft, FilePdf, Handshake, ArrowDown, ArrowUp, User } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useApp } from "@/context/AppContext";
import { fmtDate } from "@/lib/formatDate";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export default function ContractorHistory() {
  const { id } = useParams();
  const nav = useNavigate();
  const { lang } = useApp();
  const [contractor, setContractor] = useState(null);
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState("");
  const [led, setLed] = useState(null);
  const [expanded, setExpanded] = useState({});

  const rangeQ = () => {
    if (month) {
      const m = parseInt(month, 10);
      const first = `${year}-${String(m).padStart(2,"0")}-01`;
      const nextM = m === 12 ? new Date(year+1,0,1) : new Date(year,m,1);
      const last = new Date(nextM.getTime() - 86400000).toISOString().slice(0,10);
      return `?start=${first}&end=${last}`;
    }
    return `?start=${year}-01-01&end=${year}-12-31`;
  };

  useEffect(() => {
    document.body.classList.add("reports-page");
    return () => document.body.classList.remove("reports-page");
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const r = await axios.get(`${API}/contractors/${id}/ledger${rangeQ()}`);
        setLed(r.data);
        setContractor(r.data?.contractor || null);
      } catch { toast.error("Failed"); }
    })();
  }, [id, year, month]);

  const byMonth = useMemo(() => {
    if (!led) return {};
    const g = {};
    const push = (m, ev) => { (g[m] ||= { visit:[], pay:[], ret:[] }); g[m][ev.kind].push(ev); };
    (led.visits||[]).forEach(v => push(v.date.slice(0,7), { kind:"visit", ...v }));
    (led.payments||[]).forEach(p => push(p.date.slice(0,7), { kind:"pay", ...p }));
    (led.returns||[]).forEach(r => push(r.date.slice(0,7), { kind:"ret", ...r }));
    return g;
  }, [led]);

  const monthsSorted = Object.keys(byMonth).sort().reverse();
  const years = (() => { const now = new Date().getFullYear(); return Array.from({length:6},(_,i)=>now-i); })();

  const downloadPDF = async () => {
    try {
      const r = await axios.get(`${API}/reports/contractor/${id}/pdf${rangeQ()}`, { responseType: "blob" });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement("a");
      a.href = url; a.download = `${contractor?.name || "contractor"}_history_${year}${month?`_${month}`:""}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch { toast.error("PDF failed"); }
  };

  return (
    <AppShell title={lang==="kn"?"ಗುತ್ತಿಗೆದಾರ ಇತಿಹಾಸ":"Contractor History"}>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Button data-testid="back-btn" onClick={()=>nav(-1)} size="sm" variant="outline"><ArrowLeft size={16}/></Button>
          <div className="flex-1 min-w-0">
            <div className="font-semibold truncate">{contractor?.name}</div>
            <div className="text-xs text-muted-foreground truncate">{contractor?.mobile || "—"}</div>
          </div>
          <Button data-testid="export-hist-pdf" onClick={downloadPDF} size="sm" className="bg-[hsl(var(--primary))]">
            <FilePdf size={16} className="mr-1"/>PDF
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Kpi label={lang==="kn"?"ಭೇಟಿಗಳು":"Visits"} value={led?.total_visits ?? 0} />
          <Kpi label={lang==="kn"?"ಕಾರ್ಮಿಕರು":"Workers Brought"} value={led?.total_workers_brought ?? 0} />
          <Kpi label={lang==="kn"?"ಒಟ್ಟು ಪಾವತಿ":"Total Paid"} value={`₹${led?.total_paid ?? 0}`} tone="primary" />
          <Kpi label={lang==="kn"?"ಒಟ್ಟು ವಾಪಸ್":"Total Returned"} value={`₹${led?.total_returned ?? 0}`} />
          <Kpi label={lang==="kn"?"ಒಟ್ಟು ಇತ್ಯರ್ಥ":"Total Settled"} value={`₹${led?.total_settled ?? 0}`} tone="accent" />
          <Kpi label={lang==="kn"?"ನಿವ್ವಳ ಪಾವತಿ":"Net Paid"} value={`₹${led?.net_paid ?? 0}`} />
        </div>
        <div className="rounded-2xl border border-[hsl(28_40%_86%)] bg-white/85 backdrop-blur-sm shadow-sm p-3" data-testid="contractor-balance-card">
          {(() => {
            const fb = Number(led?.final_balance ?? 0);
            if (fb > 0) {
              return (<>
                <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                  {lang==="kn" ? "ನೀವು ಗುತ್ತಿಗೆದಾರರಿಗೆ ಸಾಲ" : "You owe contractor"}
                </div>
                <div className="text-xl font-bold mt-1 text-[hsl(var(--primary))]">₹{fb}</div>
              </>);
            }
            if (fb < 0) {
              return (<>
                <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                  {lang==="kn" ? "ಗುತ್ತಿಗೆದಾರ ನಿಮಗೆ ಸಾಲ" : "Contractor owes you"}
                </div>
                <div className="text-xl font-bold mt-1 text-red-600">₹{-fb}</div>
              </>);
            }
            return (<>
              <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                {lang==="kn" ? "ಸಮತೋಲನ" : "Balanced"}
              </div>
              <div className="text-xl font-bold mt-1 text-muted-foreground">₹0</div>
            </>);
          })()}
          <div className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
            {lang==="kn"
              ? "ನಿವ್ವಳ ಪಾವತಿ = ಪಾವತಿಗಳು − ವಾಪಸಾತಿಗಳು. ಒಟ್ಟು ಇತ್ಯರ್ಥ = ಇತ್ಯರ್ಥದ ಮೂಲಕ ಬಂದ ವಾಪಸಾತಿ."
              : "Net Paid = Payments − Returns.  Total Settled = amount settled via contractor settlements (included in returns above)."}
          </div>
        </div>

        <div className="rounded-2xl border border-[hsl(28_40%_86%)] bg-white/85 backdrop-blur-sm shadow-sm p-3 flex gap-2 items-center">
          <select data-testid="hist-year" value={year} onChange={e=>{ setYear(parseInt(e.target.value)); setMonth(""); }}
            className="min-h-[36px] rounded-md border border-border bg-white px-2 text-sm flex-1">
            {years.map(y=><option key={y} value={y}>{y}</option>)}
          </select>
          <select data-testid="hist-month" value={month} onChange={e=>setMonth(e.target.value)}
            className="min-h-[36px] rounded-md border border-border bg-white px-2 text-sm flex-1">
            <option value="">{lang==="kn"?"ಎಲ್ಲಾ ತಿಂಗಳು":"All Months"}</option>
            {MONTHS.map((m,i)=><option key={i} value={i+1}>{m}</option>)}
          </select>
        </div>

        {monthsSorted.length === 0 && (
          <div className="rounded-2xl border border-dashed border-[hsl(28_40%_78%)] bg-white/60 p-8 text-center text-sm text-muted-foreground">
            {lang==="kn"?"ಈ ಅವಧಿಗೆ ಯಾವುದೇ ದಾಖಲೆ ಇಲ್ಲ":"No records in this period"}
          </div>
        )}
        {monthsSorted.map(mKey => {
          const g = byMonth[mKey];
          const [y,m] = mKey.split("-");
          const label = `${MONTHS[parseInt(m)-1]} ${y}`;
          const mVisits = g.visit.reduce((s,v)=>s+v.workers_count,0);
          const mPaid = g.pay.reduce((s,p)=>s+p.amount,0);
          const mRet = g.ret.reduce((s,r)=>s+r.amount,0);
          const open = expanded[mKey] ?? true;
          return (
            <div key={mKey} data-testid={`month-${mKey}`} className="rounded-2xl border border-[hsl(28_40%_86%)] bg-white/85 backdrop-blur-sm shadow-sm overflow-hidden">
              <button onClick={()=>setExpanded({...expanded,[mKey]:!open})} className="w-full flex items-center justify-between p-3 hover:bg-secondary/40">
                <div className="font-semibold">{label}</div>
                <div className="text-[11px] text-muted-foreground flex gap-2">
                  <span>V:{g.visit.length} ({mVisits}w)</span><span>P:₹{mPaid}</span><span>R:₹{mRet}</span>
                </div>
              </button>
              {open && (
                <div className="border-t border-border divide-y divide-border">
                  {g.visit.sort((a,b)=>b.date.localeCompare(a.date)).map(v => (
                    <Row key={"v"+v.id} date={v.date}
                      left={<span className="inline-flex items-center gap-1 text-xs text-[hsl(var(--primary))]"><User size={14}/>Visit</span>}
                      desc={`${v.workers_count} workers · ${v.field_crop || v.notes || "—"}`}
                      right={<span className="text-xs text-muted-foreground">{v.workers_count}w</span>} />
                  ))}
                  {g.pay.sort((a,b)=>b.date.localeCompare(a.date)).map(p => (
                    <Row key={"p"+p.id} date={p.date}
                      left={<span className="inline-flex items-center gap-1 text-xs text-[hsl(var(--accent))]"><ArrowDown size={14}/>Payment</span>}
                      desc={p.notes || p.method}
                      right={<span className="text-[hsl(var(--accent))] font-medium">-₹{p.amount}</span>} />
                  ))}
                  {g.ret.sort((a,b)=>b.date.localeCompare(a.date)).map(r => (
                    <Row key={"r"+r.id} date={r.date}
                      left={<span className="inline-flex items-center gap-1 text-xs text-emerald-700"><ArrowUp size={14}/>Return</span>}
                      desc={r.notes || r.method}
                      right={<span className="text-emerald-700 font-medium">+₹{r.amount}</span>} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </AppShell>
  );
}

function Kpi({ label, value, tone }) {
  const t = tone==="primary" ? "text-[hsl(var(--primary))]" : tone==="accent" ? "text-[hsl(var(--accent))]" : "";
  return (
    <div className="rounded-2xl border border-[hsl(28_40%_86%)] bg-white/85 backdrop-blur-sm shadow-sm p-3">
      <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">{label}</div>
      <div className={`text-lg font-bold mt-1 ${t}`}>{value}</div>
    </div>
  );
}
function Row({ date, left, desc, right }) {
  return (
    <div className="p-3 flex items-center gap-3">
      <div className="text-[11px] text-muted-foreground w-14 shrink-0">{fmtDate(date)}</div>
      <div className="w-24 shrink-0">{left}</div>
      <div className="flex-1 text-xs text-muted-foreground truncate">{desc}</div>
      <div className="text-sm shrink-0">{right}</div>
    </div>
  );
}

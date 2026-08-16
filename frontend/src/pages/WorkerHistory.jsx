import { useEffect, useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import AppShell from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { ArrowLeft, FilePdf, CheckCircle, XCircle, Handshake, Wallet, ArrowDown, ArrowUp } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useApp } from "@/context/AppContext";
import { getWorkerLedger } from "@/offline";
import { fmtDate } from "@/lib/formatDate";

const BACKEND = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND}/api`;
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export default function WorkerHistory() {
  const { id } = useParams();
  const nav = useNavigate();
  const { lang, accountScope } = useApp();
  const [worker, setWorker] = useState(null);
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(""); // "" = all months
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
      if (!accountScope) return;
      const data = await getWorkerLedger(accountScope, id, rangeQ());
      if (data) {
        setLed(data);
        setWorker(data?.worker || null);
      } else {
        // Offline AND no cache for this range — surface a clear message
        // instead of a blank screen.
        toast.error(lang === "kn" ? "ಈ ಶ್ರೇಣಿಗೆ ಆಫ್‌ಲೈನ್ ಡೇಟಾ ಇಲ್ಲ" : "No offline data for this range");
      }
    })();
  }, [id, year, month, accountScope]);

  // Group all events by month for expandable sections
  const byMonth = useMemo(() => {
    if (!led) return {};
    const groups = {};
    const push = (m, ev) => { (groups[m] ||= { att:[], adv:[], ret:[], settle:[] }); groups[m][ev.kind].push(ev); };
    (led.attendance||[]).forEach(a => push(a.date.slice(0,7), { kind:"att", ...a }));
    (led.advances||[]).forEach(a => push(a.date.slice(0,7), { kind:"adv", ...a }));
    (led.returns||[]).forEach(r => push(r.date.slice(0,7), { kind:"ret", ...r }));
    (led.settlements||[]).forEach(s => push((s.up_to_date||"").slice(0,7), { kind:"settle", ...s }));
    return groups;
  }, [led]);

  const monthsSorted = Object.keys(byMonth).sort().reverse();
  const netAdv = led?.net_advance ?? 0;
  const finalBal = Number(led?.final_balance ?? 0);
  const owesDir = finalBal > 0
    ? { label: lang==="kn" ? "ನೀವು ಕಾರ್ಮಿಕರಿಗೆ ಸಾಲ" : "You owe worker", val: finalBal, tone: "primary" }
    : finalBal < 0
    ? { label: lang==="kn" ? "ಕಾರ್ಮಿಕ ನಿಮಗೆ ಸಾಲ" : "Worker owes you", val: -finalBal, tone: "accent" }
    : { label: lang==="kn" ? "ಸಮತೋಲನ" : "Balanced", val: 0, tone: "muted" };

  const downloadPDF = async () => {
    try {
      const r = await axios.get(`${API}/reports/pdf${rangeQ()}&worker_id=${id}`, { responseType: "blob" });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement("a");
      a.href = url; a.download = `${worker?.name || "worker"}_history_${year}${month?`_${month}`:""}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch { toast.error("PDF failed"); }
  };

  const years = (() => {
    const now = new Date().getFullYear();
    return Array.from({length: 6}, (_, i) => now - i);
  })();

  const attStatusBadge = (s) => {
    if (s === "present")  return <span className="inline-flex items-center gap-1 text-xs text-[hsl(var(--primary))]"><CheckCircle size={14} weight="fill"/>Present</span>;
    if (s === "half_day") return <span className="text-xs text-amber-600">Half day</span>;
    if (s === "overtime") return <span className="text-xs text-blue-600">Overtime</span>;
    return <span className="inline-flex items-center gap-1 text-xs text-red-600"><XCircle size={14} weight="fill"/>Absent</span>;
  };

  return (
    <AppShell title={lang==="kn" ? "ಕಾರ್ಮಿಕ ಇತಿಹಾಸ" : "Worker History"}>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Button data-testid="back-btn" onClick={() => nav(-1)} size="sm" variant="outline"><ArrowLeft size={16}/></Button>
          <div className="flex-1 min-w-0">
            <div className="font-semibold truncate">{worker?.name}</div>
            <div className="text-xs text-muted-foreground truncate">{worker?.mobile || "—"} · ₹{worker?.daily_rate}/day</div>
          </div>
          <Button data-testid="export-hist-pdf" onClick={downloadPDF} size="sm" className="bg-[hsl(var(--primary))]">
            <FilePdf size={16} className="mr-1"/>PDF
          </Button>
        </div>

        {/* KPI cards — single Present + Days Worked pair. */}
        <div className="grid grid-cols-2 gap-2">
          <Kpi label={lang==="kn"?"ಹಾಜರಿ ದಿನಗಳು":"Present"} value={led?.present_count ?? 0} tone="primary" />
          <Kpi label={lang==="kn"?"ಕೆಲಸದ ದಿನಗಳು":"Days Worked"} value={led?.days_worked ?? 0} />
          <Kpi label={lang==="kn"?"ಒಟ್ಟು ಗಳಿಕೆ":"Total Earned"} value={`₹${led?.total_earned ?? 0}`} tone="primary" />
          <Kpi label={lang==="kn"?"ಒಟ್ಟು ಮುಂಗಡ":"Total Advances"} value={`₹${led?.total_advance ?? 0}`} />
          <Kpi label={lang==="kn"?"ಒಟ್ಟು ವಾಪಸ್":"Total Returns"} value={`₹${led?.total_returned ?? 0}`} />
          <Kpi label={lang==="kn"?"ಒಟ್ಟು ಇತ್ಯರ್ಥ":"Total Settled"} value={`₹${led?.total_settled ?? 0}`} tone="accent" />
        </div>
        <div className="rounded-2xl border border-[hsl(28_40%_86%)] bg-white/85 backdrop-blur-sm shadow-sm p-3" data-testid="net-advance-card">
          <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
            {lang==="kn" ? "ನಿವ್ವಳ ಮುಂಗಡ" : "Net Advance"}
          </div>
          <div className="text-lg font-semibold text-[hsl(var(--accent))] mt-1">₹{netAdv}</div>
        </div>
        <div className="rounded-2xl border border-[hsl(28_40%_86%)] bg-white/85 backdrop-blur-sm shadow-sm p-3" data-testid="balance-card">
          <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">{owesDir.label}</div>
          <div className={`text-xl font-bold mt-1 ${owesDir.tone === "primary" ? "text-[hsl(var(--primary))]" : owesDir.tone === "accent" ? "text-[hsl(var(--accent))]" : "text-muted-foreground"}`}>
            ₹{owesDir.val}
          </div>
        </div>

        {/* Filter */}
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

        {/* Monthly sections */}
        {monthsSorted.length === 0 && (
          <div className="rounded-2xl border border-dashed border-[hsl(28_40%_78%)] bg-white/60 p-8 text-center text-sm text-muted-foreground">
            {lang==="kn"?"ಈ ಅವಧಿಗೆ ಯಾವುದೇ ದಾಖಲೆ ಇಲ್ಲ":"No records in this period"}
          </div>
        )}
        {monthsSorted.map(mKey => {
          const g = byMonth[mKey];
          const [y, m] = mKey.split("-");
          const mLabel = `${MONTHS[parseInt(m)-1]} ${y}`;
          // Single source of truth: use per-row final_amount from backend.
          const monthEarned = g.att.reduce((s,a) => s + (a.final_amount ?? 0), 0);
          const monthAdv = g.adv.reduce((s,x)=>s+x.amount,0);
          const monthRet = g.ret.reduce((s,x)=>s+x.amount,0);
          const monthSettle = g.settle.reduce((s,x)=>s+(x.amount||0),0);
          const isOpen = expanded[mKey] ?? true;
          return (
            <div key={mKey} data-testid={`month-${mKey}`} className="rounded-2xl border border-[hsl(28_40%_86%)] bg-white/85 backdrop-blur-sm shadow-sm overflow-hidden">
              <button onClick={()=>setExpanded({...expanded, [mKey]: !isOpen})}
                className="w-full flex items-center justify-between p-3 hover:bg-secondary/40">
                <div className="font-semibold">{mLabel}</div>
                <div className="text-[11px] text-muted-foreground flex gap-2">
                  <span>E:₹{monthEarned}</span><span>A:₹{monthAdv}</span><span>R:₹{monthRet}</span><span>S:₹{monthSettle}</span>
                </div>
              </button>
              {isOpen && (
                <div className="border-t border-border divide-y divide-border">
                  {/* Attendance rows — Manual Wage + OT = Final Amount */}
                  {g.att.sort((a,b)=>b.date.localeCompare(a.date)).map(a => {
                    const wage = a.wage_component ?? 0;
                    const ot = a.ot_component ?? 0;
                    const final = a.final_amount ?? 0;
                    const combined = ot > 0
                      ? <span>₹{wage} + ₹{ot} (OT)</span>
                      : <span>₹{wage} + ₹0 (OT)</span>;
                    return (
                      <Row key={"a"+a.id} date={a.date}
                        left={attStatusBadge(a.status)}
                        desc={combined}
                        right={<span className="text-[hsl(var(--primary))] font-medium">= ₹{final}</span>} />
                    );
                  })}
                  {/* Advances */}
                  {g.adv.sort((a,b)=>b.date.localeCompare(a.date)).map(a => (
                    <Row key={"v"+a.id} date={a.date}
                      left={<span className="inline-flex items-center gap-1 text-xs text-[hsl(var(--accent))]"><ArrowDown size={14}/>Advance</span>}
                      desc={a.notes || a.method}
                      right={<span className="text-[hsl(var(--accent))] font-medium">-₹{a.amount}</span>} />
                  ))}
                  {/* Returns */}
                  {g.ret.sort((a,b)=>b.date.localeCompare(a.date)).map(r => (
                    <Row key={"r"+r.id} date={r.date}
                      left={<span className="inline-flex items-center gap-1 text-xs text-emerald-700"><ArrowUp size={14}/>{r.settlement_id ? "Return (Settlement)" : "Return"}</span>}
                      desc={r.notes || r.method}
                      right={<span className="text-emerald-700 font-medium">+₹{r.amount}</span>} />
                  ))}
                  {/* Settlements */}
                  {g.settle.sort((a,b)=>(b.up_to_date||"").localeCompare(a.up_to_date||"")).map(s => (
                    <Row key={"s"+s.id} date={s.up_to_date}
                      left={<span className="inline-flex items-center gap-1 text-xs text-indigo-700"><Handshake size={14}/>Settlement</span>}
                      desc={s.mode==="adjust_advance" ? "Adjust from advance" : s.mode==="actual_paid" ? `Paid ${s.actual_paid ?? s.amount}` : (s.note || "Settled")}
                      right={<span className="text-indigo-700 font-medium">₹{s.amount}</span>} />
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
  const toneCls = tone==="primary" ? "text-[hsl(var(--primary))]" : tone==="accent" ? "text-[hsl(var(--accent))]" : tone==="danger" ? "text-red-600" : "";
  return (
    <div className="rounded-2xl border border-[hsl(28_40%_86%)] bg-white/85 backdrop-blur-sm shadow-sm p-3">
      <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">{label}</div>
      <div className={`text-lg font-bold mt-1 ${toneCls}`}>{value}</div>
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

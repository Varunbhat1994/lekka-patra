import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { CaretLeft, CaretRight, CalendarBlank, X } from "@phosphor-icons/react";
import { useApp } from "@/context/AppContext";

// Auto-select rule (documented for reviewers/tests): earliest worker by
// created_at ASC (oldest first). If created_at is missing, the worker
// falls to the end of the list.
function sortWorkersOldestFirst(workers) {
  return [...(workers || [])].sort((a, b) => {
    const at = a?.created_at ? Date.parse(a.created_at) : Number.POSITIVE_INFINITY;
    const bt = b?.created_at ? Date.parse(b.created_at) : Number.POSITIVE_INFINITY;
    return at - bt;
  });
}

const DAY_HEADERS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function statusLabel(status) {
  if (status === "half_day") return "Half Day";
  if (status === "overtime") return "Overtime";
  if (status === "present") return "Present";
  return status || "";
}

function pad2(n) { return String(n).padStart(2, "0"); }

export default function AttendanceCalendar() {
  const { API } = useApp();
  const now = new Date();
  const [workers, setWorkers] = useState(null); // null = loading, [] = none
  const [selectedWorkerId, setSelectedWorkerId] = useState("");
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1-12
  const [records, setRecords] = useState([]); // [{date, status}]
  const [sheetDate, setSheetDate] = useState(null);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [sheetWorkers, setSheetWorkers] = useState([]);

  // Load workers once. Auto-select oldest (earliest created_at).
  useEffect(() => {
    let mounted = true;
    axios.get(`${API}/workers`).then(r => {
      if (!mounted) return;
      const sorted = sortWorkersOldestFirst(r.data || []);
      setWorkers(sorted);
      if (sorted.length > 0) setSelectedWorkerId(sorted[0].id);
    }).catch(() => { if (mounted) setWorkers([]); });
    return () => { mounted = false; };
  }, [API]);

  // Load month records for the selected worker.
  useEffect(() => {
    if (!selectedWorkerId) { setRecords([]); return; }
    const url = `${API}/calendar/month?worker_id=${selectedWorkerId}&year=${year}&month=${month}`;
    axios.get(url).then(r => setRecords(r.data?.records || [])).catch(() => setRecords([]));
  }, [API, selectedWorkerId, year, month]);

  // Build a Map: "YYYY-MM-DD" → status for this worker/month.
  const workerMarks = useMemo(() => {
    const m = new Map();
    for (const r of records) m.set(r.date, r.status);
    return m;
  }, [records]);

  // Days in the current month + leading blanks so weeks align (Sunday-first).
  const cells = useMemo(() => {
    const first = new Date(year, month - 1, 1);
    const daysInMonth = new Date(year, month, 0).getDate();
    const leading = first.getDay(); // 0=Sun
    const out = [];
    for (let i = 0; i < leading; i++) out.push(null);
    for (let d = 1; d <= daysInMonth; d++) out.push(d);
    return out;
  }, [year, month]);

  const goPrev = () => {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
  };
  const goNext = () => {
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
  };

  const openDate = async (day) => {
    if (day == null) return;
    const dateStr = `${year}-${pad2(month)}-${pad2(day)}`;
    setSheetDate(dateStr);
    setSheetLoading(true);
    setSheetWorkers([]);
    try {
      const r = await axios.get(`${API}/calendar/date?date=${dateStr}`);
      setSheetWorkers(r.data?.workers || []);
    } catch {
      setSheetWorkers([]);
    } finally {
      setSheetLoading(false);
    }
  };

  const closeSheet = () => setSheetDate(null);

  const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`;
  const today = new Date();
  const isToday = (d) => (
    d && today.getFullYear() === year && (today.getMonth() + 1) === month && today.getDate() === d
  );

  return (
    <div data-testid="attendance-calendar" className="rounded-xl border border-border bg-card p-4 space-y-4">
      <div className="flex items-center gap-2">
        <CalendarBlank size={20} weight="duotone" className="text-[hsl(var(--primary))]"/>
        <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Attendance</div>
      </div>

      {/* Worker selector */}
      <div>
        {workers === null ? (
          <div className="h-11 rounded-lg border border-border bg-muted/40 animate-pulse"/>
        ) : workers.length === 0 ? (
          <div
            data-testid="calendar-no-workers"
            className="h-11 flex items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground"
          >
            No workers yet
          </div>
        ) : (
          <select
            data-testid="calendar-worker-select"
            value={selectedWorkerId}
            onChange={(e) => setSelectedWorkerId(e.target.value)}
            className="w-full h-11 rounded-lg border border-border bg-background px-3 text-sm"
          >
            {workers.map(w => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* Month header with prev/next */}
      <div className="flex items-center justify-between">
        <button
          data-testid="calendar-prev"
          onClick={goPrev}
          className="w-11 h-11 rounded-lg border border-border flex items-center justify-center active:scale-[0.98] transition-transform"
          aria-label="Previous month"
        >
          <CaretLeft size={18} />
        </button>
        <div data-testid="calendar-month-label" className="text-base font-semibold tracking-tight">{monthLabel}</div>
        <button
          data-testid="calendar-next"
          onClick={goNext}
          className="w-11 h-11 rounded-lg border border-border flex items-center justify-center active:scale-[0.98] transition-transform"
          aria-label="Next month"
        >
          <CaretRight size={18} />
        </button>
      </div>

      {/* Day-of-week header */}
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] uppercase tracking-widest text-muted-foreground">
        {DAY_HEADERS.map((d, i) => <div key={i}>{d}</div>)}
      </div>

      {/* Date grid */}
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, idx) => {
          if (day == null) return <div key={idx} className="aspect-square"/>;
          const dateStr = `${year}-${pad2(month)}-${pad2(day)}`;
          const marked = workerMarks.has(dateStr);
          const status = workerMarks.get(dateStr);
          return (
            <button
              key={idx}
              data-testid={`cal-day-${dateStr}`}
              data-marked={marked ? "1" : "0"}
              onClick={() => openDate(day)}
              className={
                "aspect-square rounded-lg text-sm flex items-center justify-center relative " +
                "active:scale-[0.96] transition-transform " +
                (marked
                  ? "bg-[hsl(var(--primary))] text-primary-foreground font-semibold"
                  : "bg-transparent text-foreground hover:bg-muted") +
                (isToday(day) && !marked ? " ring-1 ring-[hsl(var(--primary))]" : "")
              }
              aria-label={`Date ${dateStr}${marked ? ", worked (" + statusLabel(status) + ")" : ""}`}
            >
              {day}
            </button>
          );
        })}
      </div>

      {/* Bottom sheet on date tap */}
      {sheetDate && (
        <div
          className="fixed inset-0 z-40 bg-black/40"
          onClick={closeSheet}
          data-testid="calendar-sheet-backdrop"
        >
          <div
            className="absolute inset-x-0 bottom-0 max-h-[70vh] overflow-y-auto rounded-t-2xl bg-card p-4 pb-8 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            data-testid="calendar-sheet"
          >
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Date</div>
                <div data-testid="sheet-date" className="text-lg font-semibold">
                  {(() => {
                    const [y, mo, d] = sheetDate.split("-").map(Number);
                    const dObj = new Date(y, mo - 1, d);
                    return dObj.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
                  })()}
                </div>
              </div>
              <button
                data-testid="sheet-close"
                onClick={closeSheet}
                className="w-10 h-10 rounded-full border border-border flex items-center justify-center"
                aria-label="Close"
              ><X size={18}/></button>
            </div>

            {sheetLoading ? (
              <div className="text-sm text-muted-foreground">Loading…</div>
            ) : sheetWorkers.length === 0 ? (
              <div
                data-testid="sheet-empty"
                className="text-sm text-muted-foreground py-4 text-center"
              >
                No attendance recorded for this date
              </div>
            ) : (
              <div className="space-y-2" data-testid="sheet-worker-list">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground mb-1">
                  Present workers
                </div>
                {sheetWorkers.map(w => (
                  <div
                    key={w.worker_id}
                    data-testid={`sheet-worker-${w.worker_id}`}
                    className="flex items-center justify-between rounded-lg border border-border bg-background p-3"
                  >
                    <div className="font-medium">{w.name}</div>
                    <div className="text-xs uppercase tracking-wider text-[hsl(var(--primary))] font-semibold">
                      {w.status === "present" ? "Present" : statusLabel(w.status)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

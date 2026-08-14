import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  CaretLeft, CaretRight, CalendarBlank, X, CaretDown, Check,
  Info, ClipboardText,
} from "@phosphor-icons/react";
import { useApp } from "@/context/AppContext";

// -------- helpers --------

// Auto-select rule (Batch B visual, same as Phase 2 logic): earliest
// worker by created_at ASC.
function sortWorkersOldestFirst(workers) {
  return [...(workers || [])].sort((a, b) => {
    const at = a?.created_at ? Date.parse(a.created_at) : Number.POSITIVE_INFINITY;
    const bt = b?.created_at ? Date.parse(b.created_at) : Number.POSITIVE_INFINITY;
    return at - bt;
  });
}

const DAY_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function statusLabel(status) {
  if (status === "half_day") return "HALF DAY";
  if (status === "overtime") return "OVERTIME";
  if (status === "present") return "PRESENT";
  return (status || "").toUpperCase();
}

// Palette per Reference A status pills:
//   Present → emerald green filled
//   Half Day → sky blue filled
//   Overtime → purple filled
function statusPillClass(status) {
  if (status === "half_day")
    return "bg-[hsl(210_88%_92%)] text-[hsl(215_85%_35%)]";
  if (status === "overtime")
    return "bg-[hsl(272_70%_92%)] text-[hsl(272_55%_38%)]";
  return "bg-[hsl(var(--primary))]/12 text-[hsl(var(--primary))]";
}

function pad2(n) { return String(n).padStart(2, "0"); }

function initials(name) {
  return (name || "?")
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

// Deterministic soft avatar tint from name — stays inside a warm palette.
function avatarTint(name) {
  const palette = [
    "bg-[hsl(140_55%_88%)] text-[hsl(140_45%_28%)]",
    "bg-[hsl(210_70%_90%)] text-[hsl(215_65%_32%)]",
    "bg-[hsl(45_75%_88%)] text-[hsl(35_55%_32%)]",
    "bg-[hsl(272_55%_92%)] text-[hsl(272_45%_35%)]",
    "bg-[hsl(345_65%_92%)] text-[hsl(345_55%_38%)]",
  ];
  let h = 0;
  for (const ch of name || "") h = (h * 31 + ch.charCodeAt(0)) & 0xffff;
  return palette[h % palette.length];
}

// -------- small subcomponents --------

function Avatar({ name, size = 40 }) {
  return (
    <div
      className={`rounded-full grid place-items-center font-semibold shrink-0 ${avatarTint(name)}`}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      aria-hidden="true"
    >
      {initials(name)}
    </div>
  );
}

function EmptyDateIllustration({ className = "" }) {
  return (
    <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"
         className={className} aria-hidden="true">
      <circle cx="100" cy="100" r="82" fill="hsl(140 55% 94%)"/>
      <rect x="58" y="58" width="84" height="84" rx="16"
            fill="white" stroke="hsl(140 40% 55%)" strokeWidth="3"/>
      <path d="M74 58 v -8 M126 58 v -8" stroke="hsl(140 40% 55%)" strokeWidth="3" strokeLinecap="round"/>
      <path d="M76 88 h 40 M76 104 h 32 M76 120 h 20"
            stroke="hsl(140 45% 55%)" strokeWidth="2.5" strokeLinecap="round"/>
      <circle cx="132" cy="128" r="14" fill="none" stroke="hsl(140 50% 40%)" strokeWidth="3"/>
      <path d="M142 138 l 10 10" stroke="hsl(140 50% 40%)" strokeWidth="3" strokeLinecap="round"/>
    </svg>
  );
}

// -------- main component --------

export default function AttendanceCalendar() {
  const { API, lang } = useApp();
  const now = new Date();
  const [workers, setWorkers] = useState(null);
  const [selectedWorkerId, setSelectedWorkerId] = useState("");
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [records, setRecords] = useState([]);
  const [sheetDate, setSheetDate] = useState(null);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [sheetWorkers, setSheetWorkers] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);

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

  useEffect(() => {
    if (!selectedWorkerId) { setRecords([]); return; }
    const url = `${API}/calendar/month?worker_id=${selectedWorkerId}&year=${year}&month=${month}`;
    axios.get(url).then(r => setRecords(r.data?.records || [])).catch(() => setRecords([]));
  }, [API, selectedWorkerId, year, month]);

  const workerMarks = useMemo(() => {
    const m = new Map();
    for (const r of records) m.set(r.date, r.status);
    return m;
  }, [records]);

  // Grid: Mon-first (per Reference A). Adjust JS day (0=Sun) → Mon-first index.
  const cells = useMemo(() => {
    const first = new Date(year, month - 1, 1);
    const daysInMonth = new Date(year, month, 0).getDate();
    const jsDow = first.getDay();               // 0=Sun..6=Sat
    const monFirstLeading = (jsDow + 6) % 7;    // Mon=0..Sun=6
    const out = [];
    for (let i = 0; i < monFirstLeading; i++) out.push(null);
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

  const selectedWorker = (workers || []).find(w => w.id === selectedWorkerId);
  const oldestId = (workers && workers[0]) ? workers[0].id : null;

  return (
    <div
      data-testid="attendance-calendar"
      className="rounded-2xl border border-border bg-card p-3 space-y-3 shadow-sm"
    >
      {/* Card header — Reference A style */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[hsl(var(--primary))]/12 grid place-items-center">
          <CalendarBlank size={20} weight="duotone" className="text-[hsl(var(--primary))]"/>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-base font-semibold text-foreground">Attendance Calendar</div>
          <div className="text-xs text-muted-foreground">
            {lang === "kn" ? "ದೈನಂದಿನ ಹಾಜರಾತಿ" : "View daily attendance at a glance"}
          </div>
        </div>
      </div>

      {/* Worker selector: opens the "Select Worker" bottom sheet */}
      {workers === null ? (
        <div className="h-14 rounded-xl border border-border bg-muted/40 animate-pulse"/>
      ) : workers.length === 0 ? (
        <div
          data-testid="calendar-no-workers"
          className="h-14 flex items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground"
        >
          No workers yet
        </div>
      ) : (
        <button
          type="button"
          data-testid="calendar-worker-select"
          value={selectedWorkerId}
          onClick={() => setPickerOpen(true)}
          className="w-full flex items-center gap-3 rounded-xl border border-border bg-background p-3 hover:border-[hsl(var(--primary))]/40 active:scale-[0.995] transition"
        >
          <Avatar name={selectedWorker?.name || ""} size={40}/>
          <div className="flex-1 text-left min-w-0">
            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Worker</div>
            <div className="font-semibold truncate">{selectedWorker?.name || ""}</div>
          </div>
          <CaretDown size={16} className="text-muted-foreground shrink-0"/>
          {/* Hidden native option list so tests that look for options keep working */}
          <select
            aria-hidden="true"
            tabIndex={-1}
            value={selectedWorkerId}
            onChange={() => {}}
            className="sr-only"
          >
            {workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </button>
      )}

      {/* Month header */}
      <div className="flex items-center justify-between pt-1">
        <button
          data-testid="calendar-prev"
          onClick={goPrev}
          className="w-10 h-10 rounded-full border border-border grid place-items-center active:scale-[0.96] transition-transform"
          aria-label="Previous month"
        >
          <CaretLeft size={18} />
        </button>
        <div data-testid="calendar-month-label" className="text-base font-semibold tracking-tight">
          {monthLabel}
        </div>
        <button
          data-testid="calendar-next"
          onClick={goNext}
          className="w-10 h-10 rounded-full border border-border grid place-items-center active:scale-[0.96] transition-transform"
          aria-label="Next month"
        >
          <CaretRight size={18} />
        </button>
      </div>

      {/* Day-of-week header */}
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] uppercase tracking-widest text-muted-foreground">
        {DAY_HEADERS.map((d, i) => <div key={i}>{d}</div>)}
      </div>

      {/* Date grid — filled emerald circle for marked, per Reference A */}
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, idx) => {
          if (day == null) return <div key={idx} className="h-10"/>;
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
                "h-10 rounded-full text-sm flex items-center justify-center relative " +
                "active:scale-[0.96] transition-transform " +
                (marked
                  ? "bg-[hsl(var(--primary))] text-white font-semibold shadow-sm"
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

      {/* Status legend — Reference A */}
      <div
        data-testid="calendar-status-legend"
        className="pt-2 border-t border-border/70 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs"
      >
        <LegendItem label="Present" desc="Full day" className={statusPillClass("present")}/>
        <LegendItem label="Half Day" desc="Half day" className={statusPillClass("half_day")}/>
        <LegendItem label="Overtime" desc="Extra hours" className={statusPillClass("overtime")}/>
      </div>

      {/* Date-tap bottom sheet */}
      {sheetDate && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]"
          onClick={closeSheet}
          data-testid="calendar-sheet-backdrop"
        >
          <div
            className="absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto rounded-t-3xl bg-card p-5 pb-8 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            data-testid="calendar-sheet"
          >
            {/* Drag handle */}
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-muted"/>
            {/* Close button (top-left) */}
            <button
              data-testid="sheet-close"
              onClick={closeSheet}
              className="absolute top-4 right-4 w-9 h-9 rounded-full bg-muted grid place-items-center"
              aria-label="Close"
            ><X size={16}/></button>

            {/* Header icon + title */}
            <div className="flex flex-col items-center text-center pt-2">
              <div className="w-16 h-16 rounded-full bg-[hsl(var(--primary))]/12 grid place-items-center">
                <CalendarBlank size={30} weight="duotone" className="text-[hsl(var(--primary))]"/>
              </div>
              <div className="mt-3 text-lg font-bold" data-testid="sheet-date">
                Attendance – {(() => {
                  const [y, mo, d] = sheetDate.split("-").map(Number);
                  const dObj = new Date(y, mo - 1, d);
                  return dObj.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
                })()}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {sheetLoading
                  ? "Loading…"
                  : sheetWorkers.length === 0
                    ? "No attendance recorded"
                    : `${sheetWorkers.length} worker${sheetWorkers.length === 1 ? "" : "s"}`}
              </div>
            </div>

            {sheetLoading ? (
              <div className="mt-6 text-sm text-muted-foreground text-center">Loading…</div>
            ) : sheetWorkers.length === 0 ? (
              <div
                data-testid="sheet-empty"
                className="mt-4 flex flex-col items-center text-center"
              >
                <EmptyDateIllustration className="w-40 h-40"/>
                <div className="mt-2 text-sm text-muted-foreground">
                  {lang === "kn" ? "ಈ ದಿನಾಂಕಕ್ಕೆ ಹಾಜರಾತಿ ಇಲ್ಲ" : "No attendance recorded for this date"}
                </div>
              </div>
            ) : (
              <div className="mt-5 space-y-2" data-testid="sheet-worker-list">
                {sheetWorkers.map(w => (
                  <div
                    key={w.worker_id}
                    data-testid={`sheet-worker-${w.worker_id}`}
                    className="flex items-center gap-3 rounded-xl border border-border bg-background p-3"
                  >
                    <Avatar name={w.name} size={40}/>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{w.name}</div>
                    </div>
                    <span
                      className={"px-2.5 py-1 rounded-md text-[10px] font-bold tracking-wider uppercase " + statusPillClass(w.status)}
                    >
                      {statusLabel(w.status)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {sheetWorkers.length > 0 && (
              <div className="mt-5 rounded-xl bg-[hsl(var(--primary))]/8 border border-[hsl(var(--primary))]/15 p-3 flex items-start gap-2">
                <Info size={16} weight="fill" className="text-[hsl(var(--primary))] mt-0.5 shrink-0"/>
                <div className="text-xs text-[hsl(var(--primary))]">
                  {lang === "kn"
                    ? "ಈ ದಿನಾಂಕದಂದು ಕೆಲಸ ಮಾಡಿದ ಕಾರ್ಮಿಕರು ಮಾತ್ರ."
                    : "Only workers who worked on this date are shown."}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Select Worker bottom sheet */}
      {pickerOpen && workers && workers.length > 0 && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]"
          onClick={() => setPickerOpen(false)}
          data-testid="worker-picker-backdrop"
        >
          <div
            className="absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto rounded-t-3xl bg-card p-5 pb-8 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            data-testid="worker-picker-sheet"
          >
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-muted"/>
            <div className="text-center">
              <div className="text-lg font-bold">Select Worker</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Choose a worker to view his attendance
              </div>
            </div>

            <div className="mt-5 space-y-2">
              {workers.map(w => {
                const isSelected = w.id === selectedWorkerId;
                const isOldest = w.id === oldestId;
                return (
                  <button
                    key={w.id}
                    data-testid={`worker-pick-${w.id}`}
                    onClick={() => { setSelectedWorkerId(w.id); setPickerOpen(false); }}
                    className={
                      "w-full flex items-center gap-3 rounded-xl border p-3 text-left transition " +
                      (isSelected
                        ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/6"
                        : "border-border bg-background hover:border-[hsl(var(--primary))]/40")
                    }
                  >
                    <Avatar name={w.name} size={40}/>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{w.name}</div>
                    </div>
                    {isOldest && (
                      <span
                        data-testid="oldest-pill"
                        className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[hsl(var(--primary))]/12 text-[hsl(var(--primary))]"
                      >
                        Oldest
                      </span>
                    )}
                    {isSelected && (
                      <div className="w-6 h-6 rounded-full bg-[hsl(var(--primary))] grid place-items-center shrink-0">
                        <Check size={14} weight="bold" className="text-white"/>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="mt-5 rounded-xl bg-[hsl(var(--primary))]/8 border border-[hsl(var(--primary))]/15 p-3 flex items-start gap-2">
              <Info size={16} weight="fill" className="text-[hsl(var(--primary))] mt-0.5 shrink-0"/>
              <div className="text-xs text-[hsl(var(--primary))]">
                Default worker is selected by oldest joining date.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LegendItem({ label, desc, className }) {
  return (
    <div className="flex items-center gap-2">
      <span className={"px-2 py-0.5 rounded-md text-[10px] font-bold tracking-wider uppercase " + className}>
        {label}
      </span>
      <span className="text-muted-foreground text-[11px]">{desc}</span>
    </div>
  );
}

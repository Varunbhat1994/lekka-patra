import { useEffect, useState, useRef } from "react";
import { useApp } from "@/context/AppContext";

/**
 * A compact sliding text marquee that cycles through pending amounts for
 * workers/contractors who have received an advance. Each item is shown for
 * ~3s with a soft slide-up transition.
 */
export default function PendingWageMarquee({ items = [] }) {
  const { lang } = useApp();
  const [idx, setIdx] = useState(0);
  const timerRef = useRef(null);

  useEffect(() => {
    if (items.length <= 1) return;
    timerRef.current = setInterval(() => {
      setIdx((i) => (i + 1) % items.length);
    }, 3000);
    return () => clearInterval(timerRef.current);
  }, [items.length]);

  if (!items.length) return null;

  const typeTag = (type) => type === "contractor"
    ? (lang === "kn" ? "ಗುತ್ತಿಗೆದಾರ" : "Contractor")
    : (lang === "kn" ? "ಕಾರ್ಮಿಕ" : "Worker");

  return (
    <div
      data-testid="pending-marquee"
      className="mt-2 h-8 overflow-hidden relative border-t border-dashed border-border pt-1.5"
    >
      <div
        className="absolute inset-x-0 top-1.5 transition-transform duration-500 ease-out"
        style={{ transform: `translateY(-${idx * 100}%)` }}
      >
        {items.map((it, i) => {
          const neg = (it.pending ?? 0) < 0;
          return (
            <div
              key={i}
              data-testid={`pending-marquee-item-${i}`}
              className="h-8 flex items-center gap-1.5 text-[11px]"
            >
              <span
                className="shrink-0 rounded-sm px-1.5 py-0.5 text-[9px] uppercase tracking-wider font-semibold"
                style={{
                  backgroundColor: it.type === "contractor" ? "hsl(215 25% 15% / 0.08)" : "hsl(142 60% 35% / 0.1)",
                  color: it.type === "contractor" ? "hsl(215 25% 25%)" : "hsl(142 60% 30%)",
                }}
              >
                {typeTag(it.type)}
              </span>
              <span className="truncate font-medium">{it.name}</span>
              <span className={`ml-auto shrink-0 font-semibold ${neg ? "text-[hsl(var(--accent))]" : "text-[hsl(var(--primary))]"}`}>
                {neg ? `−₹${Math.abs(it.pending)}` : `₹${it.pending}`}
              </span>
            </div>
          );
        })}
      </div>
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-end gap-0.5 text-[8px] text-muted-foreground">
        {items.map((_, i) => (
          <span
            key={i}
            className={`h-0.5 rounded-full transition-all ${i === idx ? "w-3 bg-[hsl(var(--primary))]" : "w-1 bg-border"}`}
          />
        ))}
      </div>
    </div>
  );
}

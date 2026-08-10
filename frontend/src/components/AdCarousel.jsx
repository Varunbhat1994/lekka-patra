import { useEffect, useState, useRef } from "react";
import axios from "axios";
import { useApp } from "@/context/AppContext";
import { MapPin, ArrowRight } from "@phosphor-icons/react";

const AUTOPLAY_MS = 10000;
const SWIPE_THRESHOLD = 50; // px

export default function AdCarousel() {
  const { API, user } = useApp();
  const [ads, setAds] = useState([]);
  const [idx, setIdx] = useState(0);
  const [drag, setDrag] = useState(0);      // live pointer offset in px
  const [dragging, setDragging] = useState(false);
  const startX = useRef(null);
  const timerRef = useRef(null);
  const trackRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    axios.get(`${API}/ads`).then(r => {
      if (mounted) setAds(r.data || []);
    }).catch(() => {});
    return () => { mounted = false; };
  }, [API]);

  const goTo = (i) => setIdx(((i % ads.length) + ads.length) % ads.length);

  // autoplay — paused while user is swiping
  useEffect(() => {
    if (ads.length <= 1 || dragging) return;
    timerRef.current = setInterval(() => {
      setIdx(i => (i + 1) % ads.length);
    }, AUTOPLAY_MS);
    return () => clearInterval(timerRef.current);
  }, [ads.length, dragging, idx]);

  const onPointerDown = (e) => {
    if (ads.length <= 1) return;
    startX.current = e.clientX ?? e.touches?.[0]?.clientX;
    if (startX.current == null) return;
    setDragging(true);
    setDrag(0);
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
  };
  const onPointerMove = (e) => {
    if (!dragging || startX.current == null) return;
    const x = e.clientX ?? e.touches?.[0]?.clientX;
    if (x == null) return;
    setDrag(x - startX.current);
  };
  const onPointerUp = () => {
    if (!dragging) return;
    const width = trackRef.current?.offsetWidth || 1;
    if (drag > SWIPE_THRESHOLD) goTo(idx - 1);
    else if (drag < -SWIPE_THRESHOLD) goTo(idx + 1);
    setDrag(0);
    setDragging(false);
    startX.current = null;
    void width;
  };

  if (!ads.length) return null;

  const width = trackRef.current?.offsetWidth || 1;
  const dragPct = (drag / width) * 100;

  return (
    <div data-testid="ads-carousel" className="rounded-xl border border-border overflow-hidden bg-card relative select-none">
      <div
        ref={trackRef}
        className="relative h-40 overflow-hidden touch-pan-y cursor-grab active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <div
          className="absolute inset-0 flex"
          style={{
            width: `${ads.length * 100}%`,
            transform: `translateX(calc(${-idx * (100 / ads.length)}% + ${dragPct / ads.length}%))`,
            transition: dragging ? "none" : "transform 500ms cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        >
          {ads.map((ad, i) => (
            <a
              key={ad.id}
              data-testid={`ad-slide-${i}`}
              href={ad.cta_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => { if (Math.abs(drag) > 5) e.preventDefault(); }}
              draggable={false}
              className="relative shrink-0 h-40"
              style={{ width: `${100 / ads.length}%` }}
            >
              <img src={ad.image_url} alt={ad.title} draggable={false}
                   className="absolute inset-0 w-full h-full object-cover pointer-events-none"/>
              <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent"/>
              <div className="absolute inset-x-0 bottom-0 p-4 text-white">
                <div className="flex items-center gap-1 text-[10px] uppercase tracking-[0.18em] opacity-90">
                  <MapPin size={12} weight="fill"/>
                  {user?.district || "All Karnataka"}
                </div>
                <div className="mt-1 flex items-end justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-base truncate">{ad.title}</div>
                    <div className="text-xs opacity-90 truncate">{ad.subtitle}</div>
                  </div>
                  <div className="shrink-0 rounded-full bg-white text-[hsl(var(--foreground))] text-xs font-semibold px-3 py-1.5 flex items-center gap-1">
                    {ad.cta_label} <ArrowRight size={12} weight="bold"/>
                  </div>
                </div>
              </div>
            </a>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-center gap-1.5 py-2 bg-card">
        {ads.map((_, i) => (
          <button
            key={i}
            data-testid={`ad-dot-${i}`}
            onClick={() => setIdx(i)}
            className={`h-1.5 rounded-full transition-all ${
              i === idx ? "w-6 bg-[hsl(var(--primary))]" : "w-1.5 bg-border"
            }`}
            aria-label={`Slide ${i+1}`}
          />
        ))}
      </div>
    </div>
  );
}

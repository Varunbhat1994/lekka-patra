import { useEffect, useState, useRef } from "react";
import axios from "axios";
import { useApp } from "@/context/AppContext";

const AUTOPLAY_MS = 10000;
const SWIPE_THRESHOLD = 50; // px

export default function AdCarousel() {
  const { API, user } = useApp();
  const [ads, setAds] = useState([]);
  const [idx, setIdx] = useState(0);
  const [drag, setDrag] = useState(0);      // live pointer offset in px
  const [dragging, setDragging] = useState(false);
  const [held, setHeld] = useState(false);  // true while pointer is pressed on the carousel
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

  // autoplay — paused while user is holding OR swiping the carousel
  useEffect(() => {
    if (ads.length <= 1 || dragging || held) return;
    timerRef.current = setInterval(() => {
      setIdx(i => (i + 1) % ads.length);
    }, AUTOPLAY_MS);
    return () => clearInterval(timerRef.current);
  }, [ads.length, dragging, held, idx]);

  const onPointerDown = (e) => {
    if (ads.length <= 1) return;
    startX.current = e.clientX ?? e.touches?.[0]?.clientX;
    if (startX.current == null) return;
    setHeld(true);           // pause autoplay immediately on press ("hold to pause")
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
    setHeld(false);          // resume autoplay
    startX.current = null;
    void width;
  };

  if (!ads.length) return null;

  const width = trackRef.current?.offsetWidth || 1;
  const dragPct = (drag / width) * 100;

  return (
    <div data-testid="ads-carousel" className="rounded-xl border border-border overflow-hidden bg-card relative select-none">
      {held && (
        <div className="absolute top-2 right-2 z-10 bg-black/50 text-white text-[10px] uppercase tracking-wider px-2 py-1 rounded-full pointer-events-none">
          Paused
        </div>
      )}
      <div
        ref={trackRef}
        className="relative h-64 sm:h-72 overflow-hidden touch-pan-y cursor-grab active:cursor-grabbing"
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
              className="relative shrink-0 h-64 sm:h-72"
              style={{ width: `${100 / ads.length}%` }}
            >
              <img
                src={ad.image_url}
                alt=""
                draggable={false}
                className="absolute inset-0 w-full h-full object-cover pointer-events-none"
              />
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

import { useEffect, useState, useRef } from "react";
import axios from "axios";
import { useApp } from "@/context/AppContext";
import { MapPin, ArrowRight } from "@phosphor-icons/react";

export default function AdCarousel() {
  const { API, user } = useApp();
  const [ads, setAds] = useState([]);
  const [idx, setIdx] = useState(0);
  const timerRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    axios.get(`${API}/ads`).then(r => {
      if (mounted) setAds(r.data || []);
    }).catch(() => {});
    return () => { mounted = false; };
  }, [API]);

  useEffect(() => {
    if (ads.length <= 1) return;
    timerRef.current = setInterval(() => {
      setIdx(i => (i + 1) % ads.length);
    }, 10000);
    return () => clearInterval(timerRef.current);
  }, [ads.length]);

  if (!ads.length) return null;

  return (
    <div data-testid="ads-carousel" className="rounded-xl border border-border overflow-hidden bg-card relative">
      <div className="relative h-40 overflow-hidden">
        {ads.map((ad, i) => (
          <a
            key={ad.id}
            data-testid={`ad-slide-${i}`}
            href={ad.cta_url}
            target="_blank"
            rel="noopener noreferrer"
            className="absolute inset-0 transition-opacity duration-700 ease-out"
            style={{ opacity: i === idx ? 1 : 0, pointerEvents: i === idx ? "auto" : "none" }}
          >
            <img src={ad.image_url} alt={ad.title} className="absolute inset-0 w-full h-full object-cover"/>
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

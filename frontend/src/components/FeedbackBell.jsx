import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { useApp } from "@/context/AppContext";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Bell, ChatCircleDots, X, Star } from "@phosphor-icons/react";

export default function FeedbackBell() {
  const { API } = useApp();
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const seenRef = useRef(new Set());

  const load = () => {
    axios.get(`${API}/feedback`).then(r => setItems(r.data)).catch(()=>{});
  };

  useEffect(() => {
    load();
    const iv = setInterval(load, 30000);
    const onSubmit = () => load();
    window.addEventListener("feedback:submitted", onSubmit);
    return () => { clearInterval(iv); window.removeEventListener("feedback:submitted", onSubmit); };
    // eslint-disable-next-line
  }, [API]);

  const unread = items.filter(i => !i.read);
  const unreadCount = unread.length;

  // Auto-open popup when new unread feedback arrives (once per item)
  useEffect(() => {
    const newIds = unread.filter(i => !seenRef.current.has(i.id));
    if (newIds.length && !open) {
      newIds.forEach(i => seenRef.current.add(i.id));
      setOpen(true);
    }
    // eslint-disable-next-line
  }, [unreadCount]);

  const markAllRead = async () => {
    await axios.post(`${API}/feedback/read-all`);
    load();
  };
  const markRead = async (id) => {
    await axios.post(`${API}/feedback/${id}/read`);
    load();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          data-testid="feedback-bell-btn"
          className="relative h-9 w-9 rounded-full grid place-items-center hover:bg-secondary transition-colors"
          aria-label="Feedback"
        >
          <Bell size={20} weight={unreadCount > 0 ? "fill" : "duotone"}
            className={unreadCount > 0 ? "text-[hsl(var(--primary))]" : "text-muted-foreground"} />
          {unreadCount > 0 && (
            <span
              data-testid="feedback-badge"
              className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full bg-[hsl(var(--accent))] text-white text-[10px] font-bold grid place-items-center"
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[92vw] max-w-[360px] p-0 rounded-xl">
        <div className="px-3 pt-3 pb-2 flex items-center justify-between border-b border-border">
          <div className="flex items-center gap-2">
            <ChatCircleDots size={18} weight="duotone" className="text-[hsl(var(--primary))]"/>
            <div className="text-sm font-semibold">Feedback</div>
          </div>
          {unreadCount > 0 && (
            <button data-testid="mark-all-read-btn" onClick={markAllRead}
              className="text-[11px] text-[hsl(var(--primary))] font-semibold uppercase tracking-wider hover:underline">
              Mark all read
            </button>
          )}
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          {items.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground">
              No feedback yet. Send some from Settings.
            </div>
          ) : (
            items.map(f => (
              <div key={f.id} data-testid={`fb-item-${f.id}`}
                className={`px-3 py-3 border-b border-border last:border-0 flex gap-2 ${!f.read ? "bg-[hsl(var(--primary))]/5" : ""}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <span className="font-semibold text-foreground">{f.user_name || "You"}</span>
                    <span>·</span>
                    <span>{f.category}</span>
                    {f.rating ? (
                      <span className="flex items-center gap-0.5 text-amber-500">
                        <Star size={10} weight="fill"/>{f.rating}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-sm mt-0.5 whitespace-pre-wrap break-words">{f.message}</div>
                  <div className="text-[10px] text-muted-foreground mt-1">{new Date(f.created_at).toLocaleString()}</div>
                </div>
                {!f.read && (
                  <button data-testid={`fb-dismiss-${f.id}`} onClick={() => markRead(f.id)}
                    className="h-6 w-6 shrink-0 grid place-items-center rounded-md text-muted-foreground hover:bg-secondary">
                    <X size={12}/>
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

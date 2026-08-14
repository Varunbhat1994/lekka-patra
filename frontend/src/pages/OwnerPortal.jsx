import { useEffect, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { useApp } from "@/context/AppContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  ShieldCheck, Users, MapPin, Megaphone, ChatCircleDots, ArrowLeft,
  Plus, Trash, Star, ImageSquare,
} from "@phosphor-icons/react";

const TABS = [
  { key: "users", icon: Users, label: "Users" },
  { key: "districts", icon: MapPin, label: "Districts" },
  { key: "ads", icon: Megaphone, label: "Ads" },
  { key: "feedback", icon: ChatCircleDots, label: "Feedback" },
];

export default function OwnerPortal() {
  const { API, user, loading } = useApp();
  const nav = useNavigate();
  const [tab, setTab] = useState("users");

  useEffect(() => {
    if (!loading && user && !user.is_owner) nav("/dashboard", { replace: true });
  }, [loading, user, nav]);

  if (loading || !user) {
    return <div className="min-h-screen grid place-items-center text-sm text-muted-foreground">Loading…</div>;
  }
  if (!user.is_owner) {
    return <div className="min-h-screen grid place-items-center text-sm text-muted-foreground">Forbidden</div>;
  }

  return (
    <div className="min-h-screen bg-[hsl(var(--background))]">
      <div className="mx-auto max-w-md min-h-screen border-x border-border/60">
        <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-xl border-b border-border">
          <div className="px-4 h-14 flex items-center gap-2">
            <button data-testid="owner-back-btn" onClick={() => nav("/dashboard")}
              className="h-9 w-9 -ml-1 rounded-full grid place-items-center hover:bg-secondary">
              <ArrowLeft size={20}/>
            </button>
            <div className="flex-1 flex items-center gap-2 min-w-0">
              <ShieldCheck size={20} weight="fill" className="text-[hsl(var(--primary))] shrink-0"/>
              <div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Owner Portal</div>
                <div className="text-sm font-semibold truncate">Admin controls</div>
              </div>
            </div>
          </div>
          <div className="px-2 pb-2 flex gap-1 overflow-x-auto">
            {TABS.map(x => (
              <button key={x.key} data-testid={`tab-${x.key}`}
                onClick={() => setTab(x.key)}
                className={`shrink-0 px-3 h-8 rounded-full text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5 transition-colors ${
                  tab === x.key ? "bg-[hsl(var(--foreground))] text-white" : "bg-secondary text-muted-foreground hover:bg-secondary/70"
                }`}>
                <x.icon size={14} weight={tab === x.key ? "fill" : "duotone"}/>{x.label}
              </button>
            ))}
          </div>
        </header>

        <div className="px-5 pt-4 pb-20">
          {tab === "users" && <OwnerUsers API={API}/>}
          {tab === "districts" && <OwnerDistricts API={API}/>}
          {tab === "ads" && <OwnerAds API={API}/>}
          {tab === "feedback" && <OwnerFeedback API={API}/>}
        </div>
      </div>
    </div>
  );
}

function OwnerUsers({ API }) {
  const [rows, setRows] = useState([]);
  useEffect(() => { axios.get(`${API}/owner/users`).then(r => setRows(r.data)); }, [API]);
  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground pb-1">
        {rows.length} registered users
      </div>
      {rows.map(u => (
        <div key={u.user_id} data-testid={`user-row-${u.user_id}`}
          className="rounded-lg border border-border bg-card px-3 py-3 flex items-center gap-3">
          <div className="h-9 w-9 rounded-full bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))] grid place-items-center text-sm font-semibold">
            {(u.name || "?").slice(0,1).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-medium truncate">{u.name || "—"}</span>
              {u.role === "owner" && (
                <span className="text-[9px] uppercase tracking-wider bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))] px-1.5 py-0.5 rounded-full font-semibold">
                  Owner
                </span>
              )}
              {u.is_paid && (
                <span className="text-[9px] uppercase tracking-wider bg-amber-500/10 text-amber-600 px-1.5 py-0.5 rounded-full font-semibold">
                  Paid
                </span>
              )}
            </div>
            <div className="text-[11px] text-muted-foreground truncate">
              {u.mobile ? `+${u.mobile}` : (u.email || "—")}
              {u.district ? ` · ${u.district}` : ""}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function OwnerDistricts({ API }) {
  const [data, setData] = useState(null);
  useEffect(() => { axios.get(`${API}/owner/analytics/districts`).then(r => setData(r.data)); }, [API]);
  if (!data) return <div className="text-sm text-muted-foreground">Loading…</div>;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <TotalTile label="Users" val={data.totals.users}/>
        <TotalTile label="Workers" val={data.totals.workers}/>
        <TotalTile label="Contractors" val={data.totals.contractors} accent/>
      </div>
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 px-3 py-2 bg-secondary/50 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
          <div>District</div>
          <div className="w-10 text-right">Users</div>
          <div className="w-12 text-right">Workers</div>
          <div className="w-14 text-right">Contract.</div>
        </div>
        {data.rows.map(r => (
          <div key={r.district} data-testid={`district-row-${r.district}`}
            className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 px-3 py-2.5 text-sm border-t border-border">
            <div className="truncate">{r.district}</div>
            <div className="w-10 text-right text-muted-foreground">{r.users}</div>
            <div className="w-12 text-right font-semibold text-[hsl(var(--primary))]">{r.workers}</div>
            <div className="w-14 text-right font-semibold text-[hsl(var(--accent))]">{r.contractors}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TotalTile({ label, val, accent }) {
  return (
    <div className={`rounded-xl border p-3 ${accent ? "border-[hsl(var(--accent))]/30" : "border-border"} bg-card`}>
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold tracking-tight mt-1 ${accent ? "text-[hsl(var(--accent))]" : ""}`}>{val}</div>
    </div>
  );
}

function OwnerAds({ API }) {
  const [ads, setAds] = useState([]);
  const [districts, setDistricts] = useState([]);
  const [open, setOpen] = useState(false);
  const [imageData, setImageData] = useState("");
  const [form, setForm] = useState({ title: "", cta_url: "", districts: [] });
  const [uploading, setUploading] = useState(false);

  const load = () => axios.get(`${API}/owner/ads`).then(r => setAds(r.data));
  useEffect(() => {
    load();
    axios.get(`${API}/districts`).then(r => setDistricts(r.data.districts));
    // eslint-disable-next-line
  }, [API]);

  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 1_000_000) return toast.error("Image must be under 1 MB");
    const reader = new FileReader();
    reader.onload = () => setImageData(reader.result);
    reader.readAsDataURL(f);
  };

  const toggleDistrict = (d) => {
    setForm(f => f.districts.includes(d)
      ? { ...f, districts: f.districts.filter(x => x !== d) }
      : { ...f, districts: [...f.districts, d] });
  };

  const submit = async () => {
    if (!imageData) return toast.error("Pick an image");
    setUploading(true);
    try {
      await axios.post(`${API}/owner/ads`, {
        image_url: imageData,
        title: form.title,
        cta_url: form.cta_url,
        districts: form.districts.length ? form.districts : null,
      });
      setOpen(false); setForm({ title: "", cta_url: "", districts: [] }); setImageData("");
      toast.success("Ad uploaded");
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed");
    } finally { setUploading(false); }
  };

  const del = async (a) => {
    if (!window.confirm("Delete this ad?")) return;
    await axios.delete(`${API}/owner/ads/${a.id}`);
    load();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
          {ads.length} ads
        </div>
        <Button data-testid="new-ad-btn" size="sm" onClick={() => setOpen(true)}
          className="rounded-full bg-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground))]/90">
          <Plus size={14} className="mr-1"/>New ad
        </Button>
      </div>

      {open && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <label className="block cursor-pointer">
            <input data-testid="ad-file-input" type="file" accept="image/*" onChange={onFile} className="hidden"/>
            <div className={`rounded-lg border-2 border-dashed ${imageData ? "border-transparent" : "border-border"} min-h-[160px] grid place-items-center overflow-hidden bg-secondary/30`}>
              {imageData ? (
                <img src={imageData} alt="preview" className="w-full h-40 object-cover"/>
              ) : (
                <div className="text-center py-6">
                  <ImageSquare size={32} weight="duotone" className="mx-auto text-muted-foreground"/>
                  <div className="text-xs text-muted-foreground mt-1">Tap to choose image (max 1 MB)</div>
                </div>
              )}
            </div>
          </label>
          <div>
            <Label className="text-xs uppercase tracking-[0.15em] text-muted-foreground">Title (optional)</Label>
            <Input data-testid="ad-title-input" value={form.title}
              onChange={e => setForm({...form, title: e.target.value})} className="min-h-[44px]"/>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-[0.15em] text-muted-foreground">Link URL (optional)</Label>
            <Input data-testid="ad-cta-input" value={form.cta_url} placeholder="https://…"
              onChange={e => setForm({...form, cta_url: e.target.value})} className="min-h-[44px]"/>
          </div>
          <div>
            <Label className="text-xs uppercase tracking-[0.15em] text-muted-foreground">
              Districts ({form.districts.length ? `${form.districts.length} selected` : "all"})
            </Label>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {districts.map(d => (
                <button key={d} data-testid={`district-chip-${d}`}
                  onClick={() => toggleDistrict(d)}
                  className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${
                    form.districts.includes(d)
                      ? "bg-[hsl(var(--primary))] border-transparent text-white"
                      : "bg-white border-border text-muted-foreground"
                  }`}>
                  {d}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <Button variant="outline" onClick={() => { setOpen(false); setImageData(""); }} className="flex-1">Cancel</Button>
            <Button data-testid="submit-ad-btn" onClick={submit} disabled={uploading}
              className="flex-1 bg-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/90">
              {uploading ? "…" : "Upload"}
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {ads.map(a => (
          <div key={a.id} data-testid={`owner-ad-${a.id}`} className="rounded-xl border border-border bg-card overflow-hidden">
            <img src={a.image_url} alt="" className="w-full h-32 object-cover"/>
            <div className="p-3 flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{a.title || "—"}</div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {a.districts?.length ? a.districts.join(", ") : "All Karnataka"}
                </div>
              </div>
              <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full font-semibold ${a.active ? "bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]" : "bg-secondary text-muted-foreground"}`}>
                {a.active ? "Live" : "Off"}
              </span>
              <button data-testid={`del-ad-${a.id}`} onClick={() => del(a)}
                className="h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:bg-[hsl(var(--accent))]/10 hover:text-[hsl(var(--accent))]">
                <Trash size={16}/>
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OwnerFeedback({ API }) {
  const [rows, setRows] = useState([]);
  useEffect(() => { axios.get(`${API}/owner/feedback`).then(r => setRows(r.data)); }, [API]);
  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground pb-1">
        {rows.length} feedback messages
      </div>
      {rows.map(f => (
        <div key={f.id} data-testid={`owner-fb-${f.id}`}
          className="rounded-xl border border-border bg-card p-3">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
            <span className="font-semibold text-foreground">{f.user_name || "Anonymous"}</span>
            <span>·</span>
            <span>{f.category}</span>
            {f.rating ? (
              <span className="flex items-center gap-0.5 text-amber-500">
                <Star size={10} weight="fill"/>{f.rating}
              </span>
            ) : null}
            <span className="ml-auto">{new Date(f.created_at).toLocaleDateString("en-GB")}</span>
          </div>
          <div className="text-sm mt-1.5 whitespace-pre-wrap break-words">{f.message}</div>
          {f.user_mobile && (
            <div className="text-[10px] text-muted-foreground mt-1">+{f.user_mobile}</div>
          )}
        </div>
      ))}
    </div>
  );
}

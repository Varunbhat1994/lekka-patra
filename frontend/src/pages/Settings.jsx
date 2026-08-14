import { useEffect, useState } from "react";
import axios from "axios";
import AppShell from "@/components/AppShell";
import TrialBanner from "@/components/TrialBanner";
import { useApp } from "@/context/AppContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  SignOut, Translate, Check, UserCircle, MapPin, DeviceMobile,
  PencilSimple, ChatCircleDots, Star, ShieldCheck,
} from "@phosphor-icons/react";

export default function Settings() {
  const { t, user, lang, setLanguage, logout, setUser, API, refresh } = useApp();
  const nav = useNavigate();

  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState({ name: "", district: "", mobile: "" });
  const [districts, setDistricts] = useState([]);
  const [saving, setSaving] = useState(false);

  const [fbOpen, setFbOpen] = useState(false);
  const [fb, setFb] = useState({ message: "", rating: 0, category: "general" });
  const [fbSubmitting, setFbSubmitting] = useState(false);

  useEffect(() => {
    axios.get(`${API}/districts`).then(r => setDistricts(r.data.districts)).catch(()=>{});
  }, [API]);

  const openEdit = () => {
    setForm({
      name: user?.name || "",
      district: user?.district || "",
      mobile: (user?.mobile || "").replace(/^91/, ""),
    });
    setEditOpen(true);
  };

  const saveProfile = async () => {
    if (!form.name.trim()) return toast.error(lang === "kn" ? "ಹೆಸರು ಬೇಕು" : "Name required");
    if (!form.district) return toast.error(lang === "kn" ? "ಜಿಲ್ಲೆ ಆಯ್ಕೆಮಾಡಿ" : "Choose a district");
    setSaving(true);
    try {
      const { data } = await axios.post(`${API}/auth/profile`, {
        name: form.name.trim(),
        district: form.district,
        mobile: form.mobile.trim() || null,
      });
      setUser(data.user);
      await refresh();
      setEditOpen(false);
      toast.success(lang === "kn" ? "ಪ್ರೊಫೈಲ್ ಉಳಿಸಲಾಗಿದೆ" : "Profile saved");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed");
    } finally { setSaving(false); }
  };

  const submitFeedback = async () => {
    if (!fb.message.trim()) return toast.error(lang === "kn" ? "ಸಂದೇಶ ಬೇಕು" : "Message required");
    setFbSubmitting(true);
    try {
      await axios.post(`${API}/feedback`, {
        message: fb.message.trim(),
        rating: fb.rating || null,
        category: fb.category,
      });
      setFb({ message: "", rating: 0, category: "general" });
      setFbOpen(false);
      toast.success(lang === "kn" ? "ಪ್ರತಿಕ್ರಿಯೆ ಕಳುಹಿಸಲಾಗಿದೆ" : "Thanks — we got your feedback");
      // Trigger dashboard bell to pick it up next time
      window.dispatchEvent(new Event("feedback:submitted"));
    } catch { toast.error("Failed"); } finally { setFbSubmitting(false); }
  };

  return (
    <AppShell title={t("settings")}>
      <div className="space-y-4">
        <TrialBanner />

        {/* Admin Profile card */}
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            {user?.picture ? (
              <img src={user.picture} alt="" className="h-12 w-12 rounded-full border border-border"/>
            ) : (
              <div className="h-12 w-12 rounded-full bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))] grid place-items-center">
                <UserCircle size={28} weight="duotone"/>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                {lang === "kn" ? "ನಿರ್ವಾಹಕರ ಪ್ರೊಫೈಲ್" : "Admin Profile"}
              </div>
              <div className="font-medium truncate">{user?.name || "—"}</div>
            </div>
          </div>
          <div className="mt-3 space-y-1.5 text-sm">
            <Row icon={DeviceMobile} label={lang === "kn" ? "ಮೊಬೈಲ್" : "Mobile"} value={user?.mobile ? `+${user.mobile}` : (user?.email || "—")} />
            <Row icon={MapPin} label={lang === "kn" ? "ಜಿಲ್ಲೆ" : "District"} value={user?.district || "—"} />
          </div>
          <Button data-testid="edit-profile-btn" onClick={openEdit} variant="outline"
            className="w-full mt-3 min-h-[44px] rounded-lg">
            <PencilSimple size={16} className="mr-2"/>
            {lang === "kn" ? "ಪ್ರೊಫೈಲ್ ಸಂಪಾದಿಸಿ" : "Edit profile"}
          </Button>
        </div>

        {/* Language */}
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground mb-3">
            <Translate size={16} weight="duotone"/>{t("language")}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[{c:"en", n:"English"},{c:"kn", n:"ಕನ್ನಡ"}].map(l => (
              <button
                key={l.c}
                data-testid={`settings-lang-${l.c}`}
                onClick={() => setLanguage(l.c)}
                className={`min-h-[52px] rounded-lg border text-sm font-medium flex items-center justify-center gap-2 ${
                  lang===l.c ? "bg-[hsl(var(--primary))] text-white border-transparent" : "bg-white border-border"
                }`}
              >
                {lang===l.c && <Check size={14} weight="bold"/>}
                {l.n}
              </button>
            ))}
          </div>
        </div>

        {/* Feedback */}
        <button data-testid="open-feedback-btn" onClick={() => setFbOpen(true)}
          className="w-full rounded-xl border border-border bg-card p-4 flex items-center gap-3 text-left hover:bg-secondary/30">
          <div className="h-10 w-10 rounded-lg bg-[hsl(var(--accent))]/10 text-[hsl(var(--accent))] grid place-items-center">
            <ChatCircleDots size={22} weight="duotone"/>
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium">
              {lang === "kn" ? "ಪ್ರತಿಕ್ರಿಯೆ ಕಳುಹಿಸಿ" : "Send feedback"}
            </div>
            <div className="text-xs text-muted-foreground">
              {lang === "kn" ? "ನಿಮ್ಮ ಅನುಭವ ಹಂಚಿಕೊಳ್ಳಿ" : "Tell us what's working and what's not"}
            </div>
          </div>
        </button>

        {user?.is_owner && (
          <button data-testid="owner-portal-link" onClick={() => nav("/owner")}
            className="w-full rounded-xl border border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5 p-4 flex items-center gap-3 text-left hover:bg-[hsl(var(--primary))]/10 transition-colors">
            <div className="h-10 w-10 rounded-lg bg-[hsl(var(--primary))] text-white grid place-items-center">
              <ShieldCheck size={22} weight="fill"/>
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold flex items-center gap-2">
                Owner Portal
                <span className="text-[9px] uppercase tracking-wider bg-[hsl(var(--primary))]/15 text-[hsl(var(--primary))] px-1.5 py-0.5 rounded-full font-semibold">
                  Admin only
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                Users, districts, ads and feedback inbox
              </div>
            </div>
          </button>
        )}

        <Button
          data-testid="logout-btn"
          onClick={async () => { await logout(); nav("/login"); }}
          variant="outline"
          className="w-full min-h-[52px] rounded-xl border-[hsl(var(--accent))] text-[hsl(var(--accent))] hover:bg-[hsl(var(--accent))]/10"
        >
          <SignOut size={18} weight="duotone" className="mr-2"/>{t("logout")}
        </Button>

        <div className="text-center text-[11px] text-muted-foreground pt-4">
          Lekka Patra · ಲೆಕ್ಕ ಪತ್ರ · v1.0
        </div>
      </div>

      {/* Edit profile dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-[92%] rounded-xl">
          <DialogHeader>
            <DialogTitle>{lang === "kn" ? "ಪ್ರೊಫೈಲ್ ಸಂಪಾದಿಸಿ" : "Edit profile"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs uppercase tracking-[0.15em] text-muted-foreground">{lang === "kn" ? "ಹೆಸರು" : "Name"}</Label>
              <Input data-testid="edit-name-input" value={form.name}
                onChange={e => setForm({...form, name: e.target.value})} className="min-h-[48px]"/>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-[0.15em] text-muted-foreground">{lang === "kn" ? "ಮೊಬೈಲ್" : "Mobile (10 digits)"}</Label>
              <div className="flex items-center gap-2 rounded-lg border border-input min-h-[48px] px-3">
                <span className="text-sm text-muted-foreground">+91</span>
                <Input data-testid="edit-mobile-input" value={form.mobile}
                  inputMode="numeric"
                  onChange={e => setForm({...form, mobile: e.target.value.replace(/\D/g, "").slice(0,10)})}
                  className="border-0 focus-visible:ring-0 px-0 min-h-[44px]"/>
              </div>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-[0.15em] text-muted-foreground">{lang === "kn" ? "ಜಿಲ್ಲೆ" : "District"}</Label>
              <Select value={form.district} onValueChange={v => setForm({...form, district: v})}>
                <SelectTrigger data-testid="edit-district-trigger" className="min-h-[48px] rounded-lg">
                  <SelectValue placeholder={lang === "kn" ? "ಜಿಲ್ಲೆ" : "District"}/>
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {districts.map(d => (
                    <SelectItem key={d} value={d} data-testid={`edit-district-${d}`}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={()=>setEditOpen(false)}>{t("cancel")}</Button>
            <Button data-testid="save-profile-btn" onClick={saveProfile} disabled={saving}
              className="bg-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/90">
              {saving ? "…" : t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Feedback dialog */}
      <Dialog open={fbOpen} onOpenChange={setFbOpen}>
        <DialogContent className="max-w-[92%] rounded-xl">
          <DialogHeader>
            <DialogTitle>{lang === "kn" ? "ಪ್ರತಿಕ್ರಿಯೆ" : "Send feedback"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs uppercase tracking-[0.15em] text-muted-foreground">
                {lang === "kn" ? "ರೇಟಿಂಗ್" : "Rating"}
              </Label>
              <div className="flex items-center gap-1 mt-1">
                {[1,2,3,4,5].map(n => (
                  <button key={n} data-testid={`fb-star-${n}`}
                    onClick={() => setFb({...fb, rating: n})}
                    className="h-9 w-9 grid place-items-center rounded-md hover:bg-secondary">
                    <Star size={22} weight={n <= fb.rating ? "fill" : "duotone"}
                      className={n <= fb.rating ? "text-amber-500" : "text-muted-foreground"}/>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-[0.15em] text-muted-foreground">
                {lang === "kn" ? "ವರ್ಗ" : "Category"}
              </Label>
              <Select value={fb.category} onValueChange={v => setFb({...fb, category: v})}>
                <SelectTrigger data-testid="fb-category" className="min-h-[44px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="general">{lang === "kn" ? "ಸಾಮಾನ್ಯ" : "General"}</SelectItem>
                  <SelectItem value="bug">{lang === "kn" ? "ದೋಷ" : "Bug"}</SelectItem>
                  <SelectItem value="feature">{lang === "kn" ? "ಹೊಸ ವೈಶಿಷ್ಟ್ಯ" : "Feature request"}</SelectItem>
                  <SelectItem value="ux">{lang === "kn" ? "UX" : "UX / design"}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs uppercase tracking-[0.15em] text-muted-foreground">
                {lang === "kn" ? "ಸಂದೇಶ" : "Message"}
              </Label>
              <Textarea data-testid="fb-message" value={fb.message}
                onChange={e => setFb({...fb, message: e.target.value})}
                placeholder={lang === "kn" ? "ನಿಮ್ಮ ಅಭಿಪ್ರಾಯ ಬರೆಯಿರಿ" : "What did you like or dislike?"}
                rows={4}/>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={()=>setFbOpen(false)}>{t("cancel")}</Button>
            <Button data-testid="submit-feedback-btn" onClick={submitFeedback} disabled={fbSubmitting}
              className="bg-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/90">
              {fbSubmitting ? "…" : (lang === "kn" ? "ಕಳುಹಿಸಿ" : "Submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function Row({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <Icon size={16} weight="duotone" className="text-muted-foreground shrink-0"/>
      <span className="text-muted-foreground min-w-[80px]">{label}:</span>
      <span className="truncate">{value}</span>
    </div>
  );
}

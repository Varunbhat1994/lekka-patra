import { useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { useApp } from "@/context/AppContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { UserCircle, DeviceMobile } from "@phosphor-icons/react";

export default function ProfileSetup() {
  const { API, user, setUser, lang, t } = useApp();
  const nav = useNavigate();
  const [name, setName] = useState(user?.name || "");
  // Strip a leading 91 if we already have a mobile stored — the UI
  // shows only the 10 local digits.
  const [mobile, setMobile] = useState(
    (user?.mobile || "").replace(/^91/, "").slice(-10)
  );
  const [saving, setSaving] = useState(false);

  const digits = mobile.replace(/\D/g, "");
  const mobileValid = digits.length === 10;

  const save = async () => {
    if (!name.trim()) return toast.error(lang === "kn" ? "ಹೆಸರು ಬೇಕು" : "Name required");
    if (!mobileValid) return toast.error(lang === "kn" ? "10-ಅಂಕಿ ಸಂಖ್ಯೆ" : "Enter a 10-digit mobile");
    setSaving(true);
    try {
      const { data } = await axios.post(`${API}/auth/profile`, {
        name: name.trim(),
        mobile: digits,
      });
      setUser(data.user);
      if (data.merged) {
        toast.success(lang === "kn"
          ? "ನಿಮ್ಮ ಹಳೆಯ ಖಾತೆಗೆ ಸಂಪರ್ಕಿಸಲಾಗಿದೆ"
          : "Linked to your existing account");
      }
      nav("/dashboard", { replace: true });
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed");
    } finally { setSaving(false); }
  };

  return (
    <div className="min-h-screen bg-[hsl(var(--background))]">
      <div className="mx-auto max-w-md min-h-screen px-6 py-10 flex flex-col">
        <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          {lang === "kn" ? "ಸ್ವಾಗತ" : "Welcome"}
        </div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          {lang === "kn" ? "ಸ್ವಲ್ಪ ಮಾಹಿತಿ" : "A little about you"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {lang === "kn" ? "ಪ್ರಾರಂಭಿಸಲು ನಿಮ್ಮ ಹೆಸರು ಮತ್ತು ಮೊಬೈಲ್ ಸಂಖ್ಯೆ ನಮೂದಿಸಿ" : "Enter your name and mobile number to continue"}
        </p>

        <div className="mt-10 space-y-5">
          {/* Name */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-[0.15em] text-muted-foreground">
              {lang === "kn" ? "ಹೆಸರು" : "Full name"}
            </Label>
            <div className="rounded-xl border border-border bg-card px-4 flex items-center gap-3 min-h-[56px]">
              <UserCircle size={20} weight="duotone" className="text-[hsl(var(--primary))]"/>
              <Input
                data-testid="profile-name-input"
                value={name}
                autoFocus
                onChange={(e) => setName(e.target.value)}
                placeholder={lang === "kn" ? "ನಿಮ್ಮ ಹೆಸರು" : "Your name"}
                className="border-0 focus-visible:ring-0 px-0 min-h-[44px] text-base"
              />
            </div>
          </div>

          {/* Mobile — +91 prefix fixed, 10-digit numeric input */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-[0.15em] text-muted-foreground">
              {lang === "kn" ? "ಮೊಬೈಲ್ ಸಂಖ್ಯೆ" : "Mobile number"}
            </Label>
            <div className="rounded-xl border border-border bg-card px-4 flex items-center gap-3 min-h-[56px]">
              <DeviceMobile size={20} weight="duotone" className="text-[hsl(var(--primary))]"/>
              <span
                data-testid="profile-mobile-prefix"
                className="text-base font-medium text-foreground select-none"
              >+91</span>
              <span className="text-muted-foreground">|</span>
              <Input
                data-testid="profile-mobile-input"
                value={mobile}
                inputMode="numeric"
                pattern="[0-9]*"
                onChange={(e) => setMobile(e.target.value.replace(/\D/g, "").slice(0, 10))}
                placeholder="9876543210"
                className="border-0 focus-visible:ring-0 px-0 min-h-[44px] text-base tracking-wide"
              />
            </div>
            <div className="text-[11px] text-muted-foreground pl-1">
              {lang === "kn" ? "10 ಅಂಕಿ, ಸಂಖ್ಯೆಗಳು ಮಾತ್ರ" : "Exactly 10 digits, numbers only"}
            </div>
          </div>
        </div>

        <div className="mt-auto pt-10">
          <Button
            data-testid="save-profile-btn"
            onClick={save}
            disabled={saving || !name.trim() || !mobileValid}
            className="w-full min-h-[56px] rounded-xl bg-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/90 text-base font-semibold"
          >
            {saving ? "…" : (lang === "kn" ? "ಮುಂದುವರೆಸಿ" : t("continue"))}
          </Button>
        </div>
      </div>
    </div>
  );
}

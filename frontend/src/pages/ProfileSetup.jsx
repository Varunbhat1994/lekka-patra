import { useEffect, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { useApp } from "@/context/AppContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { UserCircle, MapPin } from "@phosphor-icons/react";

export default function ProfileSetup() {
  const { API, user, setUser, lang, t } = useApp();
  const nav = useNavigate();
  const [name, setName] = useState(user?.name || "");
  const [district, setDistrict] = useState(user?.district || "");
  const [districts, setDistricts] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    axios.get(`${API}/districts`).then(r => setDistricts(r.data.districts));
  }, [API]);

  const save = async () => {
    if (!name.trim()) return toast.error(lang === "kn" ? "ಹೆಸರು ಬೇಕು" : "Name required");
    if (!district) return toast.error(lang === "kn" ? "ಜಿಲ್ಲೆ ಆಯ್ಕೆಮಾಡಿ" : "Choose a district");
    setSaving(true);
    try {
      const { data } = await axios.post(`${API}/auth/profile`, { name: name.trim(), district });
      setUser(data.user);
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
          {lang === "kn" ? "ನಿಮಗಾಗಿ ಸೂಚನೆಗಳನ್ನು ಸಿದ್ಧಪಡಿಸಲು" : "So we can tailor suggestions for your area"}
        </p>

        <div className="mt-10 space-y-5">
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

          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-[0.15em] text-muted-foreground">
              {lang === "kn" ? "ಜಿಲ್ಲೆ" : "District"}
            </Label>
            <Select value={district} onValueChange={setDistrict}>
              <SelectTrigger data-testid="profile-district-trigger" className="min-h-[56px] rounded-xl bg-card">
                <div className="flex items-center gap-3">
                  <MapPin size={20} weight="duotone" className="text-[hsl(var(--primary))]"/>
                  <SelectValue placeholder={lang === "kn" ? "ಜಿಲ್ಲೆ ಆಯ್ಕೆಮಾಡಿ" : "Select your district"}/>
                </div>
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {districts.map(d => (
                  <SelectItem key={d} value={d} data-testid={`district-${d}`}>{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-auto pt-10">
          <Button
            data-testid="save-profile-btn"
            onClick={save}
            disabled={saving}
            className="w-full min-h-[56px] rounded-xl bg-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/90 text-base font-semibold"
          >
            {saving ? "…" : (lang === "kn" ? "ಮುಂದುವರೆಸಿ" : t("continue"))}
          </Button>
        </div>
      </div>
    </div>
  );
}

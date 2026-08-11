import { useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { useApp } from "@/context/AppContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  InputOTP, InputOTPGroup, InputOTPSlot,
} from "@/components/ui/input-otp";
import { toast } from "sonner";
import { ArrowLeft, DeviceMobile, ShieldCheck } from "@phosphor-icons/react";

export default function OtpLogin() {
  const { API, setUser, lang } = useApp();
  const nav = useNavigate();
  const [step, setStep] = useState("mobile");
  const [mobile, setMobile] = useState("");
  const [otp, setOtp] = useState("");
  const [devOtp, setDevOtp] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const sendOtp = async () => {
    const digits = mobile.replace(/\D/g, "");
    if (digits.length < 10) return toast.error(lang === "kn" ? "10-ಅಂಕಿ ಸಂಖ್ಯೆ ನಮೂದಿಸಿ" : "Enter 10-digit number");
    setSending(true);
    try {
      const { data } = await axios.post(`${API}/auth/otp/send`, { mobile: digits });
      setDevOtp(data.dev_otp || "");
      setStep("otp");
      // Log to console for developer visibility as the user requested
      // eslint-disable-next-line no-console
      console.log(`[DEV OTP] +91${digits} → ${data.dev_otp}`);
      toast.success(lang === "kn" ? "OTP ಕಳುಹಿಸಲಾಗಿದೆ" : "OTP sent");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed");
    } finally { setSending(false); }
  };

  const verify = async () => {
    if (otp.length !== 6) return toast.error(lang === "kn" ? "6-ಅಂಕಿ OTP" : "Enter 6-digit OTP");
    setVerifying(true);
    try {
      const { data } = await axios.post(`${API}/auth/otp/verify`, {
        mobile: mobile.replace(/\D/g, ""),
        otp,
      });
      setUser(data.user);
      if (data.needs_profile) nav("/profile-setup", { replace: true });
      else nav("/dashboard", { replace: true });
    } catch (e) {
      toast.error(e.response?.data?.detail || "Invalid OTP");
    } finally { setVerifying(false); }
  };

  return (
    <div className="min-h-screen bg-[hsl(var(--background))]">
      <div className="mx-auto max-w-md min-h-screen px-6 py-8 flex flex-col">
        <button data-testid="otp-back" onClick={() => step === "mobile" ? nav(-1) : setStep("mobile")}
          className="h-10 w-10 -ml-2 rounded-full grid place-items-center hover:bg-secondary">
          <ArrowLeft size={20}/>
        </button>

        <div className="mt-10">
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            {step === "mobile" ? "Step 01" : "Step 02"}
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            {step === "mobile"
              ? (lang === "kn" ? "ಮೊಬೈಲ್ ಸಂಖ್ಯೆ" : "Enter mobile")
              : (lang === "kn" ? "OTP ನಮೂದಿಸಿ" : "Verify OTP")}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {step === "mobile"
              ? (lang === "kn" ? "ಪರೀಕ್ಷೆಗಾಗಿ OTP ಪರದೆಯ ಮೇಲೆ ತೋರಿಸಲಾಗುತ್ತದೆ" : "Test mode — OTP is shown on screen")
              : (lang === "kn" ? `+91 ${mobile.replace(/\D/g,"").slice(-10)} ಗೆ OTP` : `Code for +91 ${mobile.replace(/\D/g,"").slice(-10)}`)}
          </p>
        </div>

        {step === "mobile" ? (
          <div className="mt-10 space-y-4">
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-3">
                <DeviceMobile size={22} weight="duotone" className="text-[hsl(var(--primary))]"/>
                <div className="flex-1 flex items-center">
                  <span className="text-lg font-medium mr-2">+91</span>
                  <Input
                    data-testid="mobile-input"
                    inputMode="numeric"
                    autoFocus
                    placeholder="9876543210"
                    value={mobile}
                    onChange={(e) => setMobile(e.target.value.replace(/\D/g, "").slice(0,10))}
                    className="border-0 focus-visible:ring-0 text-lg px-0 min-h-[44px]"
                  />
                </div>
              </div>
            </div>
            <Button
              data-testid="send-otp-btn"
              disabled={sending || mobile.replace(/\D/g,"").length < 10}
              onClick={sendOtp}
              className="w-full min-h-[52px] rounded-xl bg-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/90"
            >
              {sending ? "…" : (lang === "kn" ? "OTP ಕಳುಹಿಸಿ" : "Send OTP")}
            </Button>
            <div className="text-[11px] text-center text-muted-foreground pt-2">
              {lang === "kn"
                ? "ಪರೀಕ್ಷಾ ಮೋಡ್ · ನಿಜವಾದ SMS ಇಲ್ಲ · OTP ಇಲ್ಲಿ ತೋರಿಸಲಾಗುತ್ತದೆ"
                : "Dev mode · no real SMS · OTP shown on next screen"}
            </div>
          </div>
        ) : (
          <div className="mt-10 space-y-4">
            <div className="rounded-xl border border-border bg-card p-5 flex flex-col items-center">
              <InputOTP maxLength={6} value={otp} onChange={setOtp} data-testid="otp-input">
                <InputOTPGroup>
                  {[0,1,2,3,4,5].map(i => <InputOTPSlot key={i} index={i} />)}
                </InputOTPGroup>
              </InputOTP>
              {devOtp && (
                <button
                  data-testid="dev-otp-pill"
                  onClick={() => setOtp(devOtp)}
                  className="mt-4 text-[11px] px-3 py-1.5 bg-secondary rounded-full text-muted-foreground hover:bg-secondary/70 cursor-pointer transition-colors"
                  title="Tap to auto-fill"
                >
                  <span className="uppercase tracking-wider">Dev OTP</span> · <span className="font-mono font-semibold text-foreground">{devOtp}</span> · <span className="italic">tap to fill</span>
                </button>
              )}
            </div>
            <Button
              data-testid="verify-otp-btn"
              disabled={verifying || otp.length !== 6}
              onClick={verify}
              className="w-full min-h-[52px] rounded-xl bg-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/90"
            >
              <ShieldCheck size={18} weight="duotone" className="mr-2"/>
              {verifying ? "…" : (lang === "kn" ? "ಪರಿಶೀಲಿಸಿ" : "Verify & continue")}
            </Button>
            <button data-testid="resend-otp" onClick={sendOtp} className="w-full text-xs text-muted-foreground hover:underline">
              {lang === "kn" ? "OTP ಮತ್ತೆ ಕಳುಹಿಸಿ" : "Resend code"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

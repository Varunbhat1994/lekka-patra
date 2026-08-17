// Native authentication screen — Login / Register / Forgot / Recover
// modes in a single file. Visuals match the approved reference: peach
// background, orange gradient Book icon, orange gradient primary CTA,
// +91 leading pill, lock icon in password field, eye toggle.
//
// All API calls go to /api/auth/* endpoints defined in
// backend/routes/auth.py. On success, the bearer token is stored via
// setAuthToken() from AppContext and refresh() re-loads /auth/me.
import React, { useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { useApp, setAuthToken } from "@/context/AppContext";
import { toast } from "sonner";
import {
  Phone, Lock, Eye, EyeSlash, User, ArrowRight,
  BookOpen, ArrowLeft,
} from "@phosphor-icons/react";

const MODES = { LOGIN: "login", REGISTER: "register",
                FORGOT: "forgot", RECOVER: "recover" };

// Small, single-purpose inputs. Keep visual language consistent with
// the rest of the app (existing shadcn tokens, rounded-xl, hsl vars).

function TextField({ icon: Icon, prefix, ...props }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-[hsl(28_45%_88%)] bg-white px-3 h-12">
      {Icon && (
        <div className="w-8 h-8 rounded-full bg-[hsl(30_100%_95%)] grid place-items-center shrink-0">
          <Icon size={16} className="text-[hsl(20_85%_55%)]"/>
        </div>
      )}
      {prefix && <span className="text-sm text-[hsl(220_15%_25%)]">{prefix}</span>}
      <input
        {...props}
        className="flex-1 min-w-0 bg-transparent outline-none text-[15px] text-[hsl(220_15%_15%)] placeholder:text-[hsl(220_8%_60%)]"
      />
    </div>
  );
}

function PasswordField({ value, onChange, placeholder, testid }) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-xl border border-[hsl(28_45%_88%)] bg-white px-3 h-12">
      <div className="w-8 h-8 rounded-full bg-[hsl(30_100%_95%)] grid place-items-center shrink-0">
        <Lock size={16} className="text-[hsl(20_85%_55%)]"/>
      </div>
      <input
        data-testid={testid}
        type={show ? "text" : "password"}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="flex-1 min-w-0 bg-transparent outline-none text-[15px] text-[hsl(220_15%_15%)] placeholder:text-[hsl(220_8%_60%)]"
      />
      <button type="button" onClick={() => setShow(s => !s)}
              data-testid={`${testid}-toggle`}
              className="p-1 text-[hsl(220_10%_45%)]">
        {show ? <EyeSlash size={18}/> : <Eye size={18}/>}
      </button>
    </div>
  );
}

function PrimaryButton({ children, loading, testid, ...props }) {
  return (
    <button
      data-testid={testid}
      disabled={loading}
      {...props}
      className="w-full h-12 rounded-2xl text-white font-semibold text-[15px] inline-flex items-center justify-center gap-2 shadow-[0_8px_20px_-6px_rgba(230,120,20,0.55)] active:scale-[0.995] transition"
      style={{
        background: "linear-gradient(180deg, hsl(30 95% 55%) 0%, hsl(22 85% 50%) 100%)",
        opacity: loading ? 0.75 : 1,
      }}
    >
      {children}
      <ArrowRight size={16} weight="bold"/>
    </button>
  );
}

function Label({ children }) {
  return <div className="text-[13px] font-semibold text-[hsl(220_15%_25%)] mb-1.5">{children}</div>;
}

export default function Login() {
  const { refresh } = useApp();
  const nav = useNavigate();
  const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
  const [mode, setMode] = useState(MODES.LOGIN);
  const [busy, setBusy] = useState(false);

  // Consolidated form state (per-mode fields are cleared on switch).
  const [f, setF] = useState({});
  const upd = (k, v) => setF(prev => ({ ...prev, [k]: v }));
  const swap = (next) => { setF({}); setMode(next); };

  const errMsg = (e, fallback = "Something went wrong. Please try again.") =>
    e?.response?.data?.detail || fallback;

  // -------- handlers --------
  const doLogin = async () => {
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/auth/login`,
        { mobile: f.mobile, password: f.password });
      setAuthToken(data.token);
      await refresh();
      nav("/dashboard");
    } catch (e) { toast.error(errMsg(e)); }
    finally { setBusy(false); }
  };

  const doRegister = async () => {
    if (!f.name?.trim()) return toast.error("Enter your name");
    if ((f.password || "").length < 6) return toast.error("Password must be at least 6 characters");
    if (f.password !== f.confirm_password) return toast.error("Passwords do not match");
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/auth/register`, {
        name: f.name.trim(), mobile: f.mobile,
        password: f.password, confirm_password: f.confirm_password,
      });
      setAuthToken(data.token);
      toast.success("Account created");
      await refresh();
      nav("/dashboard");
    } catch (e) { toast.error(errMsg(e)); }
    finally { setBusy(false); }
  };

  const doForgotSend = async () => {
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/auth/forgot-password`,
        { mobile: f.mobile });
      // Auto-populate the reset code as required by the spec.
      upd("reset_code", data.reset_code);
      upd("_stage", "reset");
      toast.success("Reset code generated");
    } catch (e) { toast.error(errMsg(e)); }
    finally { setBusy(false); }
  };

  const doForgotReset = async () => {
    if ((f.new_password || "").length < 6) return toast.error("Password must be at least 6 characters");
    if (f.new_password !== f.confirm_password) return toast.error("Passwords do not match");
    setBusy(true);
    try {
      await axios.post(`${API}/auth/reset-password`, {
        mobile: f.mobile, reset_code: f.reset_code,
        new_password: f.new_password, confirm_password: f.confirm_password,
      });
      toast.success("Password reset. Please log in with your new password.");
      swap(MODES.LOGIN);
    } catch (e) { toast.error(errMsg(e)); }
    finally { setBusy(false); }
  };

  const doRecover = async () => {
    if (f.new_mobile !== f.confirm_new_mobile) return toast.error("New mobile numbers do not match");
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/auth/change-mobile`, {
        old_mobile: f.old_mobile, old_password: f.old_password,
        new_mobile: f.new_mobile, confirm_new_mobile: f.confirm_new_mobile,
      });
      setAuthToken(data.token);
      toast.success("Mobile number updated. All your data is intact.");
      await refresh();
      nav("/dashboard");
    } catch (e) { toast.error(errMsg(e)); }
    finally { setBusy(false); }
  };

  // -------- shared header --------
  const Header = ({ title, subtitle }) => (
    <div className="text-center pt-6 pb-4">
      <div className="mx-auto w-16 h-16 rounded-2xl grid place-items-center shadow-[0_10px_24px_-8px_rgba(230,120,20,0.55)] mb-3"
           style={{ background: "linear-gradient(180deg, hsl(30 95% 55%) 0%, hsl(22 85% 50%) 100%)" }}>
        <BookOpen size={30} weight="fill" className="text-white"/>
      </div>
      <div className="text-[26px] font-bold text-[hsl(220_18%_15%)] leading-tight">Lekka Patra</div>
      <div className="text-[12px] text-[hsl(220_10%_45%)] mt-0.5">
        ಲೆಕ್ಕ ಪತ್ರ · Simple Ledger &amp; Accounts
      </div>
      <div className="mt-4 text-[19px] font-bold text-[hsl(220_18%_15%)]">{title}</div>
      {subtitle && <div className="text-[12.5px] text-[hsl(220_10%_45%)] mt-1">{subtitle}</div>}
    </div>
  );

  // -------- content per mode --------
  let content = null;

  if (mode === MODES.LOGIN) {
    content = (
      <>
        <Header title="Welcome Back" subtitle="Sign in to manage your daily ledger & accounts"/>
        <div className="space-y-4 bg-white rounded-2xl border border-[hsl(28_35%_92%)] p-4 shadow-[0_2px_12px_-4px_rgba(30,20,10,0.08)]">
          <div>
            <Label>Mobile Number</Label>
            <TextField icon={Phone} prefix="+91"
              inputMode="numeric" data-testid="login-mobile"
              value={f.mobile || ""} onChange={(e) => upd("mobile", e.target.value)}
              placeholder="9876543210"/>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <Label>Password</Label>
              <button className="text-[12px] font-semibold text-[hsl(20_85%_50%)]"
                      onClick={() => swap(MODES.FORGOT)} data-testid="login-forgot-link">
                Forgot Password?
              </button>
            </div>
            <PasswordField testid="login-password"
              value={f.password || ""} onChange={(e) => upd("password", e.target.value)}
              placeholder="••••••••"/>
          </div>
          <PrimaryButton testid="login-btn" onClick={doLogin} loading={busy}>Login</PrimaryButton>
          <div className="text-center text-[12.5px] text-[hsl(220_10%_45%)] pt-1">
            <button data-testid="login-recover-link"
              onClick={() => swap(MODES.RECOVER)} className="underline underline-offset-2 mr-3">
              Account Recovery
            </button>
            <span className="text-[hsl(220_8%_65%)]">·</span>
            <button data-testid="login-create-link"
              onClick={() => swap(MODES.REGISTER)} className="ml-3 font-semibold text-[hsl(20_85%_50%)]">
              Create Account
            </button>
          </div>
        </div>
      </>
    );
  } else if (mode === MODES.REGISTER) {
    content = (
      <>
        <Header title="Create Account" subtitle="A few details and you're ready to go"/>
        <div className="space-y-3 bg-white rounded-2xl border border-[hsl(28_35%_92%)] p-4 shadow-[0_2px_12px_-4px_rgba(30,20,10,0.08)]">
          <div>
            <Label>Name</Label>
            <TextField icon={User} data-testid="reg-name"
              value={f.name || ""} onChange={(e) => upd("name", e.target.value)}
              placeholder="Your name"/>
          </div>
          <div>
            <Label>Mobile Number</Label>
            <TextField icon={Phone} prefix="+91" inputMode="numeric" data-testid="reg-mobile"
              value={f.mobile || ""} onChange={(e) => upd("mobile", e.target.value)}
              placeholder="9876543210"/>
          </div>
          <div>
            <Label>Create Password (min 6)</Label>
            <PasswordField testid="reg-password"
              value={f.password || ""} onChange={(e) => upd("password", e.target.value)}
              placeholder="••••••••"/>
          </div>
          <div>
            <Label>Confirm Password</Label>
            <PasswordField testid="reg-confirm"
              value={f.confirm_password || ""} onChange={(e) => upd("confirm_password", e.target.value)}
              placeholder="••••••••"/>
          </div>
          <PrimaryButton testid="reg-btn" onClick={doRegister} loading={busy}>Create Account</PrimaryButton>
          <div className="text-center text-[12.5px] text-[hsl(220_10%_45%)] pt-1">
            Already have an account?{" "}
            <button data-testid="reg-back-link" onClick={() => swap(MODES.LOGIN)}
                    className="font-semibold text-[hsl(20_85%_50%)]">Login</button>
          </div>
        </div>
      </>
    );
  } else if (mode === MODES.FORGOT) {
    const stage = f._stage || "request";
    content = (
      <>
        <Header title="Forgot Password" subtitle="We'll generate a reset code you can use here"/>
        <div className="space-y-3 bg-white rounded-2xl border border-[hsl(28_35%_92%)] p-4 shadow-[0_2px_12px_-4px_rgba(30,20,10,0.08)]">
          <div>
            <Label>Mobile Number</Label>
            <TextField icon={Phone} prefix="+91" inputMode="numeric" data-testid="fp-mobile"
              value={f.mobile || ""} onChange={(e) => upd("mobile", e.target.value)}
              placeholder="9876543210" disabled={stage === "reset"}/>
          </div>
          {stage === "reset" && (
            <>
              <div>
                <Label>Reset Code</Label>
                <TextField icon={Lock} data-testid="fp-code"
                  value={f.reset_code || ""} onChange={(e) => upd("reset_code", e.target.value)}
                  placeholder="6-digit code"/>
                <div className="text-[11px] text-[hsl(20_75%_45%)] mt-1">
                  Code was auto-filled. Valid for 5 minutes.
                </div>
              </div>
              <div>
                <Label>New Password (min 6)</Label>
                <PasswordField testid="fp-new"
                  value={f.new_password || ""} onChange={(e) => upd("new_password", e.target.value)}
                  placeholder="••••••••"/>
              </div>
              <div>
                <Label>Confirm New Password</Label>
                <PasswordField testid="fp-confirm"
                  value={f.confirm_password || ""} onChange={(e) => upd("confirm_password", e.target.value)}
                  placeholder="••••••••"/>
              </div>
            </>
          )}
          {stage === "request" ? (
            <PrimaryButton testid="fp-send-btn" onClick={doForgotSend} loading={busy}>
              Get Reset Code
            </PrimaryButton>
          ) : (
            <PrimaryButton testid="fp-reset-btn" onClick={doForgotReset} loading={busy}>
              Reset Password
            </PrimaryButton>
          )}
          <button data-testid="fp-back-link" onClick={() => swap(MODES.LOGIN)}
                  className="w-full text-center text-[12.5px] text-[hsl(220_10%_45%)] pt-1 inline-flex items-center justify-center gap-1">
            <ArrowLeft size={13}/> Back to Login
          </button>
        </div>
      </>
    );
  } else if (mode === MODES.RECOVER) {
    content = (
      <>
        <Header title="Account Recovery" subtitle="Change the mobile number linked to your account"/>
        <div className="space-y-3 bg-white rounded-2xl border border-[hsl(28_35%_92%)] p-4 shadow-[0_2px_12px_-4px_rgba(30,20,10,0.08)]">
          <div>
            <Label>Old Mobile Number</Label>
            <TextField icon={Phone} prefix="+91" inputMode="numeric" data-testid="rec-old-mobile"
              value={f.old_mobile || ""} onChange={(e) => upd("old_mobile", e.target.value)}
              placeholder="9876543210"/>
          </div>
          <div>
            <Label>Old Password</Label>
            <PasswordField testid="rec-old-password"
              value={f.old_password || ""} onChange={(e) => upd("old_password", e.target.value)}
              placeholder="••••••••"/>
          </div>
          <div>
            <Label>New Mobile Number</Label>
            <TextField icon={Phone} prefix="+91" inputMode="numeric" data-testid="rec-new-mobile"
              value={f.new_mobile || ""} onChange={(e) => upd("new_mobile", e.target.value)}
              placeholder="8765432109"/>
          </div>
          <div>
            <Label>Confirm New Mobile Number</Label>
            <TextField icon={Phone} prefix="+91" inputMode="numeric" data-testid="rec-confirm-mobile"
              value={f.confirm_new_mobile || ""} onChange={(e) => upd("confirm_new_mobile", e.target.value)}
              placeholder="8765432109"/>
          </div>
          <PrimaryButton testid="rec-btn" onClick={doRecover} loading={busy}>Change Mobile Number</PrimaryButton>
          <button data-testid="rec-back-link" onClick={() => swap(MODES.LOGIN)}
                  className="w-full text-center text-[12.5px] text-[hsl(220_10%_45%)] pt-1 inline-flex items-center justify-center gap-1">
            <ArrowLeft size={13}/> Back to Login
          </button>
        </div>
      </>
    );
  }

  return (
    <div
      className="min-h-screen w-full"
      style={{
        background: "linear-gradient(180deg, hsl(30 100% 96%) 0%, hsl(20 55% 94%) 100%)",
      }}
      data-testid="auth-screen"
    >
      <div className="max-w-md mx-auto px-5 pb-10">
        {content}
      </div>
    </div>
  );
}

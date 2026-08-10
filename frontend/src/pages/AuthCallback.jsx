import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { useApp } from "@/context/AppContext";

export default function AuthCallback() {
  const nav = useNavigate();
  const { setUser } = useApp();
  const hasRun = useRef(false);

  useEffect(() => {
    if (hasRun.current) return;
    hasRun.current = true;

    const hash = window.location.hash || "";
    const m = hash.match(/session_id=([^&]+)/);
    if (!m) { nav("/"); return; }
    const sessionId = m[1];

    (async () => {
      try {
        const { data } = await axios.post(
          `${process.env.REACT_APP_BACKEND_URL}/api/auth/session`,
          { session_id: sessionId },
          { withCredentials: true }
        );
        setUser(data.user);
        window.history.replaceState(null, "", "/dashboard");
        nav("/dashboard", { replace: true, state: { user: data.user } });
      } catch (e) {
        console.error("auth callback failed", e);
        nav("/login", { replace: true });
      }
    })();
  }, [nav, setUser]);

  return (
    <div className="min-h-screen grid place-items-center bg-background">
      <div className="text-sm text-muted-foreground">Signing you in…</div>
    </div>
  );
}

import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import axios from "axios";
import { t as translate } from "@/i18n";
import {
  computeAccountScope, runHydration, getHydrationProgress,
  isOfflineReady, markLastOnline, HYDRATION_STEPS,
} from "@/offline";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
axios.defaults.withCredentials = true;

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lang, setLang] = useState(() => localStorage.getItem("lang") || "");
  const [accountScope, setAccountScope] = useState(null);
  const [offlineReady, setOfflineReady] = useState(false);
  const [hydrationProgress, setHydrationProgress] = useState(null);
  const [isOnline, setIsOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine
  );
  const hydrationRunningRef = useRef(false);

  const setLanguage = useCallback((l) => {
    setLang(l);
    localStorage.setItem("lang", l);
    if (user) axios.post(`${API}/auth/language`, { language: l }).catch(() => {});
  }, [user]);

  // Kick off (or resume) hydration for the newly-authenticated user.
  // Idempotent — completed steps are skipped. Progress is reported via
  // setHydrationProgress so the AppShell can render a status pill.
  const startHydration = useCallback(async (u) => {
    if (!u?.user_id) return;
    if (hydrationRunningRef.current) return;
    hydrationRunningRef.current = true;
    try {
      const scope = await computeAccountScope(u.user_id);
      setAccountScope(scope);
      const ready = await isOfflineReady(scope);
      setOfflineReady(ready);
      const progress0 = await getHydrationProgress(scope);
      setHydrationProgress(progress0);
      if (ready) {
        // Already hydrated once — just refresh last_online.
        await markLastOnline(scope, u);
      }
      // Run (or resume) hydration. Failures leave the gate false so a
      // future reconnect resumes from the failed step.
      await runHydration(scope, {
        user: u,
        onProgress: (p) => setHydrationProgress({
          steps: p.step ? { [p.step]: p.phase === "step_done" } : {},
          done: p.done,
          total: p.total,
          phase: p.phase,
          resume_from: null,
          completed_at: p.phase === "complete" ? new Date().toISOString() : null,
        }),
      });
      const finalP = await getHydrationProgress(scope);
      setHydrationProgress(finalP);
      setOfflineReady(await isOfflineReady(scope));
    } catch (e) {
      // Hydration failure — offlineReady stays false; UI will show
      // "First-time setup needs internet" gate when offline.
      // Server session may still be valid; do not clear user.
      // eslint-disable-next-line no-console
      console.warn("[offline] hydration failed", e);
    } finally {
      hydrationRunningRef.current = false;
    }
  }, []);

  const checkAuth = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/auth/me`);
      setUser(data);
      if (data.language && !localStorage.getItem("lang")) {
        setLang(data.language);
        localStorage.setItem("lang", data.language);
      }
      // Fire-and-forget hydration; don't block UI.
      startHydration(data);
    } catch {
      setUser(null);
      setAccountScope(null);
      setOfflineReady(false);
      setHydrationProgress(null);
    } finally {
      setLoading(false);
    }
  }, [startHydration]);

  useEffect(() => {
    if (window.location.hash?.includes("session_id=")) {
      setLoading(false);
      return;
    }
    checkAuth();
  }, [checkAuth]);

  // Online/offline listeners
  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true);
      if (user) startHydration(user);
    };
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [user, startHydration]);

  const logout = async () => {
    try { await axios.post(`${API}/auth/logout`); } catch {}
    setUser(null);
    setAccountScope(null);
    setOfflineReady(false);
    setHydrationProgress(null);
    // NOTE: Per Step 2 §12, we DO NOT delete this account's IDB data
    // or its sync_queue on logout — data remains isolated by
    // account_scope until the same account logs back in.
  };

  const t = (k) => translate(lang || "en", k);

  return (
    <AppContext.Provider value={{
      user, setUser, loading, lang, setLanguage, logout,
      refresh: checkAuth, t, API,
      // Offline additions:
      accountScope, offlineReady, hydrationProgress, isOnline,
      HYDRATION_STEPS,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export const useApp = () => useContext(AppContext);

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import axios from "axios";
import { t as translate } from "@/i18n";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
axios.defaults.withCredentials = true;

// Native-auth bearer token bootstrap: if a token was persisted on a
// previous session, attach it to every axios request. Login /
// Register / Recovery calls setAuthToken(...) to persist and attach.
const _bootToken = typeof localStorage !== "undefined"
  ? localStorage.getItem("auth_token")
  : null;
if (_bootToken) {
  axios.defaults.headers.common["Authorization"] = `Bearer ${_bootToken}`;
}
export function setAuthToken(tok) {
  if (tok) {
    localStorage.setItem("auth_token", tok);
    axios.defaults.headers.common["Authorization"] = `Bearer ${tok}`;
  } else {
    localStorage.removeItem("auth_token");
    delete axios.defaults.headers.common["Authorization"];
  }
}

// Global 401 handler: any authenticated call that comes back 401 means
// the token was invalidated server-side (another device took over,
// password was reset, etc). Drop the token locally and reload so the
// Login screen appears. We skip auth-endpoint 401s (they're expected
// for wrong-credentials responses and the user is not yet logged in).
axios.interceptors.response.use(
  (r) => r,
  (err) => {
    const url = err?.config?.url || "";
    if (err?.response?.status === 401
        && !url.includes("/auth/login")
        && !url.includes("/auth/register")
        && !url.includes("/auth/forgot-password")
        && !url.includes("/auth/reset-password")
        && !url.includes("/auth/change-mobile")) {
      const had = !!localStorage.getItem("auth_token");
      if (had) {
        localStorage.removeItem("auth_token");
        delete axios.defaults.headers.common["Authorization"];
        // A hard reload lands us on the router, which will bounce to /login.
        if (typeof window !== "undefined") window.location.reload();
      }
    }
    return Promise.reject(err);
  }
);

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lang, setLang] = useState(() => localStorage.getItem("lang") || "");

  const setLanguage = useCallback((l) => {
    setLang(l);
    localStorage.setItem("lang", l);
    if (user) axios.post(`${API}/auth/language`, { language: l }).catch(() => {});
  }, [user]);

  const checkAuth = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/auth/me`);
      setUser(data);
      if (data.language && !localStorage.getItem("lang")) {
        setLang(data.language);
        localStorage.setItem("lang", data.language);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // CRITICAL: If returning from OAuth callback, skip /me. AuthCallback exchanges session first.
    if (window.location.hash?.includes("session_id=")) {
      setLoading(false);
      return;
    }
    checkAuth();
  }, [checkAuth]);

  const logout = async () => {
    try { await axios.post(`${API}/auth/logout`); } catch {}
    setAuthToken(null);
    setUser(null);
  };

  const t = (k) => translate(lang || "en", k);

  return (
    <AppContext.Provider value={{ user, setUser, loading, lang, setLanguage, logout, refresh: checkAuth, t, API }}>
      {children}
    </AppContext.Provider>
  );
}

export const useApp = () => useContext(AppContext);

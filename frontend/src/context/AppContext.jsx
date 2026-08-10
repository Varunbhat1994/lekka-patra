import { createContext, useContext, useEffect, useState, useCallback } from "react";
import axios from "axios";
import { t as translate } from "@/i18n";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
axios.defaults.withCredentials = true;

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

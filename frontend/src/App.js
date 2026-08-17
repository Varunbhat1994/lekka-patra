import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AppProvider, useApp } from "@/context/AppContext";
import { Toaster } from "sonner";

import LanguagePicker from "@/pages/LanguagePicker";
import Login from "@/pages/Login";
import ProfileSetup from "@/pages/ProfileSetup";
import OwnerPortal from "@/pages/OwnerPortal";
import Dashboard from "@/pages/Dashboard";
import Workers from "@/pages/Workers";
import Attendance from "@/pages/Attendance";
import Ledger from "@/pages/Ledger";
import WorkerHistory from "@/pages/WorkerHistory";
import ContractorHistory from "@/pages/ContractorHistory";
import Settings from "@/pages/Settings";
import AgriExpenses from "@/pages/AgriExpenses";
import AgriWorkNotes from "@/pages/AgriWorkNotes";

function Protected({ children, requireProfile = true }) {
  const { user, loading } = useApp();
  if (loading) {
    return <div className="min-h-screen grid place-items-center text-sm text-muted-foreground">Loading…</div>;
  }
  if (!user) return <Navigate to="/login" replace />;
  // Phase 1: every user (Google login) must complete Name + Mobile before entering the app.
  if (requireProfile && !(user.name && user.mobile)) {
    return <Navigate to="/profile-setup" replace />;
  }
  return children;
}

function LandingRoute() {
  const { user, lang, loading } = useApp();
  if (loading) return <div className="min-h-screen grid place-items-center text-sm text-muted-foreground">Loading…</div>;
  if (user) return <Navigate to="/dashboard" replace />;
  if (!lang) return <LanguagePicker />;
  return <Navigate to="/login" replace />;
}

function AppRouter() {
  const location = useLocation();
  if (location.hash?.includes("session_id=")) {
    // Legacy Google-OAuth callback path. Native auth no longer needs it —
    // strip the hash and route to /login so it doesn't loop.
    if (typeof window !== "undefined") {
      window.history.replaceState({}, "", window.location.pathname);
    }
    return <Navigate to="/login" replace/>;
  }
  return (
    <Routes>
      <Route path="/" element={<LandingRoute />} />
      <Route path="/login" element={<Login />} />
      <Route path="/profile-setup" element={<Protected requireProfile={false}><ProfileSetup /></Protected>} />
      <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
      <Route path="/workers" element={<Protected><Workers /></Protected>} />
      <Route path="/attendance" element={<Protected><Attendance /></Protected>} />
      <Route path="/ledger" element={<Protected><Ledger /></Protected>} />
      <Route path="/history/worker/:id" element={<Protected><WorkerHistory /></Protected>} />
      <Route path="/history/contractor/:id" element={<Protected><ContractorHistory /></Protected>} />
      <Route path="/settings" element={<Protected><Settings /></Protected>} />
      <Route path="/agri-expenses" element={<Protected><AgriExpenses /></Protected>} />
      <Route path="/agri-expenses/work-notes" element={<Protected><AgriWorkNotes /></Protected>} />
      <Route path="/owner" element={<Protected><OwnerPortal /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <AppRouter />
        <Toaster position="top-center" richColors />
      </BrowserRouter>
    </AppProvider>
  );
}

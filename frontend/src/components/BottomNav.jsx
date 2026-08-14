import { NavLink } from "react-router-dom";
import { House, CalendarCheck, UsersThree, Notebook, Gear } from "@phosphor-icons/react";
import { useApp } from "@/context/AppContext";

const items = [
  { to: "/dashboard", icon: House, key: "dashboard", tid: "nav-dashboard" },
  { to: "/attendance", icon: CalendarCheck, key: "attendance", tid: "nav-attendance" },
  { to: "/workers", icon: UsersThree, key: "workers", tid: "nav-workers" },
  { to: "/ledger", icon: Notebook, key: "ledger", tid: "nav-ledger" },
  { to: "/settings", icon: Gear, key: "settings", tid: "nav-settings" },
];

export default function BottomNav() {
  const { t } = useApp();
  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 pointer-events-none">
      <div className="mx-auto max-w-md pointer-events-auto">
        <div className="mx-3 mb-3 rounded-2xl border border-border bg-white/85 backdrop-blur-xl shadow-lg">
          <ul className="grid grid-cols-5">
            {items.map((it) => (
              <li key={it.to}>
                <NavLink
                  to={it.to}
                  data-testid={it.tid}
                  className={({ isActive }) =>
                    `relative flex flex-col items-center justify-center py-2.5 min-h-[60px] text-[10px] uppercase tracking-wider transition-colors ${
                      isActive ? "text-[hsl(var(--primary))]" : "text-muted-foreground hover:text-foreground"
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <span
                          aria-hidden="true"
                          className="absolute top-0 h-[3px] w-9 rounded-full bg-[hsl(var(--primary))]"
                        />
                      )}
                      <it.icon size={22} weight={isActive ? "fill" : "duotone"} />
                      <span className="mt-1">{t(it.key)}</span>
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </nav>
  );
}

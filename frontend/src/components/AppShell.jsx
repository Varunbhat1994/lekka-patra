import BottomNav from "./BottomNav";

export default function AppShell({ children, title, right }) {
  return (
    <div className="app-shell-root min-h-screen bg-[hsl(var(--background))]">
      <div className="app-shell-frame mx-auto max-w-md min-h-screen relative border-x border-border/60">
        {title && (
          <header className="app-shell-header sticky top-[var(--beta-banner-h,0px)] z-30 bg-white/85 backdrop-blur-xl border-b border-border">
            <div className="px-5 h-14 flex items-center justify-between">
              <h1 className="text-lg font-semibold tracking-tight" data-testid="page-title">{title}</h1>
              {right}
            </div>
          </header>
        )}
        <main className="px-5 pt-4 pb-28">{children}</main>
        <BottomNav />
      </div>
    </div>
  );
}

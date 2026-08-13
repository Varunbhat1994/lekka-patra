# Lekka Patra (ಲೆಕ್ಕ ಪತ್ರ) — Farm Labor Tracker (PRD)

## Original Problem Statement
Production-ready, mobile-responsive web app for agriculturists to track field labor attendance, daily wages, advance payments and daily work logs. Bilingual (Kannada/English), Google + Phone OTP sign-in, cloud DB, 15-day trial then ₹99/yr Razorpay subscription (read-only if unpaid), workers & contractors, ledger with Mark Settled cutoff, PDF/Excel + WhatsApp reports, hidden Owner Portal with ad management, analytics, feedback.

## Architecture
- Backend: FastAPI + MongoDB (motor)
- Frontend: React 19 + Tailwind + Shadcn UI + Recharts
- Auth: Emergent-managed Google OAuth + Dummy OTP (Firebase paused)
- Payments: Razorpay ₹99/yr subscription
- Reports: reportlab (PDF) + openpyxl (Excel)
- PWA: manifest.json + custom icons (square 16→1024, maskable 192/512/1024)

## Implemented
- Bilingual (EN/KN) with i18n dictionary
- Google Sign-In + Dummy OTP login
- Workers CRUD, Attendance (4 statuses), Advances/Settlements
- Contractor visits, payments, returns, per-contractor ledger
- Mark Settled = cycle cutoff (resets pending wages & days_worked, keeps history)
- Dashboard with sliding marquee + Ad Carousel (photo-only, swipe, 10s auto)
- PDF (detailed date-wise) + Excel exports, WhatsApp share
- Owner Portal (RBAC via OWNER_MOBILE/OWNER_EMAIL): user & location analytics, ad manager, feedback inbox
- 15-day trial + ₹99/yr Razorpay subscription with read-only lock (HTTP 402)
- App rebrand to "Lekka Patra" everywhere
- **[2026-02-11] Custom App Icon & PWA:** Square-cropped Lekka Patra logo installed as favicon.ico + PNG icons (16, 32, 48, 64, 96, 128, 144, 152, 180, 192, 256, 384, 512, 1024) + maskable variants (192/512/1024) with green safe-zone padding. manifest.json updated with 15 icons and theme/background `#1c683b`. index.html adds full apple-touch-icon set, mask-icon, and multiple icon size links for Android + iOS home-screen installs and PWA splash.
- **[2026-02-11] Bubblewrap TWA scaffolding:** `/app/mobile/twa-manifest.json` + `/app/mobile/README.md` step-by-step APK build guide. `/.well-known/assetlinks.json` served live on the PWA domain for Digital Asset Links verification (fingerprint placeholder to be filled after user runs `bubblewrap init`).
- **[2026-02-12] Worker Type & Attendance grouping:** Added `worker_type` field (regular | temporary, default regular) to Worker model + WorkerIn. Workers form now has a segmented Regular/Temporary toggle. Worker list rows show a colored badge. Attendance page groups workers into two sticky sections — **Regular Workers** first, then **Temporary Workers** — each with a header and count. Sections only render when non-empty. Bilingual (EN/KN) labels added.
- **[2026-02-12] Global Beta Marquee:** New `BetaBanner` component mounted at app root (App.js) — fixed at top, `#FFF9C4` background, `#333333` text, 30px tall, `z-index: 60`, seamless continuous scroll (42s loop, dual-copy track). Bilingual Kannada + English text: "ಗಮನಿಸಿ: ಈ ಅಪ್ಲಿಕೇಶನ್ ಪರೀಕ್ಷಾ ಹಂತದಲ್ಲಿದೆ… / Note: This app is in beta phase. Please maintain a manual backup of your important data." Sets `--beta-banner-h` CSS var so sticky page headers offset correctly. Visible on every screen including Login, Dashboard, Attendance, Workers, Ledger, Settings, Paywall, Owner Portal. Respects `prefers-reduced-motion`.
- **[2026-02-13] Final Balance accounting fix (v1):** Added `final_balance` field to `compute_worker_ledger`. Initial formula was `total_earned - net_advance - total_settled` (proven buggy in v2 audit).
- **[2026-02-13] Full accounting + data-integrity audit v3:** After user re-audit, discovered 4 additional issues and fixed them systematically:
- **[2026-02-13] Historical wage lock (Attendance.daily_rate_snapshot):** ROOT CAUSE for the "editing worker wage rewrites past earnings" bug: `Attendance` did not store the wage in force on the day it was recorded — every ledger read computed `_wage_units(status, ot, worker["daily_rate"])` with the *current* rate. Fix: added optional `daily_rate_snapshot: Optional[float] = None` to the Attendance model and `POST /api/attendance` (routes/attendance.py) now snapshots `worker.daily_rate` at insert time. Existing rows (no snapshot) unchanged — computed with a fallback to the worker's current rate for backward compat. `services/ledger.py::compute_worker_ledger` and `routes/dashboard.py` now prefer `a["daily_rate_snapshot"]` over `worker["daily_rate"]`. No migration performed. No historical rows modified. 7 new audit tests (33–39): 500→600, 500→600→700, wage change with no new work (total unchanged), legacy fallback, settle across wage change, cross-user isolation on wage change, and a live HTTP e2e test that hits `POST /workers`, `POST /attendance`, `PUT /workers` with a wage bump, and `GET /ledger/{id}` — confirms `total_earned = ₹4,400` (NOT ₹4,800). 40/40 tests pass.
- **[2026-02-13] Contractor ledger additive fix:** Contractor accounting was correct but incomplete — `compute_contractor_ledger` didn't expose `total_settled` or `final_balance`, so history views couldn't distinguish "return via settlement" from "voluntary return" and the UI/exports lacked a sign-aware direction label. Fixed (READ-SIDE ADDITIVE ONLY, zero writes, zero migrations): `services/ledger.py::compute_contractor_ledger` now returns two new fields — `total_settled` = Σ settlements with `kind='contractor_settle'` for this contractor (filtered by window if start/end), and `final_balance = -net_paid` (same formula in current and history mode, deliberately NOT copying the worker formula because contractor settlements already record a matching return so their cash effect is in `total_returned`). Settlements list is also surfaced. Kind filter (`kind='contractor_settle'`) prevents contractor settlements from ever leaking into worker `total_settled`. `ContractorsSection.jsx` adds a direction line ("You owe contractor / Contractor owes you / Balanced"). `ContractorHistory.jsx` adds Total Settled KPI, direction card with red/green tone, and an explanatory footnote. Reports (`reports.py`): PDF adds Balance column + direction sentence, Excel Summary adds Total Settled/Net Paid/Balance/Direction rows, WhatsApp includes balance line. 7 new tests (40-46) cover: contractor lifetime net_paid, settle zeros balance + surfaces total_settled, full-year history shows settle, partial-return no-settle, user isolation, contractor settle never leaks into worker totals, dashboard pending_list direction. **47/47 tests pass.** Live HTTP smoke (`tests/smoke_contractor_reports.py`) confirms /ledger, PDF (with rendered text extracted via pypdf), Excel Summary sheet, WhatsApp all contain the new fields and correct direction sentence before AND after Mark Settled. No DB writes, no migrations, no worker/settlement logic touched.


    1. `_compute_pending_list` (services/ledger.py) returned `pending = total_earned` — Dashboard marquee was misleading. Fixed to use `final_balance` (single source of truth). Also corrected contractor `advance` field to use `net_paid` and marked contractor pending as negative for sign-consistency with worker marquee items.
    2. `/api/dashboard` (routes/dashboard.py) computed `pending_wage = total_earned − total_advance` (all-time, ignoring returns and settlements) and `outstanding_advance = total_advance` (ignoring returns). Rewrote so both totals aggregate the per-worker ledger — `pending_wage = Σ max(0, w.final_balance)`, `outstanding_advance = Σ max(0, w.net_advance)` — guaranteeing dashboard equals sum of individual Ledger cards.
    3. `POST /api/advances`, `POST /api/returns`, `POST /api/attendance` accepted arbitrary `worker_id` without confirming the worker belongs to the caller. Added `db.workers.find_one({"id": worker_id, "user_id": caller})` guard on each — cross-account writes now 404. Verified via live HTTP test.
    4. Extended `/app/backend/tests/test_accounting_audit.py` to 33 automated scenarios covering multi-worker isolation, advance-after-settle (K), return-before-settle (L), absent+advance same day (R/S), half_day + overtime wage math, dashboard=Σworkers, dashboard pending_list scoping, cross-account POST rejection (28, 29), PDF/Excel==UI single source, three-cycle settle→balanced, and reload stability. 33/33 pass.
  Verified live via authenticated HTTP round-trip against the deployed API: dashboard aggregate matches per-worker sum; cross-account /advances, /returns, /attendance all return 404.

- **[2026-02-13] Balance color/direction fix:** `Stat` helper in `Ledger.jsx` now supports a `danger` prop; the worker-card Balance cell uses `primary` (green) when `final_balance > 0`, `danger` (red) when `< 0`, and neutral when `= 0`.
- **[2026-02-13] Full accounting audit & period-aware Final Balance (v2):** Fixed the post-settlement double-counting bug uncovered by the user (earned 1950 + adv 2500 + settle 1950 was showing "Worker owes ₹4,450" instead of ₹2,500). `compute_worker_ledger` in `services/ledger.py` now branches:
    - CURRENT-cycle mode (no start/end): `final_balance = total_earned − net_advance` — does NOT subtract `total_settled` because those earnings were already reset by cutoff.
    - HISTORY mode (start & end supplied): `final_balance = total_earned − net_advance − total_settled` — all three values are windowed to the same date range, so classical activity accounting applies.
  Backend is the single source of truth: `Ledger.jsx`, `WorkerHistory.jsx`, PDF, Excel, WhatsApp all consume `led['final_balance']`. Reports now also include a "Balance" column and WhatsApp messages now say "You owe worker" / "Worker owes you" / "Balanced" instead of the misleading "Pending". Comprehensive audit suite `/app/backend/tests/test_accounting_audit.py` covers all 21 required scenarios (earned-only, advance-only, mixed, exact settle, actual_paid>earned, adjust_advance both directions, multi-advances/returns/settlements, undo settle, full-year/month/pre-settle history, PDF/Excel consistency, cross-user isolation, Ledger==WorkerHistory) — 21/21 pass. Old test files `test_final_balance.py` and `test_settlement_final_balance.py` removed (replaced by the audit suite).



## Backlog (P1/P2)
- **P1** Real SMS OTP (Firebase Phone Auth once user upgrades to Blaze, or MSG91/Twilio fallback)
- **P1** Razorpay Webhook Configuration (RAZORPAY_WEBHOOK_SECRET) for out-of-band capture
- **P2** WhatsApp renewal nudges 7 days before subscription expiry
- **P2** Multi-admin management UI in Owner Portal (promote/demote without editing .env)
- **P2** Weekly WhatsApp summary of attendance/wages to owner
- **P2** iOS `apple-touch-startup-image` splash screens for device-specific PWA launch

## RBAC / Monetization Rules
- `is_owner` granted when logged-in mobile == OWNER_MOBILE or email == OWNER_EMAIL (backend/.env)
- Trial: 15 days from `created_at`. After that, writes return 402 unless `subscription_active` and `subscription_expires_at > now`
- Razorpay success grants +365 days

## Key Files
- `/app/backend/server.py` — API, RBAC, ledger cutoff, PDF/Excel, Razorpay
- `/app/frontend/public/manifest.json` + `/app/frontend/public/index.html` — PWA config
- `/app/frontend/public/icons/*` — all icon sizes + maskable variants
- `/app/frontend/src/pages/*` — Dashboard, Ledger, Workers, Settings, OwnerPortal, Paywall, OtpLogin, Login

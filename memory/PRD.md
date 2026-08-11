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

# FarmLog — Farm Labor Tracker (PRD)

## Original Problem Statement
Build a production-ready mobile-responsive web app for agriculturists to track field labor attendance, daily wages, advance payments, and daily work logs with 5-day trial + one-time lifetime purchase.

## Architecture
- Backend: FastAPI + MongoDB (motor)
- Frontend: React 19 + Tailwind + Shadcn UI + Recharts
- Auth: Emergent-managed Google OAuth
- Payments: Stripe (Flow B, `sk_test_emergent` sandbox) via emergentintegrations
- Reports: reportlab (PDF) + openpyxl (Excel)

## User Persona
Farm owner in India managing daily labor across fields/crops (Arecanut, Paddy, Dairy).

## Core Requirements (static)
- Bilingual: English + Kannada
- 5-day free trial then one-time lifetime paywall (locks writes, keeps reads)
- Workers CRUD, per-day attendance with 4 statuses, advance ledger
- Dashboard with monthly expense chart by field/crop
- PDF/Excel/WhatsApp exports
- Mobile-first PWA-ready

## Implemented (2026-02)
- Language picker (pre-login)
- Google Sign-In via Emergent OAuth + cookie session (7d)
- Trial + paid access gating (server-side 402 on writes)
- Workers CRUD
- Attendance upsert per (worker, date)
- Advances + Settlements
- Dashboard aggregation + Recharts stacked bar
- PDF + Excel exports, WhatsApp share (EN/KN)
- Stripe checkout + status polling + webhook + user unlock

## Backlog (P1/P2)
- Full PWA offline queue (service worker + IndexedDB sync) — P1
- Phone/OTP fallback auth — P2
- Per-field/crop filters on Attendance & Ledger — P2
- Push notifications for pending wage settlements — P2
- Bulk mark-all-present shortcut — P1

# ClipWaltz — Features

Living inventory of implemented capabilities. A feature isn't "done" until it's here,
operable per [`ADMIN_DOCS.md`](ADMIN_DOCS.md), and explained in the
[Help Center](HELP_CENTER.md).

## Status legend
✅ implemented · 🚧 scaffolded (stub/wiring only) · ⬜ planned (MVP) · 🔭 later

## Foundation (scaffold — 2026-09-15)
| Feature | Status | Notes |
|---|---|---|
| Next.js 16 app (App Router, TS, Tailwind v4) | ✅ | `src/` dir, `@/*` alias, shadcn (Base UI) UI kit |
| Authentication — Better Auth | ✅ | Email/password + optional social; sessions in Postgres. Pages: `/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password`. API at `/api/auth/[...all]`. Route protection in `src/proxy.ts`. |
| Transactional email — Amazon SES | ✅ | `src/lib/email.ts` (nodemailer/SMTP 587); console fallback when unconfigured |
| Database — Drizzle + Postgres | ✅ | Schema `src/db/schema.ts`; tables: user/session/account/verification + projects/assets/music_tracks/renders/subscriptions. Migration `drizzle/0000_*.sql` generated |
| Billing module — Stripe (direct) | 🚧 | Isolated in `src/lib/billing/`; Checkout + webhook verify wired; webhook handler `/api/billing/webhook` stubbed (persist in P2). See [`BILLING.md`](BILLING.md) |
| Canonical host (apex→www 308) | ✅ | `src/proxy.ts` redirects `clipwaltz.com` → `www.clipwaltz.com` |
| Landing page | ✅ | `/` — hero + signup CTA |
| Agency Agents (repo-local) | ✅ | Installed in `.claude/agents/` (279 agents) |

## MVP application features (planned — from the Design & Build Plan)
| Feature | Status | Notes |
|---|---|---|
| Projects + dashboard | ⬜ | List with Draft/Rendering/Ready status |
| New Project wizard (occasion templates) | ⬜ | 2 templates + "Surprise me"; 9:16 only |
| Media import (drag-drop / picker / guided USB) | ⬜ | Resumable chunked upload to MinIO; USB = OS-assisted import |
| Cloud auto-assemble (beat-synced) | ⬜ | FFmpeg workers on the AI box |
| Draft preview + light editor | ⬜ | Reorder, swap music, set length |
| Cloud HD render (async) + notify | ⬜ | In-app + SES "video ready" email |
| Export / share (watermark on free) | ⬜ | Download + share link |
| Licensed music catalog (~10 tracks) | ⬜ | BPM/mood metadata |
| Account / billing (Free/Plus/Pro) | ⬜ | Stripe Checkout |
| Help Center | ⬜ | Categories mirror features |
| Retention: 7-day auto-delete (free) | ⬜ | Paid "Project Vault" keeps longer |

## Later
Native mobile apps · collaboration/shared reels · auto-captions · face/scene-aware
selection · 4K · multi-aspect · brand kits · web B-roll · partner API.

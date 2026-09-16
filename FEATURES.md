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
| Object storage — MinIO (linuxg7) | ✅ | `src/lib/storage.ts` (S3 SDK, path-style). Dedicated `clipwaltz` bucket (versioned) + bucket-scoped service account. Upload/list/delete wired |
| Billing module — Stripe (direct) | 🚧 | Isolated in `src/lib/billing/`; Checkout + webhook verify wired; webhook handler `/api/billing/webhook` stubbed (persist in P2). See [`BILLING.md`](BILLING.md) |
| Canonical host (apex→www 308) | ✅ | `src/proxy.ts` redirects `clipwaltz.com` → `www.clipwaltz.com` |
| Landing page | ✅ | `/` — hero + signup CTA |
| Agency Agents (repo-local) | ✅ | Installed in `.claude/agents/` (279 agents) |

## MVP application features (planned — from the Design & Build Plan)
| Feature | Status | Notes |
|---|---|---|
| Projects + dashboard | ✅ | `/projects` (auth-gated app shell). Lists user's projects newest-first with Draft/Rendering/Ready/Failed badges; create/rename/duplicate/delete via server actions (owner-checked); empty state + free-tier retention banner. "New Project" → wizard. Verified E2E. |
| New Project wizard (occasion templates) | ✅ | `/projects/new`: Trip + Event/Wedding + "Surprise me" active, Birthday "Coming soon"; 9:16 locked. Continue creates the project with the chosen template → `/projects/[id]/import`. Verified E2E in-browser (select → create → import step → dashboard card). |
| Draft preview + editor (screen 06) | 🚧 | `/projects/[id]/edit` placeholder — lists uploaded clips; real draft/auto-assemble/render is the next milestone |
| Media import (drag-drop / picker / guided USB) | ✅ | `/projects/[id]/import`: 3 tabs (drag-drop, files/folder picker, guided OS-assisted USB), per-file progress, proxied upload → MinIO `clipwaltz` bucket, delete. Continue → editor. Verified E2E (object confirmed in bucket). *(v1.1: presigned multipart + resumable for large files.)* |
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

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
| Landing page (marketing home) | ✅ | `/` — full glass-metal marketing site in the brand spectrum (blue→violet→magenta→coral): frosted nav w/ logo, aurora hero + animated 9:16 phone mockup, "One App, Two Vibes" (vacations vs business), how-it-works, feature tiles, occasion templates, pricing teaser, CTA slab, footer. Brand assets `public/logo-2.png` (mark/favicon) + `public/logo-name-1.png` (wordmark). Responsive; `prefers-reduced-motion` aware. Scoped `cw-` `@layer components`. |
| Light / dark theme toggle | ✅ | Nav toggle (`src/components/theme-toggle.tsx`, `useSyncExternalStore`) flips the `dark` class on `<html>`; theme-aware landing via CSS tokens; no-flash init script in the root layout (stored choice → else system preference); persisted to `localStorage`. Also themes the shadcn app pages. |
| Agency Agents (repo-local) | ✅ | Installed in `.claude/agents/` (279 agents) |

## MVP application features (planned — from the Design & Build Plan)
| Feature | Status | Notes |
|---|---|---|
| Projects + dashboard | ✅ | `/projects` (auth-gated app shell). Lists user's projects newest-first with Draft/Rendering/Ready/Failed badges; create/rename/duplicate/delete via server actions (owner-checked); empty state + free-tier retention banner. "New Project" → wizard. Verified E2E. |
| New Project wizard (occasion templates) | ✅ | `/projects/new`: Trip + Event/Wedding + "Surprise me" active, Birthday "Coming soon"; 9:16 locked. Continue creates the project with the chosen template → `/projects/[id]/import`. Verified E2E in-browser (select → create → import step → dashboard card). |
| Render pipeline (queue + worker) | ✅ | `renders` DB queue; `worker/render-worker.mjs` claims jobs (FOR UPDATE SKIP LOCKED), pulls clips from MinIO, FFmpeg-assembles a 1080p 9:16 video (photos + videos, optional music, optional watermark), uploads to MinIO, updates status. Verified E2E (valid 1080×1920 MP4). **Deploy target: AI box** (pending — see ADMIN_DOCS). |
| Editor (screen 06) | ✅ | `/projects/[id]/edit`: reorder clips, remove, **music picker**, **length** (15/30/60), **aspect** (9:16 / 16:9), **Style** (title/caption overlay, filter warm/cool/vivid/bw/vintage, cut/crossfade transition, Ken Burns, fade in/out), **draft preview player**, **Render HD** + live status + **Download**. |
| Aspect ratio 9:16 / 16:9 | ✅ | Selectable in the wizard + editor (`setProjectAspect`); worker renders 1080×1920 or 1920×1080. |
| Editor Phase 1 effects | ✅ | Worker applies: title/caption overlay (drawtext), color filters, fade in/out, **crossfade** (xfade chain w/ probed offsets) or cut, Ken Burns zoom on photos. FFmpeg chains verified E2E on real media. Beat-sync + smart active-moment cutting = later phase. |
| Admin: invite + comp grants | ✅ | `/admin` (ADMIN_EMAILS allowlist): grant Plus/Pro to any email, **lifetime or expiry**; existing users upgrade instantly, unknown emails get an invite that redeems on signup. `getEffectiveTier` gates features/watermark. |
| Legal pages | ✅ | Public `/terms`, `/privacy`, `/refund` (brand-themed), linked in footer. |
| Media import (drag-drop / picker / guided USB) | ✅ | `/projects/[id]/import`: 3 tabs (drag-drop, files/folder picker, guided OS-assisted USB), per-file progress, proxied upload → MinIO `clipwaltz` bucket, delete. Continue → editor. Verified E2E (object confirmed in bucket). *(v1.1: presigned multipart + resumable for large files.)* |
| Cloud auto-assemble | ✅ | Normalize to 9:16/16:9 + concat/crossfade + Ken Burns + filters + title + fades + music + length cap + watermark. |
| Smart cut + beat sync | ✅ | Worker detects beats (`aubiotrack`) → cuts land on the beat (music trimmed to first downbeat); each video's **most active window** chosen via motion analysis (frame-diff YAVG), skipping dead/static/black. Project toggles `smartCut`/`beatSync` (0005) in the editor. Verified E2E on real media. Face/scene-aware selection = later CV phase. |
| Light editor (reorder / music / length) | ✅ | Server-actions, owner-checked; verified E2E (render used the chosen track + capped length) |
| Fast low-res draft preview | ✅ | In-editor story-style player (`src/components/draft-preview.tsx`): plays ordered clips + chosen soundtrack instantly (no server render), timing mirrors the worker (2s/photo, 4s/video, capped to length). Source media streamed via proxied `GET /api/projects/[id]/assets/[assetId]` + `GET /api/music/[trackId]`. Shows the "magic" before the async HD render. |
| Cloud HD render (async) | ✅ | DB queue + worker + live status polling; download served (proxied). SES "video ready" email still to wire |
| Export / share (watermark on free) | 🚧 | Download ✅ (proxied). Watermark drawtext in worker (font-fallback safe); public share link still to come |
| Music catalog | ✅ | **83 licensed Pixabay tracks** live in prod (manifest-driven `scripts/seed-music.mjs`, Pixabay Content License, 0 placeholders). Editor picker has **search + scroll** for the large catalog. Playback via proxied `GET /api/music/[trackId]`. Sourcing/licensing in `MUSIC_CATALOG.md`. |
| Account / billing (Free/Plus/Pro) | ✅ | `/account/billing` + Stripe hosted Checkout + portal + webhook. Live in **acct_1UGiVdER…** (test): Plus $15 / Pro $39 prices, tax code set, webhook public + verified (checkout session creates). Comp/admin grants bypass Stripe. See `BILLING.md`. |
| Community feed | ✅ | At **`/community`** ("Community" in nav; `/feed` 307→/community). Renders share as private/unlisted/public (share control in the render panel); public grid + `/w/[id]` watch pages (video, creator, likes, CTA); `render_likes`. Public stream `GET /api/renders/[id]/watch`. |
| Cloud import — Google / Dropbox / OneDrive | ✅ | **Google Photos** via server OAuth + Photos Picker (`/api/oauth/google/*`, `/api/import/google/*`, tokens in `oauth_accounts`). **Dropbox** (Chooser) + **OneDrive** (OneDrive.js) via client pickers → shared SSRF-allowlisted `/api/import/urls` → MinIO. All on the import screen. **iCloud = file-picker only** (no web API). |
| Canonical host apex→www | ✅ | `clipwaltz.com` 308→`www.clipwaltz.com` (middleware, keyed off `x-forwarded-host` behind the tunnel). |
| Help Center | ⬜ | Categories mirror features |
| Retention: 7-day auto-delete (free) | ⬜ | Paid "Project Vault" keeps longer |

## Later
Native mobile apps · collaboration/shared reels · auto-captions · face/scene-aware
selection · 4K · multi-aspect · brand kits · web B-roll · partner API.

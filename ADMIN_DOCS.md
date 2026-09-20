# ClipWaltz — Admin & Operations

Configuration, environment, and runbooks. Companion to [`FEATURES.md`](FEATURES.md) and the
[Design & Build Plan](DESIGN_BUILD_PLAN.md).

## Stack
- **Framework:** Next.js 16 (App Router, TypeScript, Tailwind v4, shadcn/Base UI kit)
- **Auth:** Better Auth (self-hosted) on Postgres
- **DB/ORM:** Postgres + Drizzle (`casing: snake_case`)
- **Object storage:** MinIO on **linuxg7** `:9000` (S3-compatible) — bucket `clipwaltz`
- **Email:** Amazon SES (SMTP 587, nodemailer)
- **Billing:** Stripe (direct) — see [`BILLING.md`](BILLING.md)
- **Render:** FFmpeg workers on the **AI box** (`ai`, 192.168.166.168, 32 cores)
- **Hosting (planned):** a linuxg host behind a Cloudflare Tunnel; canonical `https://www.clipwaltz.com`

## Local setup
```bash
cp env.example .env.local          # then fill values
openssl rand -base64 32            # → BETTER_AUTH_SECRET
npm install
npm run db:generate               # regenerate migrations after schema changes
npm run db:migrate                # apply to the DB in DATABASE_URL
npm run dev                        # http://localhost:3000
```

## Environment variables
See [`env.example`](env.example) for the full list. Groups:
- **App:** `NEXT_PUBLIC_APP_URL`
- **Auth:** `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `AUTH_REQUIRE_EMAIL_VERIFICATION`, optional social creds
- **DB:** `DATABASE_URL`
- **Storage (MinIO):** `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION`
- **Email (SES):** `SES_SMTP_HOST/PORT/USER/PASS`, `EMAIL_FROM`
- **Billing (Stripe):** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PLUS`, `STRIPE_PRICE_PRO`
- **Worker callback (video-ready email):** `WORKER_CALLBACK_SECRET` — the SAME value on the app (`.env.local`, linuxg1) and the worker (`.env.worker`, AI box). The worker POSTs `/api/internal/render-ready` with it; the app sends the SES email. Stored in `_keys/clipwaltz.txt`.
- **Google OAuth (Photos import + Drive backup):** both reuse `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (one OAuth 2.0 Client ID in Google Cloud Console → APIs & Services → Credentials). **Both callback URLs must be listed under that client's "Authorized redirect URIs" — exact string, no trailing slash:**
  - Photos import: `https://www.clipwaltz.com/api/oauth/google/callback`
  - Drive backup: `https://www.clipwaltz.com/api/oauth/google/drive/callback`

  (For any non-prod environment, substitute that env's `NEXT_PUBLIC_APP_URL` for the host.) Drive backup also needs the **Drive API enabled** and the **`drive.file`** scope on the OAuth consent screen. While the consent screen is in Testing, each user's Google account must be a **test user**; public use needs Google verification of the `drive.file` scope. Connections stored in `oauth_accounts` (providers `google` / `google_drive`).
  - **Troubleshooting — `Error 400: redirect_uri_mismatch`:** the callback URL the app sent isn't in the client's Authorized redirect URIs. Add the exact URL above (the Drive one was the cause on 2026-09-19: Photos was registered, Drive was not), Save, wait a few minutes for propagation, retry. It matches character-for-character.
- **Worker vision (face/scene):** `OLLAMA_URL` (e.g. `http://192.168.166.182:11434`), `OLLAMA_MODEL` (default `qwen2.5vl:7b`, a non-reasoning VL model), optional `OLLAMA_TIMEOUT_MS`. Worker-only; empty `OLLAMA_URL` = motion-only.

> **Never** commit `.env*`, log secrets, or put secrets in `NEXT_PUBLIC_*`.

## Scripts
| Script | Does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run db:generate` | Generate Drizzle migration from schema |
| `npm run db:migrate` | Apply migrations |
| `npm run db:push` | Push schema directly (dev only) |
| `npm run lint` | ESLint |

## Build note
`next build` needs `BETTER_AUTH_SECRET` and `DATABASE_URL` present in the environment
(Postgres connects lazily, so a live DB is not required to build).

## Deployment (planned — per fleet rules)
- Bind Next to `0.0.0.0` on a free port (verify live with `ss -tlnp`; check `server-inventory.md`).
- Route publicly via the host's existing **Cloudflare Tunnel** (owner adds the Public Hostname
  `www.clipwaltz.com` → `http://localhost:<port>`); create the DNS CNAME via API.
- Set `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` to `https://www.clipwaltz.com`.
- After standing up the service, **update `server-inventory.md`** (port/route) and re-publish the wiki copy.

## Runbooks (to expand as features land)
- **Object storage:** MinIO on linuxg7 at `192.168.166.169:9000` (LAN), bucket `clipwaltz` (versioning on), accessed via a **bucket-scoped service account** (least privilege; not the root key). Keys in `.env.local`/`_keys`. Never recursive-delete the bucket (documented incident on the fleet). Uploads are proxied through `/api/projects/[id]/assets` (MinIO stays off the public internet).
- **Render pool:** FFmpeg on the AI box; keep renders off the shared linuxg web hosts (they throttle transcoding).
- **DB migrations:** `drizzle-kit` does **not** auto-load `.env.local`, so it silently falls back to `postgres://localhost:5432/clipwaltz` and hangs/exit-1 if run bare. Always run **`node --env-file=.env.local ./node_modules/drizzle-kit/bin.cjs migrate`** (never pipe to `tail` — it SIGPIPEs mid-apply). Locally the dev DB (`clipwaltz_dev`) needs the linuxg1 SSH tunnel up.

## Monthly Theme Challenge (contests)
Admin-run community contest; likes on entered public renders are votes.
- **Start:** `/admin` → *Monthly Theme Challenge* → enter a theme (+ optional description) → **Start challenge**. Only **one active** contest at a time; the community banner appears automatically.
- **Entries:** creators enter one of their **Public** renders from the editor's render panel ("Enter this challenge"). Non-public renders can't enter until shared Public.
- **Close & crown:** `/admin` → **Close & crown winner**. The likes-leader is auto-granted **Pro for 30 days** (comp via `applyGrant`, same system as manual grants — visible in the Users table) and emailed. Closing with zero entries just closes it. Then start the next month's theme.
- **Data:** `contests` + `contest_entries` (migration 0006). Winner is stored on the contest row (`winner_render_id`/`winner_user_id`). No cron — closing is manual by design.

## Render worker
`worker/render-worker.mjs` claims queued rows from `renders` (FOR UPDATE SKIP LOCKED), pulls the
project's clips from MinIO, FFmpeg-assembles a 1080p 9:16 video (photos 2s, videos ≤4s, optional
music from `music_tracks`, optional watermark), uploads to `renders/<projectId>/<renderId>.mp4`,
and marks the row `done` (+ project `ready`). Reuses the app's `postgres` + S3 deps.

Run (from project root):
```bash
node --env-file=.env.local worker/render-worker.mjs --once   # one job, then exit
node --env-file=.env.local worker/render-worker.mjs          # loop (polls every 5s)
```
It needs `DATABASE_URL` reachable and the `S3_*` env. Verified end-to-end from the dev workstation
(FFmpeg local + Postgres via the SSH tunnel + MinIO on the LAN).

**Prod deployment (pending owner approval):** run it as a systemd service on the **AI box**
(32-core, FFmpeg, reaches MinIO directly). The AI box currently **cannot** reach linuxg1's
`localhost`-only Postgres — deploying requires **authorizing the AI box's SSH key on linuxg1** so it
can hold an SSH tunnel to `:5432` (a security change on a production host — get explicit sign-off
first). Then: copy `worker/`, `npm i postgres @aws-sdk/client-s3`, set env, and run under systemd.
*(v1.1: move the queue to Redis/BullMQ; beat-synced cuts; SES "video ready" email.)*
- **Cost instrumentation:** record `cpuSeconds`/`costCents` on each `renders` row → cost-per-render.

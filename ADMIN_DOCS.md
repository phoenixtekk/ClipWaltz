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
- **Storage edge (ADR-0003):** `S3_PUBLIC_ENDPOINT=https://media.clipwaltz.com` turns on direct
  browser ↔ MinIO media (presigned URLs); unset it (or `MEDIA_DIRECT=0`) to fall back to proxying.
- **Email (SES):** `SES_SMTP_HOST/PORT/USER/PASS`, `EMAIL_FROM`
- **Billing (Stripe):** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PLUS`, `STRIPE_PRICE_PRO`
- **AI generation queue (BullMQ):** `REDIS_URL` (default `redis://127.0.0.1:6379`; Redis runs on linuxg1, localhost-only). Used by the app (enqueue) and the generation worker (consume).
- **AI generation node (AISERVER):** `AISERVER_API_URL` (default `http://192.168.166.158:8189` — the FastAPI wrapper, LAN-reachable from linuxg1) and `AISERVER_API_TOKEN` (shared-secret bearer, matches `/opt/clipwaltz-ai/config/wrapper.env` on AISERVER). **Server-only — never `NEXT_PUBLIC_*`.** ComfyUI stays localhost on AISERVER; the app only ever talks to the wrapper.
- **Worker callback (video-ready email):** `WORKER_CALLBACK_SECRET` — the SAME value on the app (`.env.local`, linuxg1) and the worker (`.env.worker`, AI box). The worker POSTs `/api/internal/render-ready` with it; the app sends the SES email. Stored in `_keys/clipwaltz.txt`.
- **Google OAuth (Photos import + Drive backup):** both reuse `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (one OAuth 2.0 Client ID in Google Cloud Console → APIs & Services → Credentials). **Both callback URLs must be listed under that client's "Authorized redirect URIs" — exact string, no trailing slash:**
  - Photos import: `https://www.clipwaltz.com/api/oauth/google/callback`
  - Drive backup: `https://www.clipwaltz.com/api/oauth/google/drive/callback`

  (For any non-prod environment, substitute that env's `NEXT_PUBLIC_APP_URL` for the host.) Drive backup also needs the **Drive API enabled** and the **`drive.file`** scope on the OAuth consent screen. While the consent screen is in Testing, each user's Google account must be a **test user**; public use needs Google verification of the `drive.file` scope. Connections stored in `oauth_accounts` (providers `google` / `google_drive`).
  - **Troubleshooting — `Error 400: redirect_uri_mismatch`:** the callback URL the app sent isn't in the client's Authorized redirect URIs. Add the exact URL above (the Drive one was the cause on 2026-09-19: Photos was registered, Drive was not), Save, wait a few minutes for propagation, retry. It matches character-for-character.
- **Worker vision (face/scene):** `OLLAMA_URL` (e.g. `http://192.168.166.182:11434`), `OLLAMA_MODEL` (default `qwen2.5vl:7b`, a non-reasoning VL model), optional `OLLAMA_TIMEOUT_MS`. Worker-only; empty `OLLAMA_URL` = motion-only.
- **Web Push (render-complete OS notifications):** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (a `mailto:` for the push service to contact), and `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (**same value** as `VAPID_PUBLIC_KEY` — exposed to the browser to build subscriptions). **App-only** (linuxg1 `.env.local`); the worker does not need them. Generate a keypair with `node -e "console.log(require('web-push').generateVAPIDKeys())"`. If unset, push is a no-op and the "Windows notification" toggle disables itself; the in-tab toggle and email still work. Keys stored in `_keys/clipwaltz.txt`. The private key is a secret — never in `NEXT_PUBLIC_*` or git.

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
- **Proxied media (music preview, video watch, downloads):** all media is served **through the
  app** from MinIO (`/api/music/*`, `/api/renders/*/watch|download`,
  `/api/projects/*/assets/*`) so MinIO stays off the public internet, via `storage.serveObject()`.
  (`/api/media/*` was removed with the Media Library, 2026-09-22.)
- **S3 socket pool:** the AWS SDK default keep-alive pool is 50 sockets; bursty MinIO traffic queued
  past it (`socket usage at capacity=50`). Both the app (`src/lib/storage.ts`) and the render worker
  (`worker/render-worker.mjs`) use an explicit `NodeHttpHandler` with `maxSockets` from
  **`S3_MAX_SOCKETS`** (default **256**). Raise the env var on either process if the warning returns.
  **The Content-Length gotcha:** a streamed web `ReadableStream` body **without** a `Content-Length`
  hangs on Next 16 (response never flushes; `curl` gets code 000). The earlier fix "solved" this by
  buffering the whole object — which then let one large download (an 8 GB `.insv`, a big render, or
  any `Range: bytes=0-`) pull **multi-GB into the app** (observed ~**21 GB RSS**, event loop pegged,
  every route — even static `/` — timing out = full outage). **Current design (2026-09-21):**
  `serveObject()` HEADs for size, **buffers only responses ≤16 MB** (fast, hang-free) and **streams
  larger ones straight from the ranged S3 body WITH an explicit `Content-Length`** — that header is
  what makes Next flush the stream. Verified on prod: a 147 MB render streams with TTFB 0.33s and
  ~38 MB RSS growth; **8 concurrent** 147 MB downloads peaked at **+13 MB** RSS (buffered would be
  ~1.2 GB). Rule: keep the `Content-Length` on any streamed body, and never buffer an unbounded
  object. `Accept-Ranges` + 206 give `<audio>`/`<video>` seeking; 416 on a bad range.
- **DB migrations:** `drizzle-kit` does **not** auto-load `.env.local`, so it silently falls back to `postgres://localhost:5432/clipwaltz` and hangs/exit-1 if run bare. Always run **`node --env-file=.env.local ./node_modules/drizzle-kit/bin.cjs migrate`** (never pipe to `tail` — it SIGPIPEs mid-apply). Locally the dev DB (`clipwaltz_dev`) needs the linuxg1 SSH tunnel up.

## Workspaces, roles & invites (ADR-0004 / ADR-0006)
- **Model:** `workspaces` → `workspace_members` (role owner|admin|editor|viewer) → `projects.workspace_id`.
  Pending invites in `workspace_invites` (migration **0029**): `token_hash` = SHA-256 of the emailed
  token (the raw token is never stored), `expires_at` (+7 days), `accepted_at`/`accepted_by`, `revoked_at`.
- **Authorization rule:** a project **with** a `workspace_id` is authorized only by the caller's
  membership role there; the creator (`projects.owner_id`) gets no extra rights. Only projects with a
  **NULL** `workspace_id` fall back to the creator. ⇒ Every project's creator must be a member of its
  workspace, or they lose access. Integrity check (should return 0):
  `select count(*) from projects p where p.workspace_id is not null and not exists (select 1 from
  workspace_members m where m.workspace_id=p.workspace_id and m.user_id=p.owner_id);`
- **Invite email** goes through SES (`sendEmail`); link base = `NEXT_PUBLIC_APP_URL` (must be
  `https://www.clipwaltz.com` in prod). With SES unset (dev) the email + link are logged to the console.
  The SES account (us-east-1) has **production access** — verified 2026-09-24 by a probe send to an
  unverified recipient (accepted `250 Ok`; sandbox would reject with 554). The inviter can also copy
  the link from the Workspace page right after sending.
- **Support tasks:** revoke an invite → Workspace page (or set `revoked_at`); a user locked out of a
  shared workspace → check their `workspace_members` row; the owner row (`role='owner'`) must never be
  deleted or changed.
- **Code:** `src/lib/workspace.ts` (role helpers), `src/lib/workspace-actions.ts` (member management,
  returns `{ ok, error }`), `/account/workspace`, `/invite/[token]`.

## AI models & routing (ADR-0009)

**Where:** `/admin/ai` (admins only — `ADMIN_EMAILS`), linked from `/admin` as **🤖 AI models**.

- **Models** (`model_registry`) and **Workflows** (`workflow_registry`) have on/off switches. A
  workflow is usable only if it AND its model are enabled. Changes apply to the next job; running
  jobs finish on what they started with.
- **Routing rules** (`routing_rules`): for each task (text→video, image→video) and quality
  (preview / standard / high) the **lowest-priority usable rule** wins; the rest are fallbacks.
  `steps` = sampler steps sent to ComfyUI (blank = the workflow's default of 20). Defaults seeded by
  migration 0030: Preview 10, Standard 20, High 30 (measured on a 3080: 33 s / 44 s / 63 s for a
  2 s 704×480 clip, model already loaded). A rule must point at a workflow of the same task (the
  engine also enforces this).
- **What users see:** qualities / Enhance engines with no usable route are greyed out
  ("Temporarily unavailable"); a direct attempt gets a friendly error. With every rule for a task
  and quality disabled the admin page shows **"no usable rule — unavailable to users"**.
- **Enhancement workflows** are chosen by task (`upscale` / `interpolate` / `restore`) — the first
  enabled one with an enabled model. The resolved ids are stored on the job (`request_json.workflows`).
- **Code:** `src/lib/ai/routing.ts` (engine), `src/lib/ai-admin-actions.ts` (admin actions),
  `src/components/admin-ai.tsx`. Adding a new workflow: deploy its template/map to the AISERVER, add
  it to the wrapper's `WORKFLOWS`, insert a `workflow_registry` row whose `id` = wrapper id
  (`<workflow_id>-<version>`) with the right `task`, then point a routing rule at it.
- **Failure messages:** the worker stores the raw error; users see a mapped friendly message
  (`src/lib/ai/errors.ts`) with a **Retry** button (`retryGenerationJob`); the raw text is the
  tooltip. Retry re-routes (and re-checks enhancement workflows), so a job whose workflow was
  disabled retries on the current rule. **Job states:** the queue auto-retries once — after the
  first failure a job shows `queued` again (error kept); only the last failure sets `failed`. A
  retry atomically marks the old job `retried` (so it can't be retried twice) and creates a new job.

## Operations page (`/admin/ops`)
Live BullMQ queue depths (generation / enhance / export; "-1" = Redis unreachable), AISERVER status per GPU,
music-video render queue, the latest 60 AI jobs with wait/run time and errors (raw error on hover), and
7/30-day usage (generations, enhancements, exports, renders + CPU-minutes, sign-ups, daily active users).
Refreshes every 10 s. Code: `src/lib/ops-admin-actions.ts`, `src/components/admin-ops.tsx`.

## Free-plan retention (7-day uploads)
- `src/lib/retention.ts`, run by `POST /api/internal/retention` (header `x-worker-secret` =
  `WORKER_CALLBACK_SECRET`), triggered every 6 h by the generation worker on linuxg1 (`APP_INTERNAL_URL`,
  default `http://127.0.0.1:3100`). Result logged as `[retention] {...}` in both pm2 logs.
- **Deletes only with `RETENTION_ENABLED=1`** in the app env; otherwise (or `?dryRun=1`) it reports what it would
  do. Rules: project owner's effective tier must be Free; upload older than 7 days; a notice email to the owner
  succeeded ≥ 20 h earlier (`assets.retention_notice_at`; a failed send is not recorded, so nothing is deleted).
  Objects still referenced by another clip are kept. Projects, generation versions, exports and renders are never
  touched. Dry run by hand: `curl -s -X POST -H "x-worker-secret: $WORKER_CALLBACK_SECRET" "http://127.0.0.1:3100/api/internal/retention?dryRun=1"`.

## Google Drive backup
Timeline button → `backupToDrive` (editor) → background, sequential, resumable 16 MB-chunk uploads
(`uploadToDriveResumable`) into the user's "ClipWaltz" folder; `media.drive_file_id` marks done. Runs inside the app
process — a restart mid-upload just leaves that file un-marked (press the button again). OAuth returns to the
`returnTo` path (same-site paths only), default `/projects`.

## Generation worker settings
`GEN_CONCURRENCY` (default 2 = one per AISERVER GPU, ADR-0008). Paid accounts' jobs get BullMQ priority 1, free 5
(`generation_jobs.priority` 10 / 0). Only the last BullMQ attempt marks a job `failed`.

## Storage edge for direct downloads/uploads (ADR-0003) — owner setup, then code

Status: **LIVE (2026-09-25).** `media.clipwaltz.com` → linuxg1 tunnel → `192.168.166.169:9000`.

**How it works:** every media route still authorizes in the app (`serveObject` callers: render
watch/download, generation watch, export download, asset, music), then answers **302 → a presigned
GET** on the media host (1 h). Uploads: `GET /api/projects/:id/assets/:assetId/part?uploadId&partNumber`
(editor + asset must still be `uploading`) returns a presigned UploadPart URL (15 min); the browser
PUTs the 8 MB part there and reads the `ETag`. **Any** direct failure falls back per part to the
proxied `PUT …/part`, so uploads never get worse than before. Kill switch: `MEDIA_DIRECT=0` (or unset
`S3_PUBLIC_ENDPOINT`) in `.env.local` + `pm2 restart clipwaltz` → everything is proxied again.

**Verified 2026-09-25:** bucket + objects anonymous 403; tampered signature 403; GET 200 / Range 206 /
forced-download filename; 8 MB part PUT + complete; real browser on `www.clipwaltz.com`: direct PUT
200 with readable ETag, cross-origin Range GET 206. Cloudflare **cached** media by default
(`.mp4` HIT) — the signed GET now sets `response-cache-control=private, max-age=3600`, which
Cloudflare honours (`cf-cache-status: BYPASS`), so expired URLs can't be served from edge cache.

**CORS lock (2026-09-25):** MinIO's own CORS is its global default (reflects any origin; shared with
other linuxg7 apps), so the lock lives at Cloudflare: **Rules → Transform Rules → Modify Response
Header**, rule "media CORS lock to www", `http.host eq "media.clipwaltz.com"` → **Set static**
`Access-Control-Allow-Origin: https://www.clipwaltz.com`. Verified: every response (GET, 403, OPTIONS
preflight, any Origin) carries exactly one ACAO = www; a browser on `example.com` is blocked
("Failed to fetch") while `www.clipwaltz.com` direct PUT + Range GET still work. If the app ever
serves from another origin, update this rule. The zone's Browser Cache TTL raises browser
`max-age` to 14400.

Setup (done — kept for rebuilds):

1. **Cloudflare dashboard → Zero Trust → Networks → Tunnels** → the **linuxg1** tunnel (ID starts
   `772914b5`, the one already serving `www.clipwaltz.com`) → **Public Hostnames → Add**:
   subdomain `media`, domain `clipwaltz.com`, path empty, service **HTTP**, URL
   **`192.168.166.169:9000`** (MinIO **API** port — never `:9001`, the console). The dashboard creates
   the DNS record.
2. **Do NOT put a Cloudflare Access policy on it** — end users' browsers must fetch it without a
   login; access is controlled by the short-lived signature on each URL.
3. **Rules → Cache Rules:** hostname `media.clipwaltz.com` → **Bypass cache** (presigned URLs are
   per-user and short-lived).
4. Tell the developer the hostname. Code side (not yet done): presign with endpoint
   `https://media.clipwaltz.com` (SigV4 signs the Host header — cloudflared forwards it unchanged),
   MinIO CORS limited to `https://www.clipwaltz.com`, confirm the bucket is not anonymously
   listable (`curl https://media.clipwaltz.com/clipwaltz` must be 403), TTL ≤ 1 h, and
   **multipart uploads with parts < 100 MB** — Cloudflare Free/Pro rejects request bodies over
   100 MB (HTTP 413).

## Monthly Theme Challenge (contests)
Admin-run community contest; likes on entered public renders are votes.
- **Start:** `/admin` → *Monthly Theme Challenge* → enter a theme (+ optional description) → **Start challenge**. Only **one active** contest at a time; the community banner appears automatically.
- **Entries:** creators enter one of their **Public** renders from the editor's render panel ("Enter this challenge"). Non-public renders can't enter until shared Public.
- **Close & crown:** `/admin` → **Close & crown winner**. The likes-leader is auto-granted **Pro for 30 days** (comp via `applyGrant`, same system as manual grants — visible in the Users table) and emailed. Closing with zero entries just closes it. Then start the next month's theme.
- **Data:** `contests` + `contest_entries` (migration 0006). Winner is stored on the contest row (`winner_render_id`/`winner_user_id`). No cron — closing is manual by design.

## Announcements & promos (admin content area)
In-app marketing surface. `/admin` → **Announcements & promos** → **New announcement**.
- **Fields:** title (required), body, image URL, CTA label + URL, **placement**
  (`dashboard_banner` | `dashboard_card` | `community`), **audience** (`all` | `free` | `paid`),
  **accent** (violet/blue/magenta/coral), and optional **starts/ends** scheduling window.
- **Targeting:** `free` shows only to free-tier users (upsell), `paid` to any subscriber, `all` to
  everyone. Filtering is by effective tier (`lib/tier.getEffectiveTier`).
- **Lifecycle:** rows are **Live/Paused** (eye toggle) and deletable. Viewers can dismiss a card
  (stored in their browser `localStorage`, key `cw-dismissed-announcements`).
- **Rendered by:** dashboard banner + cards (`AnnouncementsView`). CTA URLs may be internal
  (`/account/billing`) or external (`https://…`).
- **Data:** `announcements` table (migration 0017). `lib/announcements.ts` (reads),
  `lib/announcement-actions.ts` (admin CRUD, `requireAdmin`-gated).

## Presets (Format + Style + overlays)
- **User presets:** saved from the editor "Presets" bar (**Save as preset**) — a snapshot of the
  project's aspect, length/max-footage, style filter, lighting, transition, effects toggles, and
  overlays. Apply to any project from the same bar.
- **Default preset:** one user preset can be flagged default (`presets.isDefault`) and is
  auto-applied to every newly-created project (`createProject`).
- **Global/featured presets:** admin-published, visible to all users (`presets.isGlobal`,
  `ownerId` null). Server actions `publishGlobalPreset` / `deleteGlobalPreset` (`requireAdmin`).
  Built-in starters (TikTok Punchy / Cinematic / Vlog) live in code (`lib/presets.ts`).
- **Data:** `presets` table (migration 0017).

## Max footage / longest video
`projects.maxFootage` (migration 0017). When true the worker treats length as 0 → `buildTimeline`
lays every clip at its full length (videos) or a slot (images) end-to-end, **no repeats**, bounded
by `MAX_FOOTAGE_CEIL` (600s / 10 min). Mutually exclusive with `loopToFill`. Editor shows a live
projected-length estimate (mirrors the same PER_IMAGE=2 / PER_VIDEO fallback the worker uses).

## Render checkpoint & settings snapshot
- **Checkpoint:** the client calls `getRenderCheckpoint(projectId)` (`lib/render-actions.ts`) on
  Render/Re-render — it reads the **live** project row (so the shown settings equal what will
  render), computes a projected length, tiered warnings, and a diff vs the previous render, then
  the modal (`components/render-checkpoint-modal.tsx`) confirms before `createRender`. Per-user
  opt-out via `localStorage` key `cw-skip-render-checkpoint` (ignored when a warning is present).
- **Snapshot:** `createRender` writes the effective settings to `renders.settings` (jsonb,
  migration 0018) for audit and the "what changed" diff. The worker still reads the live project
  row (identical to the snapshot at create time), so no worker change was needed.
- **Re-render note (investigated):** re-render uses current saved settings (worker
  `select * from projects`); a traced same-project re-render applied the changed filter correctly.
  The only residual risk was a client race (async setting writes vs an immediate render click),
  which the checkpoint's fresh read removes.

## Title follows the Style Title
`setProjectStyle` — when `titleText` is set and the project name is still an auto default
(`DEFAULT_TITLES`: "Untitled project"/"Trip video"/"Event video"), the project `title` follows the
caption. An explicit `renameProject` makes the title non-default, which stops the auto-follow.

## Render worker
`worker/render-worker.mjs` claims queued rows from `renders` (FOR UPDATE SKIP LOCKED), pulls the
project's clips from MinIO, FFmpeg-assembles a 1080p 9:16 video (photos 2s, videos ≤4s, optional
music from `music_tracks`, optional watermark), uploads to `renders/<projectId>/<renderId>.mp4`,
and marks the row `done` (+ project `ready`). Reuses the app's `postgres` + S3 deps.

**Beta instrumentation (2026-09-25):** `analytics_events` (name, user_id, project_id, props jsonb,
created_at) is append-only; `track()` in `src/lib/analytics.ts` never throws. Server events:
`upload_completed` (upload routes), `render_requested`, `render_downloaded` / `export_downloaded`
(one per download — ranged continuations skipped; `bytes` from a HEAD), `plan_changed`
(Stripe webhook + admin grants: `from`, `to`, `source`), `storage_snapshot` (once per UTC day from
the 6-hourly retention tick: bytes/objects per top-level bucket prefix). Browser events via
`trackClientEvent` (allow-list): `upload_started`, `upload_failed`, `upload_resumed`,
`draft_preview_shown` (first per project; seconds since creation / first upload). Renders record
`started_at`, and failures record `cpu_seconds` + `error_message`. `cpu_seconds` is worker
**wall-clock**, not CPU time. Metrics: `src/lib/beta-metrics.ts` → /admin/ops "Beta metrics".
Feedback: `feedback` table, `src/lib/feedback-actions.ts`, inbox on /admin.

**Watermark — every video (2026-09-25):** the ClipWaltz logo goes bottom-left (15.4% of the short
side, 3% padding, 90% opacity) on music-video renders AND every AI output: generations,
enhancements, storyboards (montage) and exports. **Free is always watermarked; paid plans are
watermarked while `/admin → Watermark → "Watermark paid plans"` is on (default on).** The switch
lives in `app_settings.watermark_paid_plans` (migration 0034; 30 s cache in `src/lib/watermark.ts`,
the single rule `shouldWatermark(userId)`). Auto-Batch renders (created by the render worker itself) apply the same rule via `batchWatermark()` in `worker/render-worker.mjs`. The app decides **when the job is created**
(`renders.watermark`, `generation_jobs.request_json.watermark`, `export_jobs.watermark`), so the
switch affects new videos only. AI versions that get the logo keep the unwatermarked master at
`generations/…/<n>.clean.mp4` (`generation_versions.clean_key`); Enhance, Assemble and Export
always read `clean_key ?? output_key` and add the logo once at the end — never stacked, never
upscaled. Deleting a version deletes both objects. The generation worker (linuxg1,
`pm2 clipwaltz-gen-worker`) reads the logo from `worker/WaterMark.png` next to it and **fails the
job** if it is missing (it never silently ships an unwatermarked video).

**How the logo is drawn (both workers):** inside the ffmpeg filter graph —
`movie='<WaterMark.png>',scale,…,loop=loop=-1:size=1,setpts=N/30/TB` → `overlay=…:shortest=1`.
Do NOT feed the PNG as an ffmpeg input: on ffmpeg 7.1 (AI box) a single-frame PNG input dropped the
logo after ~1.5–2 s, and `-loop 1` dropped frames at random (found 2026-09-25; free-tier music
videos rendered before then only carry the logo at the start). Check every frame, not one: crop the
logo's text strip and count frames with `signalstats` YMAX < 200 (see the 2026-09-25 handoff).

**Keep video and audio in separate `-filter_complex` graphs (render worker final pass).** On
ffmpeg 7.1 one graph holding both the concat video and the music (even just `null` + `volume`)
dropped 10–16 frames at random segment joins — 10 s renders came out at 282–290 of 300 frames with
brief freezes. Two graphs give 300/300 (fixed 2026-09-25). Check: `ffprobe -select_streams v:0
-show_entries stream=nb_frames out.mp4` should equal `secs × 30`.

**Render worker logo file:** `worker/WaterMark.png` (transparent PNG, a copy of `public/WaterMark.png`)
is overlaid bottom-left. **Deploy it with the worker** — scp it next to `render-worker.mjs`
(`/home/lacy/clipwaltz/worker/` on the AI box, owned by `lacy`); override with `WATERMARK_PATH`.
If the file is missing the worker logs a warning and renders without a watermark. To change the
logo, replace both PNGs and redeploy the worker. Check: `node --env-file=.env.worker
worker/render-worker.mjs --wmtest <projectId> [secs]` (read-only; writes an MP4 to /tmp).

Run (from project root):
```bash
node --env-file=.env.local worker/render-worker.mjs --once   # one job, then exit
node --env-file=.env.local worker/render-worker.mjs          # loop (polls every 5s)
```
It needs `DATABASE_URL` reachable and the `S3_*` env. Verified end-to-end from the dev workstation
(FFmpeg local + Postgres via the SSH tunnel + MinIO on the LAN).

**Crossfade is OOM-safe (chunked).** A single `xfade` filtergraph over *all* segments makes ffmpeg
buffer decoded frames for every not-yet-reached input (offsets stagger to the full runtime) — a
78-clip/10-min render peaked at **78 GB** and was OOM-killed. `crossfadeChunks()` now xfades in
bounded chunks of **`XFADE_CHUNK`** segments (default 10; env-tunable) and hard-concats the chunks,
so ffmpeg sees ≤`XFADE_CHUNK` inputs at once. Every within-chunk transition still crossfades; only
the few chunk seams are hard cuts. Verify with `node worker/render-worker.mjs --xfadetest [N] [K]`
(builds N synthetic segments, prints chunk count + duration; no DB). Lower `XFADE_CHUNK` on a
smaller box, raise it for more crossfade coverage.

**Crash recovery (orphan reaper).** A hard crash (OOM/SIGKILL/deploy restart) skips the `tick()`
catch that marks a render `failed`, and `claimOne()` only picks up `queued`, so a crashed render
was stuck in `rendering` forever (eternal spinner, no retry). On **loop startup** the worker now
runs `reapStaleRenders()`: since it's the only writer of `rendering`, any such row at boot is an
orphan from a prior run → marked `failed` (+ project `failed`) so the UI shows "try again". Not run
in `--once` (a manual one-shot must not nuke a render the live service is mid-way through). A
multi-worker deployment would need a per-render heartbeat/lease instead.

**Prod deployment (pending owner approval):** run it as a systemd service on the **AI box**
(32-core, FFmpeg, reaches MinIO directly). The AI box currently **cannot** reach linuxg1's
`localhost`-only Postgres — deploying requires **authorizing the AI box's SSH key on linuxg1** so it
can hold an SSH tunnel to `:5432` (a security change on a production host — get explicit sign-off
first). Then: copy `worker/`, `npm i postgres @aws-sdk/client-s3`, set env, and run under systemd.
*(v1.1: move the queue to Redis/BullMQ; beat-synced cuts; SES "video ready" email.)*
- **Cost instrumentation:** record `cpuSeconds`/`costCents` on each `renders` row → cost-per-render.

## Render-complete notifications (Web Push)
Two per-browser toggles at `/account/notifications`:
- **Browser notification** — the open tab fires it from the render poll (`render-panel.tsx` →
  `notifyRenderDone`). Pure client; preference in `localStorage` (`cw-notify-intab`). No server state.
- **Windows notification (OS push)** — Web Push. Enabling subscribes the browser via
  `public/sw.js`; the subscription is stored in `push_subscriptions` (one row per browser/device).
  On completion the worker's `/api/internal/render-ready` callback calls `sendPushToUser`
  (`src/lib/push.ts`), which pushes to every subscription and prunes dead endpoints (404/410).

**Setup:** set the four VAPID env vars on the **app** (linuxg1 `.env.local`) — see Environment
variables. The worker needs nothing new. **De-dupe:** the service worker suppresses its OS toast
when a ClipWaltz tab is focused (the in-tab notification covers that case).

**Troubleshooting:**
- *"Windows notification" toggle disabled / "not configured on the server":* VAPID env not set (or
  `NEXT_PUBLIC_VAPID_PUBLIC_KEY` ≠ `VAPID_PUBLIC_KEY`). Set them and rebuild (the public key is
  inlined at build time).
- *Toggle won't turn on:* the browser blocked notifications for the site — the user must re-allow
  in site settings. `Notification.permission === "denied"` can't be re-prompted programmatically.
- *No OS toast when tab open:* by design (de-dupe) — only fires when no ClipWaltz tab is focused.
- *Subscriptions not sending:* check `push_subscriptions` has rows for the user; server logs
  `[push] send failed (<code>)`. 404/410 rows self-prune; a 403 means a VAPID key mismatch (the
  keys the subscription was created with differ from the server's — re-subscribe after a key change).

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
| `node --env-file=.env.worker scripts/storage-orphans.mjs [--project <id>] [--verbose] [--apply]` | Find/delete MinIO objects + media rows of deleted projects (dry run unless `--apply`) |

## Build note
`next build` needs `BETTER_AUTH_SECRET` and `DATABASE_URL` present in the environment
(Postgres connects lazily, so a live DB is not required to build).

## Server action errors — return them, don't throw (rule, 2026-09-29)
In a **production** build React replaces every error *thrown* from a Server Action with a generic
"Minified React error #441 … message omitted in production builds" — the user never sees
`throw new Error("Project not found")`. Dev mode shows the real message, so this only bites on
www.clipwaltz.com. Verified 2026-09-29 against a local `next build` + `next start`.

**Rule:** every server action a client component calls must **return** `ActionResult<T>`
(`src/lib/action-result.ts`) instead of throwing:

- Server: keep the logic in a private `fooImpl()` that throws friendly messages as before, and export
  `export async function foo(...args: Parameters<typeof fooImpl>) { return toResult(() => fooImpl(...args)); }`.
  Other server code in the same file calls `fooImpl` directly.
- `toResult` passes hand-written messages through (max 400 chars), replaces internal DB/network errors
  with "Something went wrong — please try again." (and logs them), and re-throws Next's
  `redirect()`/`notFound()` via `unstable_rethrow`.
- Client: `unwrap(await foo(...))` (or `foo(...).then(unwrap)`) — it throws the message locally, so the
  usual `try/catch` + `toast.error((e as Error).message)` code keeps working. Server components calling
  a converted action also `unwrap`.
- Converted: every client-called action in `src/lib/*-actions.ts`. `workspace-actions.ts` already returns
  `{ ok:false, error }` via its own `ActionError`/`run`. Deliberately left throwing: server-only getters
  (admin/feedback/ai-admin lists, `listAiTemplates`, `getBrandKit`), `trackClientEvent` (fire-and-forget),
  `getMyCredits`, the ops-admin getters, and actions with no caller.
- **New action?** Add it to the wrapper block at the bottom of its file and `unwrap` it in the client.
  A void action called without `unwrap` fails *silently* (tsc won't catch that), so check every call site.

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

## Project delete & orphaned storage
- `deleteProject` (`src/lib/project-actions.ts`) → `collectProjectStorage` before the row delete, then
  `purgeProjectStorage` via Next `after()` (`src/lib/project-storage.ts`). Each purge logs one line in the app's
  pm2 log: `[project-purge] {"projectId":…,"mediaDeleted":…,"mediaKept":…,"objectsDeleted":…,"objectsKeptShared":…,"objectsFailed":…}`;
  per-object failures log `[project-purge] <id>: delete <key> failed: …`. A failed purge leaves orphans for the script below.
- Keep rule: an object is deleted only if **no row** in assets, media, renders, generation_versions, export_jobs,
  music_tracks or templates still references it. Library `media` rows go only when no remaining clip uses them.
- **Orphan finder** (for projects deleted before 2026-09-27, crashed purges, or a worker finishing a job
  into a just-deleted project). Run on the AI box, which has the DB + MinIO env:
  `cd ~/clipwaltz && sudo -u lacy node --env-file=.env.worker scripts/storage-orphans.mjs` — **dry run**: counts
  per prefix, orphan media rows, kept (still referenced) and to-delete totals. `--verbose` lists keys,
  `--project <id>` limits to one id, **`--apply`** deletes (media rows first, then objects). A bucket-wide `--apply` refuses unless the database name equals the bucket name (prod: both `clipwaltz`; `--force` overrides). Never run it with a
  `DATABASE_URL` other than prod's against the shared `clipwaltz` bucket: with the dev DB every prod project looks
  deleted (the dry run would report the whole bucket; `--apply` would delete it).

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

**AI box services (systemd, user `lacy`):** `clipwaltz-db-tunnel` (`ssh -N -L 55432:127.0.0.1:5432 lacy@linuxg1`) and
`clipwaltz-worker` (`After=`/`Requires=` the tunnel, so restarting the tunnel restarts the worker — only when idle).
Drop-in `/etc/systemd/system/clipwaltz-db-tunnel.service.d/ready.conf` (2026-09-28): `ExecStartPost` waits until
:55432 is listening (≤30 s, else the start fails and `Restart=always` retries), because `ssh` reports started before
the forward is up — after the 2026-09-28 reboot the worker logged `ECONNREFUSED 127.0.0.1:55432` for ~5 s and its
startup reapers ran against no DB. Verified: tunnel "Started" 0.56 s after start, worker after it, no errors.

**Waltz AI Remix (generation worker, 2026-09-27):** `createRemix` (src/lib/remix-actions.ts) resolves
the source (render `output_key` + its `musicTrackId` → `music_tracks.storage_key`, or a version's
`clean_key ?? output_key`), validates the recipe (≤3 non-overlapping moments; clip lengths 3/5/8 s
within the routed i2v workflow's range) and inserts a `remix` job on the **enhance queue**. Worker
`processRemix`: seed frames (0.6 s / end−0.8 s inside render fades) → `aiClipFromImage` ×N, two lanes
(one per ComfyUI) → `musicOffsetOf` (onset-curve cross-correlation, needs peak ≥0.5 and margin ≥0.1,
else AI parts are silent; logged as `[remix] … music offset`) → **compose** (`worker/remix-compose.mjs`,
below) → store (clean master + branded copy; for watermarked renders the logo is added only on the AI
ranges). Version `settings.remix=true` records source, recipe and `musicOffset`. Cost: one i2v clip per
part (preview ~1.5 min, standard ~3, high ~4.5 each at 1280×720), two in parallel.

**Remix compose — splice, not a full re-encode (2026-09-27, `98dcfc7`).** Renders are closed-GOP x264, so
`composeRemix` re-encodes only what changes and stream-copies the rest: the lead-in, the extension, each
moment widened to its surrounding keyframes, and the partial GOP at the trimmed head/tail (render fades)
are encoded with the source's own x264 settings (`veryfast`, the `crf` from the source's x264 SEI) and
colour tags, so their SPS/PPS are byte-identical; untouched whole GOPs are cut by the segment muxer at
keyframes (frame-exact; the concat demuxer's `inpoint`/`outpoint` is **not** — it cuts by DTS and added
2 frames per join) and everything is joined with the concat demuxer. The audio (same design: lead-in
plays the song from before the first real frame, silence-padded; the extension continues it, wrapping
for looped songs; the base keeps the source audio) is one separate AAC pass, muxed in. All ffmpeg runs
at `nice 15`, 3 threads. Log line: `[remix] <id> composed (splice: N frames encoded, M copied) in Xs`.
- **Guards → automatic fallback to the old full re-encode** (logged `[remix] splice not possible (…) — full
  re-encode`): source not h264/x264, open GOPs, not constant frame rate; a re-encoded piece's SPS/PPS
  differs from the source's; any piece's frame count is off; the joined output's timestamps are not evenly
  spaced. A branded copy of a *clean* source (a Waltz AI clip with the logo wanted) needs the logo on every
  frame, so it always takes the full path — those sources are short.
- **Measured** (lead-in 5 s + 2 moments + extend 5 s, clean + branded, linuxg1): 536 s 1080p render
  **118 s wall / ~330 CPU-s** (full re-encode: ~30 min at load ~17); 28.8 s render **36 s** (full: 80 s).
  Cost now scales with the number of AI parts (~250–400 frames per moment, 150 per 5 s lead/extension),
  not the video length. Load avg during compose ~4–6 (nice'd; the site stays responsive).
  **Prod E2E (same recipes as the earlier runs, real AI parts):** Lake Day v2 v6 (536 s; lead 5 + moment 3 +
  extend 3) job **2,265 s → 558 s**, compose 90 s (653 frames encoded, 15,641 copied), load avg 3.9 / max 5.5
  while composing; Lake Havasu Race Finals v1 (28.8 s) job 476 s → 428 s, compose 34 s, load avg 1.9.
- Verified: every copied frame decodes bit-identical to the source at the right position; re-encoded spans
  ~44 dB vs the source (~20 dB if shifted one frame); moments start on the exact frame; audio lag 0
  samples at several points; zero decoder errors; full-range (pc) and limited-range (tv) sources.
- Gotchas found building it: AI clips must be converted to the source's range and tagged with its colour
  params (`setparams`) or the VUI differs; the logo overlay re-tags frames `colorspace=gbr` (re-tag after
  it); `setpts=N/F/TB` truncates in float (122.999 → 122, a duplicated timestamp) — use `settb` +
  `setpts=N`; ffmpeg 7.1 needs `-fps_mode passthrough` and an explicit `fps=` or it drops a frame / signals
  level 6.2.
- Env: `REMIX_SPLICE=0` forces the full re-encode; `REMIX_THREADS` (default 3); `REMIX_DEBUG=1` logs each
  ffmpeg step; `REMIX_KEEP=1` keeps the splice work dir.
- Self-test (no DB/AI; synthetic AI parts): `node worker/remix-compose.mjs --selftest <src.mp4> [--moments
  120,300] [--music song.mp3 --off 0] [--wm --src-wm] [--full]` → prints mode, frames encoded/copied, seconds.
- **Seed-frame logo erase (2026-09-27):** when the source is watermarked (`source.watermarked`, set for renders
  made with the logo), `processRemix` runs `delogo` over the logo box (`wmBox()` in `worker/watermark.mjs`: the
  same 15.4 %/3 % geometry, grown 6 px) before scaling each seed frame. Without it the i2v model redraws the
  burned-in logo and a warped ghost (fringe, dark box, smear) shows around the fresh logo and in the clean
  master. Verified on prod (copies of the 30 s and 536 s test remixes): clean master AI frames carry no logo,
  branded AI frames one crisp logo.
- **Remix of a remix / of an enhanced remix (2026-09-27, `5531e56`):** such a version's "clean" master still
  holds the original render's burned-in logo. `createRemix` follows the version's lineage
  (`burnedInLogo()` in `src/lib/burned-logo.ts`: `settings.remix` + `settings.source`, `settings.enhancedFrom`)
  back to the render; when that render was watermarked it uses the version's **branded** copy and sets
  `source.watermarked=true`, so the seed logo is erased and the logo is added only on the new AI parts
  (before: seeded from logo frames → ghost, and the logo went on every frame again → doubled). Verified on
  prod (job 1f993158, remix of the 30 s remix v6): 697 frames bit-identical to the branded source, one logo
  on every sampled frame, new AI parts logo-free in the clean master, 0 decode errors.
- Why not move compose to the AI box: measured there, the splice takes 14–18 s but the full re-encode still
  burns ~2,000 CPU-s (80 s on 25 cores) and would need a new claim queue plus 2× the file transfers; with the
  splice, linuxg1's share is ~2 min of low-priority work, so the move is not needed.

**Gyro horizon levelling (render worker, 2026-09-27):** `imuLevel()` runs `GYRO2BB_PATH`
(default `/opt/cw-tools/telemetry-parser-0.3.0/gyro2bb`, 180 s timeout) on the source (pairs: the `_00_`
file — the rear carries no IMU), streams the CSV into 100 Hz bins, fuses gyro + accelerometer
(`fuseUp`, τ = `IMU_TAU` 5 s, accel gated to ~1 g) and writes per-moment `v360@g` rotations at
`IMU_RATE` 15/s for `sendcmd` on the FINAL projection (never on a full-size intermediate sphere —
that made a 6 s window take >25 min). No IMU data → brightness `estimateLevel` fallback. Note shows
`gyro level (N pts …)` in the worker log. Check: `node --env-file=.env.worker worker/render-worker.mjs
--followtest <insv | front_00,rear_10> [flat|follow|tiny] [secs] [start]` (start = output-side seek;
`FOLLOWTEST_OUT` sets the output path). Missing binary = silent fallback, so keep gyro2bb installed.

**Render worker dependencies (AI box):** `/home/lacy/clipwaltz` on the AI box has its OWN minimal
`package.json` (`@aws-sdk/client-s3`, `postgres`, and since 2026-09-27 `@aws-sdk/s3-request-presigner`
for the clip-length backfill). Deploying a worker that imports a new package means `npm install` there
first — and **load-test before restarting**: `sudo -u lacy node --env-file=.env.worker
worker/render-worker.next.mjs --selftest` must print its usage line (an import error crash-loops the
service; that happened once on 2026-09-27 for ~2 min and was rolled back).
**Clip lengths:** `durTick()` (lowest priority in the worker loop) ffprobes videos with no
`assets.duration_sec` via a 10-min signed URL and writes assets + media; unreadable keys are logged once
("clip length … unreadable") and skipped until the next restart.

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

**Conversion crash recovery (360 queue).** Same failure for 360 reprojection: a crash mid-`convTick()`
left the `media` row (and its `assets` placements, which mirror `media.conversion_state` by
`media_id`) in `converting` forever — `claimConversion()` only takes `pending`, so the editor spinner
never stopped. On **loop startup** (after `reapStaleRenders()`, not in `--once`) the worker runs
`reapStaleConversions()`: every `converting` row is an orphan → put back to `pending` so it retries,
unless it has already crashed the worker **3 times** (`CONV_MAX_ATTEMPTS`) → `failed` (the editor
shows the failed badge; picking a 360 view again (`setClipReframe`) re-queues it). Both outcomes are mirrored
to `assets`. The counter is `media.conversion_attempts` (migration **0037**): +1 on each claim, reset
to 0 on any clean finish (ready, caught failure, or the give-up), so it only accumulates across
crashes. Logs: `[worker] re-queued N orphaned conversion(s) …` / `[worker] failed N conversion(s)
that crashed the worker 3× …`. The claim also sets the file's `assets` to `converting`.
Verified on prod 2026-09-28 with throwaway rows (attempt 1 → re-queued, re-claimed; attempt 3 →
failed; assets followed; rows deleted afterwards).

**Prod deployment (pending owner approval):** run it as a systemd service on the **AI box**
(32-core, FFmpeg, reaches MinIO directly). The AI box currently **cannot** reach linuxg1's
`localhost`-only Postgres — deploying requires **authorizing the AI box's SSH key on linuxg1** so it
can hold an SSH tunnel to `:5432` (a security change on a production host — get explicit sign-off
first). Then: copy `worker/`, `npm i postgres @aws-sdk/client-s3`, set env, and run under systemd.
*(v1.1: move the queue to Redis/BullMQ; beat-synced cuts; SES "video ready" email.)*
- **Cost instrumentation:** record `cpuSeconds`/`costCents` on each `renders` row → cost-per-render.

## Clip rotation (2026-09-28)
- **Why:** phone videos carry a rotation flag (MP4 display matrix). If recording starts with the phone pointing down,
  iOS can store the wrong one; every player (ffmpeg autorotate, browsers, QuickTime) then shows the clip sideways.
  Case: "Lake Day v2" IMG_1940 — `side_data displaymatrix rotation=-90` on upright 1280×960 pixels. The renderer was
  correct; check with `ffprobe -show_entries stream_side_data=rotation` and compare a `-noautorotate` frame.
- **Data:** `assets.rotation` integer, degrees clockwise (0/90/180/270), default 0 (migration `0036_clip_rotation`).
  Set by `setAssetRotation` (editor role). The worker reads it through `loadRenderInputs` (`select *`).
- **Render:** `vfRotate(a.rotation)` (`transpose=clock` / `hflip,vflip` / `transpose=cclock`) is prepended to each
  slot's filter chain in `assemble` — video (`vfStatic`), photo Ken Burns and still photo — after ffmpeg's autorotate.
- **Editor:** `src/lib/rotation.ts` — `rotationParent` (size container on the parent) + `rotatedFill` (element laid
  out with the parent's width/height swapped, then turned) so object-cover/contain keep filling the box. Rotated
  videos in the clip dialog and Clips lightbox play without native controls (they would turn too); tap to play/pause.
- **Not rotated:** Waltz AI image-to-video seeds read the raw asset (`generation-worker.mjs`), and AutoWaltz's
  motion/vision window ranking looks at unrotated frames (orientation doesn't change motion scores).

## WaltzDeck (Phase 1, 2026-09-29)
Spec `06_ClipWaltz_WaltzDeck_Feature_Spec.md`. Data: `projects.kind` (`autowaltz` | `deck`), `projects.deck` jsonb
(`{brief, plan}`), `projects.brand_kit_id`, `deck_scenes` (one row per storyboard card), `assets.note` /
`assets.ai_description`, `brand_kits.logo_key` (migration `0037_waltzdeck`).
- **Planning — generation worker (linuxg1):** queue `clipwaltz-deck` (`DECK_QUEUE`), consumed by
  `worker/deck/jobs.mjs` (started from `generation-worker.mjs`), concurrency 1. Jobs: `describe {assetId}` (3 frames of a
  video / 1 of a photo → vision description, cached on the asset; skipped when already described by the same model),
  `plan {projectId}` (describe missing → `planStoryboard` → replace unlocked scenes, locked ones keep their slot;
  progress in `projects.deck.plan`), `scene {sceneId, instruction}` (rewrite one scene's text). Editor polls
  `getDeck()` every 2.5 s while busy.
- **Models:** Ollama at `OLLAMA_URL` (the shared box `192.168.166.182`). `DECK_VISION_MODEL` / `DECK_TEXT_MODEL`
  default `qwen3-vl:30b` for both — the box evicts idle models, so a second model costs a 15–60 s reload per switch
  (measured). Do **not** pass Ollama `format=` with this model: replies come back empty (verified) — the planner asks
  for JSON in the prompt and extracts it (`extractJson`), one retry. Replies are **streamed**: Node's fetch drops a
  request whose headers take > 300 s, and a non-streamed Ollama call sends headers only when finished (a prod plan
  failed with "fetch failed" at exactly 5 min). Timeouts: plan 10 min, job lock 30 min. `DECK_DEBUG=1` logs the raw
  plan JSON. Measured on prod 2026-09-29: ~40–80 s per description while the box is shared (cached afterwards),
  planning 18 s – 4.8 min depending on what else is loaded; render of a 6-scene 15 s 1:1 ad: 17 s.
- **Guards (`repairPlan`):** unknown media dropped; durations clamped (1.2–8 s), videos ≤ their length, scaled to the
  target length (CTA card ≤ 3.5 s); reading speed ≤ 3 words/s; textMode off → no text except the CTA; ads with a CTA
  end on a CTA card containing the owner's exact words; every noted item placed; notes with first/last words reorder;
  any number not in the brief/offer/CTA/notes is removed (flag shown on the card).
- **Render — render worker (AI box):** `loadRenderInputs` returns `style.deck = {scenes, brand}` for `kind='deck'`
  (length = sum of scene durations, no title, no fade-in, original audio off). `deckTimeline` (scene windows: in-point
  or motion-only `rankWindows(..., {vision:false})`; beat snap ±0.35 s, ≥0.8 s) → `deckSegments` (full-bleed crop,
  rotation, Ken Burns for photos, text layer overlay `eof_action=repeat`; text-only cards = template background held
  with `tpad`) → the normal concat / music / look / watermark / overlays pipeline.
- **Text layer:** `worker/deck/text-layer.mjs` — `playwright-core` driving the system **Chromium**
  (`CHROMIUM_PATH`, default `/usr/bin/chromium`); 6 layouts; 21 entrance frames (0.7 s @30 fps) then ffmpeg holds the
  last; auto-fit runs again after `document.fonts.ready`; bottom text stays above the watermark box. Timing: ~0.4 s
  browser start, ~0.7–1.4 s per media scene, ~5.5 s per card scene (opaque frames). Self-check:
  `node worker/deck/text-layer.mjs <outDir> [W H]` renders every layout.
- **AI box packages (installed 2026-09-29, Debian):** `chromium`, `fonts-noto-core`, `fonts-noto-color-emoji`,
  `fonts-inter`, `fonts-lato`, `fonts-montserrat`, `fonts-open-sans`, `fonts-roboto`; `playwright-core@1.63.0` in
  `/home/lacy/clipwaltz/node_modules` (also in package.json). Brand fonts are limited to installed families
  (`src/lib/brand.ts`).
- **Brand kit:** `src/lib/brand-actions.ts` (one kit per workspace), logo in MinIO `brand/<workspaceId>/<kitId>-<ts>.<ext>`
  (≤1 MB, png/jpeg/webp/svg), served to the editor by `/api/projects/[id]/brand-logo`; the render worker embeds it
  as a data URL on title/CTA cards.
- **Claim guard:** `CLAIM_RULES` / `unverifiedClaim` in `planner.mjs` — claim classes with the owner words that must
  back them (word-start regex, so "eco" doesn't match "second"); applied to headline, sub, bullets and narration.
- **Clip moments:** `describeMedia` captions 4 frames (12/37/62/87 %) → `ai_description.moments [{t, caption}]`
  (`DESCRIBE_VERSION` 2 — older cached descriptions are redone); the plan's `moment` (or `bestMoment` keyword overlap)
  sets `deck_scenes.in_sec` = window start centred on it.
- **Known limits (phase 1):** the claim guard only strips numbers — a phrase like "Limited time offer" can slip in;
  video moments are picked by motion, not by the note (a "sunset" note got the busiest stretch of that clip);
  first-draft copy is decent, not great (per-scene rewrite + locks cover it).
- **Local dev:** planning needs Redis — tunnel `ssh -N -L 6380:127.0.0.1:6379 linuxg1`, set `DECK_QUEUE=clipwaltz-deck-dev`
  + `REDIS_URL=redis://127.0.0.1:6380` in `.env.local`, run `node --env-file=.env.local worker/deck/dev-worker.mjs`
  (refuses the prod queue name and any DB but `clipwaltz_dev`). Dev renders: a one-shot copy of the worker on the AI
  box with `DATABASE_URL` pointed at `clipwaltz_dev` and `--once`.
  Dev AI clips (Generate a shot / Film suggested shots): run `worker/generation-worker.mjs` locally with
  `--env-file=.env.local --env-file=.env.development.local`, `AISERVER_API_TOKEN` (from linuxg1, never echoed) and, on
  Windows, `WATERMARK_PATH=worker/WaterMark.png` — ffmpeg's `movie=` filter can't read a `G:\…` path (verified
  2026-10-05: "Failed to avformat_open_input 'G'"); a relative path works. Production (Linux) is unaffected.

## WaltzDeck voice & captions (Phase 2, 2026-09-29)
- **Voice service:** `clipwaltz-tts` systemd unit on the AI box (User=lacy), **127.0.0.1:8191** only — Kokoro-82M
  (`kokoro==0.9.4`, Apache-2.0 code + weights) in a Python 3.12 venv `/opt/clipwaltz-tts/venv` (kokoro needs <3.13; the
  box has 3.13, so `uv` from PyPI installed a standalone 3.12), CPU torch, `TTS_THREADS=8`, `HF_HOME=/opt/clipwaltz-tts/hf`.
  `POST /tts {text, voice, speed}` → base64 WAV + per-word `{w,s,e}`; `GET /voices`, `/health`. Source
  `worker/tts/server.py` (+ README); deploy = copy it to `/opt/clipwaltz-tts/` + `systemctl restart clipwaltz-tts`.
  Measured: ~6 s model load (once), ~0.23× real time (18 s of speech in 4.2 s). Licences checked (research 2026-09-29):
  XTTS-v2 and F5-TTS are non-commercial, Piper voices vary per voice, Chatterbox watermarks output — not used.
- **Data:** brief `voice {mode: off|auto|manual, voiceId, speed}` + `captions {enabled}` (jsonb), `deck_scenes.voice`
  (migration `0039_deck_voice`). Voices list in `src/lib/deck/types.ts` must match `server.py`; previews
  `public/voices/<id>.mp3` (public in `src/proxy.ts`).
- **Planner:** AI mode asks for a `voice` line per scene; if >50 % of lines repeat the on-screen text, `writeNarration`
  (one focused call) rewrites them. Scene floor = `speechSec(line)` (2.8 words/s ÷ speed + 0.4 s); CTA cap yields to it.
- **Render (`worker/deck/voice.mjs`):** `synthScenes` (TTS per scene; a failed call fails the render with "voiceover
  service unavailable — try again") → scene min = voice + 0.35 s → `buildNarration` (adelay per scene start + 0.12 s,
  amix, `loudnorm=I=-16:TP=-1.5:LRA=11`) → `buildCaptionsAss` (≤4 words per line or split at pauses >0.35 s, `\kf`
  per word incl. the gap, lines never overlap, font = brand heading font, Primary = brand colour (default #fde047),
  Alignment 8 top-centre, MarginV 10 % of height). The look pass adds `ass=filename=…` (libass, before the watermark).
  Audio: `[voice]asplit` → `[music]volume=0.55` → `sidechaincompress=threshold=0.03:ratio=10:attack=15:release=400` →
  `amix` with the voice. Crossfade is forced off under narration.
- **Tuning evidence:** at music 1.0× speech measured level with music (−19…−22.5 dB vs −20.8 dB music-only); after the
  change −17.7/−19.0 dB speech vs −26 dB music-only.

## WaltzDeck Phase 3 — presentations, exports, import (2026-09-29)
- **Data:** migration `0040_deck_exports` — `deck_exports` (id, project_id → projects cascade, format pdf|pptx,
  status queued|running|done|failed, watermark, output_key, error, attempts, requested_by, timestamps). Objects at
  `exports/<projectId>/deck-<exportId>.<fmt>` (swept by the project purge + `scripts/storage-orphans.mjs`). Import
  status lives in `projects.deck.import` (jsonb, polled by the editor); brief mode `presentation`; layout `slide`.
- **Exports** (`worker/deck/export.mjs`, run by the render worker on the AI box): `deckExportTick()` claims the oldest
  queued row (`for update skip locked`) between renders; a restart re-queues `running` rows, and fails them after 3
  attempts. Needs `/usr/bin/chromium` (or `CHROMIUM_PATH`), `playwright-core`, `pdf-lib`, `pptxgenjs` in
  `~/clipwaltz/node_modules` (all pinned in the box's `package.json` — an `npm install` there prunes anything
  unlisted; playwright-core was unlisted until 2026-09-29 and got pruned once, restored within minutes, no renders
  affected). Layout at 1280 px on the long side (= 13.33 in), stills at the video size, screenshots at 1.5×.
  Diagnostic (read-only, no upload): `node --env-file=.env.worker worker/render-worker.mjs --decktest <projectId>
  pdf|pptx [out] [--wm]`.
- **Download:** `GET /api/projects/[id]/deck-exports/[exportId]` (any project member; attachment name = title).
  Request: `requestDeckExport()` (editor; one queued/running per format, a >30 min stuck one doesn't block).
- **Import:** `POST /api/projects/[id]/deck-import` (multipart `file`, .pptx/.pdf, magic bytes checked, ≤ 50 MB —
  under `proxyClientMaxBodySize` 55mb) → `projects/<id>/imports/<uuid>.<ext>` → deck queue job `import`; URL via
  `importFromUrl()`. Worker (`worker/deck/jobs.mjs` `importDeck`, parsing in `worker/deck/importer.mjs`) runs on
  linuxg1 (generation worker): JSZip for PPTX, poppler `pdfinfo` + `pdftotext -bbox-layout` for PDF (installed on
  linuxg1; not on the AI box), `fetchPublic()` for pages — http(s) on 80/443 only, every redirect hop re-resolved and
  refused if any address is loopback/private/link-local/CGNAT/multicast/ULA, 12 s timeout, 2 MB page / 10 MB image
  cap. The source file is deleted after the import. Brief summary = one `chatJson` call (qwen3-vl, 8000 tokens — 3000
  ran out while it reasoned); on failure a plain fallback brief is used. Imported pictures get a `media` row + asset
  like an upload, then a vision description.
- **Diagnostics:** `node worker/deck/importer.mjs <file.pptx|file.pdf|url>` prints what an import would create.
- **Troubleshooting:** export stuck in *Making it…* → render worker log (`journalctl -u clipwaltz-worker | grep
  "deck export"`); import failed "isn't a public website" = SSRF guard (expected for LAN/localhost); PPTX fonts
  differ = the viewer lacks the brand font (bold/size/positions are in the file).

## WaltzDeck Phase 4 — campaign packs (2026-09-29)
- **Data:** migration `0041_deck_campaigns` — `deck_campaigns` (config jsonb: hooks, ctas, lengths, aspects, ctaUrl,
  aiHooks, aiCtas, watermark, winner; status drafting → draft → building → rendering; `shared`; `parent_id`),
  `variant_events` (render_id → renders cascade, campaign_id, type view|play|complete|click, visitor = salted SHA-256
  (`BETTER_AUTH_SECRET`) of the page's random per-browser id + IP (or IP+UA), `net` = salted hash of the IP, day;
  unique (render, type, visitor, day); ≤ 20 visitors per network address, variant, type and day; a click counts only
  for a visitor with a view),
  `renders.campaign_id` + `renders.variant` (code, label, hook/CTA ids, length, hook headline, CTA text, angle).
- **Flow:** `createCampaign` → deck job `campaign_hooks` (`writeHooks` in `worker/deck/planner.mjs`, qwen3-vl, 8000
  tokens) → owner edits (`updateCampaignDraft`) → `renderCampaign` (draft → building, atomically; ≤ 12 combinations;
  watermark per the video rule) → deck job `campaign_render` (`worker/deck/variants.mjs` `buildVariant` per combination
  → `renders` rows with `settings.deckVariant.scenes`) → the render worker renders the snapshot
  (`loadRenderInputs(…, deckVariant)`; normal renders unchanged). `listRenders` / `getLatestRender` / the render
  checkpoint ignore campaign renders.
- **Public routes** (in `src/proxy.ts` PUBLIC_PATHS): `/c/[id]` (page), `/c/[id]/go` (CTA redirect — destination only
  from the pack's stored link, never the request), `POST /api/c/[id]/event` (always 204). All 404 unless the render is
  a finished variant of a pack with `shared = true`. `/c/[id]/go` counts the click, then — when the pack's creator
  (else the project owner) is on the Free plan (`getEffectiveTier`, per click) — redirects to `/c/[id]/leaving`, the
  interstitial showing the destination host + path with Continue / Go back / report (support@clipwaltz.com).
  Owner decision 2026-09-29 (abuse risk: open sign-up could front phishing with a www.clipwaltz.com link). `setCampaignShared` flips the pack's renders private ↔ unlisted
  (a deliberately public one stays public).
- **Notifications:** the worker still pings `/api/internal/render-ready` per render; for a pack variant the route sends
  nothing until the pack's last variant is done, then ONE push + email ("Your campaign pack is ready").
- **Review fixes (2026-09-29):** no fixed BullMQ job id for `campaign_render` (a retried build was silently dropped);
  variants insert as `unlisted` when share links were switched on mid-build; draft writes are conditional on
  `status='draft'`; a storyboard that can't reach a length is labelled with its real length (`variant.targetSec` keeps
  the ask). Free-plan packs go through the `/c/<id>/leaving` interstitial (owner decision 2026-09-29).
- **Diagnostics:** `node -e "import('./worker/deck/variants.mjs')…"` — `buildVariant` is pure (see the function's
  comment); stats query = `select type, count(*) from variant_events where campaign_id = … group by type`.

## WaltzDeck mix, dynamic camera, brief history (2026-09-29)
- **Brief fields:** `brief.audio` `{ music, musicGainDb, voiceGainDb, musicTone, voiceTone, duck }` (validated by `normAudio`),
  `brief.camera.mode` (off|subtle|cinematic|energetic); scene `motion` gains drift | punch | shake.
- **Render (`worker/render-worker.mjs`):** `audio.music === false` → no music input at all (the worker otherwise falls
  back to the first catalogue track when a project has none). Music stem `volume=level×dB` + `MUSIC_TONE` filter; voice
  stem `volume` + `VOICE_TONE`; duck: steady = bed `volume=0.42`, gentle = `sidechaincompress` 0.05 / ratio 3 / 300 ms /
  2.5 s / knee 4 (bed 0.6), strong = 0.03 / ratio 10 / 15 ms / 400 ms (bed 0.55). Presets only map to fixed filter strings
  (no user text reaches ffmpeg).
- **Camera (`worker/deck/camera.mjs`):** `pickMove` (auto rules) + `cameraChain` → `fps=30,scale 1.5×,crop,zoompan(d=1)`
  with frame-number expressions; beat times = music beats − musicOffset − scene start (≤ 10 per scene). `fps=30` before
  zoompan is required (d=1 emits one frame per input frame). Diagnostic: `node worker/deck/camera.mjs`. Client copy of
  the rules: `src/lib/deck/camera.ts`; preview keyframes in `scene-frame.tsx` (on a wrapper so clip rotation survives).
- **History:** migration `0043_brief_history` — `deck_brief_history` (user_id, text, used_at; unique user+text), trimmed
  to 15 per user on every save (`rememberBrief`).

## AI credit grants (2026-09-30)
- **Table:** `credit_grants` (migration `0045_credit_grants`): user_id (cascade), amount (> 0), note, granted_by (admin
  user id), created_at; index (user_id, created_at). A grant counts for the UTC month of `created_at`.
- **Balance:** `credits-server.ts` — `getCreditBalance` and `spendCredits` add `grantedThisMonth` to the plan allowance
  (inside the same advisory-locked transaction for spends). `CreditBalance.allowance` is the total; `planAllowance` and
  `bonus` are the parts. `listGrantsThisMonth(userId)` feeds Billing.
- **Admin:** `grantCredits({ email, amount, note })` / `revokeCreditGrant(id)` / `listCreditGrantsAdmin()` in
  `admin-actions.ts` (requireAdmin; existing accounts only; `MAX_CREDIT_GRANT` = 10,000 in `credits.ts`). UI:
  `src/components/admin-credit-grants.tsx` on /admin.
- **Troubleshooting:** a user says their grant vanished → grants expire at the 1st (UTC) by design; check
  `select * from credit_grants where user_id = '…' order by created_at desc`.

## Dates in client components (2026-09-30)
- Never call `toLocaleString` / `toLocaleDateString` on server-provided data inside a client component: the server
  renders in its own locale and time zone, the browser in the viewer's, and React throws away the page on the mismatch.
  Use `<LocalDate value kind options>` (`src/components/local-date.tsx`) in JSX or `useDateFormat()`
  (`src/lib/local-date.ts`) for strings — fixed en-US/UTC until hydrated, then the viewer's locale.
  Server components and data that only loads after mount can format directly.

## Editor studio layout (2026-09-30)
- `src/components/studio/studio-shell.tsx` (`StudioShell`, `StudioPanel`) — used by `deck/deck-editor.tsx` and
  `editor-workspace.tsx`. Fills `calc(100dvh - var(--cw-header-h))`; `--cw-header-h` (3.25rem, `globals.css`) is also the
  app header's fixed height in `src/app/(app)/layout.tsx` — change both together. `.cw-studio-pane` / `.cw-spectrum-btn`
  in `globals.css`.
- Panels that poll (RenderPanel, GenerationPanel) are rendered always and hidden with `hidden` when their tab isn't
  shown — un-mounting them drops a running render's status (RenderPanel seeds from `initial` once).
- Left-panel components that had page-width breakpoints (`project-editor`, `overlay-editor`, `generation-panel`) use
  container queries (`@container`) so they stay one column in the narrow panel.
- AutoWaltz clip settings: `src/components/clip-inspector.tsx` (was `ClipModal` in `project-timeline.tsx`), keyed per clip.

## WaltzDeck timeline inserts (2026-10-03)
- `insertScene(projectId, at, { kind: title|slide|cta|media|duplicate, … , write })` in `deck-actions.ts` shifts
  `order_index` from `at` and inserts; `duplicate` copies the row (text, media, frame, backdrop, voice, lock). `write`
  enqueues the existing deck `scene` job (worker/deck/jobs.mjs → `rewriteScene`) with an instruction naming the
  neighbours' headlines; if the queue is down the scene stays with "Added by you.".
- UI: `SceneStrip` / `InsertGap` / `InsertMenu` in `deck-editor.tsx` (Base UI menu — a `DropdownMenuLabel` must sit in
  a `DropdownMenuGroup`). Drag types `application/x-cw-scene` (move → `reorderScenes`) and `application/x-cw-asset`
  (Your media rows are draggable). App-only change: no migration, no worker deploy.

## WaltzDeck backdrops, AI backdrops, zoom-out media (2026-10-03)
- **One drawing module:** `worker/deck/backdrop.mjs` (+ `backdrop.d.mts` types) — `BACKDROP_CSS` + `backdropMarkup()`
  (container-query units, brand vars `--p`/`--s`), `textZone()` (where the words are → decoration mirrored away + the
  veil), `cardRect()` / `mediaArea()` (zoomed-out media card), `normBackdrop()` (validation). Imported by the app
  (`scene-frame.tsx` preview, `backdrop-picker.tsx`, `deck-actions.ts`), `deck/text-layer.mjs` (render + exports) and
  `deck/export.mjs`. Change a style in ONE place.
- **Schema:** migration `0046_scene_background` — `deck_scenes.background jsonb` `{ style, intensity, seed, imageId? }`,
  null = deck default. Deck default = `projects.deck.brief.backdrop`, written only by `setDeckBackdrop` (saveBrief keeps
  the stored one — the editor's brief copy can be older than a backdrop the worker just made). AI images:
  `projects.deck.backdrops[] { id (= generation job id), key, prompt, preset, tone, aspect, createdAt }`; the key never
  reaches the browser — `GET /api/projects/[id]/backdrops/[bid]` serves it. Translations copy the list (shared files;
  `deleteBackdropImage` only deletes the object when no deck lists it).
- **AI backdrop job:** `generateBackdrop` → `createGenerationJob({ deckBackdrop })` — a normal `text_to_video` job on the
  generation queue, `BACKDROP_COST` = 2 credits, never watermarked, `durationSec` 1 (route length check skipped). The
  generation worker sends `length: 1` (one Wan frame), extracts a JPEG, measures the centre brightness (> 150 = `light`
  → dark words), stores `projects/<id>/backdrops/<jobId>.jpg`, appends to the library and applies it (scene or deck
  default) — no Waltz AI version is created. Sizes: 16:9 1280×704, 9:16 704×1280, 1:1 960×960, 4:5 832×1024.
- **Render (`deckSegments`):** text cards = words rendered transparent (`bare`) over a separate 1.5× backdrop PNG
  (`renderBackdrop`) that drifts with `cameraChain("drift","subtle")` when the deck camera is on. Zoomed-out media
  (`frame.zoom < 1`): `uprightSize()` decodes one frame for the exact size → `cardRect` → backdrop PNG with the card's
  shadow baked in + a rounded-corner mask (`renderMask`) → `alphamerge` + `overlay`, then the scene's camera move on
  that composite, then the words. `vfFrame` ignores zoom < 1. Exports: the still is fitted (PNG) and drawn as a
  `.cwmc` card over the backdrop in `sceneHtml({ mediaCard })`.
- **Camera / Ken Burns:** more pull-outs (`pickMove` in `deck/camera.mjs` + `src/lib/deck/camera.ts`, keep in sync);
  `vfKenBurns(W,H,frames,out)` alternates by scene / clip index.
- **AutoWaltz blurred fill:** `vfStatic` = split → 1/8-size blurred, darkened cover copy + the fitted clip on top
  (~0.3 s per 3 s of 1080p on the AI box).
- **`render-worker.mjs --once`** now also drains queued slide exports (handy for one-shot tests against the dev DB).
- **Deploy:** migration 0046 + app build on linuxg1; `worker/generation-worker.mjs` on linuxg1 (`pm2 restart
  clipwaltz-gen-worker`); on the AI box `render-worker.mjs` + `deck/{backdrop,text-layer,export,camera,frame}.mjs`
  (`sudo -n systemctl restart clipwaltz-worker`). The app also builds `worker/deck/backdrop.mjs` (imported by `src/`),
  so the app tarball must include it.

## Per-scene caption position (2026-10-05)
- Migration **0048** `deck_scenes.caption_position` (text: top | bottom | null = deck default). `updateScene` patch
  `captionPosition`; chat op field `captions` (top / bottom / auto). Render: `voice.mjs buildCaptionsAss` reads
  `slot.scene.caption_position` per line (`{nNsN}` + the event's MarginV). Deploy: prod migration, app, gen worker,
  AI box `deck/voice.mjs`.

## AI token budgets (2026-10-05)
- `chatJson` default **8,000** tokens / 300 s (was 3,000 / 180 s). qwen3-vl reasons before answering even with
  `think:false`; a scene rewrite on prod failed with "no JSON object in model reply (eval 3000 tok, done: length)"
  (reproduced 1 of 2 locally on the same scene; 5 of 5 OK at 8,000). Rewrite, describe, narration and shot calls
  8,000; chat edits 10,000; plan / variants 8,000; translate 12,000. A failed rewrite now says so in red in the scene
  panel; the raw error goes to the gen worker log (`[deck] rewrite <id> failed: …`).

## Explainer variety + Edit with AI (2026-10-05)
- **Looks + variants:** `motion.mjs` `LOOKS` (neon, clean, bold, paper, grid, sunset) → `look()` returns palette, surface,
  shadow style (`fx`: glow / soft / lift / hard) and particles; `motionHtml({ …, look, seed, variant })` seeds
  `rng(hash32(seed:variant:layout))` for the template's choices. `brief.motion = { look: key | "auto", seed }`;
  `resolveLook("auto", seed)` picks from the seed. Seed set by `jobs.mjs` on every plan, by `setDeckMotion` (look /
  shuffle) and by chat ops. Render passes `scene.id` as `variant` (`render-worker.mjs`, `export.mjs`); the editor gets
  look + seed from `DeckMotionContext` (deck-editor provides `data.deck.brief.motion`), `FrameScene.id` as variant.
  Campaign-variant snapshots render with their scenes' ids if present.
- **Planner:** `STORY_ARCS` (random per plan), `MG_GUIDE` (neutral — no example wording), `ensureShots()` (≥ 2 shots for
  explainers; converts a non-media layout to mg-words when it gets one), repair rules for list layouts / explainer
  text cards.
- **Chat:** `projects.deck.chat = { status: idle|thinking|failed, error, startedAt, messages[≤40] }`. `askDeckAi`
  (≤ 600 chars, one turn at a time, stale after 10 min, refuses while planning) → queue job `chat` → `jobs.mjs
  chatEdit` → `planner.mjs editDeck` (ops validated: known layouts, durations 1.2–15 s, scene numbers in range;
  text guarded by `allowedNumbers` / `unverifiedClaim` with the owner's chat as source) → one transaction (scene numbers
  resolved to ids first; locked scenes skipped; order_index rewritten) → assistant message with `changes[]`.
  `replan` runs `plan()` after. `clearDeckChat` drops the history. UI `src/components/deck/deck-chat.tsx`.
- **Film suggested shots:** deck-editor `shotScenes` (scene.prompt, no media, no fill running, a layout that shows media)
  → `fillScene` per scene (credits per scene as the single "Generate a shot"); `fillSceneImpl` refuses a scene with a
  fill already running (< 6 h old).
- **Deck AI clip length:** `deckFillSeconds` (`src/lib/deck/types.ts`) = 3 s for scenes ≤ 3 s, else **5 s** (Wan 2.2 5B is
  made for 121 frames; 8 s = 193 frames at 1280×720 would run past the 20-min GPU budget on a 10 GB card). A longer
  scene is trimmed to the clip unless its voiceover needs longer (then the last frame holds).
- **Deploy:** no migration. linuxg1 app build + `pm2 restart clipwaltz clipwaltz-gen-worker` (planner + chat job);
  AI box `render-worker.mjs` + `deck/{motion,text-layer,export}.mjs`.

## WaltzDeck Explainer & animated layouts (2026-10-05)
- **Shared module:** `worker/deck/motion.mjs` (+ `motion.d.mts` for the app). `motionHtml({ layout, text, W, H, brand,
  dur, over, stars, fontsCss })` → an HTML page whose `render(t)` draws second t (pure function of t, script scoped in
  an IIFE because the render reuses one page and `setContent` keeps the JS realm). `MOTION_LAYOUTS` (`mg-*`),
  `OVER_MEDIA_LAYOUTS` (words / chat / end), `motionOpaque`, `settledAt`. Keep `LAYOUTS` / `MOTION_FIELDS` in
  `src/lib/deck/types.ts` and `LAYOUTS` / `MG_GUIDE` in `planner.mjs` in sync. All user text goes through `esc()`;
  colours `hex()`, fonts `cssFont()`, logo `okLogo()` (data URL or `/api/projects/<id>/brand-logo`), fonts CSS only
  `https://fonts.googleapis.com/css2?…`.
- **Render:** `text-layer.mjs renderMotion()` screenshots every frame (30 fps, PNG; transparent for over-media) →
  `deckSegments` makes the whole segment (opaque) or passes it as the text layer over the media (incl. zoomed-out
  cards and camera moves). Cost: ~5 min for a 40 s all-animated 1080p explainer on the AI box.
- **Captions:** `buildCaptionsAss(..., { position: "bottom" })` for `mode === "explainer"` (5.5 % of the short side).
- **Exports:** `export.mjs` draws `motionHtml` at `settledAt(dur)`, media still prepended under over-media layouts;
  picture slides (no editable PPTX text boxes).
- **Editor preview:** `scene-frame.tsx MotionLayer` — srcdoc iframe at 1280 px on the long side, scaled, in a
  **scripts-only sandbox** (no `allow-same-origin`): the page posts `{cwReady}` until it gets its first
  `{cwRender: t}` message; the editor drives frames by `postMessage` (rAF while playing, else the settled frame). The
  iframe is keyed on a hash of the page (changing `srcdoc` on the live frame left the old page showing). The brand logo
  is fetched by the editor and passed as a data URL (the sandboxed page has no cookies).
- **Planner:** animated layouts are offered to (and kept for) explainer plans only — other modes' picks fall back to
  the usual layouts. **Rewrite / Shorter / Punchier** on an animated scene describes its fields to the model and keeps
  the current lines (chat, channels, address) when the reply has none (`repairPlan(..., { single: true })` adds no end
  card and keeps the CTA in the source text). Mode `explainer` (`MODE_GUIDE`, `MG_GUIDE`, `shot` → `deck_scenes.prompt`, ≤ 3), `jobs.mjs` lets an
  explainer plan with no media and refuses an empty result. `unverifiedClaim` also drops web addresses (written or
  "x dot com") absent from brief/goal/audience/tone/offer/CTA text+URL/notes.
- **Defaults:** `defaultBrief("explainer")` voice auto; `DECK_DEFAULT_TRACK.explainer = t-music-promotion`.
- **Deploy:** no migration. linuxg1: app build + `pm2 restart clipwaltz` **and** `pm2 restart clipwaltz-gen-worker`
  (it runs the deck planner: `deck/{planner,jobs,motion}.mjs`). AI box: `render-worker.mjs` +
  `deck/{motion,text-layer,export,voice}.mjs` (`sudo -n systemctl restart clipwaltz-worker`).

## Cloud storage routing + analytics (2026-10-07)
- **Schema:** `0051_cloud_routing` — `cloud_prefs` (user_id PK, `default_targets` jsonb provider[], `rules` jsonb
  `[{ id, field: type|category|aspect, values[], targets[] }]`), `projects.cloud_targets` and `renders.cloud_targets`
  (jsonb provider[]; `[]` = don't save; null = fall through).
- **Resolution** (`src/lib/cloud/routing.ts` `resolveTargets`, first answer wins): render "Save to" → project setting →
  first matching rule → default destinations. No `cloud_prefs` row = default is every connection with `auto_save`
  (pre-0051 behaviour). Providers not connected are dropped. Video type = `videoType(kind, deck, campaignId)`:
  music | ad | slideshow | presentation | explainer | campaign. Auto-saves only ever use the project owner's storage.
  Connecting a service adds it to the default (`addDefaultTarget`) when prefs exist.
- **UI:** Cloud storage page "Where videos go" (`cloud-routing-editor.tsx`, replaces the per-service auto-save switch);
  render dialog "Save to" (`render-panel.tsx` → `createRender(projectId, { cloudTargets })`, sent only when changed);
  Video properties "Save finished videos to" (`setProjectCloudTargets`, owner only).
- **Analytics:** `/account/storage/analytics` (`getCloudAnalytics(days)`: 7/30/90/365) — totals, per service, per
  video type, per format, per day (stacked), top projects, and per-service health + quota. Quota calls (best effort,
  "Not reported" on failure): Drive `about?fields=storageQuota` (no `limit` = unlimited), Graph `/me/drive` `quota`
  (`used` or `total − remaining`), Dropbox `users/get_space_usage` (team: per-user cap if set).
- **Connect logging:** every OAuth outcome logs `[cloud] <provider> connect <result> — <reason>`; redirects are built on
  `NEXT_PUBLIC_APP_URL` (www), never `req.url`.
- **Deploy:** migration 0051 + app build + `pm2 restart clipwaltz`.

## Cloud storage auto-save (2026-10-05)
- **Schema:** `0049_cloud_storage` — `oauth_accounts` + `account_label`, `auto_save` (default false; set true when
  connected from Cloud storage), `folder_layout` (category | project | flat), `last_error`; new `cloud_saves` (one row
  per render × provider × user: queued | uploading | done | failed, remote id/url/path, bytes, attempts, error).
  `0050_cloud_saves_per_user` makes the unique index `(render_id, provider, user_id)`.
- **Code:** `src/lib/cloud/` — `types.ts`, `crypto.ts`, `store.ts` (connections, single-flight token refresh that
  stores rotated refresh tokens), `oauth.ts` (state cookie `cs_state_<provider> = <provider>:<uuid>`), `saves.ts` (queue +
  uploader), providers `google-drive.ts`, `onedrive.ts`, `dropbox.ts`. Actions `src/lib/cloud-actions.ts`.
  Routes `/api/oauth/cloud/[provider]/{start,callback}`; Google Drive reuses `/api/oauth/google/drive/callback` (it
  branches into the cloud flow when `cs_state_google_drive` matches).
- **Flow:** worker → `POST /api/internal/render-ready` → `after(enqueueRenderSaves + resumeStale)`. Uploads run one at a
  time in the app process, streaming MinIO ranges (Drive 16 MiB, Graph 10 MiB, Dropbox 8 MiB). Up to 3 attempts with backoff; "reconnect"-type errors fail at once and set
  `oauth_accounts.last_error`. A restart leaves rows queued/uploading — `resumeStale` requeues queued > 2 min and
  uploading > 6 h and not running in this process (called on render-ready and when the Cloud storage page loads).
- **Env (app, linuxg1 `.env.local`):**
  - `TOKEN_ENC_KEY` — **required in production** (random 32 bytes, base64url; copy in `_keys/clipwaltz.txt`).
    Losing it disconnects everyone (tokens can't be decrypted). Rows written before 0049 are plaintext and get
    re-encrypted on their next refresh.
  - Google Drive: existing `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (scope `drive.file`, non-sensitive).
  - OneDrive: `MS_CLIENT_ID` (defaults to `NEXT_PUBLIC_MS_CLIENT_ID`) + `MS_CLIENT_SECRET`. Entra app: supported
    accounts "any org directory + personal Microsoft accounts", **Web** redirect URI
    `https://www.clipwaltz.com/api/oauth/cloud/onedrive/callback`, delegated `offline_access User.Read Files.ReadWrite`.
  - Dropbox: `DROPBOX_APP_KEY` (defaults to `NEXT_PUBLIC_DROPBOX_APP_KEY`) + `DROPBOX_APP_SECRET`. App console:
    redirect URI `https://www.clipwaltz.com/api/oauth/cloud/dropbox/callback`, permissions `files.content.write` +
    `account_info.read`. Development status = 500 users; apply for production once 50 have linked.
  - A provider shows **Coming soon** until both its id and secret are set.
- **Troubleshoot:** `pm2 logs clipwaltz | grep "\[cloud\]"`; `select provider,status,error,attempts from cloud_saves
  order by updated_at desc limit 20;`.
- **Deploy:** migrations 0049 + 0050, set `TOKEN_ENC_KEY`, app build + `pm2 restart clipwaltz`. No worker change.

## Projects category rail + video properties (2026-10-05)
- **No migration.** Uses `projects.category` (name), `projects.description`, `projects.tags`, `project_categories`.
- **Actions:** `setProjectsCategory(ids, cat)` (bulk move, each id editor-checked, ≤ 500), `updateProjectProperties(id,
  { title, description, category, tags })` (`project-actions.ts`); `reorderCategories(ids)` (`category-actions.ts`,
  rewrites `sort_order` 0..n for the caller's categories; unknown ids ignored, missing ones appended).
- **UI:** `projects-board.tsx` (rail + grid; `?category=` read by `projects/page.tsx`, written with
  `history.replaceState`), `project-properties-dialog.tsx`, `project-card.tsx` (select box, Properties).
- **Deploy:** linuxg1 app build + `pm2 restart clipwaltz`.

## Brand pronunciations (2026-10-04)
- **Schema:** migration `0047_brand_pronunciations` — `brand_kits.pronunciations_json jsonb`, `[{ word, say }]`.
  Cleaned server-side by `cleanPronunciations` (`brand-actions.ts`): word ≤ 40 / say ≤ 80 chars, control chars
  stripped, no duplicates or word = say, max 20 (`MAX_PRONUNCIATIONS`, `src/lib/brand.ts`).
- **Render:** `render-worker.mjs` loads the kit's list into `style.deck.brand.pronunciations` and passes it to
  `synthScenes` (`worker/deck/voice.mjs`). `respell(line, list)` = one regex pass (all words as alternatives, longest
  first, Unicode letter/number boundaries) → the text sent to Kokoro + the ordered substitutions; `respokenWords`
  merges each run of spoken words back into the written word (start of the first, end of the last), only as many
  times as it was substituted. Only applies when the project uses the brand kit (`projects.brand_kit_id`).
- **Deploy:** migration 0047 + app build on linuxg1; on the AI box `render-worker.mjs` + `deck/voice.mjs`
  (`sudo -n systemctl restart clipwaltz-worker`).

## WaltzDeck scene media editing (2026-09-30)
- **Schema:** migration `0044_scene_frame` — `deck_scenes.frame jsonb` `{ x, y, zoom }` (centre as a fraction of the
  upright source, zoom 1–3); null = centred cover. Validated by `normFrame` (`src/lib/deck/frame.ts`) in `updateScene`.
  Cleared when the scene's media changes (`updateScene` assetId, AI fill in `generation-worker.mjs`, campaign hook swap
  in `deck/variants.mjs`) and for every scene of a file whose rotation changes (`setAssetRotation`).
- **Render / export:** `worker/deck/frame.mjs` `vfFrame(frame, W, H)` → an ffmpeg `crop` in the output's shape, placed
  after `vfRotate` and before the cover / camera / Ken Burns chain (`deckSegments` in `render-worker.mjs`) and the still
  filter in `deck/export.mjs`. Default framing adds no filter. Keep the maths in sync with `frameRect` in
  `src/lib/deck/frame.ts` (preview: `scene-frame.tsx` sizes a container to the whole source and offsets it).
- **Video start:** the dialog writes the existing `deck_scenes.in_sec` (null = auto window); clamped to clip − scene length.
- **Delete:** the deck page calls `deleteAsset` (`asset-actions.ts`, placement only — now also revalidates `/deck`); the
  FK `on delete set null` turns scenes into text cards.
- **Deploy:** app (migration + build) on linuxg1 **and** the render worker files on the AI box (`render-worker.mjs`,
  `deck/frame.mjs` new, `deck/export.mjs`, `deck/variants.mjs`) **and** `worker/generation-worker.mjs` on linuxg1
  (`pm2 restart clipwaltz-gen-worker`).

## AI credits + WaltzDeck Phase 5 (2026-09-29)
- **Credits:** migration `0042_ai_credits` (`generation_jobs.credits`, default 0 — older jobs cost nothing). Rules in
  `src/lib/credits.ts`; balance + atomic spend in `src/lib/credits-server.ts` (`spendCredits`: `pg_advisory_xact_lock
  (hashtext('credits:<user>'))`, sum of this UTC month's non-failed/cancelled/retried jobs, insert in the same tx). Wired
  into `createGenerationJob`, retries (`requeueGenerationCopy`, same cost), `enhanceVersion`, `createRemix`. Montage and
  Fast enhance = 0. UI: `src/components/credits-line.tsx` (`useCredits`, `CreditsLine`). To comp a user more credits
  today, upgrade their plan (`/admin` grant) — there is no per-user credit override yet.
- **AI fill:** `fillScene` (deck-actions) → `createGenerationJob({ …, deckFill: { sceneId } })` (scene ownership checked);
  the generation worker's `deckFillScene` adds the clean master as a media + asset row, sets `deck_scenes.asset_id`, and
  queues a `describe`. `getDeck().fills` = each scene's latest fill job of the last day.
- **Brand from website:** deck job `brand_from_site` (`worker/deck/brand-site.mjs`, fetches via `fetchPublic` — SSRF guard)
  → `projects.deck.brandSuggestion`; logo stored as `brand/<workspace>/suggest-<uuid>.png` (sharp → PNG ≤ 512 px);
  `applyBrandSuggestion` only accepts that prefix. Preview: `/api/projects/[id]/brand-logo?suggestion=1`.
- **Translation:** `translateDeck` copies project + assets (same storage keys) + scenes, then deck job `translate`
  (`translateDeck` in planner.mjs: one model call, 12k tokens; `keepFacts` keeps numbers / web addresses). Planner prompts
  add a LANGUAGE line for non-English decks. TTS (`worker/tts/server.py`): voices ef_dora, em_alex, ff_siwis, if_sara,
  im_nicola, pf_dora, pm_alex (espeak-ng pipelines "e/f/i/p"); they return no word timings, so `estimate_words` spreads
  a chunk's words over its audio. Non-English claim guard covers numbers only (the claim word lists are English).
- **Dev queues:** `GENERATION_QUEUE` / `EXPORT_QUEUE` / `ENHANCE_QUEUE` are now env-overridable (app + worker) like
  `DECK_QUEUE`; dev uses `*-dev` (`.env.development.local`) — before this, dev AI jobs landed on prod's queue (harmless: the
  prod worker couldn't find them in the prod DB).

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

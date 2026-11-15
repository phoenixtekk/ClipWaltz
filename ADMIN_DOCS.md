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
- **DB:** `DATABASE_URL`, optional `DATABASE_POOL_MAX` (per-process pool cap — see below)

### Postgres connection budget (shared server — 2026-10-06)
The linuxg1 Postgres (`max_connections` 100) is shared by ~10 apps. On 2026-10-06 04:37–04:46 UTC
ClipWaltz connections (mostly `clipwaltz_dev`) filled every slot and other apps (VelvetSong, mibrow)
were refused. Two caps now apply:
- **Per-process pools** (postgres.js defaults to 10): app `src/db/index.ts` **5**, gen worker **5**
  (job concurrency 2+2+1), render worker **3**; override with `DATABASE_POOL_MAX`. `idle_timeout` 30 s.
  In `next dev` the client is cached on `globalThis` so hot reloads don't leak a new pool each time.
- **Hard role cap:** `ALTER ROLE clipwaltz CONNECTION LIMIT 45` (was 30; raised 2026-11-14 for render scaling — covers `clipwaltz` + `clipwaltz_dev`
  together). Over the cap, ClipWaltz alone gets `too many connections for role` — other apps are safe.
  Check: `sudo -u postgres psql -Atc "select count(*) from pg_stat_activity where usename='clipwaltz'"`.
  Undo: `ALTER ROLE clipwaltz CONNECTION LIMIT -1`.
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
- **Worker vision (face/scene):** `OLLAMA_URL` (e.g. `http://192.168.166.182:11434`), `OLLAMA_MODEL` (default `qwen2.5vl:7b`, a non-reasoning VL model), optional `OLLAMA_TIMEOUT_MS`. Empty `OLLAMA_URL` = motion-only in the worker. **The app (linuxg1 `.env.local`) also needs
  `OLLAMA_URL`** for the Waltz Avatar AI-presenter real-person check (`PERSONA_CHECK_MODEL`, default `qwen2.5:14b`) —
  without it, creating an AI presenter is refused.
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
- **Home page content (`/`, 2026-10-31):** nothing to edit by hand — it follows live data. **Showcase** + hero
  videos = the latest public renders (users set a video to Public); the **Community** band shows the running Monthly
  Theme Challenge (`/admin` → Contest) or a generic community pitch; **Your AI, your choice** appears only when
  `/admin/ai` switches on an outside writing model, a cloud video model or the Connector for at least one plan, and
  names only those. Code: `src/lib/home-data.ts` (each read fails soft, so `/` still renders if the DB is slow).
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

## Waltz Avatar presenters (Phase 1, 2026-10-14)

**Pieces:** app `/avatars` (`src/components/avatars-manager.tsx`, `src/lib/presenter-actions.ts`, uploads
`src/app/api/presenters/[id]/{footage,consent,thumb}`) · tables `presenters`, `presenter_consents` (migration **0059**) ·
queue `<GENERATION_QUEUE>-presenter` (generation worker `processPresenter`: `prepare` = consent check + cache,
`delete` = forget the AISERVER cache) · AISERVER: the **`clipwaltz-talking`** service also runs presenter jobs
(`aiserver/talking/presenter.py`, `consent.py`) — same queue and GPU guard as talking photos — wrapper workflows
`presenter-prepare-v1`, `presenter-lipsync-v1`, `DELETE /presenters/{id}` · render worker `worker/deck/presenter.mjs`
(lip-sync per voiced presenter scene, MinIO clip cache, compositing; needs `AISERVER_API_URL` + `AISERVER_API_TOKEN`).

**AISERVER setup (once, before the deploy):**
1. `sudo apt-get install -y libgles2 libegl1` (MediaPipe) — done on AISERVER 2026-10-14.
2. Into `/opt/clipwaltz-ai/talking/venv`: `mediapipe==1.1.1 speechbrain torchaudio==2.6.0` (torch stays 2.6.0+cu124) —
   **dry-run first** (`uv pip install --dry-run ...`) and stop if it would change torch / transformers / numpy.
3. Models in `/data/clipwaltz-ai/models/musetalk` (`PRESENTER_MODELS`): `musetalkV15/{musetalk.json,unet.pth}`,
   `sd-vae/` (sd-vae-ft-mse), `whisper/` (whisper-tiny, audio features), `whisper-base/` (consent code ASR),
   `ecapa/` (speechbrain/spkrec-ecapa-voxceleb), `face_landmarker.task` (MediaPipe float16 v1,
   sha256 `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`). Copies exist in `~/presenter-dev/models`
   and `~/presenter-spike/MuseTalk/models`.
4. Cache dir `/data/clipwaltz-ai/presenters` (`PRESENTER_CACHE`; ~0.7 GB per 22 s of 1080p footage — rebuilt from the
   footage automatically if lost).
5. Copy `aiserver/talking/{service.py,presenter.py,consent.py}` → `/opt/clipwaltz-ai/talking/`, `aiserver/wrapper/app.py` →
   the wrapper; restart `clipwaltz-talking`, then `clipwaltz-aiserver-api`. Both changes are backward compatible.

**Render workers (AI box, later AISERVER):** set `AISERVER_API_URL=http://192.168.166.158:8189` and `AISERVER_API_TOKEN`
in the worker env (the AI box reaches the wrapper — 401 without a token, checked 2026-10-14) and keep a bold font for the
label (`fonts-dejavu-core` or `AI_LABEL_FONT`).

**Consent:** automatic only. Thresholds: `CONSENT_VOICE_MIN` (default 0.40 cosine; same voice measured 0.70–0.92,
different 0.04–0.09), face in ≥ 70 % of 12 sampled frames, the code's digits in order. The result JSON is in
`presenter_consents.result`. The one-time code is cleared once a presenter is ready.

**Credits:** `PRESENTER_SECONDS_PER_CREDIT` (10) in `src/lib/presenters.ts` **and** `worker/deck/presenter.mjs` (keep in
sync). Charge row: `generation_jobs.job_type = 'presenter_render'`, created `completed` (never counted as queue work),
linked by `renders.settings.presenterChargeId`; the render worker settles it down, or marks it `failed` (refund) when the
render fails or is reaped. Lines already in the clip cache are not charged (the app checks MinIO when pricing).

**Delete:** the app removes everything under `presenters/<userId>/<id>/` in MinIO and the row; the worker then calls
`DELETE /presenters/<id>` on the wrapper. Consent rows stay (without the clip).

**Troubleshooting:** "presenter isn't ready" on render → `/avatars` status · a lip-sync answering `not_prepared` is
handled automatically (the render worker re-sends the footage and rebuilds the cache) · MediaPipe `libGLESv2.so.2`
missing → setup step 1 · `Repo id must be in the form ...` → a model folder is missing under `PRESENTER_MODELS`.

## Waltz Avatar Phases 2 + 3 (2026-10-14)
**New AISERVER service `clipwaltz-voice`** (`aiserver/voice/service.py`, unit `aiserver/systemd/clipwaltz-voice.service`,
127.0.0.1:**8195**, GPU 0 with the guard vs ComfyUI #1). Own venv `/opt/clipwaltz-ai/voice/venv` (Python 3.11,
`chatterbox-tts==0.1.7`, torch 2.6.0+cu124, `fastapi uvicorn httpx soundfile librosa`) — Chatterbox pins its own
transformers/numpy, so it must not share the talking venv. Models: Chatterbox via `HF_HOME=/opt/clipwaltz-ai/voice/hf`
(copy the spike's `~/.cache/huggingface` entries; offline), `VOICE_WHISPER` = whisper-base (word timings),
`VOICE_ASR` = whisper-small (Phase 3 transcription) under `/data/clipwaltz-ai/models/musetalk/`. Wrapper env
`CW_VOICE_URL` (default http://127.0.0.1:8195), `CW_VOICE_GPU_BACKEND` (default the first ComfyUI).
**Wrapper workflows added:** `voice-clone-tts-v1`, `voice-transcribe-v1`, `presenter-consent-v1`, `presenter-match-v1`,
`presenter-dub-v1`. **Talking-service kinds added:** `consent`, `match`, `dub`.
**Talking venv extras (installed on prod 2026-10-15):** pin EVERYTHING already installed, then add the two packages —
`uv pip freeze --python /opt/clipwaltz-ai/talking/venv/bin/python > /tmp/c.txt` then `uv pip install --python
/opt/clipwaltz-ai/talking/venv/bin/python -c /tmp/c.txt --index-strategy unsafe-best-match --extra-index-url
https://download.pytorch.org/whl/cu124 mediapipe==1.1.1 speechbrain==1.1.1` (always `--dry-run` first). It adds exactly
12 packages and changes nothing. **Never install `speechbrain` unpinned:** on 2026-10-15 it resolved to 1.1.2 and would
have upgraded torch 2.6.0+cu124 → 2.14.1 (+ torchaudio, triton) in the live venv, risking EchoMimic.
**Migrations:** 0060 (`presenters.voice_*`), 0061 (`presenters.library`, `description`, `release_ref`, `portrait_keys`).
**Generation worker:** presenter queue actions `voice`, `portraits`, `ai_build`, `library_prepare`; generation job types
`translate_prep` (free) and `translate_video` (credits 2 × presenter rate). The worker imports the deck LLM (`chatJson`)
for the translation.
**Admin:** `/admin/avatars` (env allowlist `ADMIN_EMAILS`). AI faces: Wan `wan-text-to-video-v1` length 1 at 704×1280.
AI base footage: `echomimic-talking-v1` (standard) + `esrgan-upscale-v1`, ~15–20 GPU-minutes. Actors: footage via
`POST /api/presenters/<id>/footage` from the admin page, then build (no consent clip — the release reference is required).

**Deployed to prod 2026-10-15** (deploy branch `deploy/waltz-avatar-20261014` @ `1329da6` = `c7a5d87` + Waltz Avatar,
no render scaling). AISERVER: models in `/data/clipwaltz-ai/models/musetalk` (4.9 GB: musetalkV15, sd-vae, whisper,
whisper-base, whisper-small, ecapa, face_landmarker.task), presenter caches `/data/clipwaltz-ai/presenters`, talking venv
extras, NEW systemd `clipwaltz-voice` (127.0.0.1:8195, GPU 0, `/opt/clipwaltz-ai/voice` with its own py3.11 venv pinned in
`requirements.lock.txt`, Chatterbox weights in `voice/hf`), talking service + wrapper + cleanup.sh updated (`.bak-20261015-wa`
copies beside each). Prod DB migrations 0059–0061 (59 → 62). linuxg1: 42-file overlay, build 0, `pm2 restart clipwaltz
clipwaltz-gen-worker`. AI box: 6 worker files + `AISERVER_API_URL`/`AISERVER_API_TOKEN` in `.env.worker`, `clipwaltz-worker`
restarted. **Run migrations with the env loaded** — `drizzle-kit` does not read `.env.local` and otherwise falls back to an
unauthenticated localhost URL and exits 1 silently: `DATABASE_URL="$(grep ^DATABASE_URL= .env.local | cut -d= -f2-)" npx
drizzle-kit migrate`. Backups: linuxg1 `~/backups/clipwaltz-db-pre-wa-20261015-0232.dump` + `/tmp/cw-pre-wa-src.tgz`, AI box
`/tmp/cw-pre-wa-worker.tgz`, AISERVER `/data/clipwaltz-ai/backups/pre-wa-20261015-0232.tgz` (+ talking venv freeze).
Smoke test through the prod wrapper after the restart: transcription, presenter build and lip-sync all completed.
**Recording studio LIVE 2026-10-15 ~03:06 UTC** (camera/mic pickers, zoom, brightness, review — `webcam-recorder.tsx`):
deploy branch `deploy/waltz-avatar-20261014` @ `60c4ce2`; linuxg1 overlay of `src/components/webcam-recorder.tsx` (new) +
`avatars-manager.tsx` (backup `/tmp/avatars-manager.tsx.bak-20261015-rec`), build 0, `pm2 restart clipwaltz` (app only).
**Consent name fix LIVE 2026-10-15 ~04:00 UTC** (deploy branch `17db67f`): `aiserver/talking/consent.py` — a presenter
name word passes on a close match (`NAME_CLOSE` 0.6, env `CONSENT_NAME_CLOSE`; ≥ 0.8 for names of ≤ 4 letters), never
against the sentence's own words; `FACE_MIN` 0.7 → 0.6. Cause: speech recognition can't spell made-up names ("Lacyceo" →
"LACIO"/"Lacey"), so every real reading failed "Read the whole sentence… including your name". AISERVER backup
`consent.py.bak-20261015-name`; `clipwaltz-talking` restarted when idle. There is no presenter rename in the UI yet — the
owner's presenter was renamed "Lacyceo" → "Lacy" in the prod DB (status failed; the sentence is rebuilt from the name).

**Presenter picture quality (2026-10-15):** render encodes — `INTER_X264` (veryfast CRF 12) for every in-between file,
`FINAL_X264` for the delivered file (`FINAL_PRESET` default `medium`, `FINAL_CRF` default `18` in the render worker env);
Lanczos presenter scaling. **High** (`brief.presenter.quality`, priced in `render-actions.ts`, `PRESENTER_HQ_FACTOR` = 2 in
`src/lib/presenters.ts` + `worker/deck/presenter.mjs`): `presenterHq()` crops the lip-synced clip to the layout box,
runs the wrapper workflow `esrgan-upscale-v1` (RealESRGAN_x2plus), restores the source fps, muxes the narration back and
caches `presenters/<owner>/<id>/clips/<hash>-hq2-<W>x<H>-<faceHash>.mp4`; any failure → standard clip, and the render
settles the charge to the HQ seconds actually made. Full + split layouts only. **Framing:** `presenter.py prepare` returns
`face` (median face box, fractions) → `presenters.meta.face` → `presenterCropXY()`; presenters built earlier have no
`face` and use a window centred at 38 % of the height. **Workflow note:** the live `/opt/clipwaltz-ai/workflows/wan/
enhance.api.json` already wired the output frame rate to the source (`VHS_VideoInfoLoaded`); the repo copy was stale
(hard-coded 24) and is now in line — verified 2026-10-15: 25 → 25 fps and 30 → 30 fps through the live wrapper.

**Presenters from a photo or an AI face (2026-10-15):** AI faces LIVE on prod; **the photo option is off unless
`WALTZ_AVATAR_PHOTO=1`** in the app env (unset on prod — owner decision 2026-10-15: it waits for the lip-movement check;
set on dev). Off = the choice is hidden and `startPresenter`/`setPhotoFrame`/`submitPresenter` refuse photo presenters. `presenters.source` = `video` (default) | `photo` | `ai`
(kind stays `twin` = a user's own), `photo_at`, `build_charge_id`; **migration 0062** also makes
`generation_jobs.project_id` nullable (build charges have no project — access checks treat a null project as not found).
Flow: photo → consent clip (as usual) → `setPhotoFrame` → `submitPresenter` charges and queues `prepare`; the worker's
`photoBuild` runs **`presenter-consent-v1` with the consent clip as both `video` and `consent_clip`** (sentence + code +
face; the voice match is the clip against itself), cuts the frame at `photo_at` (centre 9:16 crop, 1280 tall, Lanczos)
→ `buildFromPortrait` (the library AI pipeline). ai → `createAiPresenter` (persona check) queues `portraits` (3 Wan stills,
free, logged as 0-credit `presenter_faces` jobs, cap 8/day, 3 rounds/presenter) → `pickFace` charges and queues
`ai_build`. **Charging:** `chargeAndQueue` writes a `generation_jobs` row `job_type='presenter_build'`, `status='generating'`,
`credits=30` in the same `spendCredits` transaction; `settleBuild` sets it `completed` when the presenter is ready, else
`failed` (= refunded). Queue unreachable → refunded at once. **Stuck builds:** the generation worker sweeps every 10 min —
presenters `queued`/`preparing` > 3 h → `failed` (a worker restart mid-build otherwise leaves them stuck forever), and
`presenter_build` charges still `generating` after 3 h with no build running → `completed` if the presenter is ready,
else `failed`. The owner may delete a presenter stuck > 3 h (refunded); deletion is conditional on the status in the
DELETE itself and refunds the charge the deleted row held. **Persona check:** `src/lib/persona-check.ts` → `OLLAMA_URL` `/api/generate`, model
`PERSONA_CHECK_MODEL` (default `qwen2.5:14b`), fails closed. Tested 7/7 on real/fictional samples (~0.4 s warm). Needs
`OLLAMA_URL` in the app env (prod already has it). No AISERVER changes.

**Large presenter footage (2026-10-15):** Cloudflare refuses request bodies over 100 MB (a 148 MB POST gets a 413 at the edge,
never reaching the app), so footage over 64 MB goes up in 8 MB parts: `POST /api/presenters/[id]/footage/upload` `{action:"init"}` →
`PUT …/upload?token&uploadId&partNumber` per part → `{action:"complete"}`. The parts form a MinIO multipart upload at
`presenters/<owner>/<id>/incoming-<token>`; on complete ffmpeg normalises it straight from MinIO (presigned LAN URL) and the
raw upload is deleted. Limit stays `FOOTAGE_MAX_BYTES` (400 MB). A Cloudflare **502** page during an upload is not this —
it means the app was down (e.g. mid-build during a deploy).

**Dev stack (AISERVER, beside the live services — never instead of them):** `aiserver/scripts/dev-avatar-stack.sh
start|stop|status` runs the talking service (`~/presenter-dev`, venv-full, :8193, GPU 1), the voice service (:8196, GPU 0)
and a wrapper (:8194) with inputs/outputs/logs in `/tmp/cwdev` and presenter caches in `/tmp/presenters-dev`. Local
workers: `ssh -fN -L 8194:127.0.0.1:8194 aiserver`, then `--env-file=.env.aiserver.local` (gitignored:
`AISERVER_API_URL=http://127.0.0.1:8194` + `AISERVER_API_TOKEN` from AISERVER `wrapper.env`). **Without it the dev worker
talks to the PRODUCTION wrapper.** Render worker on Windows also needs `CHROMIUM_PATH` (Playwright's chrome.exe).
Dev sign-outs every few minutes: another local app using Better Auth on another localhost port shares the
`better-auth.session_token` cookie (cookies ignore the port) — sign in again, or stop the other dev server.
**Biometric hygiene (2026-10-14):** the wrapper has `DELETE /inputs/<name>` (only `cw_<16 hex>.<ext>` names); the
generation worker and the render worker delete every input they staged when the job ends; `cleanup.sh` also removes
`presenters/dub-*` and half-built presenter caches (no `meta.json`) older than 2 h. **Cancel:** a user's cancel of a
translation is forwarded to the wrapper job; the talking service checks for it every 25 frames / each lip-sync batch.

## InfiniteTalk template — Connector 0.3 (2026-10-14)
Template `infinitetalk-v1` in `public/connector/clipwaltz-connector.mjs` (id also in `src/lib/computer-gpu.ts`
`COMPUTER_TEMPLATES.talkingHq` / `TALKING_ENGINES`). Core ComfyUI nodes only; needs ComfyUI ≥ 0.40
(`WanInfiniteTalkToVideo`, `BatchImagesNode`). `minVramMb` 20000 (24 GB class) unless the user starts the Connector with
`--allow-low-vram`. Worker `runComputer` sends `{ width, height, seed, frames }` (frames = speech × 25 + 1, ≤ 751); time
estimate `INFINITETALK_SEC_PER_SEC` (120, measured on 10 GB low-VRAM). Model list + licences: FEATURES.md.

## Video on users' own GPUs — Connector 0.2 (Phase C3, 2026-10-14)

**On/off:** the same switch as writing on users' computers — `/admin/ai` → **Users' own computers** (enabled + plans,
`app_settings.llm_providers.connector`). Checked when a job is created and again on Retry/Regenerate. Always 0 credits.

**Flow:** app (`createComputerJob` / `createTalkingPhoto` with `computerId`) → generation job with
`request_json.computer = { connectorId, template, name }` on the **cloud queue** (`<GENERATION_QUEUE>-cloud`, one
attempt, no ClipWaltz GPU slot) → worker `runComputer`: inserts `connector_jobs` (`kind = comfy.run`, `payload` =
template id + values, `inputs` = `{ name: { key, mime } }` server-only) → the Connector claims it, downloads inputs, runs
the template on local ComfyUI, uploads the MP4 (`connector/<connectorId>/<jobId>.mp4`), posts `result` → worker copies
it into the project (talking: AI label), deletes the row + temp objects.
- Timeouts: unclaimed 3 min ("is the Connector running?"), no progress ping 5 min ("lost contact"), total
  `GEN_COMPUTER_TIMEOUT_MS` (3 h). Cancel → row `expired` → the Connector's next progress ping gets `cancelled` and it
  interrupts only its own ComfyUI prompt.
- Templates (in `public/connector/clipwaltz-connector.mjs`; ids must match `src/lib/computer-gpu.ts`):
  `wan-i2v-v1` (core nodes, Wan 2.2 TI2V-5B fp8, tiled VAE decode) and `clipwaltz-talking-v1` (our node pack).
  The Connector reports per template `ready` or what's `missing` (node types, model files, < 8 GB VRAM) in `hello` →
  `connectors.comfy`; `connectors.gpu` from ComfyUI `/system_stats`.
- Speech for talking jobs: AISERVER wrapper `POST /tts` (Kokoro in `clipwaltz-talking`, CPU), stored at
  `connector-in/<genJobId>/speech.wav` for the job's duration.
- **Node pack:** source of truth `comfyui-clipwaltz/` in this repo; published to the **public GitHub repo
  https://github.com/phoenixtekk/ComfyUI-ClipWaltz** (owner decision 2026-10-14; Apache-2.0, `main`) and as the zip
  fallback. After any change: (1) `python scripts/build-comfyui-pack.py` → `public/connector/comfyui-clipwaltz.zip`
  (deterministic, ships with the next app deploy); (2) copy the folder into a clone of the GitHub repo (keep its
  `.gitignore`), commit and push — users update with `git pull`. Precomputed prompt embeddings
  (`prompt_embeds.safetensors`) were made with the service's umT5 (prompt "A person is speaking." + the negative prompt) —
  regenerate them if either text changes.
- **Limits (security review 2026-10-14):** own queue `<GENERATION_QUEUE>-computer` (`GEN_COMPUTER_CONCURRENCY`,
  default 20 — jobs only poll Postgres), at most **2 active computer jobs per user** and **5 computers per user**; the
  node pack's `download_models.py` pins Hugging Face commits and checks sha256 / git-blob hashes; vendored `torch.load`
  uses `weights_only=True`; the Connector accepts only UUID job ids and caps downloads while reading.
- Test machine used for C3: the owner's workstation, `G:\ClipWaltz-test-comfy` (ComfyUI portable 0.40.0, RTX 3080),
  Connector config in `G:\ClipWaltz-test-comfy\connector-home` (paired to the **dev** app only).

## Talking photo (Phase C2, 2026-10-13)

**On/off:** `/admin/ai` → Models **echomimic-v3** + Workflows **echomimic-talking-v1** (task `talking_photo`, seeded on by
migration **0057**). Both must be on; with either off the Generate tab hides *Talking photo* and the action/Retry refuse.
No routing rule (one model). Price and limit are code constants (`src/lib/talking-photo.ts` → `TALKING_QUALITY`):
Standard 1 credit/s (ESRGAN 2×), High 2 credits/s (SeedVR2 restore), 30 s max. **High** needs the restore workflow
(`seedvr2-restore-v1` + model `seedvr2`) on — switching it off greys High out and refuses High jobs/retries. A failed
restore falls back to ESRGAN and settles at the Standard rate. The talking service also accepts `quality: "high"`
(768×512 render, 81-frame chunks, 9.2 GB peak) — not used by the app (owner chose SeedVR2 instead, 2026-10-14).

**AISERVER service `clipwaltz-talking`** (systemd, user `lacy`, **127.0.0.1:8192 only**, bearer = the wrapper's
`CW_API_TOKEN` via `EnvironmentFile=/opt/clipwaltz-ai/config/wrapper.env`):
- Code `/opt/clipwaltz-ai/talking/service.py` (repo `aiserver/talking/service.py`); EchoMimic source
  `/opt/clipwaltz-ai/talking/echomimic_v3` = `github.com/antgroup/echomimic_v3` @ `7e89489` (unmodified); venv
  `/opt/clipwaltz-ai/talking/venv` (py 3.11, torch 2.6+cu124, transformers 5.19, kokoro 0.9 + `en_core_web_sm`; built
  with `uv` from the C0 spike's freeze); weights `/data/clipwaltz-ai/models/echomimic_v3` (28 GB: Wan2.1-Fun-V1.1-1.3B-InP,
  `emv3/echomimicv3-flash-pro`, chinese-wav2vec2-base); Kokoro weights offline in `/opt/clipwaltz-ai/talking/hf`
  (`HF_HOME`, `HF_HUB_OFFLINE=1`, copied from the AI box's `/opt/clipwaltz-tts/hf`). `espeak-ng` (apt) for non-English voices.
- **GPU 1** (`CUDA_VISIBLE_DEVICES=1`), model CPU offload — idle VRAM ≈ 0, peak **7.7 GB** per render; **~40 GB RAM** resident (all weights on the CPU). Models load in
  ~2 min at start (`GET /health` → `loaded`). One render at a time (internal queue).
- Env knobs: `TALK_CHUNK_FRAMES` (113), `TALK_OVERLAP` (8), `TALK_SAMPLE_SIZE` (512x384 pixel budget), `TALK_STEPS` (8),
  `TALK_MAX_SECONDS` (30), `TALK_DEBUG_MEM=1` (log VRAM per chunk), `TALK_GPU_COMFYUI` (ComfyUI on the same card).
- ⚠️ Do **not** set `PYTORCH_CUDA_ALLOC_CONF=expandable_segments` — it calls NVML, which fails while AISERVER's driver
  and libraries mismatch.
- Logs: `journalctl -u clipwaltz-talking` (`[talking] <job> chunk i/n … peak X GB`). Outputs land in
  `/data/clipwaltz-ai/output/clipwaltz/talking/<job>/` (swept by the hourly cleanup timer).

**Wrapper** (`aiserver/wrapper/app.py`): workflow id `echomimic-talking-v1` is forwarded to the talking service (not
ComfyUI); `/inputs` also accepts speech files. **GPU guard:** while a talking job is queued/running, new ComfyUI jobs
are sent only to the other card (`CW_TALKING_GPU_BACKEND`, default the 2nd `COMFYUI_URLS` entry); the service also waits
for that card's ComfyUI queue to be empty and calls its `/free` before rendering. A wrapper restart forgets in-flight
talking jobs (the worker then times out → failed + refunded), so restart it only when `/health` shows no active jobs.

**Worker:** `runTalking` stages photo/recording, polls (timeout `GEN_TALKING_TIMEOUT_MS`, default 60 min), runs
`esrgan-upscale-v1` 2× (skipped with a log line if it fails), puts the speech back, burns the **"AI-generated"** label
(font: `AI_LABEL_FONT` or DejaVu Sans Bold) and settles `generation_jobs.credits` to the rendered seconds.

**Uploads:** `POST /api/projects/:id/talking-audio` (editor role) → ffmpeg normalises to mono AAC ≤ 30 s → MinIO
`talking/<projectId>/<uuid>-<ms>ms.m4a` (the length in the key prices the job; only this route writes that prefix).
Swept with the project on delete.

**Consent record:** `generation_jobs.request_json.consent` = `{confirmed, text, at, userId}`.

**NVENC dependency:** Real-ESRGAN / RIFE encode with `h264_nvenc`, which fails ("No capable devices found") whenever the
NVIDIA kernel module and libraries differ (happened 595.91 vs 595.99 until the 2026-10-14 reboot). Talking clips then stay
at their native size. Since 2026-10-14 all NVIDIA `*-595*` packages are **`apt-mark hold`** on AISERVER; to update the driver:
`apt-mark unhold` → upgrade → **reboot** → check `nvidia-smi` and one ESRGAN job → hold again.

## Outside AI models for writing (2026-10-13)
`/admin/ai` → **Writing & planning models**. Providers: Claude (`@anthropic-ai/sdk`), ChatGPT (`openai`), DeepSeek and
Gemini (both via `openai` with fixed base URLs `https://api.deepseek.com` / `https://generativelanguage.googleapis.com/v1beta/openai/`).
- **Turn one on:** switch **On**, tick plans, optionally change the model names (defaults: `claude-opus-5-5`,
  `gpt-6-astra`, `deepseek-flash`, `gemini-3.8-flash` — checked against vendor docs 2026-10-13), **Save**. Then either paste
  ClipWaltz's key → **Test & save** (a tiny real call; nothing is saved if it fails) and/or switch on **Users can add their
  own key**. A provider is offered only when it's on, has ≥ 1 plan, and has a platform key or allows own keys.
- **Storage:** settings + encrypted platform keys in `app_settings` key `llm_providers`; last success/failure per provider
  in `llm_provider_status`; user keys in `user_ai_keys` (encrypted, `key_last4`, `last_error`), choices in `ai_prefs`.
  Encryption = `src/lib/cloud/crypto.ts` (AES-256-GCM) with **`TOKEN_ENC_KEY`** — the app **and** `clipwaltz-gen-worker`
  (both load `.env.local` on linuxg1) need it. Rotating `TOKEN_ENC_KEY` makes stored keys unreadable (jobs fall back to the
  built-in model; users/admin re-enter keys).
- **Limits:** **Daily limit per user on ClipWaltz's key** (per provider card, default 30 AI jobs/user/day, UTC; counted in
  `ai_prefs.platform_jobs` / `platform_day` across ClipWaltz keys) — over it the job uses the built-in model (worker log
  `[llm] <user> reached today's N-job limit …`). Key tests: 5 per user per 10 min per app instance.
- **Runtime:** `enqueueDeck` (src/lib/queue.ts) stamps each job with the signed-in user who started it (`userId`);
  `worker/deck/jobs.mjs` `withUserModel` resolves that user's choice (project owner if absent) per job (`resolveLlm`: provider
  on + plan allowed + key present, else built-in) and runs it in `llmScope`; `planner.mjs` `chatJson` calls the outside
  model, extracts the JSON (one retry), and on any error logs `[deck] <provider>/<model> failed (…) — using the built-in
  model`, records the error and finishes the job on Ollama. Worker log line per job: `[deck] job <name> <id> → <provider>/<model> (<own|platform> key)`.
- **Vendor notes:** Claude streams with `output_config.effort: "medium"` and `fallbacks: "default"` (beta
  `server-side-fallback-2026-07-01`) on Fable 5.1 / Opus 5.5 / Opus 5 / Sonnet 5.5; OpenAI uses `max_completion_tokens` and
  JSON mode, no temperature; DeepSeek `max_tokens` + JSON mode; Gemini gets neither (not documented on its OpenAI endpoint).
- **Billing:** platform-key usage is billed to the vendor accounts whose keys are saved here; no ClipWaltz credits are
  charged for it yet. User keys bill the user's own vendor account.
- **Privacy:** brief text, scene text and photo/clip frames are sent to the chosen vendor (the UI says so). Next's dev
  server logs server-action arguments (incl. pasted keys) — dev only, not `next start`.
- **Cloud video models (Phase C1, 2026-10-13):** `/admin/ai` → **Video models**. Settings: `app_settings`
  `video_providers` `{kling|runway|minimax: {enabled, plans, allowOwnKey, platformKeyEnc, platformKeyLast4, dailyLimit,
  credits{modelId}, disabledModels}}`; user keys in `user_ai_keys` (provider `kling`/`runway`/`minimax`). Vendor APIs:
  Kling `https://api-singapore.klingai.com` (Bearer API key), Runway `https://api.dev.runwayml.com` (Bearer +
  `X-Runway-Version: 2024-11-06`), MiniMax `https://api.minimax.io` (Bearer). Worker: queue `<GENERATION_QUEUE>-cloud`,
  `GEN_CLOUD_CONCURRENCY` (default 4), `GEN_CLOUD_TIMEOUT_MS` (default 30 min); log lines `[gen] <job> → <model> task <id>
  (<own|platform> key)` and `[gen-cloud] FAILED <job>: <vendor reason>`. The vendor task id is stored in
  `generation_jobs.request_json.cloud.taskId` (look it up in the vendor console). `VIDEO_BASE_KLING/RUNWAY/MINIMAX` exist
  **only** to point a dev worker at a local mock — never set them in prod. Runway requires a "Powered by Runway" credit
  (shown under the picker). Vendor outputs: Kling files deleted after 30 days, Runway URLs expire in 24–48 h, MiniMax URLs
  are time-limited — the worker copies every clip into MinIO at once. A ClipWaltz-key clip is marked
  `request_json.cloud.submitting` just before it is sent; from then on Cancel is refused (the vendor may bill it). The
  daily cap counts queued/running/completed ClipWaltz-key clips plus failed ones that reached the vendor (`cloud.taskId`).
- **Users' own computers (ClipWaltz Connector, 2026-10-13):** `/admin/ai` → **Users' own computers** (on + plans; stored
  as `llm_providers.connector`). Routes `/api/connector/{pair/start,pair/poll,hello,jobs/next,jobs/:id/result}` are in
  `src/proxy.ts` PUBLIC_PATHS (device-code / bearer-token gated; tokens stored as sha256 in `connectors.token_hash`).
  `pair/start` is limited to 10 per IP per 10 min (IP from `cf-connecting-ip`); code look-ups/approvals 10 per user per
  10 min; replies ≤ 64 KB. `jobs/next` long-polls ≤ 25 s (one claim query every 2 s; one open poll per computer per app
  instance). The approval page never pre-fills the code and shows the pairing's name/system/version/age/origin
  (`connector_pairings.origin` = `cf-ipcountry · IP`, migration 0056). Relay rows (`connector_jobs`) are deleted by the worker after each answer; pairings expire after 10 min.
  The program is served from `public/connector/` — bump `VERSION` in it when it changes. Worker log:
  `[deck] job … → connector/<model> (user's computer)`; a dead computer costs that job ≤ 45 s before the built-in model takes over.
- **Deploy:** `npm ci` on linuxg1 (new deps `@anthropic-ai/sdk`, `openai`) → migrate 0053 + 0054 → build → restart `clipwaltz`
  **and** `clipwaltz-gen-worker`.

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

## Social Publishing — P1 publishing core (2026-11-14, ADR-0011)
Port of publish.phoenixtekk.com's publishing core (plan `docs/PREDIS_PARITY_AND_PUBLISH_MERGE_PLAN.md` §4, P1). **No UI
yet** (P2); behind `SOCIAL_PUBLISHING_ENABLED` (off → only `ADMIN_EMAILS` accounts). **Deployed to prod 2026-11-14** (see P4 below).
- **Schema:** `0064_social_publishing` — `social_connections`, `social_posts` (+ `render_id`/`export_id`, D9
  `approval_status`/`approved_by`/`approved_at`), `social_post_targets` (+ `metrics`), `social_media` (`storage_key`),
  `social_auto_rules` (+ per-rule `timezone`), `social_auto_presets`, `social_snippets`, `social_ai_generations`;
  `workspace_members.social_approver`. `0065_social_comments_cache` — `social_post_targets.comments/comments_at`.
  Both applied to **dev** (`clipwaltz_dev`) only. ⚠️ This branch's schema lacks `render_workers` and the 0052 lease
  columns that exist in the db; a plain `drizzle-kit generate` therefore emits `DROP COLUMN`s for them — the 0064/0065
  SQL had those removed and their snapshots keep the columns. Check every future generate on this branch for DROPs.
- **Code:** `src/lib/social/**` (adapters in `publishing/providers/*` — 23, history comments intact), API under
  `src/app/api/social/**`. Tenancy: everything is owned by a **workspace**; viewer+ reads, editor+ publishes, admin+
  connects/disconnects/pauses, approver = owner/admin or `social_approver` (`src/lib/social/access.ts`). Channel limits
  (`src/lib/social/limits.ts`): Free 0 / Plus 10 / Pro 25 per workspace, from the workspace **owner's** effective tier;
  no credits charged for publishing.
- **Credentials:** encrypted at rest with `TOKEN_ENC_KEY` (`src/lib/cloud/crypto.ts`, `enc1:` prefix); the worker must
  have the same key. Never returned to clients (`publicConnection`). No env-credential destinations: the adapters'
  old `FACEBOOK_PAGE_*` / `LINKEDIN_*` fallbacks are unreachable because `publishToTargets` refuses any target without a
  workspace connection.
- **OAuth:** one route pair, `/api/social/oauth/<provider>/start?workspace=<id>` → `/callback`. Register this redirect URI
  with each provider: `https://www.clipwaltz.com/api/social/oauth/<provider>/callback` for facebook (also adds the
  Pages' linked Instagram accounts), linkedin, threads, pinterest, tiktok, tumblr, x, youtube; Mastodon self-registers
  per instance (`?instance=`). Paste-credential networks: `POST /api/social/connections/<provider>` (bluesky, telegram,
  discord, slack, teams, discourse, devto, medium, email, txtya, reddit, facebook_group, instagram, and token-paste
  x/youtube/tiktok). User-typed hosts (Discourse, Mastodon, Teams/TxtYa webhooks) go through `safeFetch`
  (`src/lib/social/safe-fetch.ts`): resolves DNS once, refuses private / loopback / link-local / CGNAT / ULA /
  multicast / metadata ranges (IPv4 + IPv6 incl. IPv4-mapped, NAT64, 6to4), connects only to the vetted IP (undici
  Agent `connect.lookup`), follows at most 3 redirects itself and re-vets each hop. "That address is not a public
  server." on a connect or a failed target = this guard. Teams URLs must be `https://*.webhook.office.com` /
  `*.logic.azure.com` (parsed, not regex); TxtYa `https://(www.)txtya.com/api/hooks/…`. Failed targets store the HTTP
  status + a short sanitized message, never the upstream body.
- **OAuth state cookie** (`social_oauth_<provider>`) is HMAC-sealed (`src/lib/social/oauth/state-cookie.ts`, key
  derived from `SOCIAL_OAUTH_STATE_SECRET` or `BETTER_AUTH_SECRET`, bound to the provider, 10 min). An edited or
  expired cookie → callback "state cookie missing or invalid". Mastodon's instance is re-normalized and re-vetted at
  the callback. Rotating the secret only breaks connects in flight.
- **TxtYa:** the webhook URL is the secret; `externalId` is `hook:<sha256 prefix>` (rows from before 2026-11-14 hold
  the hook's last path segment — `publicConnection` never returns externalId for txtya).
- **Channel limit on updates:** a paste-connect with `id` skips the plan check only when that id is this workspace's
  connection **of the same network** (`isInPlaceUpdate`); any other id is saved as a new row and counted.
- **Public endpoints** (in `src/proxy.ts` PUBLIC_PATHS): `/api/social/media/public/<id>?exp&sig` (HMAC, 6 h; 302 to a
  1 h presigned GET on `media.clipwaltz.com`, or proxied when the storage edge is off) and
  `/api/social/webhooks/threads/{deauthorize,delete}` (Meta `signed_request` verified with `THREADS_CLIENT_SECRET`;
  deletes that Threads user's connections). Register both Threads URLs in the Threads app.
- **Worker:** `worker/social-worker.mjs`, queue `clipwaltz-social` (dev: `clipwaltz-social-dev` when
  `GENERATION_QUEUE=clipwaltz-generation-dev`). Run from the repo root:
  `node --env-file=.env.local --import tsx worker/social-worker.mjs` (pm2 name `clipwaltz-social-worker` — there is no
  ecosystem file; the exact pm2 start line is decided at deploy — the process needs the two node flags above and the
  repo root as cwd. Not yet run under pm2 or against Redis).
  Jobs: `publish-target` (idempotent on the target row: pending → publishing claim), `sweep` (every 60 s: token refresh,
  due scheduled posts — skipping posts awaiting approval —, Auto Post slots, stuck/lost targets, retries 2/10/30/120 min),
  `metrics-pull` (hourly), `comments-pull` (on demand). Replaces SP's crontab + `/api/cron/run`.
  One-shot: `… worker/social-worker.mjs --sweep-once [--inline]`, `--metrics-once`.
- **Self-test (no live posting):** `node --env-file=.env.local --import tsx scripts/social-selftest.mts` — refuses to run
  unless `DATABASE_URL` is `clipwaltz_dev`; creates and deletes its own rows.
- **Env:** see the Social Publishing block in `env.example`.
- **Not in P1:** UI (P2), Auto AI image/video (P3 — such posts publish without and say so in `warnings`), podcast
  destination and explainer rules (P5), product grounding for Auto Post (funnels stay on SP, D3).

## Social Publishing — P2 Publish screens (2026-11-14, ADR-0011)
**Deployed to prod 2026-11-14** (flag off — see P4 below). Same flag as P1: `SOCIAL_PUBLISHING_ENABLED=1` shows Publish to everyone; unset → only
`ADMIN_EMAILS` accounts see the nav entry, the `/publish` pages (others get a "coming soon" card) and the Publish
buttons. Everything works on the caller's **personal workspace** in P2.
- **Routes:** `src/app/(app)/publish/**` (overview, compose, posts, drafts, favorites, shared, calendar, auto, by-hand,
  analytics, comments, networks); public `src/app/r/[token]` and `src/app/setup-guide` (both in `src/proxy.ts`
  PUBLIC_PATHS). UI components `src/components/publish/*` (shadcn/ui: card, tabs, dialog, select, textarea, badge,
  calendar, popover, table, switch, checkbox, tooltip, sheet, separator, skeleton, alert, progress; new deps
  `react-day-picker`, `date-fns`).
- **Server side:** read models `src/lib/social/ui.ts` (server-only), server actions `src/lib/social/ui-actions.ts`
  (each re-checks `requireSocial` and scopes ids to the workspace; errors return as `ActionResult`), page guard
  `src/lib/social/page-context.ts`, client-safe types `src/lib/social/ui-types.ts`.
- **Chunked uploads:** `POST /api/social/media/multipart` (`init` / `complete` / `abort`) +
  `GET|PUT /api/social/media/<id>/part` (presigned direct PUT when the storage edge is on, else proxied). Keys are
  `social/<workspace>/<id>` derived from the caller's workspace; the `social_media` row is written on complete.
  Files over 40 MB use it; 200 MB cap.
- **Publish button → composer:** `?render=<id>` / `?export=<id>`. Access = `userCanAccessProject`. On save the
  video is **copied** server-side (`copyObject` in `src/lib/storage.ts`, S3 CopyObject) to `social/<workspace>/<id>`
  (`social_media.source='render'`), so deleting the render later does not break the post.
- **Email destination:** `POST /api/social/connections/email` returns 403 unless the caller's email is in
  `ADMIN_EMAILS` (it sends through our SES identity). The Networks page hides the card for everyone else. Existing
  email connections keep working for their workspace. **Daily cap:** each workspace may send at most
  `SOCIAL_EMAIL_DAILY_CAP` (default 200; `0` = no email sends) Email targets per rolling 24 h, counted from
  `social_post_targets` (published, provider `email`) — survives restarts. Over the cap the target fails with "Email not
  sent: this workspace has reached its cap…" and is not retried; publish it again later. Every message carries
  `List-Unsubscribe: <mailto:EMAIL_FROM?subject=unsubscribe>` (`SOCIAL_EMAIL_UNSUBSCRIBE` overrides with an address or
  an `https:` URL); unsubscribe mails arrive at the From mailbox and are handled by hand (remove the address from the
  destination).
- **Role per screen** (page guard + the same check again in every server action/API): viewer+ reads Overview, Posts,
  Favorites, Shared, Calendar, Analytics, Comments and Networks. **Editor+** for Compose, Drafts, Auto Post, Post by
  hand and replying to comments; a viewer opening those gets a "Editors and above only" card. **Admin+** for
  connect / disconnect / pause / AI brief / Pinterest board on Networks (viewers and editors see the list read-only).
- **Review links:** `social_posts.share_token` (24-char base64url). Turning a link off clears the token (`/r/<token>`
  then 404s). The page shows text, per-network versions, media previews (signed URLs), no workspace data.
- **Runbook:** a post stuck "Publishing" → the social worker is not running or Redis is down (P1 runbook). "Choose a
  board" on Pinterest → the account has several boards; use **Board** on Networks. Comments empty → press Refresh (it
  runs the comments pull inline); only FB/IG/Threads/Bluesky are supported.

## Waltz Image — P3 images, carousels, memes (2026-11-14, ADR-0011)
**Deployed to prod 2026-11-14** (see P4 below; brand fonts installed on linuxg1 2026-11-14). Not behind the social flag (the Publish button on a design is, like every Publish button).
- **Env (all optional, defaults shown):** `IMAGE_COMFYUI_URL=http://192.168.166.183:8188` (decision D1 — the ComfyUI box
  Social Publishing uses; must be reachable from the **generation worker** host, linuxg1: checked 2026-11-14,
  `/system_stats` → 200), `IMAGE_COMFYUI_CKPT=flux1-schnell-fp8.safetensors` (CheckpointLoaderSimple; Flux → euler /
  simple / cfg 1 / `IMAGE_COMFYUI_STEPS` default 6; an SDXL checkpoint switches to dpmpp_2m / karras / cfg 6.5 / 30),
  `OLLAMA_URL` + `IMAGE_PROMPT_MODEL=qwen3.8:27b` (brief → image prompt, `think:false`; on failure the brief is used
  as-is), `IMAGE_FONTS_DIR` (extra .ttf/.otf for the compositor). No new secrets.
- **Fonts:** the compositor runs in the **web app** (previews, downloads, Save, Publish). Brand-kit fonts (Montserrat,
  Inter, Lato, Open Sans, Roboto, Noto Serif) must be installed there or in `IMAGE_FONTS_DIR`. **linuxg1: installed
  2026-11-14** via apt (`fonts-montserrat fonts-inter fonts-lato fonts-open-sans fonts-roboto fonts-noto-core`;
  `dpkg -l` and `fc-list` re-checked 2026-11-14 in P7). A server without them falls back to Liberation Sans and the
  studio shows "Brand font not on this server" — install the same packages (or set `IMAGE_FONTS_DIR`) and restart.
- **Pipeline:** `createImageJob` (`src/lib/image-ad/jobs.ts`) charges `IMAGE_COST` (2) and inserts
  `generation_jobs(job_type='image', workflow_name='comfy-image')` + the pending `image_design_images` row in one
  transaction, then enqueues on `GENERATION_QUEUE`. `worker/generation-worker.mjs` → `worker/image/job.mjs`
  `runImageJob` → `worker/image/comfy.mjs` (submit `/prompt`, poll `/history`, fetch `/view`, cancel via `/queue`
  delete) → `fitCover` to the exact size → MinIO `images/<ws>/<designId>/pic/<imageId>.png`. Failure → BullMQ retry
  (2 attempts) → `failed` → refunded automatically. Text is composited on demand by `GET /api/images/<id>/render`
  (`worker/image/compose.mjs`); ZIP `GET /api/images/<id>/zip`; uploads `POST /api/images/<id>/upload` (PNG/JPEG/WebP,
  20 MB, decoded to reject non-images); clean pictures `GET /api/images/<id>/picture/<imageId>`. Save to library →
  `media` rows (`images/<ws>/<id>/out/<mediaId>.png`); Publish → unattached `social_media` rows →
  `/publish/compose?media=<ids>&from=<design>` (only unattached images of the caller's workspace are accepted).
- **Auto AI Image (social posts):** `publishPost` → `src/lib/image-ad/post-image.ts`: post → `rendering`, one image job
  with `request_json.socialPostId`; the worker attaches a `social_media` row (`source='ai'`) and sets the post
  `scheduled`, due now; the social sweep publishes it. Final failure → `afterImageJobFailure` releases the post, which
  then publishes without a picture and a warning. One job per post, ever. The social worker can spend credits because
  the ledger now lives in `src/lib/credits-ledger.ts` (no `server-only`; `credits-server.ts` re-exports it with the guard).
- **Data:** migration **0066** `image_designs` (kind check `image|carousel|meme`) + `image_design_images` (source
  check `ai|upload`). `generation_jobs.job_type` has no check constraint, so `'image'` needed none. drizzle-kit wanted
  to DROP the drifted lease columns (`deck_exports`/`renders`/`media` worker+heartbeat, `renders.priority`) and
  `render_workers`; those lines were removed by hand and the 0066 snapshot keeps them.
- **Verify (dev DB only):** `node --env-file=.env.local scripts/verify-image-presets.mjs --email <dev account>` renders
  one image per preset through `runImageJob` and checks exact sizes + compositor determinism; `--fail` checks the
  refund. Uses 2 credits per preset on that account.
- **Dev note:** without Redis, enqueue in dev waits forever (ioredis offline queue) — run a local Redis and set
  `REDIS_URL` + a dev `GENERATION_QUEUE` to try Make with AI locally; never point dev at prod's queue names.
- **Runbook:** pictures stuck "Painting…" → generation worker not running / Redis down / `.183` busy (check
  `curl http://192.168.166.183:8188/queue`). "The image server has work waiting and nothing running" → restart ComfyUI
  on .183. Every picture failing with "Prompt outputs failed validation" → `IMAGE_COMFYUI_CKPT` not on the box
  (`/object_info/CheckpointLoaderSimple`).

## Social Publishing — P6b store catalogs, API + MCP, ads export, competitors, PWA (2026-11-14, ADR-0011)
Plan §6 G10, G12, G13, G11, G7, G16 (G17 not built — D8 deferred). Migration **`0070_p6b_api_commerce_competitors`**
(additive: `commerce_connections`, `api_keys`, `api_requests`, `api_idempotency`, `competitor_sources`,
`competitor_posts`; `product_sources.connection_id / external_id / available` + unique (connection_id, external_id)).
No DROP lines (checked). No new npm packages, no new env vars. Acceptance test: `scripts/test-p6b.mts` (below).
**Deployed to prod 2026-11-14** — deploy branch `deploy/social-p6b-20261114` @ `c08fdc3`. linuxg1 backups
`~/backups/clipwaltz-{src,db,next,package-lock}-pre-social-20261114-p6b*` + `.env.local.bak-pre-social-20261114-p6b`;
59-file overlay (prod's 14 modified files matched `a5823cc` first, line endings aside); migration 0070 (70 → 71 rows;
drift columns `render_workers` + 0052 lease columns verified present); no npm/env changes; `next build` exit 0;
`pm2 restart clipwaltz clipwaltz-gen-worker clipwaltz-social-worker`. Flag still unset. Rollback: restore the src tarball +
`.next` copy, restart the three; 0070 is additive and can stay.
- **New public paths (`src/proxy.ts`):** `/api/v1/*` and `/mcp` (gated per request by API key), `/api/commerce/<shopify|woocommerce>/webhook/<id>`
  (HMAC-gated), `/manifest.webmanifest`, `/offline`.
- **G12 API keys (`src/lib/api-keys.ts`):** secret `cwk_` + 43 base64url chars, shown once; `api_keys.hash` = SHA-256 hex,
  `prefix` = first 12 chars. Scopes `read | generate | publish`. **Pro gate** = the workspace OWNER's `getEffectiveTier`
  on every request (403 `plan_required`); a key acts as its creator (must still be a member; viewer → can't create).
  Social endpoints also obey `SOCIAL_PUBLISHING_ENABLED` (flag off → only `ADMIN_EMAILS` creators). Rate limit 60/min +
  1,000/h per key counted from `api_requests` (429 + Retry-After); rows > 7 days and idempotency rows > 24 h are pruned
  opportunistically. Revoke = `revoked_at` (row kept). Operations: `src/lib/api/v1.ts`; spec `src/lib/api/openapi.ts`.
  **Runbook:** "401 not valid" = revoked/unknown key; "403 plan_required" = owner not on Pro (keys come back after an
  upgrade); "403 forbidden … no longer in the workspace" = creator left — make a new key; to kill every key of a
  workspace: `update api_keys set revoked_at = now() where workspace_id = '<ws>' and revoked_at is null`.
- **G13 MCP (`src/lib/api/mcp.ts`, route `src/app/mcp/route.ts`):** Streamable HTTP, stateless (no `Mcp-Session-Id`),
  JSON responses only, GET → 405. Supported protocol versions 2025-11-25 / 2025-06-18 / 2025-03-26 / 2024-11-05 (unknown
  `MCP-Protocol-Version` → 400). Origin header, if present, must be the app's own origin. Tool refusals come back as
  `isError: true` tool results; auth/rate failures as HTTP 401/403/429.
  Manual check: `curl -s https://www.clipwaltz.com/mcp -H "Authorization: Bearer cwk_…" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`.
- **G10 store catalogs (`src/lib/commerce/{catalog,sync,actions}.ts`):** Shopify = public `/products.json?limit=250&page=N`
  + `/meta.json` (name, currency); WooCommerce = public Store API (prices in minor units); Wix = `POST
  https://www.wixapis.com/stores/v3/products/query` with the owner's API key + `wix-site-id` (V1 `stores/v1/products/query`
  fallback). Up to 250 products per sync; products missing from a COMPLETE read are deleted. All store hosts go through
  `safeFetch` (SSRF guard). Wix key + webhook secrets encrypted with `TOKEN_ENC_KEY`. 429s are retried twice with the
  store's Retry-After. **Shopify rate-limits storefront JSON per IP:** the workstation was 429'd after a burst on
  2026-11-14 while linuxg1 read beardbrand (69), kith (250) and allbirds (250) fine. Webhooks: Shopify `X-Shopify-Hmac-Sha256`
  (secret = the signing secret shown under Shopify Settings → Notifications → Webhooks, pasted by the owner),
  WooCommerce `X-WC-Webhook-Signature` (secret generated by ClipWaltz, shown once); WooCommerce's unsigned
  `webhook_id=<n>` ping gets 200. **Owner actions for more:** password-protected / headless Shopify shops and Shopify
  App-Store distribution need a Shopify Partner app (create in partners.shopify.com, then App Store review); Wix webhooks
  and Wix App Market listing need a Wix app (dev.wix.com) — not needed for the key-based sync.
- **G11 ads export (`src/lib/image-ad/ads-export.ts`, `POST /api/images/ads-export`):** Google CSV headers are the names on
  Google Ads Editor Help "CSV file columns" (support.google.com/google-ads/editor/answer/57747) except **Asset group**,
  which that page does not list (map it in Editor's import preview if needed); limits from "Performance Max campaigns
  specs" (support.google.com/google-ads/answer/17091269). **Meta CSV headers are UNVERIFIED** against Meta's own template
  (Meta's help pages refused automated access) — first real import: download Ads Manager's blank import template and
  compare; adjust `META_COLUMNS` if a name differs. Objective is written as "Outcome Traffic"; all statuses PAUSED.
  CSV cells starting with = + - @ are prefixed with `'` (spreadsheet formula injection).
- **G7 competitors (`src/lib/competitors.ts`):** sources rss / bluesky (public.api.bsky.app getAuthorFeed, reposts skipped,
  paged to 20) / mastodon (instance REST API via safeFetch). Feeds: robots.txt checked for UA
  `ClipWaltzCompetitorReader/1.0` (longest-match). Newest 50 posts kept per source. AI summary = AI Box
  (`SOCIAL_AI_MODEL`, default qwen3.8:27b, `num_predict` 2500), stored on the source. Max 25 sources per workspace.
  No background job: sources refresh when someone presses Refresh (plan's `competitor-pull` repeatable job not built).
- **G16 PWA:** `src/app/manifest.ts` → `/manifest.webmanifest`; icons `public/icons/` (192, 512, maskable 512,
  apple-touch 180; made from `public/logo-2.png`); `public/sw.js` now caches `/offline` + one icon at install
  (`cw-offline-v1`) and answers failed page navigations with it — nothing else is cached or intercepted; push handlers
  unchanged. Registered on every page by `src/components/pwa-register.tsx` (same `/sw.js`, scope `/`, as
  `src/lib/notify-client.ts`). To change the offline page, bump `OFFLINE_CACHE`.
- **Acceptance test (DEV only):** start a dev server, then `node --env-file=.env.local --import tsx scripts/test-p6b.mts
  http://localhost:3010` — 22 checks: key hash-at-rest, Pro gate, scopes, viewer key, cross-workspace 404, Idempotency-Key,
  rate limit, revoke; MCP initialize → tools/list → tools/call; webhook HMAC + disconnect cascade; live WooCommerce sync
  (≥ 25 products) + re-sync restores a changed title/price; CSV columns; feed parsing + robots. `P6B_SKIP_LIVE=1` skips
  the live store; `P6B_SHOPIFY_LIVE=1` adds a live Shopify read (run from linuxg1 — see above).

## Social Publishing — P6a approvals, best times, workspaces, plan, product links, estimate (2026-11-14, ADR-0011)
Plan §6 G9, G6, G15, G14, G4, G3, G8. Same flag (`SOCIAL_PUBLISHING_ENABLED`); the workspace switcher and the product
link are not behind it.
**Deployed to prod 2026-11-14** — deploy branch `deploy/social-p6a-20261114` @ `8db2cc2`. linuxg1 backups
`~/backups/clipwaltz-{src,db,next,package-lock}-pre-social-20261114-p6a*` + `.env.local.bak-pre-social-20261114-p6a`;
59-file overlay; migration 0069 (69 → 70 rows); no npm/env changes; `next build` exit 0;
`pm2 restart clipwaltz clipwaltz-gen-worker clipwaltz-social-worker`; AI box unchanged. Rollback: restore the src tarball +
`.next` copy, restart the three processes; 0069 is additive and can stay.
- **Schema (migration `0069_p6_approval_products`, additive):** `workspaces.social_require_approval` (bool, default
  false), `social_posts.plan_id` / `plan_angle`, `social_post_reviews` (post, workspace, reviewer user | `via_token`,
  `reviewer_name`, decision `submitted|approved|changes_requested` check, note), `product_sources` (workspace, url,
  title, description, price/currency as text, brand, images jsonb, source `jsonld|og|text`). Generated cleanly — no drift
  DROP lines this time (checked).
- **G9 approval gate:** `src/lib/social/approval.ts` (no `server-only`; the worker uses it). `approvalBlock` is called by
  `publishPost` for every path (manual, scheduler, Auto Post, API); `publishableApprovalSql()` is in the scheduler's due
  query (`dueScheduledPosts`) and the Auto Post queue pick. States: `none` (publishable only if the workspace does not
  require approval), `pending`, `approved`, `rejected` (UI: "Changes requested"). The server decides the state on every
  save (`approvalOnSave`); an approver's own save = approved. Review-link decisions: `POST /api/social/review/<token>`
  (public path in `src/proxy.ts`; only a `pending` post; a revoked link 404s). Notifications: `sendPushToUser` + SES to
  approvers on submit, to the author on a decision (best effort; `SOCIAL_NOTIFY_DISABLED=1` switches them off — the
  self-test sets it). Approver toggle and the workspace setting: `setMemberApprover` / `setWorkspaceApprovalRequired`
  (`src/lib/workspace-actions.ts`, admin+).
- **G15 workspaces:** active workspace = cookie `cw_ws` (httpOnly, 1 year), read by `activeWorkspaceId`
  (`src/lib/active-workspace.ts`), which re-checks membership and falls back to the personal workspace. `requireSocial(null)`,
  `createProject` (when no `?ws=`), Waltz Image designs and the product pack use it. `createWorkspace` limit on OWNED
  workspaces: Free 1 · Plus 1 · Pro 5 (`WORKSPACE_LIMITS`, owner's effective tier). Not built: deleting a workspace,
  moving projects between workspaces.
- **G6:** `src/lib/social/best-time.ts` — samples = published targets with metrics (latest `social_post_targets.metrics`;
  no history table was added — the plan's `social_post_metrics` is not needed for this), bucketed in `getAppTimezone()`.
  `MIN_POSTS` 10, `MIN_BUCKET` 2, `WINDOW_DAYS` 90. General guidance = Tue 9 / Wed 12 / Thu 17 (Tue 19 / Thu 19 / Sat 11 for
  TikTok/Instagram/YouTube/Threads/Pinterest/Tumblr), placed in the viewer's own time zone, labelled.
- **G14:** `src/lib/social/content-plan.ts` (`buildPlan` writes nothing; `savePlan` inserts drafts with `scheduledAt`,
  `plan_id`, `plan_angle`). Embeddings: AI Box `nomic-embed-text` (`SOCIAL_EMBED_MODEL` overrides). Threshold 0.94, 3 tries,
  ≤ 21 posts. `saveContentPlan` refuses unless the confirmed credits equal `planCredits` (AI picture 2 × posts, charged by
  the existing Auto AI Image path when each post publishes). Dev acceptance: `scripts/test-p6-plan.mts` (DEV DB, real AI
  Box, writes nothing).
- **G4:** `src/lib/social/copy.ts` (AI) + `src/lib/social/hashtags.ts` (pure caps / normalise). Action
  `writeCopyForNetworks`.
- **G3:** `readProduct` + the `--product` diagnostic in `worker/deck/importer.mjs`; app actions `src/lib/product-actions.ts`.
  Photos are fetched with the same `fetchPublic` (≤ 15 MB, PNG/JPEG/WebP, ≥ 200 px) and stored as Waltz Image uploads.
  **SSRF guard change:** `isPrivateAddress` refused all of 192.0.0.0/16; it now refuses 192.0.0.0/24 and 192.0.2.0/24
  only (the rest is public — e.g. Automattic's 192.0.64.0/18 serves WordPress.com / WooCommerce shops). That file is also
  used by WaltzDeck URL import and brand-from-site in the generation worker (linuxg1), so those now accept such sites too.
  Diagnostic: `node worker/deck/importer.mjs <url> --product`. Shops that answer 403/429 to automated readers get a plain
  message.
- **G8:** `src/lib/social/score-checks.ts` (pure, composer) + `src/lib/social/score.ts` (calibration, AI critique).
  Calibration cached 24 h in `app_settings` key `social:score-calibration:<workspace>`. Read-only report:
  `node --env-file=.env.local --import tsx scripts/score-calibration.mts <owner email>`.
- **Self-test:** `scripts/social-selftest.mts` section 6 (G9 gate + scheduler + review token, G15 isolation, G6 fixture,
  G14 dedupe, G4, G8, G3 parse + SSRF). DEV DB only; creates and deletes its own users/workspaces.
- **Runbook:** a post "Awaiting approval" never goes out by design — approve it (Approvals tab) or turn the workspace
  setting off. An approved post whose time has passed goes out on the next sweep. "Confirm the total first" on Plan a
  week / product pack = the client's credit total no longer matches (sizes or option changed) — re-read the total.
  Workspace switcher missing = the user has one workspace and a plan that allows one.

## Social Publishing — P5 podcast, explainers, Shorts (2026-11-14, ADR-0011, decisions D4 / D6)
**Deployed to prod 2026-11-14** — deploy branch `deploy/social-p5-20261114` (P1–P5). Flag `SOCIAL_PUBLISHING_ENABLED`
still unset (admin-only screens). linuxg1: backups `~/backups/*-pre-social-20261114-p5*` (src tgz, db dump, `.next`,
package-lock) + `.env.local.bak-pre-social-20261114-p5`; 64-file overlay; no new npm deps (package.json unchanged); migration
0068 (68 → 69 rows; drift columns verified present); `next build` exit 0; `pm2 restart clipwaltz clipwaltz-social-worker`.
AI box: backup `/home/lacy/clipwaltz-worker-pre-social-20261114-p5.tgz` + `.env.worker.bak-pre-social-20261114-p5`; copied
`worker/render-worker.mjs`, `worker/social-render/{job.mjs,dist/pipeline.mjs}`; `npm i @napi-rs/canvas@1.1.1` (saved);
`systemctl restart clipwaltz-worker` while idle. SP: backups `~/backups/social-publishing-*-pre-p5-20261114-p5*`, 3-file
overlay (SP commit `77d23f7`), `PODCAST_MOVED_TO` added, build exit 0, `pm2 restart social-publishing`.
- **Podcast moved (verified 2026-11-14):** `--podcast --apply --map lacy@phoenixtekk.com=lacy@clipwaltz.com` imported 1 show,
  1 episode, the show destination (held); its 3 media rows/objects were already present from the P4 import. New feed vs old:
  same GUID `urn:uuid:b478bc4e-…`, title, enclosure length 3,624,688, type, pubDate, duration, description and channel
  fields; parsed as XML. Audio: HEAD 200 + `Content-Length`, `Range: bytes=0-99` → 206 `bytes 0-99/3624688`, bad range 416,
  full download sha256 = SP's file. Old URLs → 301 to the same path on www.clipwaltz.com (feed, cover, episode art; the
  audio at the origin). **Cloudflare edge copies:** both zones had already cached the mp3 (`cf-cache-status: HIT`, my own
  test requests), so `publish.phoenixtekk.com/…/audio/b478…mp3` still answers 200 from Cloudflare's cache and
  `www.clipwaltz.com/…/audio/b478…mp3` is served without reaching the app (not counted) until those two URLs are purged in
  the Cloudflare dashboard (no API token on file). Audio now sends `Cache-Control: private` so it is not cached again.
- **Dev end-to-end (clipwaltz_dev, dev account p2-publish-test, then deleted):** a Short (35 s, 1080×1920, stock voice)
  rendered on the AI box in 29 s → finalized as a review-first draft with YouTube meta + video + thumbnail, charge
  completed; an explainer (272 s, 1920×1080 + compact cut + mp3, 6 chapters) in ~3.8 min → published to a dev podcast show
  by the sweep → episode in the dev feed; a first explainer whose script came back short failed after 2 tries → post
  failed with the note, charge failed (refunded). Frames checked by eye.
- **Schema (migration `0068_podcast_shorts`):** `podcast_shows` (workspace, unique `slug`, Apple fields, `cover_media_id`
  → `social_media`), `podcast_episodes` (`guid` unique and never rewritten, `audio_media_id` → `social_media` restrict,
  `duration_sec`, `image_media_id`, `published_at`), `podcast_listens` (unique `(episode_id, day, client_hash)`, `day`
  = UTC `YYYY-MM-DD` text), `short_rules` (SP 0031 + `workspace_id`, `timezone`, `migration_hold`), `social_render_jobs`
  (kind `explainer|short`, status `queued|running|done|failed`, `stage`, `payload` jsonb = media ids only, `charge_id` →
  `generation_jobs`, `finalized_at`). Generated by drizzle-kit with `render_workers` temporarily removed from the 0067
  snapshot (else it prompts a rename) and the drift `DROP COLUMN` lines hand-removed (P1 caveat).
- **Podcast (public, no auth — `src/proxy.ts` PUBLIC_PATHS):** `/p/<slug>/rss.xml` (5-min cache), `/cover.jpg`,
  `/audio/<id32>.mp3`, `/episode/<id32>.png` (`src/lib/podcast/public.ts`). Enclosure length = `social_media.size`;
  audio served with HEAD + single byte ranges streamed from MinIO (`getObjectStream`), never a redirect, so
  `recordDelivery` can count the bytes sent (IAB v2.2: GET 200/206 only, one per episode + UTC day + hashed client,
  counted after a minute of audio, self-identified bots and >50 episodes/day clients excluded; salt
  `PODCAST_ANALYTICS_SALT` → `BETTER_AUTH_SECRET`; client IP from `CF-Connecting-IP`). Every feed carries
  `<itunes:new-feed-url>` = its own URL (Apple, podcasters.apple.com/support/837: 301 the old feed + the tag in the new
  one, keep both ≥ 4 weeks). Shows: `/publish/podcast` (admins create/edit, JPEG cover upload checked square
  1400–3000 px; the slug is locked once a show has episodes). A show = a `social_connections` row provider `podcast`,
  `external_id` = show id. The **podcast provider** inserts an episode (`urn:uuid:<id>`) from a post whose media
  includes audio of the show's workspace.
- **Explainers / Shorts — where they run:** the render worker on the AI box (`worker/render-worker.mjs` →
  `socialTick` → `worker/social-render/job.mjs`), lowest priority after renders and slide exports. Reason: CPU-only
  work (canvas frames + ffmpeg x264, ElevenLabs, the AI Box for the script) of ~10 CPU-minutes per episode; linuxg1 has
  4 cores shared by ~20 apps, the AI box 32 and already runs ClipWaltz ffmpeg. The pipeline is the app's TypeScript
  (`src/lib/explainer/**`, `src/lib/shorts/**`) bundled by `node scripts/build-social-render.mjs` into
  `worker/social-render/dist/pipeline.mjs` (gitignored; esbuild; `@napi-rs/canvas` external → installed in the AI box
  `~/clipwaltz/node_modules`). **Re-run the bundle and copy it whenever those folders change.** Fonts: Liberation if
  present, else DejaVu (the AI box has DejaVu only); override `EXPLAINER_FONT_REGULAR/BOLD`.
- **Flow:** create (app / social sweep) = post `rendering` + `social_render_jobs` row + `generation_jobs` charge row
  (`job_type social_explainer|social_short`, status `generating`, credits 10 / 4) in one `spendCredits` transaction.
  Render (AI box) = explainer one stage per claim (scripting → voicing → assembling → meta → ready, `attempts` reset per
  stage, 2 tries per stage), Short in one pass; files → `social/<workspace>/<uuid>` + `social_media` rows (narration
  parts unattached, deleted at finalize). Finalize (`finalizeRenderJobs`, first step of every social sweep) = per-
  network copy + one file per destination (YouTube master, TikTok/Instagram 9:16, others compact if any, podcast the
  mp3, no-video networks the thumbnail, Discourse checked against its upload settings) → post `scheduled` now (same
  sweep publishes) or `draft` (review-first); charge `completed`, or post `failed` + charge `failed` (= refund). Posts
  stuck in `rendering` > 6 h with no live job are failed (`reapOrphanRenderingPosts`).
- **Credits (plan §4.7 has no line for this — chosen here):** explainer **10**, Short **4**. No GPU, but ElevenLabs is
  billed per character against one shared allowance (~4–5k characters per episode, ~700 per Short; plan
  350k/period, checked 2026-11-14), so a per-job charge bounds one account's share. Refunded on failure.
- **Admin-only pieces:** `isAdminWorkspace` (owner's email in `ADMIN_EMAILS`, same test as `isAdminEmail`) → the
  owner's cloned voice (`ELEVENLABS_VOICE_ID`) and Workplace-catalogue Shorts (`source = workplace`, SP's Intune audience
  line). Everyone else: `ELEVENLABS_DEFAULT_VOICE_ID` (stock "Matilda", `XrExE9yKIg1WjnnlVkGX`, premade) and their own
  brief/topics; saving or running a workplace rule from a non-admin workspace is refused.
- **Env:** AI box `.env.worker`: `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL`,
  `ELEVENLABS_DEFAULT_VOICE_ID` (copied from SP's env, values never printed); optional `EXPLAINER_OLLAMA_URL` (else
  `OLLAMA_URL` → AI Box), `EXPLAINER_OLLAMA_MODEL` (default `qwen3.8:27b` — NOT the worker's `OLLAMA_MODEL`, a vision
  model), `WORKPLACE_STORE_URL`, `SOCIAL_RENDER_DISABLED=1` to switch the loop off. linuxg1 `.env.local`: the same
  ElevenLabs lines (record only — the app never calls ElevenLabs).
- **Import (`scripts/migrate-social-publishing.mjs`):** `--podcast` (dry run / `--apply`) copies only the podcast: shows,
  episodes (GUID, title, description, duration, `published_at` verbatim), listens, the cover/audio/artwork files
  (disk → MinIO, HEAD-checked by size) and the show's `podcast` destination (held). The full import now also brings the
  podcast and SP's `short_rule` rows (held). `--activate` additionally pauses SP's active Shorts rules (captured in the
  state file) and releases `short_rules` with the captured state.
- **SP side (`G:\VisualStudioCode\SocialPublishing`, commit in its git):** `PODCAST_MOVED_TO=https://www.clipwaltz.com`
  in SP's `.env.local` → `src/middleware.ts` 301s `/p/<slug>/{rss.xml,cover.jpg,audio/*,episode/*}` to the same path
  on ClipWaltz, and SP's feed builder emits `<itunes:new-feed-url>` (only visible if the redirect is ever lifted).
- **Runbook:** jobs — `select kind,status,stage,progress,attempts,error from social_render_jobs order by created_at desc
  limit 20;`; AI box log — `journalctl -u clipwaltz-worker | grep social-render`; a job stuck `running` after a worker
  restart is re-queued at startup (failed after 3 interruptions). One stage/Short by hand against any DB:
  `node --env-file=<env> worker/render-worker.mjs --social-once`. Dev end-to-end: `scripts/test-p5-render.mts`
  (create / status / cleanup; DEV DB only). Feed check: `curl -s https://www.clipwaltz.com/p/<slug>/rss.xml | xmllint
  --noout -` and `curl -sI -H 'Range: bytes=0-99' .../audio/<id>.mp3` (expect 206 + `Content-Range`).

## Social Publishing — P4 data import + prod deploy (2026-11-14, ADR-0011)
**Deployed to prod 2026-11-14** — deploy branch `deploy/social-20261114` @ `691593d` (P1–P3 + P4 script + hold).
`SOCIAL_PUBLISHING_ENABLED` is **unset** on prod → Publish and Waltz Image's Publish buttons are admin-only
(`ADMIN_EMAILS`). **SP data imported 2026-11-14** with `--apply --map lacy@phoenixtekk.com=lacy@clipwaltz.com`, all
tables reconciled, everything held (`migration_hold = 'sp-import'`) — see "Prod import" below. SP (`social-publishing`
pm2, its crontab sweep) is still the live publisher until `--activate` (cut-over, owner's call).
- **What was done on linuxg1:** backups `~/backups/clipwaltz-src-pre-social-20261114-p4.tgz`,
  `~/backups/clipwaltz-db-pre-social-20261114-p4.dump`, `~/backups/clipwaltz-next-pre-social-20261114-p4/` (old `.next`),
  `~/backups/clipwaltz-package-lock-pre-social-20261114-p4.json`, `.env.local.bak-pre-social-20261114-p4`; 200-file overlay
  (prod code matched `deploy/home-redesign-20261031` before; only docs differed); `npm install` (+@napi-rs/canvas,
  undici, react-day-picker, date-fns, tsx); migrations **0064–0067** (64 → 68 rows; drift columns `render_workers`,
  `renders`/`media`/`deck_exports` lease columns verified still present); `next build` exit 0;
  `pm2 restart clipwaltz clipwaltz-gen-worker`; **new pm2 `clipwaltz-social-worker`**; `pm2 save`.
- **Social worker pm2 line:** `cd /home/lacy/clipwaltz && pm2 start worker/social-worker.mjs --name clipwaltz-social-worker
  --cwd /home/lacy/clipwaltz --node-args="--env-file=.env.local --import tsx"` (no port; BullMQ queue `clipwaltz-social`
  on local Redis). After a code deploy: `pm2 restart clipwaltz-social-worker` too.
- **Env added to prod `.env.local`:** provider app creds copied from SP's env (`FACEBOOK_APP_ID/SECRET`,
  `FACEBOOK_API_VERSION`, `LINKEDIN_API_VERSION`, `LINKEDIN_CLIENT_ID/SECRET`, `THREADS_CLIENT_ID/SECRET`,
  `PINTEREST_APP_ID/SECRET`, `TUMBLR_CLIENT_ID/SECRET`, `X_CLIENT_ID/SECRET`, `YOUTUBE_CLIENT_ID/SECRET`), a new random
  `SOCIAL_OAUTH_STATE_SECRET`, `SOCIAL_EMAIL_DAILY_CAP=200`, `IMAGE_COMFYUI_URL=http://192.168.166.183:8188`. SP's
  `*_REDIRECT_URI` values were NOT copied (ClipWaltz derives `${NEXT_PUBLIC_APP_URL}/api/social/oauth/<p>/callback`;
  those URIs must be registered with each provider by the owner before OAuth connects work). TikTok creds: none in SP.
- **Brand fonts:** installed on linuxg1 2026-11-14 (`fonts-inter fonts-lato fonts-montserrat fonts-open-sans
  fonts-roboto fonts-noto-core` via apt + app restart); re-checked with `dpkg -l` / `fc-list` in P7.
- **Double-post guard (migration 0067):** `migration_hold` on `social_connections`, `social_posts`,
  `social_post_targets`, `social_auto_rules`. A held row is never swept, retried, reaped, claimed by `publish-target`,
  published by `publishPost` ("…on hold until the cut-over…") or the Retry button, picked from an Auto Post queue, and a
  held connection gets no token refresh (SP owns token rotation until cut-over). `sp-import` = imported, released by
  `--activate`; `sp-deleted` = deleted on SP before activation, stays held for good.
- **Import script:** `scripts/migrate-social-publishing.mjs` (header documents everything). Run from `/home/lacy/clipwaltz`
  with an env file that is the app's `.env.local` + `SP_DATABASE_URL` (build it, then delete it after the run:
  `umask 077; cp .env.local /tmp/sp-mig.env; echo "SP_DATABASE_URL=$(grep '^DATABASE_URL=' ../social-publishing/.env.local | cut -d= -f2- | tr -d '"')" >> /tmp/sp-mig.env`):
  `node --env-file=<that file> scripts/migrate-social-publishing.mjs [--map sp@x=cw@y] [--apply | --activate] [--report f]`.
  Dry run by default. Creates no accounts; ids preserved; re-runs insert nothing new. Media `~/social-publishing-data/media/<id>`
  → MinIO `social/<workspace>/<id>` (HEAD-checked by size). Skips provider `podcast` (P5), funnels, podcast, research,
  shorts. The env Facebook Page (`FACEBOOK_PAGE_ID/ACCESS_TOKEN`) is imported only if those lines are active in SP's env —
  they were commented out on 2026-11-08, so nothing to import.
- **`--activate` (cut-over, owner's call):** (a) SP transaction: refuses if SP has a post publishing/rendering or a
  destination pending/publishing; writes a state file (`./migrate-sp-state/activate-<ts>.json`); sets SP's active rules
  inactive, scheduled/queued posts to draft, clears retries; commits. (b) ClipWaltz transaction: imports new rows, re-syncs
  held rows from SP (pre-pause state laid over), re-copies tokens, releases. If (b) fails: SP paused + ClipWaltz held →
  nothing double-posts; finish with `--activate --state <file>`. Since P5 it also pauses SP's Shorts rules (and releases
  `short_rules`); it does NOT touch SP's crontab
  or process — retire those per plan §5.
- **Prod dry run 2026-11-14 (reports in `/home/lacy/clipwaltz-p4test/prod-dry*.json`):** SP has 2 users, 20 connections,
  494 posts, 2,391 destinations, 1,860 media (1,855 on disk, 2.06 GB; 5 files missing), 11 rules (all inactive), 14 presets,
  0 snippets, 13 AI generations; nothing scheduled, no pending/retrying destinations. **Neither SP user has a ClipWaltz
  account by email** (`lacy@phoenixtekk.com` is not a ClipWaltz user; the owner's ClipWaltz account is
  `lacy@clipwaltz.com`), so a plain run imports nothing. With `--map lacy@phoenixtekk.com=lacy@clipwaltz.com` it would
  import 19 connections, 494 posts, 2,391 destinations, 1,860 media rows (1,855 files), 11 rules, 14 presets, 13 AI
  generations, 3 settings, holding 19 connections / 11 rules / 135 posts / 110 destinations.
- **Prod import (run 2026-11-14):** `--apply --map lacy@phoenixtekk.com=lacy@clipwaltz.com`; all tables reconciled,
  everything held. Read-only re-count in P7 (2026-11-14): `social_connections` 20 (all `migration_hold='sp-import'`),
  `social_posts` 494 (135 held), `social_post_targets` 2,391 (2,281 published, 110 failed, none pending),
  `social_media` 1,855, `social_auto_rules` 11 (all held, 0 active), 0 scheduled posts. Next step is `--activate`
  (cut-over) — owner's call.
- **Dev test 2026-11-14:** SP prod `pg_dump` (`~/backups/socialpublishing-20261114-p4test.dump`) restored as scratch db
  `sp_scratch_20261114`; imported into `clipwaltz_dev` (15 media files): reconciliation all OK, re-run inserted 0, tokens
  decrypt with the app's `decryptToken` to SP's values (18/18 + 1 empty hand-off token), `--sweep-once --inline` published 0
  with a due held post, a due held rule and a due held retry; `publishPost`/`retryTargetNow` refused held rows;
  `--activate` paused SP (1 rule, 2 posts, 1 retry), synced a post SP had published meanwhile as published, marked a
  post deleted on SP `sp-deleted`, imported a post created after the import, released; in-flight refusal tested. Dev rows
  and the 15 test objects were then deleted, and the scratch db dropped.
- **Rollback:** `pm2 delete clipwaltz-social-worker`; restore src tarball + `.next` copy + `.env.local` backup; the
  0064–0067 tables/columns are additive and can stay (or restore the db dump); `pm2 restart clipwaltz clipwaltz-gen-worker`.

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

## All social publishing paused by owner (2026-11-14 ~22:35 UTC)
- **Social Publishing (publish.phoenixtekk.com, stays live for staff):** all 20 channels set `paused=true`; Shorts rule
  "Intune quick tips" set inactive (was due 2026-11-16 16:20 UTC); Auto Post rules were already all off; nothing
  scheduled or retrying. Resume per channel on SP's Networks page; turn rules back on in Auto Post / Shorts.
- **ClipWaltz:** all 20 imported channels also `paused=true` and still `migration_hold='sp-import'` (kept on purpose: a
  released connection gets background Threads/LinkedIn token refresh, which could rotate the token SP still uses). No
  rules active, nothing scheduled. New channels connected in ClipWaltz are not held and can be resumed in the UI.
- **Verified:** SP cron sweep 15:35/15:36 MST and a ClipWaltz `--sweep-once` both published 0, errors none.
- **Undo snapshot:** `linuxg1:~/backups/pause-20261114-pause/*.csv` (prior `paused`/`active`/hold values for both apps).

## Post kits (2026-11-14)
- **Deployed** 2026-11-14 as `deploy/post-kits-20261114` @ `9b146d2`: migration 0071 (71 → 72 rows), build exit 0, `pm2 restart clipwaltz`. Backups `~/backups/*-pre-kits-20261114*`. Rollback: restore the src tarball and the `.next` copy, then restart; 0071 is additive and can stay.
- **Test (DEV only):** `node --env-file=.env.local --import ./scripts/lib/server-only-stub.mjs --import tsx scripts/test-kits.mts` (11 checks; refuses unless DATABASE_URL is clipwaltz_dev).
- **What it is:** per-network captions and pictures for posting by hand. It never calls a network API and needs no
  connected channel.
- **Access:** same as Publish. Off for customers until `SOCIAL_PUBLISHING_ENABLED=1`; while it is off, only ADMIN_EMAILS
  accounts can use it. Viewers can read kits; editors can make and change them.
- **How a kit is built:**
  - The `createPostKit` server action stores a `post_kits` row with `status='writing'` and returns.
  - `buildKit` (`src/lib/kits/kits.ts`) then runs in Next's `after()` inside the `clipwaltz` process:
    1. It makes the pictures. Designs go through `renderDesign` at each format; uploads are cropped with sharp.
       Pictures are stored as `social_media` rows with `post_id` null.
    2. It writes one caption per network on the AI Box (`OLLAMA_URL`), saving after each network.
    3. It sets `status='ready'`.
  - If anything fails it sets `status='failed'` with a readable `error`, and **Write again** retries.
  - A kit stuck in `writing` (for example after a pm2 restart mid-build) can be retried after 5 minutes.
- **Storage:**
  - Pictures live under `social/<workspace>/<media id>` in MinIO and are listed in `post_kits.assets`.
  - Deleting a kit removes its pictures and uploaded originals, but skips any that a post has taken (`post_id` not null).
- **Downloads:**
  - `/api/kits/<id>/file/<media>` serves only media listed in that kit's `assets`, to viewers of the workspace.
  - `/api/kits/<id>/zip` builds the zip in memory with pictures only. Videos are left out on purpose (size).
- **Troubleshooting:**
  - **Captions stay empty and the kit shows "Needs a retry":** check that the AI Box answers from linuxg1:
    `curl -s $OLLAMA_URL/api/tags`.
  - **No pictures for a design:** the design was deleted before the kit was built. Make a new kit.

## Render scaling deployed (2026-11-14)
Prod = `main` @ `44661ef` (deploy branch `deploy/render-scaling-20261114`). Code: multi-worker render leases (`a6c581e`
+ `543635d`, re-applied in the merge), paid-first queue with position/ETA, uploads moved to a background worker.
- **linuxg1:** 14-file overlay, no migration (0052 was applied on 2026-10-13; rows stay 72), build exit 0,
  `pm2 restart clipwaltz clipwaltz-gen-worker clipwaltz-social-worker`. NEW pm2 **`clipwaltz-bg-worker`**:
  `pm2 start node_modules/.bin/tsx --name clipwaltz-bg-worker --cwd /home/lacy/clipwaltz --interpreter node
  --node-args="--env-file=.env.local" -- scripts/background-worker.ts`; `pm2 save` done. **It is required:** the web
  app no longer uploads cloud saves itself (only queues `cloud_saves` rows). It also emails ADMIN_EMAILS when the
  oldest queued render waits > `QUEUE_ALERT_MIN` (5) min or no render worker is online.
- **DB:** `ALTER ROLE clipwaltz CONNECTION LIMIT 45`.
- **AI box:** `worker/render-worker.mjs` + `worker/deck/jobs.mjs` copied; `.env.worker` adds `RENDER_CONCURRENCY=3`,
  `WORKER_ID=aibox`, `DATABASE_POOL_MAX=6`; log line `id=aibox renders at once=3 misc jobs=on lease=180s`.
  Workers register in `render_workers` (heartbeat each `HEARTBEAT_MS`); a dead worker's renders fail after the 180 s lease.
- **Verified:** 3 renders queued at once on the owner's projects started within 3 s on `aibox` and finished in 22–44 s;
  `clipwaltz-bg-worker` uploaded all 3 to Dropbox via the auto-save rule. Test renders + MinIO files deleted afterwards.
- **Backups:** linuxg1 `~/backups/*pre-20261114-scaling*` (src, .next, db dump, env); AI box
  `/home/lacy/clipwaltz-worker-pre-20261114-scaling.tgz` + `.env.worker.bak-pre-20261114-scaling`.
- **Rollback:** stop AI box worker → restore the src tgz + .next tgz on linuxg1 → `pm2 delete clipwaltz-bg-worker && pm2
  save` → `pm2 restart clipwaltz clipwaltz-gen-worker clipwaltz-social-worker` → restore AI box tgz/env → start worker.
- **Not done (from the original plan):** app as a pm2 cluster ×2, and a second render worker on AISERVER.

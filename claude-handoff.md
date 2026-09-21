<!-- session-version: 5 -->

# ClipWaltz — session handoff

**FIRST ACTION for a fresh session:** set your session title from the `pending-session-title`
marker above (via `mcp__ccd_session_mgmt__set_session_title` if available, else ask the owner to
rename the tab), then **clear that marker line** so the next rotation sets a fresh name. Then read
this handoff and continue.

ClipWaltz = a cloud auto-video-maker (drop in phone photos/videos → beat-driven music video).
**MVP is a desktop web app.** Name locked, domain **clipwaltz.com** purchased. Canonical
`https://www.clipwaltz.com` (apex→www 308). Planning docs: `PRODUCT_PLAN.md`,
`DESIGN_BUILD_PLAN.md` (settled decisions in §7); features in `FEATURES.md`.

---

## Working state (2026-09-20) — v5 in progress ⚠️ DEPLOY PENDING (owner-gated)

- **Committed `a3ab99a`** — "Render-complete notifications: in-tab + Web Push (two toggles)".
  Type-check ✓ · lint ✓ · prod build ✓. Migration **0019** (`push_subscriptions`) generated,
  **NOT yet applied to prod**.
- **What shipped (code):** Account → Notifications (`/account/notifications`, avatar menu) with two
  per-browser toggles — (1) in-tab browser notification (localStorage pref; fired from
  `render-panel.tsx`→`notifyRenderDone`); (2) OS/Windows push via Web Push (`public/sw.js` +
  `push_subscriptions` + VAPID). `render-ready` callback now also `sendPushToUser` (`lib/push.ts`,
  prunes dead subs). SW suppresses OS toast when a tab is focused (de-dupe). Docs updated +
  **mirrored to wiki** (features/admin-docs/help-center).
- **Done on prod already (pre-deploy):** VAPID env appended to linuxg1 `.env.local` (4 vars);
  deploy tarball staged at `linuxg1:/tmp/clipwaltz-deploy.tar.gz`. Keys saved to
  `_keys/clipwaltz.txt`.
- **⚠️ REMAINING (owner runs — auto-mode blocks prod deploy here):** on linuxg1 `cd ~/clipwaltz` →
  `tar xzf /tmp/clipwaltz-deploy.tar.gz` → `npm ci` → `node --env-file=.env.local
  ./node_modules/drizzle-kit/bin.cjs migrate` (applies 0019; NEVER pipe to tail) → `npm run build`
  → `pm2 restart clipwaltz`. Worker unchanged (no redeploy needed).
- **Bugs found this session (NOT yet fixed):** (1) **crossfade OOMs** on many-segment renders —
  the crossfade path opens every segment as a simultaneous ffmpeg input (`render-worker.mjs:1034`);
  a 78-clip/600s/all-effects render hit **78 GB** and the OOM killer killed the worker. (2) **No
  crash recovery** — a hard crash skips the `catch` that marks `failed`, so the render is orphaned
  in `rendering` forever (worker only re-claims `queued`, `render-worker.mjs:1162`). The owner's
  stuck render `34d1db72` is orphaned; clear with `update renders set status='failed' where
  id='34d1db72-560b-4893-9556-a4d2f4e09b4b'`. **Recommended next work:** chunked/2-stage crossfade
  (or cap segments when crossfade on) + a stale-`rendering` reaper.

---

## Working state (2026-09-20) — v4 shipped; tree CLEAN + all deployed

- **Tree:** clean. **Type-check + build green.** Prod DB migrated through **`0018`**.
- **Recent commits:** `254a09d` docs media-streaming gotcha · `3c717d7` fix proxied media streaming · `0a907e1` docs A/B/C · `48df603` title-follows-caption + settings snapshot + checkpoint · `7e74943` presets/max-footage/dashboard/announcements.
- **Deploy (verified this session):** app → `git archive HEAD` tarball → scp linuxg1 → (`npm ci` only if `package-lock` changed) → `node --env-file=.env.local ./node_modules/drizzle-kit/bin.cjs migrate` (NEVER pipe to tail) → `npm run build` → `pm2 restart clipwaltz`. Worker unchanged this session (only 5c… earlier). Migrations run with the `--env-file` form — bare `npm run db:migrate` falls back to localhost and hangs.
- **Shipped this session (v4), all deployed + verified live:**
  - **Presets** (#1) — save/apply Format+Style+overlays; 3 built-in starters + personal + admin **global** presets; per-account **default** auto-applied to new projects. `presets` table. Editor "Presets" bar; `lib/presets.ts`, `lib/preset-actions.ts`.
  - **Max footage** (#2) — ♾️ Max length removes the cap; worker `buildTimeline` lays every clip full-length, no repeats, 10-min ceiling; live projected-length readout. `projects.max_footage`.
  - **Dashboard** (#4) `/dashboard` — analytics tiles, plan usage meter, Jump-back-in, community-feed rail (click → `/community`); **post-login landing**; nav = Dashboard·Projects·Library·Community·Admin. `lib/dashboard.ts`.
  - **Admin announcements** (#5) — in-app promos/banners/cards, placement + audience (all/free/paid) + scheduling + accent + CTA, dismissible. `announcements` table; `/admin` CRUD; rendered on dashboard.
  - **A** — "Untitled project" now follows the Style Title (`setProjectStyle`; default titles only).
  - **B** — investigated re-render "ignored settings": render path reads settings **live** (worker `select * from projects`); a traced same-project re-render applied the change correctly → no stale bug. Only residual was a client race, removed by the checkpoint's fresh read. Now also snapshot settings onto `renders.settings` (migration 0018) for audit + diff.
  - **C** — render **checkpoint modal**: effective settings + projected length + tiered warnings + "what changed since last render" + per-user "don't show again for quick renders" opt-out.
  - **BUGFIX (media streaming)** — proxied media routes returned a web `ReadableStream` body, which **hangs on Next 16** (code 000 / no headers) → **music preview, video watch, downloads all silently failed**. Fixed with `storage.serveObject()` = buffered bytes + `Content-Length`/`Accept-Ranges`/206 Range. Applied to music, watch, download, media, asset routes. See ADMIN_DOCS "Proxied media" runbook.
  - Migrations **0017** (presets, announcements, projects.max_footage) + **0018** (renders.settings) applied on prod.
- **Owner action still pending (carried from v3):** add Google **Drive** redirect URI `https://www.clipwaltz.com/api/oauth/google/drive/callback` in the Google Cloud OAuth client (fixes `redirect_uri_mismatch`); see `ADMIN_DOCS.md`.
- **Next focus / open:** (1) authenticated click-through of music preview + the checkpoint modal in-browser (verified server-side, not via a logged-in UI this session). (2) Per-project post-text template (currently hardcoded jet-ski). Nothing blocking.

---

## Working state (2026-09-20) — v3 shipped a lot; ⚠️ tree UNCOMMITTED

- **LIVE:** `https://www.clipwaltz.com` — **app** on **linuxg1** pm2 `clipwaltz` :3100 (CF tunnel, apex→www 308); **worker** on the **AI box** systemd `clipwaltz-worker`. MinIO on linuxg7. Prod DB reachable from the AI box worker via SSH tunnel `127.0.0.1:55432`.
- ⚠️ **Tree is DIRTY and UNCOMMITTED.** Everything below is **deployed to prod + verified** but **not in git** (`git status` = ~18 modified + ~8 untracked). No new migrations this session (post-text reuses `renders.description`; all else existing columns). **Next session: commit this before new work** — a fresh session starts blind to these changes' history.
- **Deploy (this session's verified flow):** app → tar (exclude node_modules/.next/.git/.env.local/public/insta360; **POSIX `/c/…` path**, never `C:/…`) → scp linuxg1 → `npm run build` → `pm2 restart clipwaltz`. Worker → `scp worker/render-worker.mjs` to `ai:/home/lacy/clipwaltz/worker/` → `sudo -n systemctl restart clipwaltz-worker` (env `.env.worker`; seed/scripts run here too — has ffprobe + MinIO + DB).
- **Shipped this session (v3), all deployed + verified:**
  - **Resumable uploads** — `upload-client.ts` (timeline insert) + hardened `import-uploader.tsx` (multipart >8MB, 5 retries, exp-backoff+jitter, 120s part timeout, real errors surfaced; routes log storage errors). **Streaming S3 `download()`** in worker (fixes >2GB clip overflow that failed renders).
  - **Download-to-folder** (File System Access API): `download-folder.ts` + `download-controls.tsx` — "Choose folder" + Download save straight in (Chromium only).
  - **iCloud card** `icloud-import.tsx` — guidance only (Apple has no photo API).
  - **Theme guard** `theme-guard.tsx` — fixes dark→light flip on `(app)` navigation.
  - **Title/caption** moved to Timeline tab (`title-caption-field.tsx`); new text overlays default near top (`y:0.15`). **Project cards** show `titleText`; grid up to 10–12 cols.
  - **360 auto-leveling** — `estimateLevel`/`levelEquirect` (brightness-up → `yaw=φ,pitch=−β`), replaces fixed `roll=90`; verified tilt 88°→0°. **Best-moments montage** (`rankWindows` motion+vision). **Fill-to-length**: auto-loop when footage short (≤150s) + even whole-clip coverage (`windowQueue`); fixed `nextRanked` crash.
  - **Music** — 41 Pixabay tracks seeded → catalog **83→116**. Record: `scripts/music-manifest-pixabay-2026-09-20.json`.
  - **Ready-to-post description** — worker `generatePostContent` (vision writes the video-specific block; fixed jet-ski `POST_TEMPLATE_SUFFIX` verbatim) → `renders.description`; **Copy post** button next to Download. Toggle relabeled **📝 Generate post text**.
  - Worker diagnostics added: `--ranktest`, `--filltest`, `--posttest`.
- **Owner action pending:** add Google **Drive** redirect URI `https://www.clipwaltz.com/api/oauth/google/drive/callback` in the Google Cloud OAuth client (fixes `redirect_uri_mismatch`); see `ADMIN_DOCS.md`.
- **Next focus:** commit the tree; then the **`handoff-dashboard-features.md`** batch (dashboard #4, presets #1, max-footage #2, admin announcements #5, bug A "Untitled project" naming, bug B re-render-ignored-settings, checkpoint modal #C). Also: post template is hardcoded jet-ski — could be made per-project configurable.

---

## Working state (2026-09-18) — v2 shipped a lot; app is LIVE

- **LIVE in production:** `https://www.clipwaltz.com` — linuxg1 pm2 **`clipwaltz` :3100** behind the
  linuxg1 Cloudflare tunnel (apex→www 308). Prod DB `clipwaltz` migrated through **`0005`**. Worker
  redeployed on the AI box (now needs **aubiotrack** = `aubio-tools`, installed).
- **Tree:** clean (only this handoff untracked). **Build + lint green** as of `fcc26eb`.
- **Recent commits:** `fcc26eb` smart cut+beat sync · `390e673` flagship · `bf7399d` community
  rename+apex+Dropbox/OneDrive · `a5b49f4` Google import · `733039c` community feed · `0ac547e`
  projects openable+Stripe fix · `c6584e4` editor Phase 1 · `55c7d3a` landing+brand · `712cbf6`
  draft preview.
- **Shipped this session (all deployed + verified):** landing page (glass-metal brand, light/dark,
  favicon) · **public deploy** (linuxg1:3100 + CF tunnel + My Apps card + inventory) · **Stripe
  LIVE (test)** acct **`1UGiVdER…`**, Plus $15 / Pro $39, webhook public+verified, checkout works,
  products carry tax_code (Managed Payments) · **Admin** `/admin` (invite + comp lifetime/expiry;
  `lacy@clipwaltz.com` = Pro/lifetime) · aspect 9:16/16:9 · legal (`/terms`,`/privacy`,`/refund`) ·
  app theming (violet primary + aurora) · **Editor Phase 1** (title, filters, fades, crossfade, Ken
  Burns) · **Community** (`/community` feed + `/w/[id]` watch + share + likes; **post-login
  landing**) · **Cloud import** Google Photos (server OAuth + Photos Picker), Dropbox (Chooser),
  OneDrive (OneDrive.js) → shared SSRF-allowlisted `/api/import/urls` · **Music: 83 Pixabay tracks**
  (picker has search) · **Flagship: smart active-moment cutting + beat-sync** (aubiotrack + motion
  frame-diff; verified E2E, 4s render) · **apex→www fixed** (x-forwarded-host).
- **Shipped in v3 (all deployed to prod + verified live):**
  (1) **Music side-panel + ▶ audition** in the editor (`music-panel.tsx`, two-col edit layout).
  (2) **Community upgrade** — creator profiles (`/u/[id]` + `/account/profile`, social links),
  **Top Contributors / Most Posted** leaderboards, **global chat** (`/api/chat`, polled) +
  **per-video comments** (`/w/[id]`), and the **Monthly Theme Challenge** (admin sets/closes in
  `/admin`; likes = votes; winner auto-granted **Pro 30-day comp** via `applyGrant` + email;
  creators enter a public render from the editor). Migration **0006** (profiles, render_comments,
  chat_messages, contests, contest_entries) applied to **dev + prod**.
  (3) **UI vibrancy pass** — glass tokens now defined on `.cw-app` (light+dark) so `cw-glass`
  works in-app (this also fixed the v3-#1 music panel, which had shipped with undefined glass
  tokens); editor sections are glass cards, brand-gradient headings, spectrum project thumbnails.
- ⚠️ **`drizzle-kit` does NOT auto-load `.env.local`** — always migrate with
  `node --env-file=.env.local ./node_modules/drizzle-kit/bin.cjs migrate` (bare = silent fallback
  to localhost:5432 → hang/exit-1). Never pipe migrate to `tail` (SIGPIPE).
- ⚠️ **This lucide-react dropped brand icons** — `Instagram`/`Youtube` don't exist; use `AtSign`
  / `Video` (or other generics). Verify an icon exists before importing.
- **Owner action / live-test:** cloud-import pickers (Google/Dropbox/OneDrive) are built but each
  needs the owner to complete that provider's consent to verify. If OneDrive.js is flaky, swap to
  the OneDrive **File Picker v8**.

---

## How to run locally
```bash
ssh -fN -L 55432:127.0.0.1:5432 lacy@linuxg1   # Postgres tunnel (DB is localhost-only on linuxg1)
npm run dev                                      # http://localhost:3000
```
`.env.local` (gitignored) is populated; secrets also in `G:\VisualStudioCode\_keys\clipwaltz.txt`.
Build check: `BETTER_AUTH_SECRET=x NEXT_PUBLIC_APP_URL=… DATABASE_URL=… npm run build` (Postgres
connects lazily; a live DB isn't needed to build). ⚠️ The workstation's LAN path to MinIO
(192.168.166.169:9000) is **intermittent** — uploads/renders from the workstation may fail when it's
down; the AI-box worker reaches MinIO fine.

## Stack & infra (durable)
- **App:** Next.js 16 (App Router, TS, Tailwind v4, shadcn = **Base UI**, uses `render` prop not
  `asChild` — see memory `clipwaltz-ui-base-ui`). Auth: Better Auth. ORM: Drizzle (`casing: snake_case`).
- **Postgres:** linuxg1 :5432 (`listen_addresses=localhost`). DBs `clipwaltz` (prod) + `clipwaltz_dev`
  (Windows dev via the SSH tunnel). Migrations in `drizzle/`.
- **Object storage:** MinIO on **linuxg7** `192.168.166.169:9000`, bucket `clipwaltz` (versioned),
  bucket-scoped service account (least-priv). Uploads are **proxied through the app**
  (`/api/projects/[id]/assets`) — presigned/resumable is a v1.1 optimization.
- **Render worker:** live on the **AI box** (`ai`, .168) as systemd services `clipwaltz-db-tunnel`
  + `clipwaltz-worker` (run as user **lacy**; code at `/home/lacy/clipwaltz`; source in
  `worker/`). Polls `renders`, FFmpeg-assembles 9:16 1080p, uploads to MinIO. See memory
  `clipwaltz-render-worker-deploy` + `worker/deploy/`.
- **Email:** Amazon SES via nodemailer (`src/lib/email.ts`), console fallback.
- **Billing:** Stripe (direct), isolated in `src/lib/billing/` + `billing-actions.ts` + webhook
  `/api/billing/webhook`. See `BILLING.md`.
- **Docs mirrored to wiki:** `ClipWaltz/{design-build-plan,features,admin-docs,billing}` +
  gated `SystemDocs/linuxg-fleet-inventory`.

## v3 Wave 1 — music platform + editor (shipped, deployed, verified)
Migration **0007** (dev + prod). All live on prod; worker redeployed.
- **Music Provider Layer** (`src/lib/music-providers.ts`) — `MusicProvider` interface + registry;
  Pixabay (DB "Included") implemented, Epidemic/Soundstripe/Artlist adapters interface-ready
  (add `*_API_KEY` + `listTracks()`). `getMusicTracks()` aggregates through it. Prod tracks
  backfilled `provider='pixabay'` (86).
- **Favourites + music tabs** — `music_favorites`; panel tabs For You / Browse / Premium / My Music,
  ♥ toggle, provider-agnostic labels. For You reserved for WaltzMatch.
- **Clip thumbnails** in the editor list. **Fade in / Fade out** split toggles (`fadeOut` col).
  **Aspect** shows a "re-render needed" note after a render.
- **Licensing ledger** (`render_licenses`) — worker snapshots the music license per render.
- ✅ **WaltzMatch (#9/#10)** — For You tab: analyzes media (AI-box vision on photos → occasion/mood/
  energy; media-mix fallback) → ranks catalog with % match + Surprise Me. `src/lib/waltzmatch.ts`
  (pure matcher) + `waltzmatch-actions.ts`. Needs `OLLAMA_URL` on linuxg1 (set). Deployed.
- ✅ **Waltz to the Music (#11)** — opt-in `waltzToMusic` (0008). Worker builds a per-second energy
  curve (ffmpeg astats) + beats → energy-varied, beat-snapped cadence ending on a beat. Diagnostic
  `--waltztest`; verified E2E on a real track. Editor toggle "💃 Waltz to the Music". Deployed.
- ✅ **Text + emoji overlays (#6)** — `projects.overlays` jsonb (0009); `overlay-editor.tsx`
  drag-to-position on a live frame, size/colour/box, timing, anim (fade/slide/pop), snap-to-beat.
  Worker 2nd pass: drawtext (text) + Twemoji PNG overlay (emoji, jsDelivr). `--overlaytest`;
  verified E2E. Deployed.
- Still to do from this batch (**Wave 2**): **#4 full timeline + insert** (visual duration-scaled
  timeline with insert points). **#12 copyright clearance** BLOCKED on Epidemic/Soundstripe partner
  APIs (ledger ready).

## v3 Wave 3 (this session) — shipped + deployed
- ✅ **#4 full timeline + insert** (`project-timeline.tsx` + `reorderAssets`) — drag-reorder, +insert/upload at a spot.
- ✅ **Image preview** — clip thumbnails (image+video) open a lightbox (`project-editor.tsx`).
- ✅ **Lighting effects** (`lightFx`, 0010) — vignette/glow/grain/dreamy/noir (worker).
- ✅ **Insta360 / 360 import** (0011) — accept `.insv/.lrv/.insp`; worker reprojects via ffmpeg
  `v360` (dual-fisheye `hstack`+`dfisheye`, single `fisheye`) → flat mp4/jpg (`convertedKey`),
  audio kept; async conversion queue in the worker (`convTick`); editor shows "converting" +
  auto-refresh; render/preview use converted; landing advertises it. Diagnostic `--convtest`;
  verified E2E on a real dual-fisheye `.insv`. Sample at `public/insta360/…insv` (gitignored from
  deploys). **Next 360 step:** AutoReframe (motion/face-driven yaw over time) + tiny-planet/multi-angle.
- ✅ **Media library** — DONE (full user-level model, migration 0012 + backfill validated on dev then
  prod: 50 assets → 50 media, 1:1). `media` table + `assets.mediaId`; uploads create media+asset;
  worker updates media on 360 convert; `deleteAsset` keeps the file; `/library` page (reuse across
  projects, download, rename, delete, filters); `/api/media/[id]` serving. Nav has "Library".
- ✅ **Describe → YouTube description** (0013) — editor 📝 toggle; worker generates via AI-box text
  model (`OLLAMA_TEXT_MODEL` default qwen3.8:27b) → `renders.description`; render panel Copy box.
- ✅ **Download named after Style Title** — `<titleText>.mp4` (falls back to project title).
- ✅ **Community opt-in + remove** — Public = feed opt-in; owner "Remove from community" on `/w/[id]`.
- (superseded) earlier media-library plan:
  it refactors the live core):
  1. Migration 0012: `media` table (owner, kind, storageKey, sourceFormat/conversionState/convertedKey,
     sizeBytes, durationSec, createdAt=importedAt, lastUsedAt) + `assets.mediaId` → media.
  2. Backfill: one media row per existing asset (owner via project); set `assets.mediaId`. Move file
     identity + 360 conversion to **media** (convert once, reuse everywhere).
  3. Rewire: upload creates/reuses media + an asset (placement) referencing it; worker conversion
     updates **media**; serving/render/draft read file via asset→media; `deleteAsset` deletes the
     MinIO object only when no other asset references that media (reference counting).
  4. `/library` page: all the user's media — thumbnail, imported date, last used, projects-using,
     size/type/360 badge; **reuse in another project**, **download original**, delete-if-unused, groups
     (Recents/Videos/Photos/360/Converted/Unused).
  ⚠ Test the migration + backfill on `clipwaltz_dev` before prod; prod has live data.
- ⏳ **Cloud storage (#5)** — needs write-OAuth scopes + the pending **joint OAuth session** (owner
  completes provider consent live). Store/back up media to the user's Drive/Dropbox/OneDrive.
- ✅ **Insta360 AutoReframe** (0014) — per-file 360 reframe mode in the library: **Front** (flat,
  roll=90), **Auto-follow** (motion yaw path → ffmpeg `sendcmd`, **two-stage** level-then-reframe so
  pans stay upright), **Tiny Planet** (`v360=ball`). Conversion is now **media-based** (convert once,
  reuse); `setReframeMode` re-converts. Verified: flat + tiny + follow (upright at yaw ±90) on the
  bright sample. Diagnostics `--convtest`, `--followtest`. ⚠ Long 360 clips convert slowly (follow =
  2 passes); fine as a background job. **Multi-angle-on-beat** (cut between virtual views) = still TODO.
- ✅ **Cloud storage — Google Drive (#5)** — connect (own OAuth, `drive.file` scope, routes
  `/api/oauth/google/drive/*`, provider `google_drive`) + back up originals to a `ClipWaltz/` Drive
  folder; per-file + Back-up-all + badge (`media.driveFileId`, 0015). `src/lib/drive.ts`. Owner did the
  Google console setup (Drive API, scope, redirect URI, test user). **Live-verify pending:** click
  "Connect Google Drive" in the library once (consent) → Back up a file → confirm it lands in Drive.
  Dropbox/OneDrive backup = future (each needs its own app + write scope).

## Open items / backlog
1–3. ✅ **DONE in v3** — music side-panel, community upgrade + contest, UI vibrancy (see above).
   Owner should live-test the authenticated internals (editor glass, admin contest create/close,
   chat/comments, profile edit) since those weren't browser-verified this session (auth-gated).
- ✅ **Longer lengths** — 15s/30s/1–5m presets + custom up to 60m (`setProjectLength` clamps
  15–3600s). Deployed.
- ✅ **Face/scene-aware selection** — worker re-ranks top motion windows by subject/faces via the
  AI-box vision model (`qwen2.5vl:7b`, non-reasoning). `.env.worker`: `OLLAMA_URL`/`OLLAMA_MODEL`.
  Diagnostic `--selftest`. Verified E2E on the AI box; deployed + worker restarted.
- ✅ **v1.1 "video ready" email** — worker → `POST /api/internal/render-ready` (shared secret
  `WORKER_CALLBACK_SECRET`, set on both boxes + `_keys`) → app sends via SES. Endpoint verified
  (403/409). Full email fires on a real render.
- ✅ **v1.1 resumable uploads** (owner chose resumable-through-proxy) — files >8MB use S3 multipart
  streamed through `/api/projects/[id]/assets/multipart` (init/complete/abort) + `/assets/[assetId]/part`
  (per-part retry, localStorage reload-resume). MinIO stays LAN-only. Multipart verified E2E; deployed.
- ⏸ **v1.1 BullMQ/Redis queue** — DEFERRED by owner (DB-polling queue is fine at this scale).
- ⏸ **Real-artist music partner API** — ON HOLD by owner (keep the 83 Pixabay tracks). Revisit with
  a provider (Epidemic Sound / Artlist) + API key when ready.
- ⏸ **Cloud-import live-verify** — needs the owner to complete Google/Dropbox/OneDrive OAuth consent
  in a live (joint) session. OneDrive.js → File Picker v8 if flaky. Pending owner availability.

## Older backlog
4. **Cloud-import live-verify** (owner completes provider consent). OneDrive.js → **File Picker v8**
   if flaky.
5. **Face/scene-aware smart selection** (CV phase on the AI-box GPU) — motion-based active-moment
   is live; face detection is the next increment.
6. **v1.1 infra:** presigned/resumable uploads, SES "video ready" email, Redis/BullMQ queue.
7. **Real-artist music** needs a production-music **partner API** (Epidemic Sound / Artlist) —
   Pixabay has **no music API** (images/videos only), so bulk auto-pull isn't possible.
8. **Cost-per-render on real 4K** before finalizing prices (currently $0/$15/$39).
9. **Prod music seeding** is done (83 tracks); dev DB lags on the last batches (owner tests prod).

## Deploy runbooks (this session, verified)
- **App → linuxg1:** `tar` (exclude node_modules/.next/.git/.env.local; **POSIX scratch path**,
  not `C:/…` — tar treats `C:` as a host) → scp → extract over `/home/lacy/clipwaltz` → `node
  ./node_modules/drizzle-kit/bin.cjs migrate` (⚠ run **without** `| tail` — the pipe SIGPIPEs
  migrate mid-apply) → `npm run build` → `pm2 restart clipwaltz --update-env`.
- **Worker → AI box:** scp `worker/render-worker.mjs` to `ai:/home/lacy/clipwaltz/worker/` →
  `sudo -n systemctl restart clipwaltz-worker`. Worker env = `.env.worker` (NOT `.env.local`).
- **Music seed (prod):** scp files + a manifest to linuxg1 → `node --env-file=.env.local
  scripts/seed-music.mjs <manifest> <dir>` (uploads to MinIO + upserts, on-box where both reachable).

## Editor redesign + theming (2026-09-19)
- **EditorWorkspace** (`src/components/editor-workspace.tsx`): full-width; **sticky Draft Preview**
  on top; **tabbed workspace card** (Timeline / Clips / Format / Style / Overlays); **tabbed Music
  card** right (MusicPanel `embedded` prop drops its own glass). `ProjectEditor` gains a `section`
  prop ("clips"|"format"|"style") to render one tab at a time.
- **Full width:** `(app)` layout main + header no longer capped; projects grid → xl:5 / 2xl:6.
- **Theme:** default is now **dark** (pre-paint script in root layout, `cw-theme` in localStorage);
  `ThemeToggle` (pre-existing, `useSyncExternalStore`) added to the app nav — ⚠ DON'T recreate it,
  it already existed and is used on the landing. Dark glass verified on public pages; **authed
  editor look not screenshot-verified (auth-gated)** — owner to eyeball.

## Fixes
- **Fill-to-length (2026-09-19):** length was only a cap, so one short clip → ~4s video. Worker
  `buildTimeline` now, when the timeline is under the target, cycles the assets and **tiles each
  video into different windows** (per-video cursor) to fill to the chosen length (MAX 400 segments);
  offset resolver skips slots that already have a tiled offset. `buildDraftTimeline` mirrors it
  (cycles clips; DraftPreview keys are index-based to allow repeats). Verified via `--waltztest`
  (1 clip, 30s target → 21 segments = 30.00s). Quality of a one-clip fill depends on the source
  length (a long clip tiles into varied moments; a very short one repeats).
  **Update:** now gated by **`loopToFill`** (0016, default OFF). OFF = tile each video across its own
  duration once (no repeats) → video is as long as the footage allows, up to the target. ON = repeat
  footage to hit the full target. `buildTimeline` takes `loopToFill`; draft only loop-fills when ON.
- **Crash loop from proxied media streams (fixed 2026-09-19):** client aborts (video range
  requests, navigation) on the MinIO proxy routes threw `ERR_INVALID_STATE` "Controller is already
  closed" as **uncaught exceptions**, crash-looping the app (~30 restarts) → intermittent "This page
  couldn't load" (owner hit it on `/import`). Fix: `src/instrumentation.ts` swallows client-abort
  stream errors (crashes on real ones); `getObject(key, signal)` takes the request AbortSignal +
  wraps the web stream to cancel cleanly; all 5 stream routes pass `req.signal`. Verified: 12 forced
  aborts → no restart, guard logged `[stream] ignored client-abort`.

## Standing rules that bit us
- shadcn = Base UI (`render`, not `asChild`); custom glass classes must be in `@layer components`
  so Tailwind utilities (e.g. `absolute`) still win.
- Client effects: no synchronous `setState` in `useEffect` (lint `react-hooks/set-state-in-effect`)
  — use render-time adjust / `useSyncExternalStore` / `queueMicrotask`.
- Stripe: the app's **key account must match** where prices/webhook live; this account has
  **Managed Payments** on → products need a `tax_code` or checkout 400s.
- apex→www redirect must read **`x-forwarded-host`** (the tunnel's real host header).
- Middleware `PUBLIC_PATHS` must include any endpoint hit without a cookie (Stripe webhook,
  `/community`, `/w/*`, `/api/renders/*/watch`, OneDrive picker callback).
- Fleet Postgres localhost-only; tunnel, never widen `listen_addresses`. Never print/commit
  secrets; `.env*` gitignored; secrets in `_keys/clipwaltz.txt`.

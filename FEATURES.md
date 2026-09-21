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
| Editor workspace (tabbed) | ✅ | Full-width editor (`editor-workspace.tsx`): **sticky Draft Preview** on top, a **tabbed workspace card** (Timeline / Clips / Format / Style / Overlays) below, and a **tabbed audio card** (Music) on the right. Projects + editor use full width. |
| Dark / light theme | ✅ | Persisted theme toggle (`cw-theme` in localStorage, **default dark**); pre-paint script sets it with no flash; glassy dark surfaces (`cw-glass` on `.cw-app`). Toggle in the app + landing nav. |
| Editor (screen 06) | ✅ | `/projects/[id]/edit`: two-column layout (editor left, **music side-panel** right on `lg`); reorder clips, remove, **length** (15s/30s/1–5min presets + custom up to 60min), **aspect** (9:16 / 16:9), **Style** (title/caption overlay, filter warm/cool/vivid/bw/vintage, cut/crossfade transition, Ken Burns, fade in/out), **draft preview player**, **Render HD** + live status + **Download**. |
| Aspect ratio 9:16 / 16:9 | ✅ | Selectable in the wizard + editor (`setProjectAspect`); worker renders 1080×1920 or 1920×1080. |
| Lighting effects | ✅ | Atmospheric **Lighting** looks in the editor (`lightFx`, 0010) applied by the worker on top of the colour filter: **vignette, glow, film grain, dreamy, noir**. |
| Text + emoji overlays | ✅ | Multiple overlays per project (`projects.overlays` jsonb, 0009): **drag-to-position on a live frame** in the editor (`overlay-editor.tsx`), size/colour/box, timing (whole video or start–end), animation (fade/slide/pop) and **snap-to-beat** entrances. Worker second pass: **text via drawtext**, **emoji via Twemoji PNG overlay** (jsDelivr, best-effort with fallback). Verified E2E (`--overlaytest`). |
| Editor Phase 1 effects | ✅ | Worker applies: title/caption overlay (drawtext), color filters, fade in/out, **crossfade** (xfade chain w/ probed offsets) or cut, Ken Burns zoom on photos. FFmpeg chains verified E2E on real media. Beat-sync + smart active-moment cutting = later phase. |
| Admin: invite + comp grants | ✅ | `/admin` (ADMIN_EMAILS allowlist): grant Plus/Pro to any email, **lifetime or expiry**; existing users upgrade instantly, unknown emails get an invite that redeems on signup. `getEffectiveTier` gates features/watermark. |
| Legal pages | ✅ | Public `/terms`, `/privacy`, `/refund` (brand-themed), linked in footer. |
| Insta360 / 360 import | ✅ | Accepts **`.insv`/`.lrv`/`.insp`** uploads; the worker **reprojects 360 footage to a flat, shareable, auto-levelled clip** with ffmpeg `v360` (dual-fisheye→`dfisheye`, single→`fisheye`; keeps audio) — no Insta360 Studio. **Horizon auto-leveling** (`estimateLevel`): the brightness²-weighted mean direction over the equirect estimates true "up" (sky/main light), and the sphere is rotated (`yaw=φ`, `pitch=−β`) to bring it to the zenith before a **separate** reframe stage — replacing the old fixed `roll=90`, which only worked when the camera happened to be held level. Falls back to `roll=90` if the estimate fails, so it never regresses. Verified on real Insta360 footage: tilt 88°→0°, horizon level and subjects upright across yaws (previously sideways / pointed at sky). Async conversion queue (`sourceFormat`/`conversionState`/`convertedKey`, 0011); editor shows a "converting" state and auto-refreshes. Diagnostics: `--convtest`, `--followtest`. Advertised on the home page. |
| Media import (drag-drop / picker / guided USB) | ✅ | `/projects/[id]/import`: 3 tabs (drag-drop, files/folder picker, guided OS-assisted USB), per-file progress, proxied upload → MinIO `clipwaltz` bucket, delete. Continue → editor. Verified E2E (object confirmed in bucket). Large files (>8MB) upload via **resumable multipart** through the proxy (`/assets/multipart` init/complete/abort + `/assets/[assetId]/part`) with per-part retry and localStorage reload-resume — MinIO stays LAN-only. Multipart verified E2E against the bucket. |
| Fill-to-length (few clips) | ✅ | The worker fills to the chosen length by cycling assets and, for videos, using each clip's windows. **Long clip → short target:** a montage of the clip's **best-ranked moments** (motion + vision ranked). **Short clip → long target:** windows walk the **whole clip in time order and repeat evenly** (a best window opens), so all footage is used — not just the first part. **Auto-loop:** if the user didn't force looping and the footage is genuinely short (≤150s) yet shorter than the chosen length, it loops automatically to reach the target; a long clip still fills only to its own length. **🔁 Loop to fill length** toggle (`loopToFill`, 0016) forces looping regardless. Diagnostic: `--filltest <video> <lengthSec> [loop]` prints slot count + a per-decile coverage histogram. |
| No-clip-more-than-twice cap | ✅ | **Every source clip appears at most 2× in a render** (`MAX_APP=2` in `buildTimeline`), even in loop-to-fill mode — so a project never shows the same image/video more than twice. Extra video appearances draw a **different window** (distinct moment). If the footage can't reach the chosen length within the 2× cap, the worker **stretches to fill** rather than repeating a 3rd time: it **holds images longer** first (up to 12s each), then **lengthens video slots to use more of their own footage** (bounded by each clip's remaining length). If footage still can't fill the target, the video is simply shorter than the target (better than repetition). Diagnostic: `--captest [nVideos] [nImages] [lengthSec] [videoLen]` prints slot count, total, and the max appearances of any clip. |
| Cloud auto-assemble | ✅ | Normalize to 9:16/16:9 + concat/crossfade + Ken Burns + filters + title + fades + music + length cap + watermark. |
| Waltz to the Music | ✅ | Opt-in energy-aware beat-driven edit (`waltzToMusic`, 0008): worker builds a per-second **energy curve** (ffmpeg `astats` RMS) + beats (aubiotrack) → **faster cuts in loud sections, longer holds when calm**, all snapped to beats, starting at the first beat and **ending on a beat**. Diagnostic `--waltztest`; verified E2E on a real catalog track. |
| Smart cut + beat sync | ✅ | Worker detects beats (`aubiotrack`) → cuts land on the beat (music trimmed to first downbeat); each video's **most active window** chosen via motion analysis (frame-diff YAVG), skipping dead/static/black. Project toggles `smartCut`/`beatSync` (0005) in the editor. Verified E2E on real media. |
| 360 reframe modes (AutoReframe) | ✅ | Per-file 360 **reframe mode** (`media.reframeMode`, 0014), set in the library: **Front** (auto-levelled flat), **Auto-follow** (motion-driven yaw that pans toward the action, via computed yaw path + ffmpeg `sendcmd`), **Tiny Planet** (little-planet `v360=ball`). Converted once at the media level and reused; changing the mode re-converts. |
| Face/scene-aware selection | ✅ | `rankWindows` scans the **whole clip** for motion candidates + evenly-spaced probes, then **vision-scores** them with the **AI-box model** (Ollama `qwen2.5vl:7b` — non-reasoning; reasoning ones return empty) to rank windows by people/faces/subject, so cuts land on action rather than empty scenery or choppy water (which reads as high motion). Returns the best distinct windows, feeding both single cuts and the fill montage. Best-effort with motion-only fallback; `OLLAMA_URL`/`OLLAMA_MODEL` in `.env.worker` (empty disables). Runs within `smartCut`. Diagnostics: `--selftest <video>`, `--ranktest <video> [need] [k]` (stitches a best-moments montage to `/tmp/ranktest.mp4`). Verified E2E on real 16-min lake footage (jet-ski/marina picked over empty water). |
| Light editor (reorder / music / length) | ✅ | Server-actions, owner-checked; verified E2E (render used the chosen track + capped length) |
| Fast low-res draft preview | ✅ | In-editor story-style player (`src/components/draft-preview.tsx`): plays ordered clips + chosen soundtrack instantly (no server render), timing mirrors the worker (2s/photo, 4s/video, capped to length). Source media streamed via proxied `GET /api/projects/[id]/assets/[assetId]` + `GET /api/music/[trackId]`. Shows the "magic" before the async HD render. |
| Ready-to-post description | ✅ | Editor **📝 Generate post text** toggle (`projects.describe`, 0013): on render the worker builds a **complete, ready-to-post description** — the vision model (`qwen2.5vl`) samples the finished video's frames and writes the **video-specific top block** (an opening description + three "In this video:" bullets), then the project's **channel template** is appended verbatim. Always returns a full post (generic block if the model fails). Stored on `renders.description`; the render panel shows a **Copy post** button next to Download plus a preview box. Worker diagnostic: `--posttest <video> [title] [topic] [template]`. |
| Per-project post-text template | ✅ | The post text is **configurable per project** (migration 0020), replacing the old hardcoded jet-ski template. Under the 📝 toggle in the editor: a **Topic / subject** field (`projects.post_topic`) that steers the AI's description (e.g. "European travel vlog", "home cooking"), and a **Channel template** textarea (`projects.post_template`) appended verbatim after the generated block (About, links, hashtags…). Both blank → the worker's built-in defaults (`DEFAULT_POST_TOPIC` / `DEFAULT_POST_TEMPLATE`, the jet-ski/PWC channel text) so existing projects are unchanged. Saved via `setProjectStyle`; `PostTextSettings` in `project-editor.tsx`. |
| Download named after title | ✅ | Finished video downloads as **`<Style Title>.mp4`** (falls back to project title) via Content-Disposition. |
| Choose download folder | ✅ | Optional **"Download folder"** on the ready-to-download panel (`download-controls.tsx` + `download-folder.ts`): pick a folder once (File System Access API) and renders save straight into it — no Save dialog. Handle persisted in IndexedDB per browser; a **change/clear** chip manages it. Chromium only (Edge/Chrome); other browsers hide the chip and use the normal download. Note: browsers forbid writing to a typed absolute path, so this is a folder **picker**, not a text field. |
| Title / caption placement | ✅ | The optional **Title / caption** field lives in the **Timeline tab** (`title-caption-field.tsx`), alongside the clips, rather than the Style card. Saves via `setProjectStyle({titleText})`. |
| Community opt-in + remove | ✅ | Render panel Private/Unlisted/**Public** = opt-in to the community feed; owners get a **Remove from community** button on the watch page (sets it private). |
| Cloud HD render (async) | ✅ | DB queue + worker + live status polling; download served (proxied). **"Video ready" email** on completion: the worker pings `POST /api/internal/render-ready` (shared-secret `WORKER_CALLBACK_SECRET`) and the app sends via SES — keeps SES creds only on linuxg1. |
| Export / share (watermark on free) | 🚧 | Download ✅ (proxied). Watermark drawtext in worker (font-fallback safe); public share link still to come |
| Music catalog | ✅ | **83 licensed Pixabay tracks** live in prod (manifest-driven `scripts/seed-music.mjs`, Pixabay Content License, 0 placeholders). Sourcing/licensing in `MUSIC_CATALOG.md`. |
| Music Provider Layer | ✅ | Provider-agnostic music sourcing (`src/lib/music-providers.ts`): `MusicProvider` interface + registry. **Pixabay** (DB-backed "Included") implemented; **Epidemic / Soundstripe / Artlist** adapters interface-ready (light up when their `*_API_KEY` + `listTracks()` are added — no editor/UI change). `music_tracks.provider/premium/providerTrackId` (0007). |
| Music panel (tabs + favourites) | ✅ | Sticky side-panel (`music-panel.tsx`): tabs **For You / Browse / Premium / My Music**, search, **per-track ▶ audition**, **♥ favourites** (`music_favorites`, 0007 → My Music), provider-agnostic labels ("Included" / "Real Artist" + mood + BPM). For You = **WaltzMatch**. |
| WaltzMatch (soundtrack matching) | ✅ | **For You** tab: analyzes the project's media (best-effort **AI-box vision** on photos → occasion/mood/energy; media-mix fallback) and ranks the catalog with a **% match**, plus **Surprise Me** (weighted-random top pick). Deterministic matcher (`src/lib/waltzmatch.ts`, mood + BPM); analysis in `waltzmatch-actions.ts`. Vision prompt verified against the AI box. |
| Cloud backup — Google Drive | ✅ | Connect **Google Drive** (own OAuth, least-privilege `drive.file` scope) from the library; backs up originals into a **`ClipWaltz/` folder** in the user's Drive. Per-file **Back up** + **Back up all**, backed-up badge (`media.driveFileId`, 0015). Reuses `GOOGLE_CLIENT_ID/SECRET`; routes `/api/oauth/google/drive/*`. `src/lib/drive.ts`. |
| Media library | ✅ | User-level **`/library`** (`media` table, 0012): every imported photo/video/360, reusable across projects. Shows imported date, size, kind/360 badge, **used-in count**; **download original**, **rename**, **delete** (removes it everywhere), **add to any project** (reuse without re-upload/re-convert), filters (All/Videos/Photos/360/Unused). Assets are now placements referencing library media; removing a clip keeps the file. 360 conversion stored on media (convert once, reuse). |
| Timeline (view + insert/reorder) | ✅ | Full-video **timeline** (`project-timeline.tsx`): clips laid left→right, widths scaled by draft duration; **drag a clip to reorder**, **+ between clips to insert/upload** a photo, video, **or Insta360 clip (.insv/.lrv/.insp)** at that exact spot, remove per clip. Insert uses the shared **resumable uploader** (`upload-client.ts` — single POST for small files, MinIO **multipart** for large videos) and shows a **prominent status banner** with filename + live progress bar, then an "Inserted ✓" / error state. `reorderAssets` server action. |
| Clip thumbnails + preview | ✅ | Each clip shows an image/video thumbnail; **clicking any clip (image or video) opens a full preview** (image enlarges, video plays with controls) via a lightbox (`project-editor.tsx`). |
| Fade in / fade out | ✅ | Separate editor toggles; worker applies fade-in (`fades`) and a **fade-out ending** (`fadeOut`, 0007) independently. The fade-out now fades **both the picture and the music together** at the very end (`afade` matched to the video fade), so the audio never hard-cuts when the video ends. |
| Licensing ledger | ✅ | Per-render music-license snapshot (`render_licenses`, 0007): provider, track, artist, license type/ref, clearance status — written by the worker on completion. Answers "what license did this video use?"; clearance fields fill in when a premium provider is wired. |
| Account / billing (Free/Plus/Pro) | ✅ | `/account/billing` + Stripe hosted Checkout + portal + webhook. Live in **acct_1UGiVdER…** (test): Plus $15 / Pro $39 prices, tax code set, webhook public + verified (checkout session creates). Comp/admin grants bypass Stripe. See `BILLING.md`. |
| Community feed | ✅ | At **`/community`** ("Community" in nav; `/feed` 307→/community). Renders share as private/unlisted/public (share control in the render panel); public grid + `/w/[id]` watch pages (video, creator, likes, CTA); `render_likes`. Public stream `GET /api/renders/[id]/watch`. |
| Creator profiles | ✅ | Public **`/u/[id]`** page (avatar, bio, social links, their public videos). Editable at **`/account/profile`** (`updateProfile`): bio + website/Instagram/TikTok/YouTube (`user` profile columns, 0006). Feed + watch creator names link to it. `src/lib/profile.ts`. |
| Community leaderboards | ✅ | On `/community`: **Top Contributors** (most-liked creators) + **Most Posted** (most creations). `src/lib/community.ts` (`getTopLiked`/`getTopPosters`). |
| Lightweight chat | ✅ | **Global community chat** on `/community` (signed-in; polled `GET/POST /api/chat`, `chat_messages`) + **per-video comments** on `/w/[id]` (`render_comments`, `src/lib/comments*.ts`; author/admin delete). |
| Monthly Theme Challenge | ✅ | Admin sets the theme in `/admin` and **closes** it to auto-grant the likes-leader **Pro (30-day comp** via `applyGrant`) + winner email. Creators **enter** a public render from the editor (render panel); likes = votes. `/community` shows the active-challenge banner + ranked entries. `contests`/`contest_entries` (0006), `src/lib/contest*.ts`. |
| Cloud import — Google / Dropbox / OneDrive | ✅ | **Google Photos** via server OAuth + Photos Picker (`/api/oauth/google/*`, `/api/import/google/*`, tokens in `oauth_accounts`). **Dropbox** (Chooser) + **OneDrive** (OneDrive.js) via client pickers → shared SSRF-allowlisted `/api/import/urls` → MinIO. All on the import screen. |
| iCloud Photos guidance | ✅ | Apple provides **no third-party API** to read a user's iCloud Photo Library (Sign in with Apple = auth only; CloudKit = own-app data only), so there's no OAuth connector. An **iCloud Photos** card (`icloud-import.tsx`) instead guides users to the working path: the OS file picker on iPhone/iPad/Mac already reaches iCloud Photos; on Windows, iCloud for Windows syncs to a local folder to pick from. |
| Canonical host apex→www | ✅ | `clipwaltz.com` 308→`www.clipwaltz.com` (middleware, keyed off `x-forwarded-host` behind the tunnel). |
| Help Center | ⬜ | Categories mirror features |
| Retention: 7-day auto-delete (free) | ⬜ | Paid "Project Vault" keeps longer |

## Dashboard, presets & content batch (2026-09-20)

- **Style presets** — save the current project's Format + Style + overlays as a named preset and
  apply it to any project in one click. Three built-in starters (TikTok Punchy, Cinematic, Vlog),
  personal presets, and admin-published **global/featured** presets. A per-account **default
  preset** is auto-applied to every newly-created project. Editor: the "Presets" bar above the
  workspace. Data: `presets` table (`src/lib/presets.ts`, `src/lib/preset-actions.ts`).
- **Max footage / longest video** — a **♾️ Max** length option that removes the length cap and
  builds the longest coherent video the footage supports (every clip at its full length, no
  repeats), bounded by a 10-minute soft ceiling. Live projected-length readout ("~2m 40s from 18
  clips"). Inverse of Loop-to-fill; the two are mutually exclusive. `projects.maxFootage` column;
  worker honours it in `buildTimeline` (`worker/render-worker.mjs`).
- **Dashboard** (`/dashboard`) — the post-login landing page. Analytics tiles (projects, videos
  made, minutes, likes, comments), a plan usage-vs-quota meter with an upgrade nudge, a "Jump back
  in" recent-projects grid, and a right rail showing a live community feed where any click opens
  `/community`. `src/lib/dashboard.ts`, `src/app/(app)/dashboard/page.tsx`.
- **Admin announcements / promos** — an admin content area (`/admin`) to publish in-app cards &
  banners: upgrade promos targeted at Free users, feature drops, contest banners, cross-promo.
  Placement (dashboard banner/card, community), audience (all/free/paid), brand accent, optional
  image + CTA, and start/end scheduling. Dismissible per-viewer. `announcements` table
  (`src/lib/announcements.ts`, `src/lib/announcement-actions.ts`).
- **Nav** — top header now reads **Dashboard · Projects · Library · Community · Admin**; the logo
  and post-login redirect point at `/dashboard`.
- **Render checkpoint** — clicking Render / Re-render first shows a confirmation modal with the
  effective settings (read fresh from the server, so it's exactly what will render), a projected
  length, tiered warnings (🔴 no clips · 🟡 1 clip / no music / clip-orientation vs aspect · 🟢
  footage shorter than target), and **what changed since the last render**. A per-user "don't show
  again for quick renders" opt-out is honoured unless a warning is present. Each render also
  snapshots its settings (`renders.settings`) for audit + the diff.
- **Title follows the caption** — a project still on its auto name ("Untitled project", "Trip
  video", "Event video") takes the Style Title as its project name, so it stops showing as
  "Untitled" in the list. An explicit rename is preserved.

## Render-complete notifications (2026-09-20)

- **Two independent, per-browser toggles** at **Account → Notifications** (`/account/notifications`;
  also linked from the avatar menu) that tell you the moment a video finishes rendering:
  1. **Browser notification (while ClipWaltz is open)** — the open tab fires a notification when
     your render finishes. Preference stored per-browser (`localStorage`); fired from the render
     poll in `render-panel.tsx` via `notifyRenderDone` (`src/lib/notify-client.ts`).
  2. **Windows notification (even when ClipWaltz is closed)** — a real OS toast via **Web Push**,
     delivered by the service worker (`public/sw.js`) even with the tab closed. Turning it on
     subscribes this browser; turning it off unsubscribes it. Backed by the `push_subscriptions`
     table (one row per browser/device) and VAPID keys.
- The render worker's existing completion callback (`/api/internal/render-ready`) now also sends a
  Web Push to every browser the owner opted in on (`sendPushToUser`, `src/lib/push.ts`), alongside
  the "video ready" email. Expired subscriptions are pruned automatically on send.
- **De-dupe:** when a ClipWaltz tab is focused, the service worker suppresses its OS toast and lets
  the in-tab notification handle it, so you don't get notified twice.
- Requires browser notification permission (requested on first enable). Fully degrades: no
  permission, unsupported browser, or unconfigured server → the toggles disable gracefully.

## Later
Native mobile apps · collaboration/shared reels · auto-captions · face/scene-aware
selection · 4K · multi-aspect · brand kits · web B-roll · partner API.

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
| Projects + dashboard | ✅ | `/projects` (auth-gated app shell). Lists user's projects with Draft/Rendering/Ready/Failed badges; create/rename/duplicate/delete via server actions (owner-checked); empty state + free-tier retention banner. "New Project" → wizard. Verified E2E. |
| Projects board (organise) | ✅ | `/projects` is a **card board** (`projects-board.tsx`): **uniform, wider cards** (`auto-fill minmax(210px)`) with a fixed 16:9 thumbnail and an **orientation icon** (portrait/landscape) so the grid stays even and names are readable. **Search** box (name + tags), a **tag filter** row (`projects.tags`, AND-filter), and **categories** (`projects.category`) rendered as sections. **Click-hold drag** a card between sections to move it (HTML5 DnD → `setProjectCategory`, optimistic); also a card-menu **Move to** submenu + **Edit tags…**. Migration 0022. |
| Server-side categories | ✅ | Categories are **persisted per-account** (`project_categories` table, 0023) — shared across devices, ordered, with an optional **accent colour**. Each category header has **rename / move up-down / colour / delete** (deleting moves its projects to Uncategorized); a **New category** button creates one. `category-actions.ts` (create/rename/delete/setColor/move), `listCategories`. Renames re-point every project in the category. Legacy free-text categories still render until formalised. |
| Per-clip screen time | ✅ | Set **how long each image shows** (`assets.durationOverride`, 0024): open a clip from the Timeline strip → a modal **plays it** (scrub/preview) with a **manual time slider + number** (0.4–60s) or **Auto**. Timeline block widths + labels reflect the manual time (violet badge). Worker: pinned slots use the exact time (excluded from stretch-to-fill). `setAssetDuration`. |
| Per-video trim (in/out) | ✅ | Choose **which part of a video renders** (`assets.trimStart`/`trimEnd`, 0026): in the clip modal, enable **Trim** and set start/end with sliders — or play, pause at a spot, and **Set ⏱** from the playhead. Shows the rendered range + resulting length; block gets a ✂ badge. Worker renders exactly `[trimStart,trimEnd]` (`-ss`/`-t`), overriding smart-cut windowing + duration override, and pins the slot. `setAssetTrim`. |
| Render history (download/delete) | ✅ | Every finished render is kept per project; the editor shows a **Render history** list (`render-history.tsx`) — **download or delete any past version**, not just the latest (marked "Latest"). Download via the existing owner-checked proxy; **delete** removes the DB row + the MinIO object (`deleteRender`). `listRenders`. |
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
| 360 reframe modes (AutoReframe) | ⚠️ | Per-file 360 **reframe mode** (`media.reframeMode`, 0014): **Front** (auto-levelled flat), **Auto-follow** (motion-driven yaw that pans toward the action, via computed yaw path + ffmpeg `sendcmd`), **Tiny Planet** (little-planet `v360=ball`). Converted once at the media level and reused. **The per-file mode selector lived in the Media Library (removed 2026-09-22)**; 360 files now convert with their stored/default mode and there is currently no UI to change it. |
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
| Export / share (watermark on free) | 🚧 | Download ✅ (proxied). Free-tier watermark = the ClipWaltz logo PNG (`worker/WaterMark.png`, copy of `public/WaterMark.png`), **bottom-left**, ~22% of the short side, 90% opacity, fades with the picture (2026-09-24); public share link still to come |
| Music catalog | ✅ | **83 licensed Pixabay tracks** live in prod (manifest-driven `scripts/seed-music.mjs`, Pixabay Content License, 0 placeholders). Sourcing/licensing in `MUSIC_CATALOG.md`. |
| Music Provider Layer | ✅ | Provider-agnostic music sourcing (`src/lib/music-providers.ts`): `MusicProvider` interface + registry. **Pixabay** (DB-backed "Included") implemented; **Epidemic / Soundstripe / Artlist** adapters interface-ready (light up when their `*_API_KEY` + `listTracks()` are added — no editor/UI change). `music_tracks.provider/premium/providerTrackId` (0007). |
| Music panel (tabs + favourites) | ✅ | Sticky side-panel (`music-panel.tsx`): tabs **For You / Browse / Premium / My Music / Upload**, search, **per-track ▶ audition**, **♥ favourites** (`music_favorites`, 0007 → My Music), provider-agnostic labels ("Included" / "Real Artist" + mood + BPM). For You = **WaltzMatch**. |
| Custom music upload | ✅ | **Upload tab**: add your own audio (≤50 MB) from your computer — **MP3, MPA, MP2, M4A, AAC, WAV, OGG, OPUS, FLAC** (ffmpeg decodes any of them for rendering; the correct MIME is stored so in-browser audition works). Proxied to MinIO (`/api/music/upload`) as an **owner-scoped** `music_tracks` row (`ownerId`, provider `upload`, migration 0025). Visible only to you, auditioned/selected like catalog tracks, **deletable** (`deleteMusicTrack` → row + object; drops from any project using it). Owner-checked streaming; `getMusicTracks(userId)` merges catalog + uploads. |
| Original video audio + mix | ✅ | **🔊 Use original video audio** toggle (`projects.originalAudio`, 0021): keeps each clip's own sound and mixes it with the in-app music. **Independent level sliders** (`musicVolume`/`originalVolume`, 0–150%) — music defaults to 65% when mixed so the clip audio stays clear; set music to 0 for original-audio-only, or original to 0 for music-only. Worker builds a timeline-matched original-audio track (each video slot's own audio from its window; silence for images/audio-less clips), then `amix`es it with the looped music (`volume` + `amix normalize=0` + end `afade`). Transitions render as **cuts** while original audio is on (crossfade would drift the audio). Verified: the full mix graph renders video+audio on the AI box. |
| WaltzMatch (soundtrack matching) | ✅ | **For You** tab: analyzes the project's media (best-effort **AI-box vision** on photos → occasion/mood/energy; media-mix fallback) and ranks the catalog with a **% match**, plus **Surprise Me** (weighted-random top pick). Deterministic matcher (`src/lib/waltzmatch.ts`, mood + BPM); analysis in `waltzmatch-actions.ts`. Vision prompt verified against the AI box. |
| Cloud backup — Google Drive | ⚠️ | Google Drive **OAuth connection** (own OAuth, least-privilege `drive.file` scope) is retained — `src/lib/drive.ts`, routes `/api/oauth/google/drive/*`, reuses `GOOGLE_CLIENT_ID/SECRET`. **The Back up / Back up all UI lived in the Media Library (removed 2026-09-22)**, so there is currently no user-facing backup action; `media.driveFileId` (0015) still records already-backed-up files. |
| Media library | ❌ | **Removed 2026-09-22** (per owner: "too heavy, not needed"). The user-facing `/library` page, nav link, `MediaLibrary` component, `getUserMedia`, `media-actions`/`drive-actions`, and the `/api/media/[id]` serving route are gone. The **`media` table is kept** — the asset-upload pipeline still writes/updates it (`assets.media_id`, 360 conversion state). Assets remain placements referencing media rows. |
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
- **Nav** — top header now reads **Dashboard · Projects · Community · Admin**; the logo
  and post-login redirect point at `/dashboard`. (**Library** link removed 2026-09-22.)
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

## Auto-Batch Studio (2026-09-22)

- **Server-side batch pipeline** (admin-only: `/admin/batch`, linked from `/admin`). Turns folders of
  media into rendered videos unattended. A batch = **input / output / done** folders (absolute paths
  on the render host) + a **style preset** + optional **music** + **describe** toggle + a **grouping
  mode** (each subfolder → 1 video · all loose files → 1 video · each file → 1 video) + a **schedule**
  (minutes between videos; 0 = as fast as possible). Tables `batch_jobs` + `batch_items` (migration 0027).
- **Worker** (`batchTick` in `render-worker.mjs`): for each active batch, when nothing's in flight and
  the schedule allows, it takes the next group from the input folder, **uploads the media to MinIO +
  creates a project + queues a render** with the batch settings. On the render finishing
  (`finalizeBatchItem`): writes the **MP4 + `.txt` description** to the output folder and **moves the
  consumed sources to the done folder** (failed renders → `done/_failed`). **Auto-stops** (status
  `done`) when the input folder is empty; **Rescan** re-activates it.
- One item in flight per batch (so the schedule paces output). UI shows per-batch status + done/in-
  progress/failed counts; pause/resume/rescan/delete (delete leaves files untouched). Admin-gated
  because it reads/writes arbitrary server paths. **V1 scope:** standard video/image formats (360
  `.insv` excluded); no auto-posting yet (render + move only). **Verified E2E** on the AI box (queue →
  render → output MP4 + `.txt` → source moved to done → auto-stop).
- ⚠️ **The three folders must be owned/writable by the worker's user (`lacy` on the AI box)** — the
  worker runs as `lacy`, so root-owned folders fail with EACCES. A group that already has a done/failed
  `batch_item` is never reprocessed (skip-set), so a bad folder can't spin an infinite retry loop;
  finalize failures move the source to `done/_failed`.

## Workspaces & team members (2026-09-23)

- **Shared workspaces** (ADR-0004/0006). Every user has a personal workspace; its owner can invite
  others so they can work on **every project in it**. Settings at **Account menu → Workspace**
  (`/account/workspace`): rename, members list, role changes, remove, pending invites, leave.
- **Roles:** **owner** (one per workspace; can't be removed) · **admin** (edit, delete any project,
  manage editors/viewers) · **editor** (edit, upload, render, generate, enhance, export, delete media)
  · **viewer** (open projects read-only, watch + download renders/exports). Only the owner can invite
  or manage admins.
- **Email invites** via SES: single-use link, 7-day expiry, only for the invited email address
  (`/invite/<token>`; the raw token is never stored — only its SHA-256). Re-inviting an address
  revokes the older link. Max 25 pending invites per workspace. The inviter can also copy the link.
- **Enforcement:** every project-scoped server action and API route checks the caller's workspace
  role (`src/lib/workspace.ts`: `getProjectRole` / `userCanAccessProject` / `assertProjectRole`).
  Removing a member revokes their access at once — including projects they created there.
- **Projects page** gains a workspace switcher (`?ws=`); **New Project** creates inside the selected
  workspace (editor+). **Viewers** get the editor read-only (all controls disabled + banner) and are
  redirected away from Import.
- Stays per-person: categories, presets, music uploads, batches, dashboard stats. Sharing a render to
  the Community / entering a challenge stays with the project's creator (credit + prizes).
- Data: `workspace_invites` (migration 0029). Actions: `src/lib/workspace-actions.ts`.

## Direct media delivery — storage edge (2026-09-25, ADR-0003)

- Videos, photos and music now stream **directly from storage** (`media.clipwaltz.com`, Cloudflare)
  instead of through the app server: the app checks access, then redirects to a 1-hour signed link
  (seeking works; downloads keep their filename). Large uploads send each 8 MB part straight to
  storage too, falling back automatically to the old path if a part can't go direct.
- Private by design: no link works without a valid, unexpired signature, and signed media is never
  cached at Cloudflare's edge.

## AI video generation (2026-09-23) + AI Restore (2026-09-24)

Runs alongside the music-video assembler (ADR-0001). Jobs go through Redis/BullMQ
(`clipwaltz-gen-worker` on linuxg1) to the AISERVER GPU node (ComfyUI behind an authenticated
wrapper; ADR-0002/0005).

- **Generate tab** (project editor): image→video or text→video with Wan 2.2 TI2V-5B. Controls:
  prompt, style, camera, motion, aspect (landscape 1280×720 / portrait 720×1280 / square 768×768),
  duration (3 / 5 / 8 s), seed and negative prompt. Live progress over SSE.
- **Versions:** every result is a numbered version — preview, compare side by side, favourite, pick,
  duplicate, regenerate, delete.
- **Enhance** (creates a new version; `enhanceVersion` → `clipwaltz-enhance` queue):
  - **Fast** — ffmpeg on linuxg1: smoother motion (motion interpolation to 48 fps) and/or 2× lanczos
    upscale + light sharpen.
  - **AI upscale** — GPU: Real-ESRGAN 2× (`esrgan-upscale-v1`) and/or RIFE 2× frame interpolation
    (`rife-interpolate-v1`); chained upscale → interpolate.
  - **AI Restore** — GPU: **SeedVR2-3B** (Apache-2.0) diffusion video restoration
    (`seedvr2-restore-v1`, ADR-0007). Rebuilds fine detail and doubles resolution (short side ×2,
    capped at 1080p), keeps the source frame rate, optional RIFE afterwards. Clips up to 400 frames;
    ~2 s/frame at 720p, ~4.6 s/frame at 1080p. Best on real camera footage; can over-sharpen
    AI-generated clips (`latent_noise_scale` 0.1 applied to soften this).
- **Export Center:** MP4 or WebM × native / 720p / 1080p, then download.
- **Quality routing** (ADR-0009): Preview / Standard / High map to admin-editable routing rules
  (default 10 / 20 / 30 sampler steps). **Motion** (subtle / balanced / dynamic) steers the prompt.
  **Seed** is honoured and recorded (Duplicate reproduces a version; Regenerate varies it).
  **Negative prompt** is sent to the model. Prompts are limited to 2,000 characters with a counter.
- **Failures:** a plain-language message plus a **Retry** button (same settings; re-routed if the
  original workflow was switched off).
- **Admin — AI models & routing** (`/admin/ai`): switch models and workflows on/off, edit routing
  rules and fallbacks; the Generate tab greys out anything unavailable.
- **Two GPUs in parallel** (ADR-0008): the AISERVER runs one ComfyUI per RTX 3080 and the wrapper
  sends each job to the less busy card, so a long AI Restore no longer blocks new generations.
- **Access:** generate / enhance / export need the **editor** role or higher in the project's
  workspace; viewers can watch and download.

## Later
Native mobile apps · collaboration/shared reels · auto-captions · face/scene-aware
selection · 4K · multi-aspect · brand kits · web B-roll · partner API.

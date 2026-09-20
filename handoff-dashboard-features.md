# ClipWaltz — Handoff: Dashboard + Presets + Render-checkpoint feature batch

**Created:** 2026-09-20
**Reason for handoff:** This work was started in the wrong session. Move it to a fresh session and continue from here.
**Product:** ClipWaltz — cloud auto-music-video maker. Live at https://www.clipwaltz.com.

---

## ⚠️ READ FIRST — the working tree is dirty with WIP that is NOT this batch's work

The repo has an **in-progress multipart-upload feature from another session**. It type-checks clean (`npx tsc --noEmit` = 0) but it is unfinished and not mine to ship.

Files touched by that other WIP (do **not** sweep these into a commit for this batch, and know that a deploy tar of the working dir will carry them live):

- `src/components/editor-workspace.tsx`
- `src/components/import-uploader.tsx`
- `src/app/layout.tsx` (root layout)
- `src/app/api/projects/[id]/assets/multipart/route.ts`
- `src/app/api/projects/[id]/assets/[assetId]/part/route.ts`
- `src/app/api/projects/[id]/assets/route.ts`
- `src/app/(app)/projects/[id]/import/page.tsx`
- `src/app/(app)/projects/page.tsx`
- `ADMIN_DOCS.md`, `FEATURES.md`
- untracked: `src/components/download-controls.tsx`, `src/components/icloud-import.tsx`, `src/components/theme-guard.tsx`, `src/components/title-caption-field.tsx`, `src/lib/download-folder.ts`, `src/lib/upload-client.ts`, `scripts/music-manifest-pixabay-2026-09-20.json`

**Decision still needed from the owner (was asked, dismissed, pending):**
1. How to handle the multipart WIP before building + deploying — (a) build alongside & deploy it all, (b) build+commit locally but hold prod deploy until the WIP is settled, or (c) commit the WIP first as its own commit.
2. Build order — dashboard cluster (#4+#5, mostly clean new files) first vs editor cluster (#1+#2, both touch the dirty `editor-workspace.tsx`).

**Rule while dirty:** stage only this batch's files by explicit path. Never `git add src/`. Do not deploy without the owner's OK on the WIP.

---

## ✅ Already done in the originating session

- **#3 Projects nav** — added a `Projects` link (→ `/projects`) next to `Library` in the top header.
  File: `src/app/(app)/layout.tsx` — nav now reads **Projects · Library · Community · Admin**. Isolated, clean edit. Not yet committed/deployed.

---

## Verified code facts (grounded — use these, don't re-derive)

- **Nav is a top header, not a left sidebar.** `src/app/(app)/layout.tsx` renders logo + links + ThemeToggle + UserMenu. Admin link gated by `isAdminEmail(session.user.email)` from `@/lib/admin`.
- **`projects` table** (`src/db/app-schema.ts`) already has every style field presets/max-footage need: `id, ownerId, title, template, aspect, lengthSec, status, musicTrackId, titleText, styleFilter, lightFx, transition, motion, fades, fadeOut, smartCut, beatSync, waltzToMusic, describe, loopToFill, overlays (jsonb), timestamps`.
  - `lightFx` values: `none|vignette|glow|grain|dreamy|noir`.
  - `loopToFill` = repeat footage to reach target length (the inverse of the requested "max footage" mode).
- **`getProject` / `listProjects`** in `src/lib/projects.ts` already return all those fields (`ProjectDetail`). `ProjectSummary` carries `titleText` and cards show `titleText?.trim() || title` as display name (`src/components/project-card.tsx`).
- **Tables present** (migrations at `drizzle/`, latest `0016`): `musicTracks, projects, media, assets, renders, renderLicenses, oauthAccounts, renderLikes, renderComments, chatMessages, contests, invites, subscriptions`. → Dashboard analytics can source from `projects`, `renders`, `renderLikes`, `renderComments`.
- **Auth gate** in `src/proxy.ts`: `PUBLIC_PATHS` regex allowlist; apex→www 308 keyed off `x-forwarded-host` (tunnel). Post-login redirect target lives here / in the auth flow — this is what #4 changes to `/dashboard`.
- **Render worker:** `worker/render-worker.mjs` (FFmpeg; Ken Burns, color filters, fades, xfade crossfade, drawtext title, beat-sync via aubiotrack, motion-based active-moment selection). Runs on the AI box as systemd `clipwaltz-worker`.

---

## Feature designs (as elaborated for the owner)

### 1 · Presets (Format + Style + overlays)
New **user-scoped `presets` table** snapshotting: `aspect, lengthSec, styleFilter, lightFx, transition, motion, fades, fadeOut, smartCut, beatSync, waltzToMusic, loopToFill, overlays`. Editor UI: "Save as preset" (named) + "Apply preset" dropdown.
Improvements: 3 built-in starters — **TikTok Punchy** (9:16, vivid, crossfade, beat-sync, fast cuts), **Cinematic** (16:9, noir/vintage, Ken Burns, slow), **Vlog** (9:16, warm, smart-cut); per-account **default preset** auto-applied to new projects; **admin/global presets** pushable to everyone (ties to #5).

### 2 · "Use as much footage as possible" / longest video
Length **"Max"** option beside 15/30/60 that removes the `lengthSec` cap and builds the longest coherent video the footage supports (each video its full/smart-trimmed active length; each image a beat/Ken-Burns slot). Inverse of `loopToFill`.
Improvements: beat-sync still cuts across the whole timeline; **soft ceiling** (~10 min) to bound render cost; live **projected-length readout** ("~2m 40s from 18 clips"); pair with `smartCut` so "max" = all *active* footage, not dead frames.
Touches `editor-workspace.tsx` (dirty) + `worker/render-worker.mjs` (timeline builder).

### 3 · Projects nav — ✅ done (see above).

### 4 · `/dashboard` as post-login landing
New route styled like the projects grid.
- Main: **analytics tiles** (projects, videos rendered, total minutes, likes/comments received, plan usage vs quota) + **"Jump back in"** recent-project cards + New Project CTA.
- **Right rail:** live community feed of recent public generations; clicking anywhere in the rail → `/community`.
- Change post-login redirect → `/dashboard`.
Improvements: usage-vs-plan meter that nudges upgrades, "continue last draft," trending/most-liked strip, contest banner when active.

### 5 · Admin advertisement / content area
New **`announcements` table**: `title, body, imageUrl, ctaLabel, ctaUrl, placement (dashboard_banner|dashboard_card|community), audience (all|free|paid), startsAt, endsAt, active`. Admin CRUD (on `/admin`); rendered as cards/banner on the dashboard.
Best use: target Free users with upgrade promos (`audience=free`), announce features/contests, seasonal music/template drops, cross-promote other Phoenixtekk apps. Scheduling + audience targeting = lightweight in-app marketing engine. Keep clearly labeled + dismissible.

### UI vibrancy pass
More color / gradient / motion across dashboard + editor (owner: "UI needs to be more modern and colorful and vibrant"). Brand tokens already exist: `--cw-violet/--cw-blue/--cw-magenta/--cw-coral`, helper classes `cw-sheen`, `cw-gradient-text`, `cw-glass` (note: custom `cw-` classes must live in `@layer components` so Tailwind utilities like `.absolute` win — a prior bug where `.cw-glass` set `position:relative` and beat `.absolute`).

---

## 🆕 New instructions added by owner (this batch) — do these too

### A · "Untitled project" should inherit the Title
Owner reopened a project named **"Untitled project"** and expected it to carry the same name as the **Title** (the Style Title / `titleText`).
- Today cards already fall back to `titleText?.trim() || title` for *display*, but the underlying `title` stays "Untitled project".
- **Fix intent:** when a project has no explicit `title` (still the default "Untitled project") but the user has set a `titleText`, the project name should follow the Title — either derive the display everywhere from `titleText`, or auto-set `title` from `titleText` on save when `title` is still the default. Verify where the default "Untitled project" string is assigned (project create path) and where `titleText` is written (editor / `title-caption-field.tsx`). Confirm the actual behavior before "fixing" — don't guess.

### B · Re-render did not apply the set settings — BUG, investigate
Owner re-rendered a project and it **did not re-render with the settings that were set**.
- Trace the render/re-render path: editor settings → project row update → render job payload → `worker/render-worker.mjs`. Confirm whether the re-render reads the *current* saved project settings or a stale/cached snapshot (e.g. an old `renders` row, or settings not persisted before the render call fires).
- Likely suspects: (1) settings not saved to the `projects` row before the render request; (2) the render endpoint/worker reading defaults instead of the project's current `styleFilter/lightFx/transition/motion/beatSync/…`; (3) client sending a stale payload. **Reproduce and verify with the actual job payload / worker logs before claiming a cause** (HARD RULE: verify, never guess).

### C · Render "checkpoint" preview/confirmation popup (new feature — elaborated)
When the user clicks **Render / Re-render**, first show a **confirmation checkpoint** summarizing the chosen options, so they can catch mistakes before spending a render.

Core: a modal listing the effective settings — Format/aspect, Length (or "Max"), Style filter, Light FX, Transition, Motion, Fades, Beat-sync, Music track, # clips, Title text, Overlays — with **Confirm render** / **Back to edit**.

**Elaborations / improvements:**
- **Severity-tiered checks**, not just a flat list:
  - 🔴 **Blocking-ish warnings** (still allow override): "No media added — nothing to render."
  - 🟡 **Soft warnings**: "No music selected — video will be silent," "Beat-sync is on but no music track is set," "Title text is empty," "Only 1 clip for a 60s video — footage will loop / stretch," "Aspect is 16:9 but most clips are vertical (will letterbox/crop)."
  - 🟢 **Info line**: projected output — "~0:42, 1080×1920, 12 clips, crossfade, beat-synced to *Track name*."
- **Show what changed since last render** on a re-render ("Style: Vivid → Noir; Length 30s → Max") so the user sees exactly why the output will differ — directly relevant to bug **B**.
- **Estimated render time / credit cost** if that's tracked, so "Max footage" (#2) doesn't surprise them.
- **"Don't show again for quick renders"** opt-out (per-user pref) so power users aren't slowed — but always show it when a 🔴/🟡 warning is present.
- Make the projected-length line reuse the same estimator built for #2 (Max footage).

This popup pairs naturally with #2 (surfaces the projected Max length) and #B (surfaces the settings actually about to be used, which helps confirm the re-render bug is fixed).

---

## Deploy runbook (when cleared to ship)

**App (Next.js) → `lacy@ai` (AI box), pm2:**
1. `tar` the repo **excluding** `node_modules .next .git .env.local`; use a POSIX scratch path (`/c/...`, never `C:/...` — tar treats `C:` as a remote host).
2. `scp` → extract on box.
3. `npx drizzle-kit migrate` (or project's migrate script) — **run WITHOUT `| tail`**; the pipe caused SIGPIPE mid-apply before.
4. `npm run build`.
5. `pm2 restart` the app.

**Worker:** `scp worker/render-worker.mjs` → `sudo systemctl restart clipwaltz-worker`.

**Standing rules (global CLAUDE.md):** secrets live in `G:\VisualStudioCode\_keys\clipwaltz.txt` — never print/commit; commit only when asked; commit attribution `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; mirror durable docs to https://docs.phoenixtekk.com; register shipped public URLs as a card in My Apps (Delivery group); canonical hostname is always `www.`; verify — never guess.

---

## Suggested first moves in the new session
1. Get the owner's answer on the WIP handling + build order (top of this file).
2. Reproduce bug **B** (re-render ignoring settings) and bug **A** (Untitled naming) first — they're user-visible and cheap, and B informs the checkpoint feature (C).
3. Then build the chosen cluster (dashboard #4+#5 is the low-conflict start; editor #1+#2 touches the dirty `editor-workspace.tsx`).
4. Keep FEATURES.md / ADMIN_DOCS.md / Help Center updated as features land; mirror to the wiki.

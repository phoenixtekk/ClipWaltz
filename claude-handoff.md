<!-- session-version: 11 -->

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

## Working state (2026-09-30, rotation to v11)
Tree **clean**, in sync with origin/main (`709fe78`). tsc clean; lint clean (v11: fixed generation-panel + announcements-view set-state-in-effect; eslint now ignores `.claude/**` worktree copies) — `b20d585` deployed to linuxg1 2026-09-30 (2 components + eslint config, build, pm2 restart clipwaltz; backup `/tmp/cw-pre-lintfix-src.tgz`). All deployed.
```
709fe78 docs(handoff): action-errors fix deployed
dcc5fd7 Merge remote-tracking branch 'origin/main' into claude/jovial-wescoff-66e528
38b4ecf fix: return server action errors as ActionResult so users see them in production
f48b8d6 feat(deck): music & voice mix, dynamic camera, brief history, tone presets
79ee0c0 feat: AI credits + WaltzDeck phase 5 — AI fill, brand kit from website, translations
```
- Shipped in v10: WaltzDeck **Phase 3** (presentations, PDF/PPTX export, import), **Phase 4** (campaign packs + stats +
  Free-plan "leaving ClipWaltz" interstitial), **Phase 5** (AI credits Free 30/Plus 300/Pro 1,000, AI fill, brand from
  website, translations + 7 voices), music & voice mix (Steady duck default), dynamic camera, brief history, tone presets,
  and the app-wide action-errors fix (ActionResult). Migrations 0040–0043 applied on prod.
- **Scene media editing (v11, 2026-09-30):** Edit media dialog on deck scenes (crop/reposition = `deck_scenes.frame`, migration 0044; rotate; video start = `in_sec`) + Delete from project (dialog + media rows). Dev-verified incl. real render + PDF export (PSNR). **Deployed `8e0cf9e`:** linuxg1 migration 0044 + build + pm2 restart clipwaltz & clipwaltz-gen-worker (backup `/tmp/cw-pre-scenemedia-src.tgz`); AI box render-worker.mjs + deck/{frame,export,variants}.mjs (backups `*.bak-20260930-scenemedia`), clipwaltz-worker restarted idle. Wiki features/admin-docs/help-center updated. Not exercised through the prod UI (no prod login).
- **One-screen editor studio (v11, 2026-09-30):** WaltzDeck + AutoWaltz rebuilt on `src/components/studio/studio-shell.tsx` (owner-approved invideo-style mockup https://claude.ai/artifact/D9JiqUUbzQdAexcnjrCKxg). AutoWaltz clip dialog → `clip-inspector.tsx`. Date hydration mismatch fixed + deployed (`da82e2f`, `<LocalDate>` / `useDateFormat`; backup `/tmp/cw-pre-datefix-src.tgz`). DeckPage key warning not seen in the last fresh loads, not investigated. **Deployed `d8a2862`** to linuxg1 (14 src files, build, pm2 restart clipwaltz; backup `/tmp/cw-pre-studio-src.tgz`); wiki updated.
- **Admin AI credit grants (v11, 2026-09-30):** /admin section; this-month-only bonus on top of plan allowance, note shown on Billing, revoke; `credit_grants` (migration 0045). Dev-verified. **Deployed `7b118c7`:** prod migration 0045 applied, build, pm2 restart clipwaltz (backup `/tmp/cw-pre-creditgrants-src.tgz`); wiki features/admin-docs/help-center/billing updated.
- **Next focus:** nothing queued — all 5 WaltzDeck phases are live; credit grants shipped. Hindi/Japanese/Chinese
  **not wanted** (owner, 2026-09-30) — don't propose them. Ask the owner. Rule: new client-called actions must return ActionResult
  and be unwrapped (ADMIN_DOCS "Server action errors").

## Music & voice mix, dynamic camera, brief history, tone presets (2026-09-30, v10) — LIVE on prod (`f48b8d6`)
Owner asks: music select/upload, gain + tone for music and voice, fix the ducking "pumping", brief history (15), tone
dropdown, and a camera/"video mode" (elaborated). Shipped: deck page Music & voice section (MusicPanel reuse + AudioMix:
music on/off, dB levels, tone presets, duck Steady (default) / Gentle / Strong); Camera mode Off/Subtle/Cinematic/Energetic
+ per-scene override (push/pull/pan/drift/punch-on-beat/shake; `worker/deck/camera.mjs`), preview CSS; `deck_brief_history`
(migration **0043**) + Recent picker; TONES dropdown + Custom.
- **Verified:** music-bed swing on a narrated clip Steady 0.17 dB / Gentle 1.8 / Strong 4.3 dB (14 dB range = the pumping);
  camera moves on a still (push/pan/punch/shake visible, exactly 90 frames / 3 s); dev renders with energetic camera +
  steady / strong mixes (no fallback); UI (chips, picker, per-scene select, history newest-first, reuse, cap = 15). Code
  Reviewer (71 audio combos + camera at 25/60 fps): no blockers; 3 fixes applied (crossfade beat drift, derived custom tone,
  preview reads the same description as the render). Prod: 1 render of the test project with Cinematic camera (13 s, no
  fallback; the owner got one "video ready" email); that project's brief restored (camera unset).
- **Deployed:** linuxg1 (backup `/tmp/cw-pre-mixcam-src.tgz`), migration 0043, build, app restart; AI box render worker +
  `deck/camera.mjs` (backup `render-worker.mjs.bak-20260930-mixcam`). Wiki updated.
- **Action-errors fix deployed (2026-09-30, `dcc5fd7`, owner-approved):** the other session's ActionResult sweep (58 files; every
  user-facing server action returns `{ok,error}` via `src/lib/action-result.ts`, clients `unwrap()`; toResult calls
  `unstable_rethrow` first) fast-forwarded onto main, tsc clean, app-only (no worker/migration/deps), linuxg1 rebuilt +
  restarted (backup `/tmp/cw-pre-actionerrors-src.tgz`). Verified by that session with a local production build (real toast,
  not #441); not re-checked through the prod UI (no prod login). **Rule:** a new client-called action goes in its file's
  wrapper block and must be unwrapped — a void action called without unwrap fails silently (ADMIN_DOCS section mirrored).

## AI credits + WaltzDeck Phase 5 (2026-09-29, v10) — LIVE on prod (`79ee0c0` + voice previews)
Owner decisions: **credits = monthly allowance, no purchases; all Waltz AI; Free 30 / Plus 300 / Pro 1,000** (recorded in
BILLING.md + spec). Shipped: per-job `generation_jobs.credits` (migration **0042**; older jobs 0), balance = month's
non-failed/cancelled/retried jobs (auto refund), atomic `spendCredits`, cost + balance on every AI button (Waltz AI generate,
enhance, remix, deck fill) + Billing card; **AI fill** (Bring to life / Generate a shot → clip copied to its own file, swapped
into the scene); **brand kit from website** (suggest → Use these); **languages** EN/ES/FR/IT/PT-BR + **Translate to…** (copy);
7 new Kokoro voices (espeak, estimated word timings) + previews; queue names env-overridable (dev uses `*-dev`).
- **Found + fixed:** production React replaces thrown server-action errors with "Minified React error #441" (verified with a
  local `next build`). Credit-spending actions now RETURN errors (`src/lib/action-result.ts` toResult/unwrap) — verified the
  real message shows in a production build. **App-wide this is still broken for every other action** → spawned task
  "Show server action errors in production" (another session, worktree `claude/jovial-wescoff-66e528`, converting the rest;
  told it 79ee0c0 is on main; it won't deploy without the owner).
- Code Reviewer: 6 findings, all fixed + verified (pre-credit jobs regenerated free → copies priced via `costOfJob`; fill clip
  shared the version's file → own copy; SVG-as-PNG rasterised → real-format check; translation reset retention clock →
  keeps createdAt; regenerate re-filled a scene → deckFill stripped; enqueue failure kept credits → fails + refunds).
- **Deployed:** linuxg1 full tree (backup `/tmp/cw-pre-phase5-src.tgz`), migration 0042, build, pm2 restart app + gen
  worker; AI box `clipwaltz-tts` server.py (backup `server.py.bak-20260929-phase5`) → 15 voices; voice previews
  `public/voices/*.mp3` (app restarted to serve them). Render worker unchanged. Wiki (features, admin-docs, help-center,
  spec, billing) + inventory updated.
- **Verified:** dev — real GPU AI fill (8 s clip → scene swapped, described), credits line + server refusal with no job
  created, refund math, brand from python.org applied, Spanish translation (0 lines kept back), regenerate of a 0-cost job
  charged 8 + deckFill stripped (then cancelled — GPU job stopped), storage copy call on a real clip. Prod — migration,
  15 voices synthesise with timings, previews 200. **Not exercised on prod:** credits/AI fill/translate through the UI (no
  prod login) — owner can try.
- Dev leftovers: throwaway project "Credits regen test (dev)", the Spanish copy "Phase 3 test — Q3 review (Español)".
- **Next:** all 5 WaltzDeck phases shipped. Open: merge/deploy the action-errors task when the owner approves it; optional
  per-user credit grants (admin) and Hindi/Japanese/Chinese (need CJK/Devanagari fonts + misaki extras).

## WaltzDeck Phase 4 (2026-09-29, v10) — LIVE on prod (`69fcc57`)
Campaign packs: editor section "4 · Campaign pack" → AI hooks (`writeHooks`) + CTA wordings → owner-reviewed draft →
every hook × CTA × length (6/15/30) × shape (≤ 12) rendered as its own render with a storyboard snapshot
(`renders.settings.deckVariant`, `worker/deck/variants.mjs`) → share switch opens `/c/<renderId>` landing pages with a
tracked UTM redirect (`/c/<id>/go`) → per-variant views / completion / clicks (`variant_events`, migration **0041**) →
winner (≥ 10 views, 2+ variants) → "make more like this". Code Reviewer: no IDOR; 7 bugs fixed + retested before deploy
(fixed-jobId retry hang, share-during-build 404s, 12× notifications → one per pack, unguarded draft write, lost typed
hook, click-without-view / per-IP cap, honest length labels).
- **Deployed:** linuxg1 full tree (backup `/tmp/cw-pre-phase4-src.tgz`, tree matched 8ab3a75 before), migration 0041,
  build, pm2 restart app + gen worker; AI box `render-worker.mjs` (+ `deck/variants.mjs`, `deck/planner.mjs`; backup
  `render-worker.mjs.bak-20260929-phase4`). Wiki (features, admin-docs, help-center, spec) updated. No new deps / ports.
- **Verified:** dev — 8-variant pack at exactly 6.00/15.00 s with the right hook/CTA frames, 23 simulated visitors
  counted exactly (dupes, bot, owner ignored), UTM redirect, winner "B2 25 % over 12 views", more-like-winner → 3
  question hooks, share off → 404s, one pack notification (dev log). Prod — 1-video test pack **"Prod test pack
  (phase 4)"** in "WaltzDeck test — Lake Pleasant ad" rendered via the live deck + render workers (unlisted because
  shared), www landing 200 with CTA, event 204, redirect with UTM, counts 1 view + 1 click (my curl test), share off →
  landing/redirect/video 404 (share now OFF). The owner got one "campaign pack ready" email from it (callback 200).
- **Owner decision (2026-09-29): interstitial for Free accounts** — `/c/<id>/go` → `/c/<id>/leaving` ("You're leaving
  ClipWaltz", destination shown, Continue / Go back / report) when the pack creator (else project owner) is Free, checked
  per click; Plus/Pro redirect straight. Verified on dev both ways (plan flipped + reverted).
- Dev: `.env.development.local` now also sets `WORKER_CALLBACK_SECRET` (dev-only) and `SES_SMTP_HOST=` (dev emails are
  logged, never sent). Dev packs in "Phase 3 test — URL import".
- **Next:** Phase 5 (AI fill: animate stills / generate missing shots with credits + auto-refund, brand kit from website,
  translations) — needs the credits decision (spec §7.4). Ask the owner.

## WaltzDeck Phase 3 (2026-09-29, v10) — LIVE on prod (`8ab3a75`)
Owner chose "All of Phase 3". Shipped: **Presentation** mode + `slide` layout (template, preview, planner), **Present**
full-screen view (arrows/click, N notes, P auto-play), **PDF / PPTX export** (`deck_exports`, migration **0040**, built by
the AI-box render worker via `worker/deck/export.mjs`; PPTX = picture-layer background + editable text boxes at
Chromium's measured positions/line breaks, voice line → notes), **import** PPTX/PDF (route `deck-import`, JSZip with
streamed size caps / poppler `-bbox-layout` on linuxg1) and web page (`importFromUrl`, SSRF-guarded `fetchPublic` incl.
IPv4-mapped IPv6, brief summary 8000 tokens, og:image, auto-plan). Code Reviewer found 2 issues (mapped-IPv6 SSRF, zip
bomb) — both fixed + tested before deploy.
- **Deployed:** linuxg1 full HEAD tree (backup `/tmp/cw-pre-phase3-src.tgz`; tree matched 8e4a0b6 before, CRLF aside),
  `npm ci`, migration 0040, build, pm2 restart app + gen worker; AI box `render-worker.mjs` + `deck/export.mjs` +
  `deck/text-layer.mjs` (backups `*.bak-20260929-phase3`), npm deps pptxgenjs/pdf-lib/jszip + **playwright-core now
  pinned** in `~/clipwaltz/package.json` (an npm install pruned it once — restored in minutes, no render ran meanwhile).
  Inventory + wiki (features, admin-docs, help-center, waltzdeck-feature-spec, gated fleet inventory) updated.
- **Verified:** dev E2E (PPTX import 3 slides + picture + notes; URL import python.org → brief + image + auto-plan; PDF +
  PPTX export queued in UI, built by the worker, downloaded; Present slide 2/3 + notes via DOM — the browser pane was
  hidden so screenshots were black). Prod: 2 test exports on "WaltzDeck test — Lake Pleasant ad" (d0fcb8cd…) done by the
  live worker (6-page PDF with text, 6-slide PPTX with 6 notes — the owner will see them as Downloads in that project);
  anonymous download/import → 307 to sign-in; importer diagnostics on linuxg1 (PDF, URL, mapped-v6 LAN refused).
  **Not run on prod:** an import through the prod UI (no prod login) — owner can try it any time.
- Dev: test login in gitignored `.env.development.local` (also sets `DECK_QUEUE=clipwaltz-deck-dev`, `REDIS_URL` 6380
  tunnel); dev projects "Phase 3 test — Q3 review", "Phase 3 test — URL import".
- **Next:** Phase 4 (campaigns + analytics) per spec §6 — ask the owner. Known limits: PPTX fonts fall back if the
  viewer lacks the brand font; video scenes export as stills; DNS-rebind window in `fetchPublic` (documented).

## Working state (2026-09-29, rotation to v10)
Tree **clean**, in sync with origin/main (`8e4a0b6`). Type-check + lint green on all touched files. All deployed.
```
8e4a0b6 docs(deck): phase 2 voice & captions, claim guard, clip moments; handoff
f0a7486 fix(deck): narration second pass when lines repeat the on-screen text; spoken web addresses; public voice previews
0501fee feat(deck): voiceover + word-highlight captions (phase 2)
615c1bf feat(voice): Kokoro TTS service for WaltzDeck voiceovers (phase 2, step 1)
9ccc752 feat(deck): claim guard beyond numbers; note-aware clip moments
```
- Shipped in v9: sideways-clip cause (wrong phone rotation flag) → per-clip **Rotate 90°**; remix ghost-logo fixes;
  orphan storage cleanup (14.1 GB); AI-box tunnel readiness drop-in; **WaltzDeck** (spec `06_…`, invideo research)
  Phase 1 (brief, notes, AI storyboard, scene cards, preview, brand kit, 1:1/4:5, deck renders) + claim guard + clip
  moments + **Phase 2** (Kokoro voiceover service `clipwaltz-tts` on AI box 127.0.0.1:8191, captions, ducking).
- Prod test project: "WaltzDeck test — Lake Pleasant ad" (d0fcb8cd…, owner's workspace) — AI voice + captions render.
- **Next focus:** WaltzDeck **Phase 3** (Presentation mode, PPTX + PDF export, PPTX/PDF/URL import) per spec §6 — owner
  hasn't confirmed yet (last question asked). Known limits: planning 18 s–5 min on the shared Ollama box; CTA narration
  doesn't always speak the URL (prompt-only).

## Storage cleanup on project delete (2026-09-27) — deployed + verified on prod
- `83222aa`/`2bae54c`: `deleteProject` now collects the project's keys + library media rows, deletes the row,
  then purges MinIO via `after()` (`src/lib/project-storage.ts`); anything any row still references is kept.
  Prod E2E: throwaway project + 1 upload → delete in UI → `[project-purge] … mediaDeleted:1, objectsDeleted:1`,
  object HEAD 404, media row gone. **Deployed as a file overlay** (not a full tarball) because the main
  checkout had uncommitted Waltz AI Remix work whose worker was already on linuxg1.
- `scripts/storage-orphans.mjs` (on the AI box too). Prod dry run: **202 objects / ~14.1 GB** from 98–99 deleted
  test projects (Sep 20–24), 2 orphan media rows, 0 shared. **Applied 2026-09-27 (v9, owner's go):** DB
  cross-check first (0 live projects/renders/versions/assets referencing them), then deleted 202 objects +
  2 media rows, 0 failed; re-run dry run reports 0.

## WaltzDeck Phase 2 + guards (2026-09-29, v9) — LIVE on prod
Claim guard beyond numbers + note-aware clip moments (describe v2), then Phase 2: voiceover (Kokoro TTS service
`clipwaltz-tts` on the AI box, 127.0.0.1:8191, /opt/clipwaltz-tts), narration per scene (AI or manual, second pass when
lines repeat the screen text), word-highlight ASS captions, -16 LUFS narration + ducked music; migration 0039; voice
previews public/voices. Deployed: linuxg1 full tree (backup /tmp/cw-pre-phase2-src.tgz), gen worker, render worker
(backup render-worker.mjs.bak-20260929-phase2). Prod test project now has AI voice + captions. Next: Phase 3
(presentation mode + PPTX/PDF export + PPTX/PDF/URL import) per spec.

## WaltzDeck Phase 1 (2026-09-29, v9) — LIVE on prod
Owner asked for an invideo-class "ads / campaigns / presentations from your media + prompts" feature; spec
`06_ClipWaltz_WaltzDeck_Feature_Spec.md` (research + gaps, phases 1-5; owner said "go with your recommendations" +
overlay text Auto/Manual/Off). Phase 1 shipped: Ad + Slideshow, brief, per-item notes, AI storyboard (Ollama
qwen3-vl:30b on the shared .182 box, streamed), scene cards (edit/lock/reorder/rewrite), instant preview, brand kit,
1:1 + 4:5 aspects for all projects, deck renders with Chromium text layer. Deploy: full HEAD tree to linuxg1
(backup `/tmp/cw-pre-waltzdeck-src.tgz`), migration **0038_waltzdeck** (renumbered: merged the unmerged conversion-reset
branch `claude/trusting-chebyshev-6d16ca` whose 0037_conversion_attempts was already live), gen worker restarted
(deck queue), render worker on AI box (backup `render-worker.mjs.bak-20260929-waltzdeck`); AI box got chromium +
fonts + playwright-core (inventory updated). Code review findings all fixed (asset ownership, no SVG logos, stale
plans, locked CTA, …). Prod test project **"WaltzDeck test — Lake Pleasant ad"** (d0fcb8cd…, owner's workspace; its
clips point at Lake Day v2 files — delete via the app's purge, which keeps shared files). Known limits: claim guard is
numbers-only, video moments by motion not note, planning 18 s–5 min on the shared box. Next: Phase 2 (voice +
captions) per spec.

## Remix seed logo erase (2026-09-27, v9) — deployed to linuxg1 + verified
Remix seeds from watermarked sources get `delogo` over the logo box (`wmBox` in worker/watermark.mjs) so the
i2v model can't redraw a ghost logo. Overlay deploy (generation-worker.mjs + watermark.mjs; backups
`*.bak-20260927-seeddelogo`), pm2 restarted while idle. Prod test jobs 86681e58 (30 s) and 9a546adf (536 s)
in "Remix test (throwaway)": clean-master AI frames logo-free, branded AI frames one crisp logo, lengths
exact, 0 decode errors. Remix-of-remix fixed too (`5531e56`, app rebuilt + restarted; backup
`src/lib/remix-actions.ts.bak-20260927-burnedlogo`): lineage lookup → branded source; prod job 1f993158 verified.

## Remix compose splice (2026-09-27) — deployed to linuxg1
`98dcfc7`: `worker/remix-compose.mjs` re-encodes only the changed spans (lead-in, extension, moment GOP spans,
trimmed head/tail GOP) with the source's x264 settings + colour tags (identical SPS/PPS) and stream-copies
the rest; audio built in one separate pass. Guards fall back to the old full re-encode. 536 s render
compose ~30 min → ~2 min; details, gotchas and `--selftest` in ADMIN_DOCS "Remix compose". Moving compose
to the AI box was evaluated and not needed. Deployed as a file overlay (worker/generation-worker.mjs,
remix-compose.mjs, watermark.mjs; backup `generation-worker.mjs.bak-20260927-remixsplice`), pm2 restarted.

## Working state (2026-09-27, rotation to v9)
Tree **clean**, in sync with origin/main. Type-check green (lint: 1 pre-existing error in generation-panel.tsx).
```
8d4a75a docs(marketing): add Waltz AI Remix to the product profile
75c4a9b docs: Waltz AI Remix verification, follow-ups, handoff
50e3968 fix(renders): private renders play for people who can open the project (watch route was public-only)
ec74ca1 feat(waltz-ai): Remix a video — AI lead-in, moment magic and extend on any finished video
0d40846 docs(handoff): project-delete storage purge deployed; orphan dry-run results
```
- Shipped since v8: Waltz AI **Remix a video** (lead-in / moment magic / extend on any finished video,
  song continuity), private renders playable by project members, watermark switch tested on/off,
  watermark test projects + their storage deleted.
- **PENDING — verify when each background task finishes** (owner asked; they run in separate
  sessions and their finish notices go to the OLD session, not this one — the owner will say when):
  1. ~~*Move Waltz AI Remix encoding off the web server*~~ → **done as the splice (above); verified by v9**
     2026-09-27: linuxg1 worker files == origin/main (generation-worker, remix-compose, watermark). Prod jobs
     725bc0bc (536 s, 2,265→558 s) and 2e6caa0a (30 s, 476→428 s): video = audio = 543.133 s / 33.367 s,
     0 decode errors, 15,641 frames bit-identical to the source at one offset (+132), extension audio
     audible to the end (-14 dB; the old full-re-encode run went silent for its last 3 s). **Open defect:**
     some AI frames show a ghost of the burned-in logo around the fresh one (green fringe, dark box, smear),
     because seed frames come from the watermarked render (`generation-worker.mjs` seed grab). Pre-existing,
     not caused by the splice. **Fixed + verified same day** (seed `delogo`, see "Seed-frame logo erase" below).
  2. *Delete storage files when a project is deleted*: throwaway project → upload + render + AI clip →
     delete → objects gone, no orphan media; media shared with another project kept; the orphan
     script reports only unless explicitly applied.
  3. ~~*Sideways phone clips*~~ → **taken over by v9 and done 2026-09-28** (the stalled session was stopped): cause is
     IMG_1940's own wrong rotation flag (display matrix -90 on upright pixels), not the renderer. Owner chose a
     per-clip **Rotate 90°** button (`51b4054`, `b552677`; migration 0036 applied on prod; app + render worker
     deployed, worker backup `render-worker.mjs.bak-20260928-rotation`). Prod test: project "Lake Day v2 (rotation
     test copy)" (6f745273…, render b2501878) — IMG_1940 upright, all other sampled frames bit-identical to v6.
     Test copy deleted 2026-09-28 via the app's purge (its render object removed; the 23 shared originals kept).
     No 360 clips in that project, so 360 wasn't exercised. Dev DB "Rotation UI test" project deleted
     2026-09-29 (rows only — its clips pointed at prod files in the shared bucket, so no storage purge from dev;
     the test account rtdbcd1e@example.test remains in the dev DB).
  For each: confirm deployed code on linuxg1 / AI box matches origin/main first. Never restart a
  worker mid-job; deploy restarts pm2 only after a successful build.

## Waltz AI Remix (2026-09-27, later) — live
`ec74ca1` + watch-route fix. Waltz AI tab → **Remix a video**: library of all renders + AI clips; lead-in
(reversed i2v into the first frame), moment magic (in-place overlay), extend; song continuity via
onset alignment. Verified on prod (3 runs incl. UI). Throwaway project "Remix test (throwaway)" holds
the test remixes. Follow-up chips: ~~move remix encoding off linuxg1~~ (done: splice, above); sideways
phone clips seen in "Lake Day v2" v6 render (cause unverified). Test projects "Watermark test (…)"
deleted (+ their 28 storage objects). ⚠ Another session (v8) was active on this repo the same day —
`git fetch` before deploying; deploy only restarts pm2 after a successful build.

## Working state (2026-09-27) — build plan closed out
Tree **clean** @ `0626c43`, pushed. Type-check green (lint: 1 pre-existing error in generation-panel.tsx set-state-in-effect).
```
0626c43 docs: release gate results, AI box worker dependency, handoff
ccfa686 fix(worker): measure and store video clip lengths (assets.duration_sec was never written)
fbb5393 feat(360): gyro horizon levelling; release-gate fixes; marketing handoff
adcf401 feat(beta): instrumentation events, /admin/ops beta metrics, in-app feedback
6b4978b fix: backlog gaps — cancel guard + right queue (084), clip length on thumbnails (021), fullscreen button (111), clip length within the model's range (051)
```
**Next focus / open:** owner to click the Waltz AI fullscreen button in a real browser; confirm brand voice +
competitors in PRODUCT_PROFILE.md; clip-length backfill DONE (340/340 uploaded videos, 0 unreadable — verified 2026-09-27);
optional: flip /admin watermark switch once to test it. No build-plan items remain.
All deployed + verified on prod. Commits `6b4978b` (backlog gaps) · `adcf401` (beta instrumentation) ·
`fbb5393` (gyro levelling + release-gate fixes + marketing handoff) · `ccfa686` (clip lengths).
- **Release gate (backlog §23) run in the browser as lacy@clipwaltz.com — all pass:** auth, projects,
  multi-file upload, text- and image-to-video, AI server + queue, live status, cancel, retry after a real
  failure, preview + versions, AI upscale (from the clean master), MP4 export (1080p, watermark on every frame).
  Fullscreen button calls the API correctly but the in-app browser pane never completes fullscreen — check in a real browser.
- **Fixed during the gate:** upload counter double count · feedback dialog off-screen (portal) · "Building motion"
  shown for enhancements · `assets.duration_sec` never written (backfill in the render worker).
- **Gyro levelling live:** gyro+accel fusion (accel-only followed the bank in turns). AI box got
  `@aws-sdk/s3-request-presigner` (see ADMIN_DOCS: load-test worker before restart).
- **Owner decisions:** no closed beta (sign-up stays open); tool names AutoWaltz / Waltz AI in the UI;
  marketing handoff written (`PRODUCT_PROFILE.md`, `product.marketing.json`).
- Test projects "Watermark test (AI)" / "(AutoWaltz)" on lacy@clipwaltz.com are throwaway.

## Working state (2026-09-24) — v7 start: member management + watermark (all deployed + verified)

Tree **clean** @ `87547a0`, pushed to `github.com/phoenixtekk/ClipWaltz` main. Type-check + lint green.
```
87547a0 feat(worker): logo PNG watermark bottom-left; --wmtest diagnostic
90318ce docs(status): member management deployed to prod
1ebc44c docs(status): member management built; prod deploy pending
17560d1 feat(workspaces): member management — roles, email invites, role-based access (ADR-0006)
f22c126 docs(handoff): rotate to session v6
```
- **Member management (ADR-0006) LIVE:** roles owner>admin>editor>viewer; SES email invites
  (`workspace_invites`, migration **0029** on dev+prod; single-use, 7-day, email-bound, **verified
  email required**); `/account/workspace`, `/invite/[token]`, projects workspace switcher, viewer
  read-only editor. ALL project-scoped actions/routes use `src/lib/workspace.ts` role checks;
  creator fallback ONLY for workspace-less projects (prod integrity check = 0 orphans). E2E on dev
  (2 test users, cleaned up); Security Engineer review → 4 findings fixed.
- **SES now works on prod:** SMTP user/pass added to linuxg1 `.env.local` (backup
  `.env.local.bak-ses-*`); auth + simulator send `250 Ok`. **Out of sandbox** (2026-09-24: send to unverified
  recipient accepted `250 Ok`). Note prod `.env.local` has CRLF on the SES lines (Next's dotenv copes).
- **Watermark:** free-tier renders overlay `worker/WaterMark.png` (logo) **bottom-left**; worker on
  AI box redeployed; verified via new read-only `--wmtest <projectId>` on a real prod project.
- **Deploy notes:** prod deploys work only outside auto mode (classifier blocks them). `ssh ai` logs
  in as **root** → use absolute `/home/lacy/clipwaltz/...` paths and `chown lacy`. Old pm2 error-log
  lines "different slug names ('id' !== 'versionId')" predate this deploy.
- ⚠️ Secrets from `_keys/clipwaltz.txt` (SES SMTP pass, Stripe test sk, Google client secret) were
  shown in the v6 transcript — owner advised to rotate SES + Google; update prod env if they do.
- **AISERVER idle freezes (2026-09-24):** froze twice at idle with no kernel trace; mitigations applied —
  `processor.max_cstate=1`, kdump armed (was `USE_KDUMP=0`), lockup→panic sysctls. Details in
  server-inventory AISERVER section. Watch for 1–2 days before long GPU jobs; after any freeze check `/var/crash/`.
- **AI Restore = SeedVR2 (ADR-0007, `82b5b97`, DEPLOYED):** SUPIR dropped — its license bars commercial
  SaaS use. SeedVR2-3B (Apache-2.0) on AISERVER as `seedvr2-restore-v1`; Enhance chooser has **AI Restore**
  (2× short side ≤1080p, source fps kept, ≤400 frames, 60-min timeout). Wrapper now reports `running`;
  worker timeouts count run time (3 h queue cap); cancel no longer interrupts other jobs. Verified: bench
  ≤8.8 GB on one 3080; wrapper E2E; full worker E2E on dev (704×480→1408×960, 49/49 frames, 125 s,
  cleaned up). **Not browser-verified** (auth-gated): the AI Restore button itself.
  ⚠️ ESRGAN workflow hard-codes 24 fps output (a 25/48 fps source is re-timed) — not fixed.
- **Both GPUs in use (ADR-0008, DEPLOYED):** 2nd ComfyUI `comfyui-gpu1` on GPU 1 (`127.0.0.1:8190`); wrapper
  load-balances + per-job output prefix. Verified concurrent 1080p restore + Wan gen (205 s / 82 s, no slowdown,
  30 GB RAM, 319 W/84 °C per card, no kernel errors). VRAM can't pool across the cards (tested).
- **Routing engine + admin (ADR-0009, `fffbb5c`, DEPLOYED, migration 0030 on dev+prod):** `/admin/ai`
  (models/workflows on-off, editable routing rules); Quality → steps (10/20/30); Motion → prompt phrase;
  negative prompt now sent; **seed bug fixed** (wrapper ignored seed_fields → every job used the template
  seed); friendly errors + Retry (atomic `retried`); only the final BullMQ attempt sets `failed`.
  Verified on dev: routing matrix/fallback/disable, worker E2E (10 steps, recorded seed, neg appended),
  attempt-aware failure. **Not browser-verified** (auth-gated): /admin/ai UI, Retry button, greyed options.
- **Storage edge LIVE (ADR-0003, `99e7de5`, 2026-09-25):** `media.clipwaltz.com` → MinIO. Media routes auth
  then 302 → 1 h presigned GET (`response-cache-control=private` → CF BYPASS; CF cached `.mp4` by default);
  upload parts PUT direct via presigned UploadPart, per-part fallback to the proxy. Prod env
  `S3_PUBLIC_ENDPOINT` (backup `.env.local.bak-edge-*`); kill switch `MEDIA_DIRECT=0`. Verified live on prod
  (public render 302→206 BYPASS; private render still 404/sign-in) + real-browser CORS PUT/ETag + Range GET.
  CORS locked to www via a CF Response Header Transform Rule (verified: example.com blocked in-browser).
- **360 fix (`6490dfe`, DEPLOYED app + AI-box worker, migration 0031):** single-lens `.insv` (split `_00_`/`_10_`
  recordings) now lens-axis view (full-sphere level had aimed it at the lens edge: "tilt 96°"); follow = default,
  2-lens only; circular yaw smoothing; aspect-correct FOV; per-clip **360 view** in the clip editor; worker uploads
  stream in 64 MB parts (>2 GiB outputs used to fail). Owner's jet-ski clip re-converted + verified (wake + chasing
  rider). Known limit: 2-lens handheld clips keep a tilted horizon (single global level; gyro not used). Split-lens
  pairs (_00_+_10_) are not stitched together. Watermark = Free tier only (owner is Pro) — by design.
- **Build-plan batch (`d9d0ee5` + proxy fix `380489a`, DEPLOYED 2026-09-25; migrations 0032+0033 prod):** 010/011/020/024/
  080/093/101/112/121/132/150/151/160-162/171/172/173/192/193 + /help + Free retention (LIVE, `RETENTION_ENABLED=1`;
  prod dry run: 0 free owners) + Drive backup + Stripe webhook order fix + Insta360 pair stitching (ADR-0010) + follow
  `reset_rot` fix + GEN_CONCURRENCY=2. Code-reviewed (9 findings fixed). Verified on dev: billing (real test sub,
  out-of-order), retention (7 cases), storyboard montage, stitched pair on the owner's real _00_/_10_ files.
  **Not browser-verified (auth-gated):** new wizard, Generate-tab UI, scenes panel, tags, Drive button, /admin/ops UI.
  **Gyro levelling:** prototype works (gyro2bb telemetry-parser in /opt/cw-tools on AI box; script /tmp/cwgyro) — NOT
  wired; owner to decide. Owner to upload VID_20240602_113827_00_017.insv to the jet-ski project → auto-stitch.
- **Next:** owner's signed-in smoke test of `/account/workspace` + Enhance → AI Restore; watch AISERVER
  for freezes (`/var/crash/`).

## Working state (2026-09-23) — v6: AI video-generation platform (all deployed + verified)

This session built the **generative AI video** product ALONGSIDE the music-video assembler
(coexist — ADR-0001). Full phase log: `CLIPWALTZ_BUILD_STATUS.md`; decisions:
`docs/architecture/DECISIONS.md` (ADR-0001..0005). GitHub remote now
`github.com/phoenixtekk/ClipWaltz` (main). Tree clean @ `029ace2`.

- **Data/queue:** migration **0028** (workspaces, workspace_members, generation_jobs/versions,
  export_jobs, scenes, templates, model/workflow registry) applied to dev+prod. **Redis on
  linuxg1** (127.0.0.1:6379) + BullMQ. Generation worker **`pm2 clipwaltz-gen-worker`** on linuxg1
  handles 3 queues: generation, export, enhance.
- **AISERVER (`.158`) = GPU inference node:** ComfyUI (systemd `comfyui`, **127.0.0.1:8188 only**)
  + FastAPI wrapper (systemd `clipwaltz-aiserver-api`, LAN **:8189**, bearer auth) + hourly
  `clipwaltz-aiserver-cleanup.timer`. torch 2.11+cu128, **2× RTX 3080 10 GB**. Models via
  `extra_model_paths.yaml`. Artifacts version-controlled in repo **`aiserver/`**; secret in
  `/opt/clipwaltz-ai/config/wrapper.env` (chmod 600, not committed). ⚠️ **opencv pin**:
  keep a single `opencv-contrib-python-headless<5` (dual/opencv-5 breaks cv2 → VideoHelperSuite).
- **Models/workflows:** Wan 2.2 TI2V-5B fp8 → `wan-image-to-video-v1` + `wan-text-to-video-v1`;
  enhancement `esrgan-upscale-v1` (Real-ESRGAN 2×) + `rife-interpolate-v1` (RIFE 2× fps).
- **Generate tab** (editor, new tab; assembler untouched): image/text→video, style/camera/motion/
  aspect/**variable duration**, seed/negative; live **SSE** progress; version browser with preview/
  **compare / delete / duplicate / regenerate / favorite / pick**; **Enhance** (Fast ffmpeg OR AI:
  RIFE+ESRGAN, chained upscale→interpolate); **Export Center** (mp4/webm × native/720p/1080p +
  download). All E2E-verified.
- **Workspace-scoped auth (foundation, ADR-0004):** access = owner OR workspace member (owner
  fallback → no regression; `userCanAccessProject` in `src/lib/workspace.ts`). Behaviour-preserving
  today (1 member/workspace).
- **Also:** removed the Media Library; **+41 Pixabay music tracks** (169 active); **timeline
  drag-to-reorder** fixed; S3 socket pool → 256.

**Next / open:** (1) **member-management** (invite/roles/workspace UI) to make workspace auth
multi-user; (2) **SUPIR** premium enhancement. ⚠️ AISERVER shares ONE usable GPU → generation +
AI-enhance serialize under load (the box crashed once under concurrent load, recovered by reboot).

## Working state (2026-09-22) — v5 wave 4 (all deployed + verified)

- **Auto-Batch Studio** (0027, `batch_jobs`+`batch_items`) — admin `/admin/batch`. Server-side pipeline:
  watches an input folder on the AI box, renders each group (grouping: subfolder/whole/file) with a
  preset+music+describe, writes MP4+`.txt` to the output folder, moves sources to done, auto-stops when
  empty; paced by scheduleMinutes; one item in flight per batch. Worker `batchTick`/`finalizeBatchItem`/
  `failBatchItem` in the loop. **Verified E2E** on the AI box (queue→render→output→move→auto-stop).
  ⚠️ **Folders must be writable by the worker user `lacy`** (root-owned → EACCES). Skip-set prevents
  reprocessing done/failed groups (no infinite loop). V1: standard formats, no posting.
- **UI polish this wave:** projects page + title row in glass cards; editor "New Project" button;
  music Upload tab drag-and-drop; broadened audio formats (mp3/mpa/m4a/aac/wav/ogg/opus/flac);
  per-video **trim** (in/out) via clip modal + **drag handles** on the (widened) timeline block with a
  live in/out readout; draft preview no longer sticky.
- Migrations through **0027**. Wan2GP nginx vhost on AISERVER (see server-inventory).

## Working state (2026-09-22) — v5 wave 3 (all deployed + verified)

- **Editor preview sticky fix** — the draft preview was pinned by the whole left column; wrapped
  preview+workspace in a sticky group so it releases at the render panel/history.
- **Per-video trim** (0026, `assets.trim_start/trim_end`) — clip modal Trim toggle: start/end
  sliders + "Set ⏱" from the video playhead; worker renders exactly `[start,end]` via `-ss`/`-t`,
  overriding smart window + duration override, pinned. Timeline ✂ badge. `setAssetTrim`.
- **Music upload broadened** — accepts MP3/MPA/MP2/M4A/AAC/WAV/OGG/OPUS/FLAC (≤50 MB), per-format
  MIME stored (`/api/music/upload`). ffmpeg decodes any for rendering.
- **⚠ Not browser-verified (auth-gated):** trim modal + Set-⏱, non-mp3 audio audition. Build/
  type/lint/migrations/health green.

## Working state (2026-09-22) — v5 wave 2 (all deployed + verified)

Migrations **0023–0025** applied on prod; app + worker redeployed; FEATURES mirrored to wiki.
- **Server-side categories** (0023, `project_categories`) — per-account, ordered, colour; header
  rename/move/colour/delete; `category-actions.ts`, `listCategories`. Board reads them (no more
  localStorage). Renames re-point projects; delete → Uncategorized.
- **Per-clip screen time** (0024, `assets.duration_override`) — Timeline clip modal previews that
  specific clip + manual duration slider (0.4–60s, videos clamped to source) or Auto. Worker pins
  overridden slots (verbatim, excluded from stretch). `setAssetDuration`; `--captest` unaffected.
- **Render history** — editor `RenderHistory` lists every finished render; download/delete any
  version. `listRenders`, `deleteRender` (row + MinIO object).
- **Custom MP3 upload** (0025, `music_tracks.owner_id`) — Music card **Upload** tab; owner-scoped
  rows (provider `upload`), `/api/music/upload`, `deleteMusicTrack`, owner-checked streaming;
  `getMusicTracks(userId)` merges catalog + uploads.
- **⚠ Not browser-verified (auth-gated):** category management UI, clip modal, render-history
  delete, MP3 upload+audition. Build/type/lint/migrations/health all green — owner to eyeball.

## Working state (2026-09-22) — v5 feature wave (all deployed + verified)

Migrations **0020–0022** applied on prod; app + worker redeployed; FEATURES mirrored to wiki.
- **Per-project post-text** (0020) — Topic + Channel template under 📝; worker defaults to jet-ski.
- **Notifications** — in-tab + Web Push both working; click → `/projects/<id>/edit`.
- **Fill quality** — ≤2× appearances per clip (even in loop-to-fill) + stretch-to-fill (images then
  video footage); `--captest` verifies. **Audio+video fade out together** at the end.
- **Original audio + mix** (0021) — 🔊 toggle + music/clip level sliders; worker builds a
  timeline-matched original-audio track and `amix`es with music; crossfade forced to cuts when on.
  Mix filtergraph validated on the AI box.
- **Presets** — editor bar now Apply / **Update** (resave) / **Delete** (own presets).
- **Overlay text placement** — 3×3 anchor grid + pixel sliders (distance from every edge).
- **Projects board** (0022) — uniform wider cards + orientation icon, **search**, **tag filter**,
  **user categories** with **click-hold drag between them** (`projects-board.tsx`,
  `setProjectCategory`/`setProjectTags`). Empty categories persisted per-browser (localStorage).
- **⚠ Not yet browser-verified (auth-gated):** the projects-board drag-drop, the audio mix on a
  real render, and the overlay pixel sliders — owner to eyeball. Build/type/lint/migrations/health
  all green.

## Working state (2026-09-21) — v5 in progress

- **`3e0dde0` fix(storage): stream large media instead of buffering (DEPLOYED + VERIFIED).**
  `serveObject()` buffered the whole object on any no-Range / `bytes=0-` GET; one large download
  (an 8 GB `.insv`, a big render) pulled **~21 GB RSS** into the app → event loop pegged, every
  route (even static `/`) timed out = **full outage** (this was the real cause of the repeated
  "This page couldn't load", not just the menu bug). Fix: HEAD for size, buffer ≤16 MB, **stream
  larger responses with an explicit `Content-Length`** (that header is what unblocks Next 16
  streaming — the old "streaming hangs" was a Content-Length-less body). **Verified on prod:** 147 MB
  render → TTFB 0.33s, +38 MB RSS; 8 concurrent 147 MB streams → peak +13 MB. App RSS back to ~140 MB.
  Runbook updated (ADMIN_DOCS "Proxied media"). Deployed build `pg4IL8Lp…`.
- **Notifications: BOTH toggles work (in-tab + Windows Web Push), verified live.** The earlier
  push failure was NOT a network block (that was a wrong guess — verified from the workstation that
  FCM is fully reachable: `fcmregistrations.googleapis.com:443` → 404, cert = Google Trust Services
  (no MITM), `mtalk.google.com:5228` open, no proxy). The real cause was that push was tested WHILE
  the app was in the 21 GB hung state, so `/sw.js` timed out → subscribe failed with "push service
  error". Once the media-streaming fix restored the app, push subscribed and delivered fine.
  **Notification click URL fixed** (`VOUmKJuUGrF3qLq__eoHZ`): pointed at `/projects/<id>` which has
  no page (only `/projects/[id]/edit`) → 404 on click; both the push (`render-ready/route.ts`) and
  in-tab (`render-panel.tsx`) now use `/projects/<id>/edit`. UCG/UniFi gateway needs no changes.
- **Still pending (owner):** worker restart to activate OOM-safe crossfade + clear stuck render
  `34d1db72` (`ssh ai "sudo -n systemctl restart clipwaltz-worker"`).

## Working state (2026-09-20) — v5 in progress ⚠️ DEPLOY PENDING (owner-gated)

- **`99ec815` fix(ui): account menu crashed on open (Base UI error #31).** `DropdownMenuLabel`
  (Base UI `Menu.GroupLabel`) was rendered outside a `Menu.Group`; `GroupLabel` →
  `useMenuGroupRootContext()` throws "MenuGroupContext is missing" (prod code #31) → the whole page
  showed "This page couldn't load" the instant the avatar menu opened. **Pre-existing** latent bug
  (verified: lockfile drift was only web-push's own deps, Base UI untouched); surfaced because
  Account → Notifications now lives in that menu. Fix: wrap the label in `DropdownMenuGroup`
  (`user-menu.tsx`). Only that dropdown used `DropdownMenuLabel`. Build green. **Redeploy app** with
  the staged tarball (below) to pick it up. Base UI error codes → text:
  `gh api repos/mui/base-ui/contents/docs/src/error-codes.json`.


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
- **Worker bugs — FIXED this session (committed, ⚠️ worker NOT yet redeployed):**
  (1) **crossfade OOM** → `crossfadeChunks()` xfades in bounded chunks of `XFADE_CHUNK` (default 10,
  env-tunable) then hard-concats; ffmpeg now sees ≤10 inputs, not 78. Verified on the AI box:
  `--xfadetest 30 10` → 3 chunks, 51.90s = expected. (2) **orphaned renders** → `reapStaleRenders()`
  runs on loop startup and fails any render stuck in `rendering` (single-worker: they're all orphans
  from a prior crash). **Deploying the worker also auto-clears the owner's stuck `34d1db72`** via the
  reaper. Deploy: `scp worker/render-worker.mjs ai:/home/lacy/clipwaltz/worker/ && ssh ai 'sudo -n
  systemctl restart clipwaltz-worker'`. Diagnostic: `--xfadetest [N] [K]`.

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

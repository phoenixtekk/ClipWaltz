# ClipWaltz Build Status

Living tracker for the AI-video-generation build (per `00_ClipWaltz_Build_Execution_Guide.md` §37).
Assembler (music-video) product is separate and shipping — see [ADR-0001](docs/architecture/DECISIONS.md).

## Current Phase
**Phase 1 — Data + queue foundation** (Phase 0 decisions complete)

## Approved decisions (2026-09-23)
- Coexist assembler + AI generation (ADR-0001)
- Redis + BullMQ queue (ADR-0002)
- Direct-to-object-storage signed URLs (ADR-0003) — security design pending
- Multi-tenant Workspaces from the start (ADR-0004)

## Verified infrastructure (2026-09-23)
- **AISERVER** = `aiserver` / 192.168.166.158 (distinct from the .168 CPU render box and .182 Ollama host).
- GPU: **2× RTX 3080, 10 GB each**, driver 595.91.07. RAM 121 GB. Disk 389 GB free. OS Ubuntu 26.04.
- linuxg1 (app) → AISERVER reachable (ping ~1 ms; :11434 → 200).
- **Blockers for Phase 2 (AISERVER):** ComfyUI not installed · ffmpeg missing · Python 3.14 (too new
  for torch/ComfyUI wheels — need 3.11–3.12 env) · no CUDA toolkit (torch runtime likely fine) · no Redis yet.
- **Model constraint:** 10 GB/GPU → start with LTX-Video / small Wan variants; Hunyuan Video too heavy.

## Completed
- [x] Phase 0 — build-gap report + owner decisions + ADRs
- [x] Live AISERVER + backend-reachability validation
- [x] Phase 1 schema — migration 0028 (10 new tables + workspace_id) applied to **dev AND prod** (10/10 verified)
- [x] Redis provisioned on linuxg1 (127.0.0.1:6379, localhost-only, verified PONG)

## Phase 2 — AISERVER inference node: DONE + VERIFIED (2026-09-23)
- [x] ComfyUI (localhost:8188, systemd) + FastAPI wrapper (LAN :8189, bearer auth) both active;
      torch 2.11+cu128, both RTX 3080s visible.
- [x] Model: **Wan 2.2 TI2V-5B fp8** (ADR-0005 — LTX is now 22B, too big for 10 GB). Workflow
      `wan-image-to-video-v1` (graph + map in `aiserver/workflows/wan/`).
- [x] E2E through the wrapper: `POST /jobs` → ComfyUI → Wan 2.2 → MP4, `/jobs/{id}` completed
      (doc 04 §28 tests 1–5 + submit/status). linuxg1→wrapper reachable (401 w/o token).
- **Wrapper shared secret** lives at `/opt/clipwaltz-ai/config/wrapper.env` on AISERVER (chmod 600),
  NOT committed. Owner action / next step: set `AISERVER_API_URL` + `AISERVER_API_TOKEN` on
  linuxg1 `.env.local` for the app/worker to authenticate.

## Phase 1 first vertical slice: DONE + VERIFIED E2E (2026-09-23, Guide §44)
- [x] Generation **worker** live on linuxg1 (`pm2 clipwaltz-gen-worker`, saved). BullMQ consumer:
      MinIO source → wrapper `POST /inputs` → `POST /jobs` → poll → `GET /outputs` → MinIO →
      `generation_versions` row + status state machine. Media transfer via wrapper endpoints
      (`POST /inputs`, `GET /outputs`) — ComfyUI stays isolated.
- [x] `AISERVER_API_URL`/`AISERVER_API_TOKEN`/`REDIS_URL` wired into linuxg1 `.env.local`.
- [x] **E2E proof:** enqueued a real job against a prod photo asset → worker → Wan 2.2 → MP4 in
      MinIO (405 KB) → `generation_versions` v1 → status `completed` in ~56 s. Test artifacts cleaned up.

## Generation UI: DONE + DEPLOYED (2026-09-23)
- [x] `GenerationPanel` (doc 03 §9-12): source-photo picker, prompt, style/camera/motion/aspect/
      quality controls, advanced (seed/negative), dominant Generate CTA, §11 friendly progress +
      Cancel, version browser playing via `/api/generations/[id]/watch`. New "Generate" tab in the
      editor (assembler tabs untouched). Backend: `listGenerationVersions` + owner-only watch route.
- [x] Deployed to linuxg1 (app rebuilt, `pm2 restart clipwaltz` + `clipwaltz-gen-worker`); / 200.
      **The full path is live: Generate tab → createGenerationJob → BullMQ → worker → AISERVER →
      MinIO → version browser.** (Backend E2E proven earlier; each UI link verified in code+build.)

- [x] **Variable clip length** (2026-09-23): worker converts durationSec→Wan frames (24fps, 4n+1,
      clamped 1–12s), wrapper accepts `length`, workflow maps it. Verified E2E: 3s→3.04s/73f,
      8s→8.04s/193f (no OOM). Deployed.

- [x] **Text-to-video** (2026-09-23): Wan 2.2 TI2V-5B does both modes (start_image optional).
      `wan-text-to-video-v1` workflow + wrapper registry; UI "From image / From text" toggle.
      Verified E2E through the worker (prompt→MP4, no image, ~80s). Deployed.

- [x] **Version browser: compare + delete** (2026-09-23). Hover a version for side-by-side
      Compare (two players) or Delete (`deleteGenerationVersion` — row + MinIO object). Deployed.
- [x] **Version browser: duplicate + regenerate** (2026-09-23). Preview-header Duplicate (same
      seed) / Regenerate (fresh seed) via `regenerateFromVersion`. Deployed.
- [x] **Music catalog +41** (2026-09-23): ingested 41 Pixabay tracks (I:\…\Pixabay\200, 2 dupes
      skipped) via `scripts/seed-music.mjs` + manifest `music-manifest-pixabay200-2026-09-23.json`.
      music_tracks active now 169; durations ffprobed, moods tagged, Pixabay Content License.

- [x] **Export-as-a-job** (2026-09-23): `clipwaltz-export` queue + export-actions + owner-only
      download route; the worker ffmpeg-transcodes a version to format (MP4/WebM) + resolution
      (Native/720p/1080p) on linuxg1 → MinIO. UI: preview-header Export chooser + Export Center
      (status, download, delete). Verified E2E (704×480 → 1080p → 1584×1080). Deployed.

## Remaining (not yet built)
- [ ] Generation: enhancement pass (interpolation/upscale); workspace-scoped auth; realtime SSE
      status; version favorite / set-as-selected.
- [ ] Workspace-scoped authorization (queries still owner-scoped); enhancement + export-as-job
      phases; text-to-video workflow; realtime SSE status (polling works today).

## App-layer done (2026-09-23, verified: build passes; backfill tested on dev with real data)
- [x] BullMQ queue module (`src/lib/queue.ts`, lazy Redis) — `bullmq`/`ioredis` added
- [x] Provider abstraction `AIVideoProvider` + `ComfyUIAIServerProvider` (`src/lib/ai/*`) — coded to
      the wrapper's exact `/jobs` contract
- [x] Generation-job service (`src/lib/generation-actions.ts`) — create/get/cancel + enqueue
- [x] Workspace layer: `ensurePersonalWorkspace` + signup hook + idempotent backfill
      (`scripts/backfill-workspaces.mjs`). Run on **dev AND prod** (prod: 1 user → 1 workspace,
      25 projects + 374 assets linked; re-run idempotent). Note: workspace_id is populated but not
      yet enforced in authorization (queries still owner-scoped) — enforcement is a later step.

## Blocked / owner-action
- [ ] Direct-signed-URL storage edge (ADR-0003) — needs owner-created CF public hostname when Phase 4 lands
- [ ] AISERVER wrapper public exposure (if ever needed) — owner CF Access, per fleet rule 1a

## Next (dependency order)
1. Read doc 01 data model + doc 05 §6 entities; design + write Drizzle migrations for the new
   generation entities + workspace layer (coexisting with existing tables).
2. Backfill migration: default workspace per existing user; attach existing projects.
3. Stand up Redis + BullMQ; queue module + generation worker skeleton.
4. Phase 2: AISERVER inference node (ffmpeg, py env, ComfyUI, one Wan/LTX image→video workflow,
   FastAPI wrapper) — validated independently before UI wiring.
5. Phase 3: `AIVideoProvider` abstraction + workflow registry loader + minimal routing.
6. Phase 4: first vertical slice (Guide §44) — Create Project → upload image → GenerationJob →
   queue → AISERVER → ComfyUI → video → store as GenerationVersion → status → display.

Full phase plan (Phases 5–10: controls/text-to-video, versions/compare, enhancement, export,
realtime status, templates/storyboard/admin) in the build-gap analysis.

> Do not mark untested work complete.

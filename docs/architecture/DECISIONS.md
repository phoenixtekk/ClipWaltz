# ClipWaltz Architecture Decision Log

Per `00_ClipWaltz_Build_Execution_Guide.md` §38. Newest first.

---

## ADR-0008 — One ComfyUI per GPU, load-balanced by the wrapper
- **Date:** 2026-09-24
- **Decision:** Run a second ComfyUI (`comfyui-gpu1`, `127.0.0.1:8190`, `--cuda-device 1`) beside
  the first (pinned `--cuda-device 0`). The wrapper sends each job to the online backend with the
  fewest active jobs and gives every job a unique output prefix (`clipwaltz/<job_id>`).
- **Reason:** GPU 1 sat idle; a 30-min restore blocked every generation. The two 10 GB 3080s cannot
  pool into one 20 GB device (no NVLink; SeedVR2 has no model-sharding) — tested: VAE on GPU 1 with
  the DiT on GPU 0 left GPU 0's peak unchanged (9.48 GB at 1080p b21) and b33 still OOMed. So the
  second card buys **concurrency**, not bigger batches.
- **Measured (2026-09-24):** 1080p restore on GPU 0 and a Wan 704×480 generation on GPU 1 at the
  same time: 205 s and 82 s (solo: 206 s / 86 s); peak system RAM 30 GB of 121; both cards peaked
  319 W / 84 °C; no kernel/GPU errors.
- **Alternatives considered:** SeedVR2 CLI multi-GPU (splits one clip across both cards — ~2×
  faster per restore, but still serial across jobs and outside ComfyUI).
- **Impact:** ~640 W GPU draw when both are busy (PSU rating not checked). Models load per
  instance (a job landing on the other card pays a cold load). `COMFYUI_URLS` in `wrapper.env`.

## ADR-0007 — Premium enhancement uses SeedVR2, not SUPIR
- **Date:** 2026-09-24
- **Decision:** The premium "restore" enhancement is **SeedVR2-3B** (ByteDance-Seed; code **and**
  weights Apache-2.0) via the `ComfyUI-SeedVR2_VideoUpscaler` node (v2.5.23, Apache-2.0), exposed as
  the **AI Restore** engine (`seedvr2-restore-v1`).
- **Reason:** SUPIR's license (Fanghua-Yu/SUPIR `LICENSE` §1(c), §3) prohibits commercial use —
  explicitly including "deploying software as a service" — without a separate written agreement.
  ClipWaltz is a paid SaaS. Owner chose SeedVR2 over licensing SUPIR. SeedVR2 is also video-native
  (temporal batches) where SUPIR is per-image.
- **Measured on one 10 GB RTX 3080 (2026-09-24):** 3B fp8 DiT, BlockSwap 32, VAE tiles 512 →
  704×480→1408×960 b21: 118 s / 49 frames, 8.8 GB peak; 640×360→1280×720 b21: 88 s / 45 frames;
  1280×720→1920×1080 b13: 206 s / 45 frames, 8.4 GB peak (b21 hit 9.5 GB, b49 OOM). On real footage
  it gives clearly more detail than Real-ESRGAN; on blurry Wan output it can invent streak texture —
  `latent_noise_scale=0.1` reduces it and is the default.
- **Alternatives considered:** License SUPIR commercially; SUPIR internal-only.
- **Impact:** New AISERVER node + 3.7 GB of models (`/data/clipwaltz-ai/models/SEEDVR2`); wrapper
  gains optional `resolution`/`batch_size` job inputs; worker computes them (2× short side ≤1080;
  batch 13 above 1.4 MP), 60-min timeout, 400-frame cap. (Long restores no longer block
  generation — see ADR-0008.)

## ADR-0006 — Workspace roles + email invites (member management)
- **Date:** 2026-09-23
- **Decision:** Four roles — owner > admin > editor > viewer. Members get the **full editor** on every
  project in the workspace (owner ruling), by role. Invites are **emailed via SES** as single-use,
  7-day, email-bound token links (only the SHA-256 is stored). Admins manage editors/viewers; only the
  owner manages admins. A project in a workspace is authorized **solely by workspace membership** —
  the creator fallback applies only to legacy projects with no workspace, so removing a member
  revokes access even to projects they created there.
- **Reason:** Owner ruling (full editor + 4 roles + email link) to make ADR-0004 multi-user.
- **Alternatives considered:** Generate/export-only or view-only membership; copy-link-only invites;
  two roles.
- **Impact:** `workspace_invites` (migration 0029). All project-scoped actions/routes moved from
  `ownerId` checks to role checks. Categories, presets, music uploads, batches, community sharing and
  challenge entries stay per-person (creator).

## ADR-0005 — First generation model: Wan 2.2 TI2V-5B (not LTX)
- **Date:** 2026-09-23
- **Decision:** Use **Wan 2.2 TI2V-5B** (fp8) as the first image→video model on AISERVER, via
  ComfyUI core's native Wan nodes. Owner ruling after the VRAM finding below.
- **Reason:** The plan (and doc §9/§12) assumed LTX as the light/fast model, but **ComfyUI-LTXVideo
  has moved to LTX-2.3, whose checkpoint is 22B** — impossible to load on the AISERVER's 2× RTX 3080
  **10 GB** cards. Wan 2.2 TI2V-5B (fp8, ~5–6 GB resident) fits 10 GB with weight-dtype fp8 + offload
  and is the doc's "baseline" family.
- **Alternatives considered:** older LTX-Video 0.9.x 2B (fp8) — the original fast/light LTX.
- **Impact:** Models (`wan2.2_ti2v_5B_fp16.safetensors`, `umt5_xxl_fp8_e4m3fn_scaled.safetensors`,
  `wan2.2_vae.safetensors`) in `/data/clipwaltz-ai/models`, referenced via
  `extra_model_paths.yaml`. Workflow id `wan-image-to-video-v1` (graph + field map committed under
  `aiserver/workflows/wan/`). UNETLoader `weight_dtype=fp8_e4m3fn` to fit 10 GB. Verified E2E through
  the wrapper 2026-09-23. LTX / Hunyuan deferred.

## ADR-0004 — Multi-tenant Workspace layer from the start
- **Date:** 2026-09-23
- **Decision:** Introduce `Workspace → Project` with `WorkspaceMember` roles up front, per the
  Technical Architecture (doc 01 §5/§21). Existing `User → Project` data migrates into a default
  personal workspace per user.
- **Reason:** Owner ruling. Avoids a later schema-wide refactor touching every domain table.
- **Alternatives considered:** Defer workspaces for MVP (backlog doc 02 does not require them).
- **Impact:** New `workspaces` / `workspace_members` tables; `projects` (and other owner-scoped
  tables) gain `workspace_id`; authorization moves from owner-check to workspace-membership check.
  A data migration backfills a default workspace for every existing user and their projects.

## ADR-0003 — Direct-to-object-storage signed URLs (replacing app-proxied media)
- **Date:** 2026-09-23
- **Decision:** Adopt presigned direct-to-MinIO upload/download URLs per the architecture
  (doc 01 §12/§17, Guide §22), replacing the current app-proxied media model for the generation
  path.
- **Reason:** Owner ruling. Removes large binaries from the app process; matches the named arch.
- **Alternatives considered:** Keep app-proxied media (the current LAN-only-MinIO security posture,
  adopted after the 21 GB buffering outage — see `ADMIN_DOCS.md`).
- **Impact / SECURITY (must design carefully):** MinIO must become reachable to browsers for
  presigned URLs to work. This is a deliberate reversal of "MinIO stays off the public internet."
  Guardrails required: short-TTL presigned URLs only; bucket must NOT be publicly listable; CORS
  locked to the ClipWaltz origin; expose the presign target via a **Cloudflare Tunnel public
  hostname** (owner-created, per global rule §1a), never raw MinIO on the internet; keep the
  existing proxied routes for anything that must stay private. Owner must create the CF hostname
  for the storage edge before this ships.

## ADR-0002 — Redis + BullMQ for the generation job queue
- **Date:** 2026-09-23
- **Decision:** Use Redis + BullMQ for AI generation jobs, per the architecture (doc 01, doc 05
  Priority 2) — CW-MVP-090.
- **Reason:** Owner ruling. Better fit than DB polling for GPU orchestration: progress events,
  retries/backoff, concurrency caps to a scarce 2-GPU node, cancellation.
- **Alternatives considered:** Reuse the existing Postgres `FOR UPDATE SKIP LOCKED` queue
  (`renders` table) that already works for FFmpeg assembly.
- **Impact:** New Redis instance (planned: linuxg1, bound `127.0.0.1:6379`); `bullmq`/`ioredis`
  deps; a queue module + BullMQ worker. The existing DB queue REMAINS for the music-video
  assembler (see ADR-0001). Redis provisioning on the prod host requires owner confirmation.

## ADR-0001 — AI generation coexists with the music-video assembler (no replacement)
- **Date:** 2026-09-23
- **Decision:** Keep the existing deterministic music-video product (beat-sync, music catalog,
  overlays, contests, community) as one mode; add generative AI video as a second, separate mode.
- **Reason:** Owner ruling. The existing product is mature and shipping; the 7 design docs are
  additive (they never mention music/beat-sync) and do not direct its removal (Guide §40: don't
  remove working functionality without reason).
- **Alternatives considered:** Full replacement; replace-but-keep-community.
- **Impact:** New generation entities/worker/queue are added alongside `renders`/`assets`. The
  FFmpeg assembly worker (`worker/render-worker.mjs`) and its DB queue are untouched. Shared:
  auth, workspaces/projects, uploads, storage, billing, notifications.

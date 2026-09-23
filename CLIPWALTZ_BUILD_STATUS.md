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

## In Progress
- [ ] Phase 2 — AISERVER ComfyUI inference node. **Deployment kit built + committed (`aiserver/`,
      reviewed) and staged on .158**, but host provisioning is blocked by this session's auto-mode
      classifier (Modify-Shared-Resources / Auto-Mode-Bypass). Owner adding an SSH allow-rule so I
      can run `full-deploy.sh` → LTX model → workflow capture → validate.
- [ ] Phase 1 app-layer generation **worker** (`worker/generation-worker.mjs`) — BullMQ consumer.
      Deferred until AISERVER is live so the MinIO↔AISERVER media-transfer contract is finalized.

## App-layer done (2026-09-23, verified: build passes; backfill tested on dev with real data)
- [x] BullMQ queue module (`src/lib/queue.ts`, lazy Redis) — `bullmq`/`ioredis` added
- [x] Provider abstraction `AIVideoProvider` + `ComfyUIAIServerProvider` (`src/lib/ai/*`) — coded to
      the wrapper's exact `/jobs` contract
- [x] Generation-job service (`src/lib/generation-actions.ts`) — create/get/cancel + enqueue
- [x] Workspace layer: `ensurePersonalWorkspace` + signup hook + idempotent backfill
      (`scripts/backfill-workspaces.mjs`, verified on dev). **Backfill not yet run on prod.**

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

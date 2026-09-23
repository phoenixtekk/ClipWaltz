# ClipWaltz Architecture Decision Log

Per `00_ClipWaltz_Build_Execution_Guide.md` §38. Newest first.

---

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

# ClipWaltz render worker

Standalone Node worker that turns queued renders into finished 9:16 videos.

## What it does
1. Claims the oldest `renders` row with `status='queued'` (atomic: `FOR UPDATE SKIP LOCKED`).
2. Pulls the project's uploaded clips from the MinIO `clipwaltz` bucket.
3. FFmpeg-assembles a **1080×1920 (9:16) H.264** video — photos ~2s, videos ≤4s, normalized and
   concatenated; optional music (first active `music_tracks` row, looped to length); optional
   watermark (font-fallback safe).
4. Uploads to `renders/<projectId>/<renderId>.mp4` and sets the render `done` + project `ready`.
   On error the render is marked `failed`.

## Run
From the **project root** (reuses the app's `node_modules` — `postgres`, `@aws-sdk/client-s3`):
```bash
node --env-file=.env.local worker/render-worker.mjs --once   # process one job, exit
node --env-file=.env.local worker/render-worker.mjs          # loop (5s poll)
```
Requires `DATABASE_URL` + `S3_*` in the environment, plus `ffmpeg`/`ffprobe` on PATH.

## Deploy (prod)
Target host: the **AI box** (32-core, FFmpeg, reaches MinIO on the LAN). See `ADMIN_DOCS.md` →
*Render worker* for the pending prerequisite (authorizing the AI box on linuxg1 for a Postgres
tunnel) and the systemd setup.

## Roadmap
- Redis/BullMQ queue instead of DB polling
- Beat-synced cuts + face/scene-aware clip selection
- SES "your video is ready" email on completion

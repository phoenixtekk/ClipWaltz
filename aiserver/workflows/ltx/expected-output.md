# Expected output — `ltx-image-to-video-v1`

A successful run produces:

- An **MP4** file in `/data/clipwaltz-ai/output/` (H.264, yuv420p).
- Dimensions matching the requested `width`×`height` (default 768×512).
- Duration ≈ requested `duration` seconds (LTX generates a frame count; the
  effective duration is frames ÷ fps and may differ by a fraction of a second).

The wrapper's `GET /jobs/{job_id}` reports:

```json
{
  "job_id": "cw_xxxxxxxxxxxx",
  "status": "completed",
  "outputs": [
    {
      "filename": "<name>.mp4",
      "subfolder": "",
      "path": "/data/clipwaltz-ai/output/<name>.mp4",
      "type": "output",
      "format": "video/h264-mp4"
    }
  ]
}
```

Validation evidence recorded on the successful Phase 1 run (doc §28 tests 4–5)
is appended here during deployment: actual filename, ffprobe dimensions/codec,
generation time, and peak VRAM during the run (nvidia-smi) proving GPU use.

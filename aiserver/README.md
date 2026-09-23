# ClipWaltz AI Video Node — AISERVER

Version-controlled artifacts for the ClipWaltz Phase 1 AI-video inference node
running on **AISERVER** (`192.168.166.158`, host alias `aiserver`). Implements
doc `04_ClipWaltz_Phase1_AISERVER_ComfyUI_Implementation.md`.

The pipeline: **ClipWaltz backend (linuxg1) → AISERVER API wrapper → ComfyUI
(localhost) → LTX-Video → MP4 in `/data/clipwaltz-ai/output`.**

## Layout on AISERVER

```
/opt/clipwaltz-ai/            # application code (root-created, owned by lacy)
    comfyui/                  # ComfyUI checkout
    venv/                     # dedicated Python 3.12 venv (uv-managed)
    workflows/{wan,ltx,hunyuan,enhancement}/
    scripts/                  # wrapper app.py runs from here
    config/wrapper.env        # shared secret + bind config (chmod 600, NOT committed)
    logs/                     # comfyui.log, wrapper.log, jobs.jsonl audit
/data/clipwaltz-ai/           # data (separate 916 GB mount, owned by lacy)
    models/{checkpoints,diffusion_models,text_encoders,vae,clip,loras,upscale_models,controlnet}/
    input/  output/  temp/  cache/
```

Why the split: system Python on AISERVER is 3.14 (too new for PyTorch/ComfyUI
wheels) and must not be touched; models/renders are large so they live on the
dedicated `/data` mount, never mixed with app code (doc §5).

## Ports & network posture

| Service | Bind | Port | Reachable from |
|---------|------|------|----------------|
| ComfyUI | `127.0.0.1` | 8188 | **localhost only** — never off-box |
| AISERVER API wrapper | LAN IP `192.168.166.158` | 8189 | LAN (ClipWaltz backend on linuxg1); **not** public |

Nothing here is on the public internet. If external access is ever needed it
goes through a **Cloudflare Tunnel + Access created by the owner** — do not set
that up from here. Untouched neighbours on this host: nginx `:80`, Ollama
`:11434`, Wan2GP `127.0.0.1:42003`.

## Systemd services

- `comfyui.service` — runs ComfyUI from the venv, bound to `127.0.0.1:8188`,
  output/input/temp pointed at `/data/clipwaltz-ai`. Auto-start, restart-on-failure.
- `clipwaltz-aiserver-api.service` — runs the FastAPI wrapper via uvicorn,
  `EnvironmentFile=/opt/clipwaltz-ai/config/wrapper.env`, `Requires=comfyui.service`.

Install: copy the units from `systemd/` to `/etc/systemd/system/`, then
`sudo systemctl daemon-reload && sudo systemctl enable --now comfyui clipwaltz-aiserver-api`.

## API (wrapper)

All endpoints require `Authorization: Bearer <CW_API_TOKEN>`.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | `{status, comfyui, gpu_count, active_jobs, disk_free_gb}` |
| GET | `/gpu` | per-GPU name / memory / utilisation / driver |
| GET | `/models` | available logical workflows |
| POST | `/jobs` | submit a logical job (see `workflows/ltx/sample-input.json`) |
| GET | `/jobs/{job_id}` | job status + registered output files |
| POST | `/jobs/{job_id}/cancel` | remove from queue / interrupt |

## Operating

```bash
# status / logs
systemctl status comfyui clipwaltz-aiserver-api
tail -f /opt/clipwaltz-ai/logs/comfyui.log
tail -f /opt/clipwaltz-ai/logs/wrapper.log
cat /opt/clipwaltz-ai/logs/jobs.jsonl          # structured per-job audit (doc §22)

# health (from linuxg1)
curl -s -H "Authorization: Bearer $CW_API_TOKEN" http://192.168.166.158:8189/health

# restart
sudo systemctl restart comfyui
sudo systemctl restart clipwaltz-aiserver-api
```

## Repo contents

```
aiserver/
  README.md                       # this file
  wrapper/app.py                  # FastAPI wrapper source
  wrapper/requirements.txt
  systemd/comfyui.service
  systemd/clipwaltz-aiserver-api.service
  config/wrapper.env.example      # template; real secret never committed
  models/manifest.md              # model manifest (doc §27 retained artifact)
  custom-nodes-manifest.md        # ComfyUI custom node manifest (doc §10)
  scripts/deploy.sh               # reproducible host build (doc steps 2–7)
  workflows/ltx/                  # LTX image→video workflow + docs
```

The shared secret (`CW_API_TOKEN`) is **never** in this repo. It is generated on
AISERVER and delivered to the owner out-of-band for the ClipWaltz backend env.

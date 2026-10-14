#!/usr/bin/env bash
# Dev-only Waltz Avatar stack on AISERVER, beside (never instead of) the live services:
#   talking  127.0.0.1:8193  (~/presenter-dev: service.py + presenter.py + consent.py in venv-full = the live talking venv + the Waltz Avatar extras, GPU 1)
#   voice    127.0.0.1:8196  (~/presenter-spike/chatterbox/service.py = aiserver/voice/service.py, GPU 0)
#   wrapper  127.0.0.1:8194  (~/presenter-dev/wrapper_app.py) → the dev talking + voice services, the live ComfyUIs
# Inputs/outputs/logs in /tmp/cwdev, presenter caches in /tmp/presenters-dev — nothing touches /data or prod logs.
# The dev generation worker reaches the dev wrapper through an SSH tunnel:
#   ssh -fN -L 8194:127.0.0.1:8194 aiserver   and   AISERVER_API_URL=http://127.0.0.1:8194 node worker/generation-worker.mjs
# Sync code first:  scp aiserver/talking/{service,presenter,consent}.py aiserver:presenter-dev/
#                   scp aiserver/wrapper/app.py aiserver:presenter-dev/wrapper_app.py
#                   scp aiserver/voice/service.py aiserver:presenter-spike/chatterbox/service.py
# Usage: dev-avatar-stack.sh start|stop|status
set -euo pipefail
TOKEN=$(sudo -n grep -E '^CW_API_TOKEN=' /opt/clipwaltz-ai/config/wrapper.env | cut -d= -f2-)
D=/tmp/cwdev
M=$HOME/presenter-dev/models
mkdir -p $D/input $D/output $D/logs /tmp/presenters-dev

stop() { for p in 8193 8194 8196; do pid=$(ss -tlnpH "sport = :$p" | grep -oP 'pid=\K[0-9]+' | head -1 || true); [ -n "$pid" ] && kill "$pid" && echo "stopped :$p ($pid)"; done; true; }

case "${1:-status}" in
  start)
    stop
    common=(CW_API_TOKEN="$TOKEN" CW_INPUT_DIR=$D/input CW_OUTPUT_DIR=$D/output HF_HUB_OFFLINE=1)
    (cd ~/presenter-dev && env "${common[@]}" CUDA_VISIBLE_DEVICES=1 HF_HOME=/opt/clipwaltz-ai/talking/hf \
       PRESENTER_MODELS=$M PRESENTER_CACHE=/tmp/presenters-dev TALK_GPU_COMFYUI=http://127.0.0.1:8190 TALK_CPU_THREADS=8 \
       setsid nohup venv-full/bin/uvicorn service:app --host 127.0.0.1 --port 8193 --workers 1 </dev/null >$D/talk.log 2>&1 &)
    (cd ~/presenter-spike/chatterbox && env "${common[@]}" CUDA_VISIBLE_DEVICES=0 VOICE_GPU_COMFYUI=http://127.0.0.1:8188 \
       VOICE_WHISPER=$M/whisper-base VOICE_ASR=$M/whisper-small \
       setsid nohup .venv/bin/uvicorn service:app --host 127.0.0.1 --port 8196 --workers 1 </dev/null >$D/voice.log 2>&1 &)
    (cd ~/presenter-dev && env "${common[@]}" CW_LOG_DIR=$D/logs CW_WORKFLOW_DIR=/opt/clipwaltz-ai/workflows \
       COMFYUI_URLS=http://127.0.0.1:8188,http://127.0.0.1:8190 CW_TALKING_URL=http://127.0.0.1:8193 \
       CW_VOICE_URL=http://127.0.0.1:8196 \
       setsid nohup venv/bin/uvicorn wrapper_app:app --host 127.0.0.1 --port 8194 --workers 1 </dev/null >$D/wrap.log 2>&1 &)
    echo "started; logs in $D/{talk,voice,wrap}.log" ;;
  stop) stop ;;
  status) ss -tlnp | grep -E ':819[346]\b' || echo "dev stack not running" ;;
esac

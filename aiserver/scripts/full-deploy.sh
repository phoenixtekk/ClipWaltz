#!/usr/bin/env bash
# ClipWaltz AISERVER full bootstrap + build (doc 04 steps 2-7), self-contained.
# Run ON aiserver as `lacy` (passwordless sudo required). Assumes the kit is at
# ~/clipwaltz-aiserver-kit (scp'd from the repo's aiserver/ dir; already present).
# Idempotent where practical. Safe to re-run.
#
#   bash ~/clipwaltz-aiserver-kit/scripts/full-deploy.sh
#
# Leaves: dirs, ffmpeg, py3.12 venv, ComfyUI + cu128 torch, LTX nodes, wrapper
# deps, both systemd services enabled. Model download + workflow capture are the
# two remaining manual steps (printed at the end) — they need live, non-guessed values.
set -euo pipefail

OPT=/opt/clipwaltz-ai
DATA=/data/clipwaltz-ai
KIT="$HOME/clipwaltz-aiserver-kit"
PYVER=3.12

echo "== Step 2: directories =="
sudo mkdir -p "$OPT"/{comfyui,workflows,scripts,logs,config,venv} "$OPT"/workflows/{wan,ltx,hunyuan,enhancement}
sudo chown -R lacy:lacy "$OPT"
mkdir -p "$DATA"/{models,input,output,temp,cache}
mkdir -p "$DATA"/models/{checkpoints,diffusion_models,text_encoders,vae,clip,loras,upscale_models,controlnet}

echo "== place kit files =="
cp "$KIT/wrapper/app.py" "$OPT/scripts/app.py"
cp "$KIT/wrapper/requirements.txt" "$OPT/scripts/requirements.txt"
cp -r "$KIT/workflows/ltx/." "$OPT/workflows/ltx/"
cp "$KIT/scripts/"*.sh "$OPT/scripts/" 2>/dev/null || true
sudo cp "$KIT/systemd/comfyui.service" /etc/systemd/system/comfyui.service
sudo cp "$KIT/systemd/clipwaltz-aiserver-api.service" /etc/systemd/system/clipwaltz-aiserver-api.service

echo "== shared-secret env (chmod 600, secret NOT printed) =="
if [ ! -f "$OPT/config/wrapper.env" ]; then
  ( umask 077; sed "s/replace-with-generated-secret/$(openssl rand -hex 32)/" \
      "$KIT/config/wrapper.env.example" > "$OPT/config/wrapper.env" )
  chmod 600 "$OPT/config/wrapper.env"
  echo "  wrapper.env created"
else
  echo "  wrapper.env exists (kept)"
fi

echo "== Step 3: ffmpeg + git =="
sudo apt-get update -y
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y ffmpeg git
ffmpeg -version | head -1

echo "== Step 4: Python $PYVER via uv (system python 3.14 untouched) =="
if ! command -v uv >/dev/null 2>&1; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
fi
export PATH="$HOME/.local/bin:$PATH"
uv python install "$PYVER"
[ -x "$OPT/venv/bin/python" ] || uv venv --python "$PYVER" "$OPT/venv"
# shellcheck disable=SC1091
source "$OPT/venv/bin/activate"
python --version

echo "== Step 5: ComfyUI + cu128 PyTorch =="
[ -d "$OPT/comfyui/.git" ] || git clone https://github.com/comfyanonymous/ComfyUI "$OPT/comfyui"
# Use `uv pip` — a uv-created venv has no standalone pip binary.
uv pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128
uv pip install -r "$OPT/comfyui/requirements.txt"
python - <<'PY'
import torch
print("torch", torch.__version__, "cuda", torch.cuda.is_available(), "gpus", torch.cuda.device_count())
for i in range(torch.cuda.device_count()):
    print(" ", i, torch.cuda.get_device_name(i))
PY

echo "== Step 7 (nodes): LTX custom nodes =="
cd "$OPT/comfyui/custom_nodes"
[ -d ComfyUI-LTXVideo ]        || git clone https://github.com/Lightricks/ComfyUI-LTXVideo
[ -d ComfyUI-VideoHelperSuite ] || git clone https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite
for d in ComfyUI-LTXVideo ComfyUI-VideoHelperSuite; do
  [ -f "$d/requirements.txt" ] && uv pip install -r "$d/requirements.txt" || true
done

echo "== wrapper deps =="
uv pip install -r "$OPT/scripts/requirements.txt"

echo "== Step 6: services (ComfyUI localhost:8188; wrapper LAN:8189) =="
sudo systemctl daemon-reload
sudo systemctl enable --now comfyui
sudo systemctl enable --now clipwaltz-aiserver-api
sleep 4
systemctl --no-pager --lines=0 status comfyui clipwaltz-aiserver-api | grep -E "Active:|●" || true

cat <<'NEXT'

============================================================================
ENV UP. Two manual, non-guessed steps remain (doc 04 §12 + §14):

1) DOWNLOAD THE LTX-VIDEO MODEL into /data/clipwaltz-ai/models/ per the current
   ComfyUI-LTXVideo README (checkpoint → checkpoints/, T5 text encoder →
   text_encoders/). Exact files/URLs must come from that README (do not guess).

2) CAPTURE THE WORKFLOW: load ComfyUI-LTXVideo's example image-to-video graph,
   export it in API format to /opt/clipwaltz-ai/workflows/ltx/workflow.api.json,
   and write workflow.map.json mapping logical fields (prompt/source_image/
   width/height/duration/seed) to the graph's node ids. Then restart the wrapper.

Verify: curl -s -H "Authorization: Bearer <token from config/wrapper.env>" \
        http://192.168.166.158:8189/health
============================================================================
NEXT
echo "FULL_DEPLOY_OK"

#!/usr/bin/env bash
# ClipWaltz AISERVER build — doc 04 steps 2–7. Idempotent where practical.
# Run as user `lacy` on AISERVER (passwordless sudo required for /opt, apt, systemd).
set -euo pipefail

OPT=/opt/clipwaltz-ai
DATA=/data/clipwaltz-ai
PYVER=3.12

echo "== Step 2: directories =="
sudo mkdir -p "$OPT"/{comfyui,workflows,scripts,logs,config,venv}
sudo mkdir -p "$OPT"/workflows/{wan,ltx,hunyuan,enhancement}
sudo chown -R lacy:lacy "$OPT"
mkdir -p "$DATA"/{models,input,output,temp,cache}
mkdir -p "$DATA"/models/{checkpoints,diffusion_models,text_encoders,vae,clip,loras,upscale_models,controlnet}

echo "== Step 3: system deps (ffmpeg) =="
sudo apt-get update -y
sudo apt-get install -y ffmpeg git
ffmpeg -version | head -1

echo "== Step 4: Python 3.12 via uv (system python is 3.14 — untouched) =="
if ! command -v uv >/dev/null 2>&1; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
fi
uv python install "$PYVER"
uv venv --python "$PYVER" "$OPT/venv"
# shellcheck disable=SC1091
source "$OPT/venv/bin/activate"
python --version

echo "== Step 5: ComfyUI + CUDA (cu124) PyTorch =="
if [ ! -d "$OPT/comfyui/.git" ]; then
  git clone https://github.com/comfyanonymous/ComfyUI "$OPT/comfyui"
fi
pip install --upgrade pip
# cu124 wheel: bundled CUDA 12.4 runtime, compatible with driver 595.91.07.
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu124
pip install -r "$OPT/comfyui/requirements.txt"
python - <<'PY'
import torch
print("torch", torch.__version__, "cuda_available", torch.cuda.is_available(),
      "device_count", torch.cuda.device_count())
for i in range(torch.cuda.device_count()):
    print(i, torch.cuda.get_device_name(i))
PY

echo "== Step 7 (nodes): LTX custom nodes =="
cd "$OPT/comfyui/custom_nodes"
[ -d ComfyUI-LTXVideo ] || git clone https://github.com/Lightricks/ComfyUI-LTXVideo
[ -d ComfyUI-VideoHelperSuite ] || git clone https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite
for d in ComfyUI-LTXVideo ComfyUI-VideoHelperSuite; do
  [ -f "$d/requirements.txt" ] && pip install -r "$d/requirements.txt" || true
done

echo "== wrapper deps =="
pip install -r "$OPT/scripts/requirements.txt"

echo "== Step 6: services =="
# (unit files + wrapper.env are copied in by the operator before this point)
sudo systemctl daemon-reload
sudo systemctl enable --now comfyui
sudo systemctl enable --now clipwaltz-aiserver-api
systemctl --no-pager status comfyui clipwaltz-aiserver-api | head -20

echo "Done. Next: download LTX model into $DATA/models, capture workflow.api.json, validate (doc §28)."

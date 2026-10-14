"""ClipWaltz talking-photo service (Phase C2): a photo + speech -> a speaking video, on AISERVER's own GPU.

EchoMimic v3-Flash (Apache-2.0, antgroup/echomimic_v3 @ 7e89489) on Wan2.1-Fun-V1.1-1.3B-InP, kept loaded with model
CPU offload so one 10 GB RTX 3080 is enough. One render at a time. Voice from Kokoro-82M (Apache-2.0, CPU) when the
caller sends a script instead of audio.

A single pass tops out at ~6.4 s on 10 GB (161 frames 9.05 GB; 249 frames OOM), so clips are rendered in overlapping
chunks (TALK_CHUNK_FRAMES, default 113 = 4.5 s, cross-faded over TALK_OVERLAP frames) — the continuation pattern of
EchoMimic's own non-Flash app.py. Each chunk after the first is conditioned on the previous chunk's last frames.

GPU guard: this service runs on GPU 1 (systemd sets CUDA_VISIBLE_DEVICES=1), which it shares with ComfyUI instance #2.
Before a render it waits until that ComfyUI's queue is empty and asks it to unload its models (/free). The API wrapper
stops sending ComfyUI jobs to GPU 1 while a talking job is queued or running (aiserver/wrapper/app.py).

Bound to 127.0.0.1 only; the wrapper (the box's only network surface) is the sole caller and passes CW_API_TOKEN.

  POST /jobs {job_id, image, audio?|text, voice, speed, max_seconds, seed, aspect} -> {"status": "queued"}
  GET  /jobs/{id} -> {status, stage, progress, output, duration, error}
  POST /jobs/{id}/cancel     GET /health     GET /voices
  POST /tts {text, voice, speed} -> audio/wav (Kokoro only; speech for talking photos rendered on a user's computer)
"""
from __future__ import annotations

import math
import os
import queue
import subprocess
import sys
import threading
import time
import traceback
from pathlib import Path
from typing import Any, Dict, Optional

import httpx
import numpy as np
import soundfile as sf
import torch
from fastapi import Depends, FastAPI, HTTPException, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

EMV3_DIR = Path(os.environ.get("EMV3_DIR", "/opt/clipwaltz-ai/talking/echomimic_v3"))
MODELS = Path(os.environ.get("EMV3_MODELS", "/data/clipwaltz-ai/models/echomimic_v3"))
INPUT_DIR = Path(os.environ.get("CW_INPUT_DIR", "/data/clipwaltz-ai/input"))
OUTPUT_DIR = Path(os.environ.get("CW_OUTPUT_DIR", "/data/clipwaltz-ai/output"))
API_TOKEN = os.environ.get("CW_API_TOKEN", "").strip()
GPU_COMFYUI = os.environ.get("TALK_GPU_COMFYUI", "http://127.0.0.1:8190").rstrip("/")
CHUNK_FRAMES = int(os.environ.get("TALK_CHUNK_FRAMES", "113"))
OVERLAP = int(os.environ.get("TALK_OVERLAP", "8"))
SAMPLE_W, SAMPLE_H = (int(v) for v in os.environ.get("TALK_SAMPLE_SIZE", "512x384").split("x"))
STEPS = int(os.environ.get("TALK_STEPS", "8"))
MAX_SECONDS = float(os.environ.get("TALK_MAX_SECONDS", "30"))
FPS = 25
TTS_SR = 24000

torch.set_num_threads(int(os.environ.get("TALK_CPU_THREADS", "8")))
sys.path.insert(0, str(EMV3_DIR))

# Kokoro voices — keep in sync with worker/tts/server.py and src/lib/deck/types.ts VOICES.
VOICES = {
    "af_heart": "a", "af_bella": "a", "af_nicole": "a", "am_michael": "a", "am_fenrir": "a", "am_puck": "a",
    "bf_emma": "b", "bm_george": "b", "ef_dora": "e", "em_alex": "e", "ff_siwis": "f", "if_sara": "i",
    "im_nicola": "i", "pf_dora": "p", "pm_alex": "p",
}
ASPECTS = {"9:16": 9 / 16, "16:9": 16 / 9, "1:1": 1.0}
# Render size per quality: pixel budget (W x H area) and frames per chunk. "standard" = the env defaults; "high" = the
# 768x512 budget (9.4 GB for 81 frames in the C0 spike), so its chunks are kept at 81 frames.
QUALITY = {
    "standard": ((SAMPLE_W, SAMPLE_H), CHUNK_FRAMES),
    "high": ((768, 512), int(os.environ.get("TALK_HIGH_CHUNK_FRAMES", "81"))),
}


class Cancelled(Exception):
    pass


# ─── Model (loaded once, in the background, at startup) ─────────────────────────────────────────────────────────
M: Dict[str, Any] = {}
_load_error: Optional[str] = None


def load_models() -> None:
    global _load_error
    try:
        from omegaconf import OmegaConf
        from transformers import AutoTokenizer, Wav2Vec2FeatureExtractor
        from safetensors.torch import load_file
        from src.wan_vae import AutoencoderKLWan
        from src.wan_image_encoder import CLIPModel
        from src.wan_text_encoder import WanT5EncoderModel
        from src.wan_transformer3d_audio_2512 import WanTransformerAudioMask3DModel
        from src.pipeline_wan_fun_inpaint_audio_2512 import WanFunInpaintAudioPipeline
        from src.fm_solvers_unipc import FlowUniPCMultistepScheduler
        from src.utils import filter_kwargs
        from src.cache_utils import get_teacache_coefficients
        from src.wav2vec2 import Wav2Vec2Model

        t0 = time.time()
        dtype = torch.bfloat16
        device = torch.device("cuda:0")
        base = MODELS / "Wan2.1-Fun-V1.1-1.3B-InP"
        cfg = OmegaConf.load(EMV3_DIR / "config" / "config.yaml")
        wav2vec_dir = MODELS / "chinese-wav2vec2-base"
        audio_encoder = Wav2Vec2Model.from_pretrained(str(wav2vec_dir), local_files_only=True).to("cpu")
        audio_encoder.feature_extractor._freeze_parameters()
        feat = Wav2Vec2FeatureExtractor.from_pretrained(str(wav2vec_dir), local_files_only=True)

        transformer = WanTransformerAudioMask3DModel.from_pretrained(
            str(base / cfg["transformer_additional_kwargs"].get("transformer_subpath", "transformer")),
            transformer_additional_kwargs=OmegaConf.to_container(cfg["transformer_additional_kwargs"]),
            low_cpu_mem_usage=True, torch_dtype=dtype,
        )
        sd = load_file(str(MODELS / "emv3" / "echomimicv3-flash-pro" / "diffusion_pytorch_model.safetensors"))
        transformer.load_state_dict(sd.get("state_dict", sd), strict=False)
        vae = AutoencoderKLWan.from_pretrained(
            str(base / cfg["vae_kwargs"].get("vae_subpath", "vae")),
            additional_kwargs=OmegaConf.to_container(cfg["vae_kwargs"]),
        ).to(dtype)
        tokenizer = AutoTokenizer.from_pretrained(str(base / cfg["text_encoder_kwargs"].get("tokenizer_subpath", "tokenizer")))
        text_encoder = WanT5EncoderModel.from_pretrained(
            str(base / cfg["text_encoder_kwargs"].get("text_encoder_subpath", "text_encoder")),
            additional_kwargs=OmegaConf.to_container(cfg["text_encoder_kwargs"]),
            low_cpu_mem_usage=True, torch_dtype=dtype,
        ).eval()
        clip = CLIPModel.from_pretrained(
            str(base / cfg["image_encoder_kwargs"].get("image_encoder_subpath", "image_encoder"))
        ).to(dtype).eval()
        sched_kwargs = OmegaConf.to_container(cfg["scheduler_kwargs"])
        sched_kwargs["shift"] = 1  # Flow_Unipc, as in the official Flash script
        scheduler = FlowUniPCMultistepScheduler(**filter_kwargs(FlowUniPCMultistepScheduler, sched_kwargs))
        pipe = WanFunInpaintAudioPipeline(
            transformer=transformer, vae=vae, tokenizer=tokenizer, text_encoder=text_encoder,
            scheduler=scheduler, clip_image_encoder=clip,
        )
        # 10 GB card: model CPU offload (idle VRAM ~0, so ComfyUI keeps the card between talking jobs); the ~11 GB
        # umT5 text encoder never goes to the GPU (the official script ignores its memory-mode flag).
        pipe.enable_model_cpu_offload(device=device)
        from accelerate.hooks import remove_hook_from_module

        def text_encoder_on_cpu():
            remove_hook_from_module(pipe.text_encoder, recurse=True)
            pipe.text_encoder.to("cpu")

        text_encoder_on_cpu()
        # Every pipeline call ends with maybe_free_model_hooks(), which re-applies CPU offload to ALL models — the
        # text encoder's hook would then move it onto the 10 GB card on the next call (chunk 2) and run out of memory.
        orig_free = pipe.maybe_free_model_hooks

        def free_hooks():
            orig_free()
            text_encoder_on_cpu()

        pipe.maybe_free_model_hooks = free_hooks
        orig_t5 = pipe._get_t5_prompt_embeds
        t5_cache: Dict[Any, Any] = {}

        def cpu_t5(*a, **k):
            # umT5 on the CPU takes ~30-50 s per call and every chunk asks again for the same (usually default)
            # prompt + negative prompt, so the CPU result is cached by its arguments.
            k["device"] = torch.device("cpu")
            key = repr((a, sorted(k.items(), key=lambda kv: kv[0])))
            out = t5_cache.get(key)
            if out is None:
                out = orig_t5(*a, **k)
                if len(t5_cache) >= 16:
                    t5_cache.pop(next(iter(t5_cache)))
                t5_cache[key] = out
            return [t.to(device) for t in out] if isinstance(out, (list, tuple)) else out.to(device)

        pipe._get_t5_prompt_embeds = cpu_t5
        type(pipe)._execution_device = property(lambda self: device)
        coeffs = get_teacache_coefficients(str(base))
        M.update(pipe=pipe, vae=vae, audio_encoder=audio_encoder, feat=feat, device=device, dtype=dtype, coeffs=coeffs)
        print(f"[talking] models loaded in {time.time() - t0:.0f} s", flush=True)
    except Exception as exc:  # noqa: BLE001
        _load_error = f"{type(exc).__name__}: {exc}"
        traceback.print_exc()


_kokoro: Dict[str, Any] = {}
_tts_lock = threading.Lock()  # the render thread and /tts share the Kokoro pipelines


def tts(text: str, voice: str, speed: float, wav_path: Path) -> float:
    from kokoro import KPipeline
    lang = VOICES[voice]
    if lang not in _kokoro:
        _kokoro[lang] = KPipeline(lang_code=lang, repo_id="hexgrad/Kokoro-82M", device="cpu")
    parts = []
    with _tts_lock:
        for r in _kokoro[lang](text, voice=voice, speed=speed):
            parts.append(r.audio.numpy() if hasattr(r.audio, "numpy") else np.asarray(r.audio))
    if not parts:
        raise ValueError("nothing to say")
    wav = np.concatenate(parts)
    sf.write(str(wav_path), wav, TTS_SR, subtype="PCM_16")
    return len(wav) / TTS_SR


# ─── Jobs ────────────────────────────────────────────────────────────────────────────────────────────────────────
_jobs: Dict[str, Dict[str, Any]] = {}
_lock = threading.Lock()
_q: "queue.Queue[str]" = queue.Queue()


def _set(job_id: str, **fields: Any) -> None:
    with _lock:
        _jobs[job_id].update(fields)


def _cancelled(job_id: str) -> bool:
    with _lock:
        return _jobs[job_id].get("cancel", False)


def _run(cmd: list) -> None:
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if r.returncode != 0:
        raise RuntimeError(f"{cmd[0]} failed: {r.stderr[-400:]}")


def wait_for_gpu(job_id: str) -> None:
    """GPU guard: wait for ComfyUI #2 (same card) to go idle, then have it unload its models."""
    while True:
        if _cancelled(job_id):
            raise Cancelled()
        try:
            q = httpx.get(f"{GPU_COMFYUI}/queue", timeout=10).json()
            busy = q.get("queue_running") or q.get("queue_pending")
        except Exception:  # noqa: BLE001 — ComfyUI down: nothing holds the card
            busy = False
        if not busy:
            break
        time.sleep(3)
    try:
        httpx.post(f"{GPU_COMFYUI}/free", json={"unload_models": True, "free_memory": True}, timeout=30)
    except Exception:  # noqa: BLE001
        pass
    time.sleep(2)
    torch.cuda.empty_cache()


def crop_to_aspect(img, aspect: str):
    if aspect not in ASPECTS:
        return img
    w, h = img.size
    target = ASPECTS[aspect]
    if w / h > target:  # too wide: crop the sides
        nw = int(h * target)
        return img.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
    nh = int(w / target)  # too tall: keep the top (faces sit high in portraits)
    top = min((h - nh) // 2, int(h * 0.1))
    return img.crop((0, top, w, top + nh))


def sample_size(img, budget=(SAMPLE_W, SAMPLE_H)) -> tuple:
    """Fit the photo into the pixel budget (W x H area), multiples of 16 (as the Flash script does)."""
    w, h = img.size
    ratio = math.sqrt(w * h / (budget[0] * budget[1]))
    if ratio > 1:
        w, h = w / ratio, h / ratio
    return int(h // 16 * 16), int(w // 16 * 16)


def audio_embeds_for(wav16: np.ndarray, frames: int) -> torch.Tensor:
    import pyloudnorm as pyln
    from einops import rearrange
    meter = pyln.Meter(16000)
    loud = meter.integrated_loudness(wav16)
    if abs(loud) <= 100:
        wav16 = pyln.normalize.loudness(wav16, loud, -23)
    wav16 = wav16[: int(frames / FPS * 16000)]
    feat = np.squeeze(M["feat"](wav16, sampling_rate=16000).input_values)
    feat = torch.from_numpy(feat).float().unsqueeze(0)
    enc = M["audio_encoder"]
    # transformers 5.x no longer fills hidden_states for this custom forward: capture each encoder layer's output.
    outs: list = []
    hooks = [l.register_forward_hook(lambda m, i, o: outs.append(o[0] if isinstance(o, tuple) else o)) for l in enc.encoder.layers]
    with torch.no_grad():
        e = enc(feat, seq_len=int(frames), output_hidden_states=True)
    for h in hooks:
        h.remove()
    hidden = e.hidden_states[1:] if e.hidden_states is not None else outs
    emb = rearrange(torch.stack(hidden, dim=1).squeeze(0), "b s d -> s b d").cpu()
    emb = emb.to(device=M["device"], dtype=M["dtype"])
    idx = torch.arange(0, frames).unsqueeze(1) + (torch.arange(5) - 2).unsqueeze(0)
    idx = torch.clamp(idx, min=0, max=emb.shape[0] - 1)
    return emb[idx].unsqueeze(0)  # [1, F, 5, 12, 768]


def chunk_plan(total: int, chunk: int = CHUNK_FRAMES) -> list:
    """(start, length) per chunk; lengths are 4n+1 (Wan's temporal compression), consecutive chunks overlap."""
    plan, start = [], 0
    while True:
        remaining = total - start
        length = (min(chunk, remaining) - 1) // 4 * 4 + 1  # may drop up to 3 tail frames
        if plan and length <= OVERLAP:
            break
        plan.append((start, length))
        if remaining <= chunk:
            break
        start += length - OVERLAP
    return plan


def render(job: Dict[str, Any]) -> None:
    from PIL import Image
    from src.utils import get_image_to_video_latent3, save_videos_grid

    job_id = job["job_id"]
    work = OUTPUT_DIR / "clipwaltz" / "talking" / job_id
    work.mkdir(parents=True, exist_ok=True)

    # 1. Speech: Kokoro for a script, or the caller's audio, as 16 kHz mono WAV, capped at max_seconds.
    _set(job_id, status="running", stage="voice", progress=3)
    speech = work / "speech.wav"
    if job.get("audio"):
        src = INPUT_DIR / Path(job["audio"]).name
        if not src.is_file():
            raise ValueError("audio not found")
        _run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-t", str(job["max_seconds"]), "-ac", "1", "-ar", "16000", str(speech)])
    else:
        raw = work / "tts.wav"
        tts(job["text"], job["voice"], job["speed"], raw)
        _run(["ffmpeg", "-v", "error", "-y", "-i", str(raw), "-t", str(job["max_seconds"]), "-ac", "1", "-ar", "16000", str(speech)])
    wav16, _ = sf.read(str(speech), dtype="float32")
    seconds = len(wav16) / 16000
    if seconds < 0.5:
        raise ValueError("the speech is too short (under half a second)")
    total = int(seconds * FPS)
    total = (total - 1) // 4 * 4 + 1
    budget, chunk = QUALITY.get(job.get("quality") or "standard", QUALITY["standard"])
    plan = chunk_plan(total, chunk)

    # 2. Photo.
    img_path = INPUT_DIR / Path(job["image"]).name
    if not img_path.is_file():
        raise ValueError("photo not found")
    photo = crop_to_aspect(Image.open(img_path).convert("RGB"), job.get("aspect", "photo"))
    h, w = sample_size(photo, budget)
    embeds = audio_embeds_for(wav16, total)

    # 3. GPU guard, then render chunk by chunk.
    _set(job_id, stage="waiting_gpu", progress=8)
    wait_for_gpu(job_id)
    if _cancelled(job_id):
        raise Cancelled()
    pipe = M["pipe"]
    gen = torch.Generator(device=M["device"]).manual_seed(int(job["seed"]))
    _, _, clip_image = get_image_to_video_latent3(photo, None, video_length=plan[0][1], sample_size=[h, w])
    steps_total = len(plan) * STEPS
    done = {"n": 0}

    def on_gpu() -> str:
        names = ("transformer", "vae", "clip_image_encoder", "text_encoder")
        return ",".join(n for n in names if next(getattr(pipe, n).parameters()).device.type == "cuda")

    def mem(tag: str) -> None:
        if os.environ.get("TALK_DEBUG_MEM"):
            print(f"[talking] mem {tag}: alloc {torch.cuda.memory_allocated() / 1e9:.2f} GB, reserved "
                  f"{torch.cuda.memory_reserved() / 1e9:.2f} GB, on GPU: {on_gpu()}", flush=True)

    def on_step(_pipe, _i, _t, kw):
        if _i == 0:
            mem("chunk step0")
        done["n"] += 1
        _set(job_id, progress=10 + int(80 * done["n"] / steps_total))
        if _cancelled(job_id):
            raise Cancelled()
        return kw

    mix = torch.linspace(0, 1, steps=OVERLAP).view(1, 1, -1, 1, 1)
    video = None
    ref = photo
    t0 = time.time()
    _set(job_id, stage="rendering", progress=10, chunks=len(plan))
    for n, (start, length) in enumerate(plan):
        if M["coeffs"] is not None:
            pipe.transformer.enable_teacache(M["coeffs"], STEPS, 0.1, num_skip_start_steps=5, offload=False)
        inp, mask, _ = get_image_to_video_latent3(ref, None, video_length=length, sample_size=[h, w])
        mem(f"before chunk {n + 1}")
        with torch.no_grad():
            sample = pipe(
                job.get("prompt") or "A person is speaking.",
                num_frames=length,
                negative_prompt="Gesture is bad. Gesture is unclear. Strange and twisted hands. Bad hands. Bad fingers. "
                "Unclear and blurry hands. Unclear gestures, broken hands, fused fingers.",
                audio_embeds=embeds[:, start:start + length],
                audio_scale=1.0, ip_mask=None, use_un_ip_mask=False,
                height=h, width=w, generator=gen, neg_scale=1.0, neg_steps=0,
                use_dynamic_cfg=False, use_dynamic_acfg=False,
                guidance_scale=6.0, audio_guidance_scale=3.0, num_inference_steps=STEPS,
                video=inp, mask_video=mask, clip_image=clip_image, cfg_skip_ratio=0.0, shift=5.0,
                callback_on_step_end=on_step,
            ).videos
        if video is None:
            video = sample
        else:
            video[:, :, -OVERLAP:] = video[:, :, -OVERLAP:] * (1 - mix) + sample[:, :, :OVERLAP] * mix
            video = torch.cat([video, sample[:, :, OVERLAP:]], dim=2)
        # Next chunk continues from this one's last frames.
        ref = [Image.fromarray((video[0, :, i].permute(1, 2, 0) * 255).numpy().astype(np.uint8)) for i in range(-OVERLAP, 0)]
        del inp, mask
        torch.cuda.empty_cache()
        print(f"[talking] {job_id} chunk {n + 1}/{len(plan)} ({length} frames) done at {time.time() - t0:.0f} s, "
              f"peak {torch.cuda.max_memory_reserved() / 1e9:.2f} GB", flush=True)

    # 4. Frames + speech -> MP4.
    _set(job_id, stage="muxing", progress=93)
    frames = video.shape[2]
    silent = work / "silent.mp4"
    save_videos_grid(video[:, :, :frames], str(silent), fps=FPS)
    out = work / f"{job_id}.mp4"
    _run(["ffmpeg", "-v", "error", "-y", "-i", str(silent), "-i", str(speech), "-map", "0:v", "-map", "1:a",
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "17", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k",
          "-t", f"{frames / FPS:.3f}", "-movflags", "+faststart", str(out)])
    for p in (silent, speech, work / "tts.wav"):
        p.unlink(missing_ok=True)
    _set(job_id, status="completed", stage="done", progress=100, duration=round(frames / FPS, 2),
         output=f"clipwaltz/talking/{job_id}/{out.name}", size=[w, h], render_s=round(time.time() - t0, 1),
         peak_gb=round(torch.cuda.max_memory_reserved() / 1e9, 2))


def worker_loop() -> None:
    while True:
        job_id = _q.get()
        with _lock:
            job = dict(_jobs[job_id])
        if job.get("cancel"):
            continue
        while not M and _load_error is None:
            time.sleep(2)
        try:
            if _load_error:
                raise RuntimeError(f"model failed to load: {_load_error}")
            torch.cuda.reset_peak_memory_stats()
            render(job)
        except Cancelled:
            _set(job_id, status="cancelled", stage="cancelled")
        except torch.cuda.OutOfMemoryError:
            _set(job_id, status="failed", error="the GPU ran out of memory")
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            _set(job_id, status="failed", error=f"{type(exc).__name__}: {exc}"[:500])
        finally:
            torch.cuda.empty_cache()


# ─── API ─────────────────────────────────────────────────────────────────────────────────────────────────────────
app = FastAPI(title="clipwaltz-talking")
bearer = HTTPBearer(auto_error=True)


def require_token(creds: HTTPAuthorizationCredentials = Depends(bearer)) -> None:
    if not API_TOKEN:
        raise HTTPException(503, "server auth not configured")
    if creds.credentials != API_TOKEN:
        raise HTTPException(401, "invalid token")


class JobIn(BaseModel):
    job_id: str = Field(pattern=r"^cw_[a-f0-9]{12}$")
    image: str = Field(min_length=1, max_length=200)
    audio: Optional[str] = Field(default=None, max_length=200)
    text: Optional[str] = Field(default=None, max_length=3000)
    voice: str = "af_heart"
    speed: float = Field(1.0, ge=0.7, le=1.4)
    max_seconds: float = Field(MAX_SECONDS, gt=0, le=MAX_SECONDS)
    seed: int = Field(43, ge=0, le=2**32 - 1)
    aspect: str = "photo"
    prompt: Optional[str] = Field(default=None, max_length=500)
    quality: str = "standard"


@app.on_event("startup")
def startup() -> None:
    threading.Thread(target=load_models, daemon=True).start()
    threading.Thread(target=worker_loop, daemon=True).start()


@app.get("/health")
def health(_: None = Depends(require_token)) -> Dict[str, Any]:
    with _lock:
        active = [j["job_id"] for j in _jobs.values() if j["status"] in ("queued", "running")]
    return {"ok": bool(M) and _load_error is None, "loaded": bool(M), "error": _load_error, "active": active}


@app.get("/voices")
def voices(_: None = Depends(require_token)) -> Dict[str, Any]:
    return {"voices": sorted(VOICES)}


class TtsIn(BaseModel):
    text: str = Field(min_length=1, max_length=3000)
    voice: str = "af_heart"
    speed: float = Field(1.0, ge=0.7, le=1.4)
    max_seconds: float = Field(MAX_SECONDS, gt=0, le=MAX_SECONDS)


@app.post("/tts")
def speak(req: TtsIn, _: None = Depends(require_token)) -> Response:
    if req.voice not in VOICES:
        raise HTTPException(400, f"unknown voice {req.voice}")
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        raw, out = Path(d) / "raw.wav", Path(d) / "out.wav"
        try:
            tts(req.text, req.voice, req.speed, raw)
        except ValueError as exc:
            raise HTTPException(422, str(exc))
        _run(["ffmpeg", "-v", "error", "-y", "-i", str(raw), "-t", str(req.max_seconds), "-ac", "1", "-ar", "24000", str(out)])
        return Response(content=out.read_bytes(), media_type="audio/wav")


@app.post("/jobs")
def create(req: JobIn, _: None = Depends(require_token)) -> Dict[str, Any]:
    if not req.audio and not (req.text or "").strip():
        raise HTTPException(400, "send a script (text) or audio")
    if req.voice not in VOICES:
        raise HTTPException(400, f"unknown voice {req.voice}")
    if req.quality not in QUALITY:
        raise HTTPException(400, "quality must be standard or high")
    if req.aspect not in ("photo", *ASPECTS):
        raise HTTPException(400, "aspect must be photo, 9:16, 16:9 or 1:1")
    with _lock:
        if req.job_id in _jobs:
            raise HTTPException(409, "job exists")
        _jobs[req.job_id] = {**req.model_dump(), "status": "queued", "stage": "queued", "progress": 0,
                             "created": time.time(), "output": None, "error": None}
    _q.put(req.job_id)
    return {"job_id": req.job_id, "status": "queued"}


@app.get("/jobs/{job_id}")
def get(job_id: str, _: None = Depends(require_token)) -> Dict[str, Any]:
    with _lock:
        j = _jobs.get(job_id)
        if not j:
            raise HTTPException(404, "unknown job")
        return {k: v for k, v in j.items() if k not in ("text", "cancel")}


@app.post("/jobs/{job_id}/cancel")
def cancel(job_id: str, _: None = Depends(require_token)) -> Dict[str, Any]:
    with _lock:
        j = _jobs.get(job_id)
        if not j:
            raise HTTPException(404, "unknown job")
        j["cancel"] = True
        if j["status"] == "queued":
            j["status"] = "cancelled"
    return {"job_id": job_id, "status": "cancelling"}

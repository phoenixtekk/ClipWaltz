"""ClipWaltz voice service (Waltz Avatar Phase 2): speak lines in a presenter's own cloned voice, on AISERVER.

Chatterbox Multilingual (Resemble AI, MIT code + weights; every output carries Resemble's inaudible PerTh watermark) clones a
voice zero-shot from a short reference clip of the presenter (cut from their consented footage). Word timings for the
burned-in captions come from whisper-base (Apache-2.0) word timestamps on each generated line.

GPU guard: runs on GPU 0 (systemd sets CUDA_VISIBLE_DEVICES=0), shared with ComfyUI #1. A job waits until that ComfyUI's
queue is empty, asks it to unload (/free), loads Chatterbox (~3.6 GB), speaks every line of the job, then unloads — so a
WaltzDeck render's narration is one GPU visit. The API wrapper keeps new ComfyUI jobs off GPU 0 while a voice job is
queued or running (aiserver/wrapper/app.py).

Bound to 127.0.0.1; the wrapper (the box's only network surface) is the sole caller and passes CW_API_TOKEN.

  POST /jobs {job_id, ref (staged audio), language, lines: [text], exaggeration?} -> {"status": "queued"}
       output: clipwaltz/voice/<job_id>/{0..n}.wav + manifest.json [{file, dur, words: [{w, s, e}]}]
  GET  /jobs/{id}   POST /jobs/{id}/cancel   GET /health
"""
from __future__ import annotations

import json
import os
import queue
import subprocess
import threading
import time
import traceback
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
import numpy as np
import torch
from fastapi import Depends, FastAPI, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

API_TOKEN = os.environ.get("CW_API_TOKEN", "").strip()
INPUT_DIR = Path(os.environ.get("CW_INPUT_DIR", "/data/clipwaltz-ai/input"))
OUTPUT_DIR = Path(os.environ.get("CW_OUTPUT_DIR", "/data/clipwaltz-ai/output"))
GPU_COMFYUI = os.environ.get("VOICE_GPU_COMFYUI", "http://127.0.0.1:8188").rstrip("/")
WHISPER = os.environ.get("VOICE_WHISPER", "/data/clipwaltz-ai/models/musetalk/whisper-base")
DEVICE = "cuda" if torch.cuda.is_available() and os.environ.get("VOICE_DEVICE", "cuda") == "cuda" else "cpu"
# ClipWaltz's narration languages (src/lib/deck/types.ts LANGUAGES) — all supported by Chatterbox Multilingual.
LANGUAGES = {"en", "es", "fr", "it", "pt"}
MAX_LINES = 60
MAX_LINE_CHARS = 600


class Cancelled(Exception):
    pass


_jobs: Dict[str, Dict[str, Any]] = {}
_lock = threading.Lock()
_q: "queue.Queue[str]" = queue.Queue()
_asr: Dict[str, Any] = {}


def _set(job_id: str, **fields: Any) -> None:
    with _lock:
        _jobs[job_id].update(fields)


def _cancelled(job_id: str) -> bool:
    with _lock:
        return _jobs[job_id].get("cancel", False)


def wait_for_gpu(job_id: str) -> None:
    """GPU guard: wait for ComfyUI #1 (same card) to go idle, then have it unload its models."""
    if DEVICE != "cuda":
        return
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


def words_for(wav: np.ndarray, sr: int, language: str) -> List[Dict[str, Any]]:
    """Word timings of a generated line (whisper-base word timestamps, CPU)."""
    import librosa
    from transformers import pipeline

    if "pipe" not in _asr:
        _asr["pipe"] = pipeline("automatic-speech-recognition", model=WHISPER, device="cpu")
    a16 = librosa.resample(wav.astype(np.float32), orig_sr=sr, target_sr=16000)
    out = _asr["pipe"]({"raw": a16, "sampling_rate": 16000}, return_timestamps="word",
                       generate_kwargs={"language": language, "task": "transcribe"})
    words = []
    for c in out.get("chunks", []):
        s, e = c.get("timestamp") or (None, None)
        w = str(c.get("text", "")).strip()
        if w and s is not None:
            words.append({"w": w, "s": round(float(s), 3), "e": round(float(e if e is not None else s + 0.3), 3)})
    return words


def run(job: Dict[str, Any]) -> None:
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS

    job_id = job["job_id"]
    _set(job_id, status="running", stage="waiting for the GPU", progress=2)
    wait_for_gpu(job_id)
    _set(job_id, stage="loading the voice model", progress=5)
    t0 = time.time()
    model = ChatterboxMultilingualTTS.from_pretrained(device=torch.device(DEVICE))
    out_dir = OUTPUT_DIR / "clipwaltz" / "voice" / job_id
    out_dir.mkdir(parents=True, exist_ok=True)
    ref = str(INPUT_DIR / job["ref"])
    manifest = []
    try:
        lines = job["lines"]
        for i, text in enumerate(lines):
            if _cancelled(job_id):
                raise Cancelled()
            _set(job_id, stage=f"line {i + 1} of {len(lines)}", progress=5 + int(90 * i / len(lines)))
            with torch.inference_mode():
                wav = model.generate(text, language_id=job["language"], audio_prompt_path=ref,
                                     exaggeration=job.get("exaggeration", 0.5))
            a = wav.squeeze(0).cpu().numpy()
            f = out_dir / f"{i}.wav"
            import soundfile as sf

            sf.write(str(f), a, model.sr)
            manifest.append({"file": f.name, "dur": round(len(a) / model.sr, 3), "words": words_for(a, model.sr, job["language"])})
    finally:
        del model
        if DEVICE == "cuda":
            torch.cuda.empty_cache()
    (out_dir / "manifest.json").write_text(json.dumps(manifest))
    _set(job_id, status="completed", stage="done", progress=100, output=f"clipwaltz/voice/{job_id}/manifest.json",
         files=[f"clipwaltz/voice/{job_id}/{m['file']}" for m in manifest], render_s=round(time.time() - t0, 1))


def worker_loop() -> None:
    while True:
        job_id = _q.get()
        with _lock:
            job = dict(_jobs[job_id])
        if job.get("cancel"):
            continue
        try:
            run(job)
        except Cancelled:
            _set(job_id, status="cancelled", stage="cancelled")
        except torch.cuda.OutOfMemoryError:
            _set(job_id, status="failed", error="the GPU ran out of memory")
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            _set(job_id, status="failed", error=f"{type(exc).__name__}: {exc}"[:500])


app = FastAPI(title="clipwaltz-voice")
bearer = HTTPBearer(auto_error=True)


def require_token(creds: HTTPAuthorizationCredentials = Depends(bearer)) -> None:
    if not API_TOKEN:
        raise HTTPException(503, "server auth not configured")
    if creds.credentials != API_TOKEN:
        raise HTTPException(401, "invalid token")


class JobIn(BaseModel):
    job_id: str = Field(pattern=r"^cw_[a-f0-9]{12}$")
    ref: str = Field(min_length=1, max_length=200)
    language: str = "en"
    lines: List[str] = Field(min_length=1, max_length=MAX_LINES)
    exaggeration: float = Field(0.5, ge=0.25, le=1.0)


@app.on_event("startup")
def startup() -> None:
    threading.Thread(target=worker_loop, daemon=True).start()


@app.get("/health")
def health(_: None = Depends(require_token)) -> Dict[str, Any]:
    with _lock:
        active = [j["job_id"] for j in _jobs.values() if j["status"] in ("queued", "running")]
    return {"ok": True, "device": DEVICE, "active": active}


@app.post("/jobs")
def create(req: JobIn, _: None = Depends(require_token)) -> Dict[str, Any]:
    if req.language not in LANGUAGES:
        raise HTTPException(400, f"language must be one of {sorted(LANGUAGES)}")
    if Path(req.ref).name != req.ref or not (INPUT_DIR / req.ref).is_file():
        raise HTTPException(400, "no staged reference audio")
    lines = [str(t).strip()[:MAX_LINE_CHARS] for t in req.lines]
    if not all(lines):
        raise HTTPException(400, "empty line")
    with _lock:
        if req.job_id in _jobs:
            raise HTTPException(409, "job exists")
        _jobs[req.job_id] = {**req.model_dump(), "lines": lines, "status": "queued", "stage": "queued", "progress": 0,
                             "created": time.time(), "output": None, "error": None}
    _q.put(req.job_id)
    return {"job_id": req.job_id, "status": "queued"}


@app.get("/jobs/{job_id}")
def get(job_id: str, _: None = Depends(require_token)) -> Dict[str, Any]:
    with _lock:
        j = _jobs.get(job_id)
        if not j:
            raise HTTPException(404, "unknown job")
        return {k: v for k, v in j.items() if k not in ("lines", "cancel")}


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

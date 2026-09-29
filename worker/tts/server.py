"""ClipWaltz voice service (WaltzDeck phase 2): Kokoro-82M text-to-speech with per-word timings.

Runs on the render box ("ai") as systemd unit clipwaltz-tts, bound to 127.0.0.1:8191 — only the render worker
on the same host calls it. Kokoro-82M: Apache-2.0 code and weights (commercial use OK, verified 2026-09-29).
Measured on the box: ~6 s model load (once), ~0.23x real time on CPU.

POST /tts  {"text": str, "voice": str, "speed": float}
  -> {"sampleRate": 24000, "duration": s, "words": [{"w": str, "s": sec, "e": sec}], "wav": base64 WAV}
GET  /voices -> {"voices": [...]}   GET /health -> {"ok": true}
"""
import base64
import io
import os
import threading

import numpy as np
import soundfile as sf
import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

torch.set_num_threads(int(os.environ.get("TTS_THREADS", "8")))  # leave cores for ffmpeg renders

from kokoro import KPipeline  # noqa: E402  (after torch threads are set)

SR = 24000
# Curated voices (Kokoro v1.0 names). American English pipeline "a", British "b".
VOICES = {
    "af_heart": ("a", "Heart — warm, female (US)"),
    "af_bella": ("a", "Bella — bright, female (US)"),
    "af_nicole": ("a", "Nicole — soft, female (US)"),
    "am_michael": ("a", "Michael — friendly, male (US)"),
    "am_fenrir": ("a", "Fenrir — deep, male (US)"),
    "am_puck": ("a", "Puck — upbeat, male (US)"),
    "bf_emma": ("b", "Emma — clear, female (UK)"),
    "bm_george": ("b", "George — calm, male (UK)"),
}

_pipes = {}
_lock = threading.Lock()  # one synthesis at a time; torch already uses TTS_THREADS cores


def pipe(lang):
    if lang not in _pipes:
        _pipes[lang] = KPipeline(lang_code=lang)
    return _pipes[lang]


app = FastAPI(title="clipwaltz-tts")


class TtsIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    voice: str = "af_heart"
    speed: float = Field(1.0, ge=0.7, le=1.4)


@app.on_event("startup")
def warm():
    pipe("a")


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/voices")
def voices():
    return {"voices": [{"id": k, "label": v[1]} for k, v in VOICES.items()]}


@app.post("/tts")
def tts(req: TtsIn):
    if req.voice not in VOICES:
        raise HTTPException(400, f"unknown voice {req.voice}")
    lang = VOICES[req.voice][0]
    with _lock:
        chunks, words, off = [], [], 0.0
        for r in pipe(lang)(req.text, voice=req.voice, speed=req.speed):
            a = r.audio.numpy() if hasattr(r.audio, "numpy") else np.asarray(r.audio)
            for tk in r.tokens or []:
                # Kokoro times each yielded chunk from its own start — offset by the audio so far.
                if tk.start_ts is not None and tk.text.strip() and any(ch.isalnum() for ch in tk.text):
                    words.append({"w": tk.text, "s": round(off + tk.start_ts, 3), "e": round(off + (tk.end_ts or tk.start_ts), 3)})
            chunks.append(a)
            off += len(a) / SR
    if not chunks:
        raise HTTPException(422, "nothing to say")
    wav = np.concatenate(chunks)
    buf = io.BytesIO()
    sf.write(buf, wav, SR, format="WAV", subtype="PCM_16")
    return {"sampleRate": SR, "duration": round(len(wav) / SR, 3), "words": words, "wav": base64.b64encode(buf.getvalue()).decode()}

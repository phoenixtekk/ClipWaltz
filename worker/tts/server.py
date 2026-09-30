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
# Curated voices (Kokoro v1.0 names, Apache-2.0). Pipelines: American English "a", British "b", Spanish "e",
# French "f", Italian "i", Brazilian Portuguese "p" (the last four phonemise with espeak-ng and give no word timings —
# see estimate_words). Keep in sync with src/lib/deck/types.ts VOICES.
VOICES = {
    "af_heart": ("a", "Heart — warm, female (US)"),
    "af_bella": ("a", "Bella — bright, female (US)"),
    "af_nicole": ("a", "Nicole — soft, female (US)"),
    "am_michael": ("a", "Michael — friendly, male (US)"),
    "am_fenrir": ("a", "Fenrir — deep, male (US)"),
    "am_puck": ("a", "Puck — upbeat, male (US)"),
    "bf_emma": ("b", "Emma — clear, female (UK)"),
    "bm_george": ("b", "George — calm, male (UK)"),
    "ef_dora": ("e", "Dora — warm, female (Spanish)"),
    "em_alex": ("e", "Alex — friendly, male (Spanish)"),
    "ff_siwis": ("f", "Siwis — clear, female (French)"),
    "if_sara": ("i", "Sara — bright, female (Italian)"),
    "im_nicola": ("i", "Nicola — calm, male (Italian)"),
    "pf_dora": ("p", "Dora — warm, female (Portuguese, BR)"),
    "pm_alex": ("p", "Alex — friendly, male (Portuguese, BR)"),
}


def estimate_words(text, start, dur):
    """Word timings for a chunk without them (espeak languages): spread the words over the chunk's audio by length,
    with a little extra time after punctuation. Good enough for word-highlight captions."""
    ws = [w for w in text.split() if any(ch.isalnum() for ch in w)]
    if not ws or dur <= 0:
        return []
    weight = [len(w) + 2 + (3 if w[-1] in ".,;:!?" else 0) for w in ws]
    total = float(sum(weight))
    out, t = [], start
    for w, k in zip(ws, weight):
        d = dur * k / total
        out.append({"w": w.strip(".,;:!?\"'()"), "s": round(t, 3), "e": round(t + d * 0.9, 3)})
        t += d
    return out

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
            timed = [tk for tk in (r.tokens or []) if tk.start_ts is not None]
            for tk in timed:
                # Kokoro times each yielded chunk from its own start — offset by the audio so far.
                if tk.text.strip() and any(ch.isalnum() for ch in tk.text):
                    words.append({"w": tk.text, "s": round(off + tk.start_ts, 3), "e": round(off + (tk.end_ts or tk.start_ts), 3)})
            if not timed:
                # No timings from the model (espeak languages): estimate from the chunk's own text and audio length.
                words.extend(estimate_words(getattr(r, "graphemes", "") or "", off + 0.05, len(a) / SR - 0.1))
            chunks.append(a)
            off += len(a) / SR
    if not chunks:
        raise HTTPException(422, "nothing to say")
    wav = np.concatenate(chunks)
    buf = io.BytesIO()
    sf.write(buf, wav, SR, format="WAV", subtype="PCM_16")
    return {"sampleRate": SR, "duration": round(len(wav) / SR, 3), "words": words, "wav": base64.b64encode(buf.getvalue()).decode()}

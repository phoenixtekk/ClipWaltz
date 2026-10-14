"""Waltz Avatar consent check (automatic only — owner decision 2026-10-13): is the live consent clip the same person as
the presenter footage, saying the one-time code shown on screen?

  1. The words: whisper-base (openai, Apache-2.0) transcribes the clip. The sentence shown on screen must be read — a fuzzy
     word match (SENTENCE_MIN) with the person's name in it — and the code must be spoken as ONE run of numbers (digits or
     number words in English, Spanish, French, Italian, Portuguese or German), not digits picked from anywhere in it.
  2. A face: Google MediaPipe Face Landmarker (Apache-2.0) finds one face in most sampled frames of the clip.
  3. Same person: the clip's voice matches the footage's voice — ECAPA-TDNN speaker embeddings (speechbrain, Apache-2.0,
     trained on VoxCeleb, CC BY 4.0), cosine similarity ≥ VOICE_MIN. Face recognition is deliberately not used: the
     commercial-licence options (e.g. OpenCV SFace) don't state their training data, the same problem that ruled out
     DWPose (spec §9).

The app's UI records the clip live in the browser, but its upload route accepts any video file — so nothing here may
assume the clip is live; the sentence + continuous-code checks are what make a re-cut of someone's old speeches fail.
Known limit (by design, owner decision "automatic only"): the face in the clip is not matched to the footage's face.
"""
from __future__ import annotations

import os
import re
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import torch

MODELS = Path(os.environ.get("PRESENTER_MODELS", "/data/clipwaltz-ai/models/musetalk"))
VOICE_MIN = float(os.environ.get("CONSENT_VOICE_MIN", "0.40"))
FACE_MIN = 0.7  # share of sampled frames with a face
SENTENCE_MIN = float(os.environ.get("CONSENT_SENTENCE_MIN", "0.6"))  # difflib ratio, shown sentence vs what was said

_m: dict = {}
NUMBER_WORDS = {
    # en
    "zero": 0, "oh": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9,
    # es / pt / it / fr / de
    "cero": 0, "uno": 1, "una": 1, "dos": 2, "tres": 3, "cuatro": 4, "cinco": 5, "seis": 6, "siete": 7, "ocho": 8, "nueve": 9,
    "um": 1, "uma": 1, "dois": 2, "duas": 2, "três": 3, "quatro": 4, "sete": 7, "oito": 8, "nove": 9,
    "due": 2, "tre": 3, "quattro": 4, "sei": 6, "sette": 7, "otto": 8,
    "zéro": 0, "un": 1, "une": 1, "deux": 2, "trois": 3, "quatre": 4, "cinq": 5, "sept": 7, "huit": 8, "neuf": 9,
    "null": 0, "eins": 1, "ein": 1, "zwei": 2, "drei": 3, "vier": 4, "fünf": 5, "sechs": 6, "sieben": 7, "acht": 8, "neun": 9,
}


def _load() -> None:
    if _m:
        return
    # transformers before speechbrain: speechbrain's lazy imports break transformers' own if they run first.
    from transformers import WhisperForConditionalGeneration, WhisperProcessor
    from speechbrain.inference.speaker import EncoderClassifier

    _m["asr"] = WhisperForConditionalGeneration.from_pretrained(MODELS / "whisper-base").eval()
    _m["proc"] = WhisperProcessor.from_pretrained(MODELS / "whisper-base")
    _m["spk"] = EncoderClassifier.from_hparams(source=str(MODELS / "ecapa"), savedir=str(MODELS / "ecapa"), run_opts={"device": "cpu"})


def _wav16(src: Path, max_seconds: float) -> np.ndarray:
    import librosa

    with tempfile.TemporaryDirectory() as d:
        out = Path(d) / "a.wav"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-t", str(max_seconds), "-vn", "-ac", "1", "-ar", "16000", str(out)],
                       check=True, capture_output=True, timeout=300)
        w, _ = librosa.load(str(out), sr=16000)
    return w


def _tokens(text: str) -> list:
    return re.findall(r"\d+|[^\W\d_]+", text.lower())


def code_spoken(text: str, code: str) -> bool:
    """The code as one run of number tokens ("4 1 3 3", "4133", "four one three three", "41 33")."""
    run = ""
    for tok in _tokens(text):
        d = tok if tok.isdigit() else (str(NUMBER_WORDS[tok]) if tok in NUMBER_WORDS else None)
        if d is None:
            run = ""
            continue
        run += d
        if code in run:
            return True
    return False


def sentence_match(text: str, statement: str, code: str) -> tuple:
    """(ratio, name_ok): how much of the shown sentence (without its code) was said, and whether the name was."""
    import difflib

    said = [t for t in _tokens(text) if not t.isdigit() and t not in NUMBER_WORDS]
    want = [t for t in _tokens(statement) if not t.isdigit()]
    ratio = difflib.SequenceMatcher(None, want, said).ratio() if want else 0.0
    m = re.match(r"\s*I,\s*(.+?),\s*agree", statement)
    names = [t for t in _tokens(m.group(1)) if len(t) > 1] if m else []
    # Only the name's own words count ("Test Presenter": "test" — "presenter" is also in "an AI presenter of me").
    rest = set(_tokens(statement[m.end():])) if m else set()
    own = [t for t in names if t not in rest]
    if own:
        name_ok = any(n in said for n in own)
    else:  # every word of the name is also elsewhere in the sentence: the whole name must be said in a row
        k = len(names)
        name_ok = not names or any(said[i:i + k] == names for i in range(len(said) - k + 1))
    return ratio, name_ok


def digits_in(text: str) -> str:
    out = []
    for tok in re.findall(r"\d+|[^\W\d_]+", text.lower()):
        if tok.isdigit():
            out.append(tok)
        elif tok in NUMBER_WORDS:
            out.append(str(NUMBER_WORDS[tok]))
    return "".join(out)


def _face_share(video: Path) -> float:
    import cv2
    from presenter import _landmarker

    cap = cv2.VideoCapture(str(video))
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    idx = sorted(set(np.linspace(0, max(0, n - 1), 12).astype(int).tolist())) if n > 0 else list(range(0, 300, 25))
    seen = hits = 0
    mp, lmk = _landmarker()
    with lmk:
        for k, i in enumerate(idx):
            cap.set(cv2.CAP_PROP_POS_FRAMES, i)
            ok, f = cap.read()
            if not ok:
                continue
            seen += 1
            res = lmk.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(f, cv2.COLOR_BGR2RGB)), k * 1000)
            hits += 1 if res.face_landmarks else 0
    cap.release()
    return hits / seen if seen else 0.0


@torch.no_grad()
def match(video: Path, footage: Path) -> dict:
    """Phase 3: is a video the user wants translated the same person as their (consented) presenter footage? Voice match
    (ECAPA ≥ VOICE_MIN) + a face visible in most of it. → {ok, reason, face_share, voice_score}."""
    _load()
    a, b = _wav16(video, 60), _wav16(footage, 60)
    if len(a) < 16000 * 3:
        return {"ok": False, "reason": "There's too little speech in that video to translate", "face_share": 0.0, "voice_score": 0.0}
    spk = _m["spk"]
    emb = lambda w: spk.encode_batch(torch.tensor(w[: 16000 * 30])[None]).squeeze()  # noqa: E731
    score = float(torch.nn.functional.cosine_similarity(emb(a), emb(b), dim=0)) if len(b) >= 16000 * 3 else 0.0
    face = _face_share(video)
    res = {"face_share": round(face, 2), "voice_score": round(score, 3)}
    if face < FACE_MIN:
        return {**res, "ok": False, "reason": "Your face needs to be visible in most of the video"}
    if score < VOICE_MIN:
        return {**res, "ok": False, "reason": "The voice in that video doesn't match your presenter — you can only translate videos of yourself"}
    return {**res, "ok": True, "reason": None}


@torch.no_grad()
def verify(clip: Path, footage: Path, code: str, statement: str = "") -> dict:
    """→ {ok, reason, transcript, heard, code_ok, face_share, voice_score}. `reason` is shown to the user on failure."""
    _load()
    a = _wav16(clip, 30)
    if len(a) < 16000 * 2:
        return {"ok": False, "reason": "The consent recording is too short — read the whole sentence"}
    proc, asr = _m["proc"], _m["asr"]
    ids = asr.generate(proc(a, sampling_rate=16000, return_tensors="pt").input_features, task="transcribe")
    transcript = proc.batch_decode(ids, skip_special_tokens=True)[0].strip()
    heard = digits_in(transcript)
    code_ok = code_spoken(transcript, code)
    ratio, name_ok = sentence_match(transcript, statement, code) if statement else (1.0, True)
    face = _face_share(clip)
    b = _wav16(footage, 60)
    spk = _m["spk"]
    emb = lambda w: spk.encode_batch(torch.tensor(w[: 16000 * 30])[None]).squeeze()  # noqa: E731
    score = float(torch.nn.functional.cosine_similarity(emb(a), emb(b), dim=0)) if len(b) >= 16000 * 3 else 0.0
    res = {"transcript": transcript[:500], "heard": heard[:40], "code_ok": code_ok, "sentence": round(ratio, 2),
           "name_ok": name_ok, "face_share": round(face, 2), "voice_score": round(score, 3)}
    if ratio < SENTENCE_MIN or not name_ok:
        return {**res, "ok": False, "reason": "Read the whole sentence on screen, including your name, in one go"}
    if not code_ok:
        return {**res, "ok": False, "reason": "We couldn't hear the code — say each number clearly"}
    if face < FACE_MIN:
        return {**res, "ok": False, "reason": "Your face wasn't visible during the consent recording — face the camera"}
    if score < VOICE_MIN:
        return {**res, "ok": False, "reason": "The voice in the consent recording doesn't match the presenter video — the same person must record both"}
    return {**res, "ok": True, "reason": None}

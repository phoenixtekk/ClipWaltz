"""Waltz Avatar presenter engine: lip-syncs a presenter's own footage to new speech, on AISERVER's GPU.

MuseTalk 1.5 (TMElyralab/MuseTalk, MIT code + weights) for the mouth, with every face step done by Google MediaPipe
Face Landmarker (Apache-2.0) instead of MuseTalk's own pipeline — DWPose (trained on COCO-WholeBody, CC BY-NC), S3FD
(no stated licence) and BiSeNet face parsing (CelebAMask-HQ, non-commercial) are not used or shipped (Waltz Avatar
spec §9). Only MuseTalk's UNet, the sd-vae-ft-mse VAE (MIT) and whisper-tiny (Apache-2.0) are loaded.

Two steps, as in MuseTalk's "realtime" mode:
  prepare(video) — once per presenter: frames, a face box per frame (from MediaPipe's 478 landmarks mapped to the
                   68-point layout MuseTalk's crop rule expects), VAE latents of each face crop, and a soft lower-face
                   blend mask from the face-oval landmarks. Cached on disk (frames + loop played forward then back).
  lipsync(audio) — whisper features → UNet (one step) → VAE decode → pasted into the cached frames → MP4 with the audio.

Models live on the CPU between jobs and move to the GPU only while one runs (the card is shared with EchoMimic and
ComfyUI — see service.py's GPU guard).
"""
from __future__ import annotations

import json
import math
import os
import shutil
import subprocess
from pathlib import Path
from typing import Callable, Optional

import cv2
import numpy as np
import torch

MODELS = Path(os.environ.get("PRESENTER_MODELS", "/data/clipwaltz-ai/models/musetalk"))
LANDMARKER = Path(os.environ.get("PRESENTER_LANDMARKER", str(MODELS / "face_landmarker.task")))
FPS = 25
MAX_SIDE = 1920  # longest side of cached frames (1080p presenters stay 1080p)
CROP = 256  # MuseTalk's face size
EXTRA_MARGIN = 10  # MuseTalk 1.5: extend the crop below the chin
BATCH = int(os.environ.get("PRESENTER_BATCH", "16"))

# MediaPipe Face Mesh index for each of the 68 iBUG points (jaw 0-16, brows 17-26, nose 27-35, eyes 36-47, lips 48-67).
MP68 = [162, 234, 93, 58, 172, 136, 149, 148, 152, 377, 378, 365, 397, 288, 323, 454, 389,
        71, 63, 105, 66, 107, 336, 296, 334, 293, 301,
        168, 197, 5, 4, 75, 97, 2, 326, 305,
        33, 160, 158, 133, 153, 144, 362, 385, 387, 263, 373, 380,
        61, 39, 37, 0, 267, 269, 291, 405, 314, 17, 84, 181, 78, 82, 13, 312, 308, 317, 14, 87]
FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176,
             149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]


class PresenterError(Exception):
    """A problem with the user's footage or speech (shown to them)."""


# ── Models ─────────────────────────────────────────────────────────────────────────────────────────
_models: dict = {}


def load() -> None:
    """Load once, onto the CPU (fp16)."""
    if _models:
        return
    from diffusers import AutoencoderKL, UNet2DConditionModel
    from transformers import AutoFeatureExtractor, WhisperModel

    with open(MODELS / "musetalkV15" / "musetalk.json", "r", encoding="utf-8") as fh:
        unet = UNet2DConditionModel(**json.load(fh))
    unet.load_state_dict(torch.load(MODELS / "musetalkV15" / "unet.pth", map_location="cpu", weights_only=True))
    _models["unet"] = unet.half().eval()
    _models["vae"] = AutoencoderKL.from_pretrained(MODELS / "sd-vae").half().eval()
    _models["whisper"] = WhisperModel.from_pretrained(MODELS / "whisper").half().eval()
    _models["features"] = AutoFeatureExtractor.from_pretrained(MODELS / "whisper")
    # MuseTalk's positional encoding for the audio tokens (d_model 384).
    pe = torch.zeros(5000, 384)
    pos = torch.arange(0, 5000, dtype=torch.float).unsqueeze(1)
    div = torch.exp(torch.arange(0, 384, 2).float() * (-math.log(10000.0) / 384))
    pe[:, 0::2], pe[:, 1::2] = torch.sin(pos * div), torch.cos(pos * div)
    _models["pe"] = pe.unsqueeze(0).half()


class _OnGpu:
    """Moves the models to the GPU for one job and back afterwards (frees ~2 GB for EchoMimic / ComfyUI)."""

    def __init__(self, names):
        self.names = names

    def __enter__(self):
        for n in self.names:
            _models[n] = _models[n].to("cuda")
        return self

    def __exit__(self, *exc):
        for n in self.names:
            _models[n] = _models[n].to("cpu")
        torch.cuda.empty_cache()


# ── Face (MediaPipe) ───────────────────────────────────────────────────────────────────────────────
def _landmarker():
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions, vision

    opts = vision.FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(LANDMARKER)),
        running_mode=vision.RunningMode.VIDEO,
        num_faces=1,
        min_face_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    )
    return mp, vision.FaceLandmarker.create_from_options(opts)


def face_box(lm68: np.ndarray, h: int) -> tuple:
    """MuseTalk's crop rule (preprocessing.get_landmark_and_bbox, v1.5 extra margin): sides from the jaw, bottom at the
    chin, top as far above the nose (point 29) as the chin is below it."""
    half = lm68[29]
    bottom = int(np.max(lm68[:, 1]))
    top = max(0, int(half[1] - (bottom - half[1])))
    return int(np.min(lm68[:, 0])), top, int(np.max(lm68[:, 0])), min(h, bottom + EXTRA_MARGIN)


def crop_box(box, expand=1.5):
    x, y, x1, y1 = box
    xc, yc = (x + x1) // 2, (y + y1) // 2
    s = int(max(x1 - x, y1 - y) // 2 * expand)
    return [xc - s, yc - s, xc + s, yc + s]


def blend_mask(pts: np.ndarray, box, cbox) -> np.ndarray:
    """Soft mask of the lower face inside the expanded crop: the face oval (stretched down a little so an opening jaw
    stays inside), bottom half only, blurred — the role BiSeNet's "jaw" parsing plays in MuseTalk."""
    xs, ys, xe, ye = cbox
    size = xe - xs
    mask = np.zeros((size, size), np.uint8)
    oval = pts[FACE_OVAL].astype(np.float32) - [xs, ys]
    cy = oval[:, 1].mean()
    oval[:, 1] = np.where(oval[:, 1] > cy, cy + (oval[:, 1] - cy) * 1.08, oval[:, 1])
    cv2.fillPoly(mask, [oval.astype(np.int32)], 255)
    # Keep only the face box (as MuseTalk does), then only its lower half of the crop.
    x, y, x1, y1 = box
    keep = np.zeros_like(mask)
    keep[max(0, y - ys):y1 - ys, max(0, x - xs):x1 - xs] = 255
    mask = cv2.bitwise_and(mask, keep)
    mask[: size // 2] = 0
    k = int(0.1 * size // 2 * 2) + 1
    return cv2.GaussianBlur(mask, (k, k), 0)


# ── Prepare ────────────────────────────────────────────────────────────────────────────────────────
def _read_frames(video: Path, max_seconds: float):
    cap = cv2.VideoCapture(str(video))
    src_fps = cap.get(cv2.CAP_PROP_FPS) or FPS
    frames, step = [], src_fps / FPS  # resample to 25 fps: keep the source frame at or after each 1/25 s tick
    i, want = 0, 0.0
    while True:
        ok, f = cap.read()
        if not ok:
            break
        while i >= want - 1e-6 and len(frames) < max_seconds * FPS:
            h, w = f.shape[:2]
            if max(h, w) > MAX_SIDE:
                s = MAX_SIDE / max(h, w)
                f = cv2.resize(f, (int(w * s) // 2 * 2, int(h * s) // 2 * 2), interpolation=cv2.INTER_AREA)
            frames.append(f)
            want += step
        i += 1
        if len(frames) >= max_seconds * FPS:
            break
    cap.release()
    return frames


@torch.no_grad()
def prepare(video: Path, cache: Path, max_seconds: float = 30.0, progress: Optional[Callable[[float], None]] = None) -> dict:
    """Build the presenter cache from its base footage. Returns stats for the caller to store."""
    load()
    frames = _read_frames(video, max_seconds)
    if len(frames) < FPS * 2:
        raise PresenterError("The video is too short — record at least 10 seconds of yourself talking")
    mp, lmk = _landmarker()
    found, last, missing = [], None, 0
    with lmk:
        for n, f in enumerate(frames):
            h, w = f.shape[:2]
            res = lmk.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(f, cv2.COLOR_BGR2RGB)), int(n * 1000 / FPS))
            if res.face_landmarks:
                last = np.array([[p.x * w, p.y * h] for p in res.face_landmarks[0]], np.float32)
            else:
                missing += 1  # brief miss (blink, turn): the last face found is reused
            found.append(last)
            if progress and n % 25 == 0:
                progress(0.6 * n / len(frames))
    if missing > len(frames) * 0.1 or last is None:
        raise PresenterError("Your face wasn't visible in enough of the video — face the camera, in good light, one person only")
    first = next(p for p in found if p is not None)  # frames before the first detection take the first face
    boxes, cboxes, masks = [], [], []
    for pts in found:
        pts = first if pts is None else pts
        box = face_box(pts[MP68], frames[0].shape[0])
        cb = crop_box(box)
        boxes.append(box)
        cboxes.append(cb)
        masks.append(blend_mask(pts, box, cb))

    if cache.exists():
        shutil.rmtree(cache)
    (cache / "frames").mkdir(parents=True)
    latents = []
    vae = _models["vae"]
    with _OnGpu(["vae"]):
        for n, (f, box) in enumerate(zip(frames, boxes)):
            x, y, x1, y1 = box
            crop = cv2.resize(f[y:y1, x:x1], (CROP, CROP), interpolation=cv2.INTER_LANCZOS4)
            img = torch.from_numpy(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)).permute(2, 0, 1).float().div(255).mul(2).sub(1)
            masked = img.clone()
            masked[:, CROP // 2:] = -1.0  # MuseTalk hides the lower half (0 before normalising = -1 after)
            both = torch.stack([masked, img]).half().cuda()
            lat = vae.encode(both).latent_dist.sample() * vae.config.scaling_factor
            latents.append(torch.cat([lat[0:1], lat[1:2]], dim=1).cpu())
            cv2.imwrite(str(cache / "frames" / f"{n:05d}.jpg"), f, [cv2.IMWRITE_JPEG_QUALITY, 94])
            if progress and n % 25 == 0:
                progress(0.6 + 0.4 * n / len(frames))
    torch.save(torch.cat(latents), cache / "latents.pt")
    np.save(cache / "masks.npy", np.array(masks, dtype=object), allow_pickle=True)
    meta = {"frames": len(frames), "boxes": boxes, "crop_boxes": cboxes, "missing": missing,
            "width": frames[0].shape[1], "height": frames[0].shape[0], "fps": FPS, "engine": "musetalk-1.5+mediapipe"}
    (cache / "meta.json").write_text(json.dumps(meta))
    return {k: meta[k] for k in ("frames", "missing", "width", "height")}


# ── Lip-sync ───────────────────────────────────────────────────────────────────────────────────────
@torch.no_grad()
def _whisper_chunks(wav16: np.ndarray) -> torch.Tensor:
    """MuseTalk's AudioProcessor.get_whisper_chunk: per video frame, 10 whisper steps × 5 layers × 384."""
    fe, wh = _models["features"], _models["whisper"]
    seg = 30 * 16000
    feats = []
    for i in range(0, len(wav16), seg):
        x = fe(wav16[i:i + seg], return_tensors="pt", sampling_rate=16000).input_features.half().cuda()
        hs = wh.encoder(x, output_hidden_states=True).hidden_states
        feats.append(torch.stack(hs, dim=2))
    feat = torch.cat(feats, dim=1)
    frames = math.floor(len(wav16) / 16000 * FPS)
    feat = feat[:, : math.floor(len(wav16) / 16000 * 50)]
    feat = torch.cat([torch.zeros_like(feat[:, :2 * 2]), feat, torch.zeros_like(feat[:, :2 * 3 * 2])], 1)
    out = [feat[:, math.floor(i * 2): math.floor(i * 2) + 10] for i in range(frames)]
    out = torch.cat(out, dim=0)  # T, 10, 5, 384
    return out.reshape(out.shape[0], 50, 384)


@torch.no_grad()
def lipsync(cache: Path, audio: Path, out: Path, progress: Optional[Callable[[float], None]] = None) -> float:
    """Render `audio` (any format ffmpeg reads) on the prepared presenter → H.264 MP4 at the presenter's size.
    Returns the video length in seconds."""
    import librosa

    load()
    meta = json.loads((cache / "meta.json").read_text())
    n = meta["frames"]
    latents = torch.load(cache / "latents.pt", weights_only=True)
    masks = np.load(cache / "masks.npy", allow_pickle=True)
    boxes, cboxes = meta["boxes"], meta["crop_boxes"]
    order = list(range(n)) + list(range(n - 1, -1, -1))  # forward then back, so long speech loops smoothly
    wav16, _ = librosa.load(str(audio), sr=16000)
    if len(wav16) < 1600:
        raise PresenterError("The speech is empty")
    w, h = meta["width"], meta["height"]
    tmp = out.with_suffix(".silent.mp4")
    enc = subprocess.Popen(
        ["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{w}x{h}", "-r", str(FPS),
         "-i", "-", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", str(tmp)],
        stdin=subprocess.PIPE,
    )
    try:
        with _OnGpu(["unet", "vae", "whisper", "pe"]):
            chunks = _whisper_chunks(wav16)
            total = chunks.shape[0]
            unet, vae, pe = _models["unet"], _models["vae"], _models["pe"]
            t0 = torch.tensor([0], device="cuda")
            for b in range(0, total, BATCH):
                idx = [order[i % len(order)] for i in range(b, min(total, b + BATCH))]
                aud = chunks[b:b + len(idx)].cuda()
                aud = aud + pe[:, : aud.shape[1]]
                lat = latents[idx].half().cuda()
                pred = unet(lat, t0, encoder_hidden_states=aud).sample
                img = vae.decode(pred / vae.config.scaling_factor).sample
                img = ((img / 2 + 0.5).clamp(0, 1) * 255).round().byte().permute(0, 2, 3, 1).cpu().numpy()[..., ::-1]
                for k, fi in enumerate(idx):
                    frame = cv2.imread(str(cache / "frames" / f"{fi:05d}.jpg"))
                    x, y, x1, y1 = boxes[fi]
                    face = cv2.resize(np.ascontiguousarray(img[k]), (x1 - x, y1 - y), interpolation=cv2.INTER_LANCZOS4)
                    enc.stdin.write(_paste(frame, face, boxes[fi], cboxes[fi], masks[fi]).tobytes())
                if progress:
                    progress(min(1.0, (b + len(idx)) / total))
        enc.stdin.close()
        if enc.wait() != 0:
            raise RuntimeError("ffmpeg failed while encoding")
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(tmp), "-i", str(audio), "-map", "0:v", "-map", "1:a",
                        "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", str(out)], check=True)
    finally:
        if enc.poll() is None:
            enc.kill()
        tmp.unlink(missing_ok=True)
    return total / FPS


def _paste(frame: np.ndarray, face: np.ndarray, box, cbox, mask: np.ndarray) -> np.ndarray:
    """MuseTalk's get_image_blending, in NumPy: the new face into the expanded crop, then the crop back through the
    soft mask. Crop boxes can run off the frame edge — only the part inside is blended."""
    h, w = frame.shape[:2]
    xs, ys, xe, ye = cbox
    x, y, x1, y1 = box
    large = np.zeros((ye - ys, xe - xs, 3), np.uint8)
    fx0, fy0, fx1, fy1 = max(0, xs), max(0, ys), min(w, xe), min(h, ye)
    large[fy0 - ys:fy1 - ys, fx0 - xs:fx1 - xs] = frame[fy0:fy1, fx0:fx1]
    large[y - ys:y1 - ys, x - xs:x1 - xs] = face
    a = (mask.astype(np.float32) / 255.0)[..., None]
    region = frame[fy0:fy1, fx0:fx1].astype(np.float32)
    new = large[fy0 - ys:fy1 - ys, fx0 - xs:fx1 - xs].astype(np.float32)
    am = a[fy0 - ys:fy1 - ys, fx0 - xs:fx1 - xs]
    out = frame.copy()
    out[fy0:fy1, fx0:fx1] = (new * am + region * (1 - am)).round().astype(np.uint8)
    return out

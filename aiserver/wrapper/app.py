"""
ClipWaltz AISERVER API wrapper.

A thin, authenticated FastAPI service that sits in front of a localhost-only
ComfyUI instance and exposes a small, stable job API to the ClipWaltz backend.

Design contract (doc 04 sections 16-18, 22-23):
  - ComfyUI is NEVER exposed off-box; this wrapper is the only network surface.
  - Every mutating/inspecting endpoint requires a shared-secret bearer token.
  - The wrapper translates a *logical* job (a small, controlled parameter set)
    into a ComfyUI API-format prompt graph. The client never submits raw graphs.
  - Job state + a structured audit line per job are persisted to disk so we do
    not rely on ComfyUI console output alone.

The LTX (and any future) workflow graph lives in a template file on disk plus a
mapping file that says which graph node/input each logical field writes to. That
keeps this wrapper free of model-specific node internals.

Env (loaded by systemd from /opt/clipwaltz-ai/config/wrapper.env):
  CW_API_TOKEN         required. Shared secret bearer token.
  CW_BIND_HOST         interface to bind (default 127.0.0.1; set to the LAN IP
                       to allow the ClipWaltz backend on linuxg1 to reach it).
  CW_BIND_PORT         default 8189.
  COMFYUI_URLS         comma-separated ComfyUI backends, one per GPU
                       (default COMFYUI_URL, else http://127.0.0.1:8188)
  CW_WORKFLOW_DIR      default /opt/clipwaltz-ai/workflows
  CW_OUTPUT_DIR        default /data/clipwaltz-ai/output
  CW_INPUT_DIR         default /data/clipwaltz-ai/input
  CW_LOG_DIR           default /opt/clipwaltz-ai/logs
  CW_DATA_MOUNT        default /data   (for disk_free_gb reporting)
  CW_TALKING_URL       talking-photo service (aiserver/talking), default http://127.0.0.1:8192
  CW_TALKING_GPU_BACKEND  the ComfyUI backend sharing the talking service's GPU (default: the
                       second COMFYUI_URLS entry). No new ComfyUI job goes there while a talking
                       job is queued or running — EchoMimic + Wan on one 10 GB card run out of memory.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #
API_TOKEN = os.environ.get("CW_API_TOKEN", "").strip()
# One ComfyUI per GPU (comfyui.service → GPU 0 :8188, comfyui-gpu1.service → GPU 1 :8190). Jobs
# are dispatched to the least-busy online backend. COMFYUI_URLS is comma-separated; COMFYUI_URL
# (single backend) is still honoured for older wrapper.env files.
COMFYUI_URLS = [
    u.strip().rstrip("/")
    for u in os.environ.get("COMFYUI_URLS", os.environ.get("COMFYUI_URL", "http://127.0.0.1:8188")).split(",")
    if u.strip()
]
WORKFLOW_DIR = Path(os.environ.get("CW_WORKFLOW_DIR", "/opt/clipwaltz-ai/workflows"))
OUTPUT_DIR = Path(os.environ.get("CW_OUTPUT_DIR", "/data/clipwaltz-ai/output"))
INPUT_DIR = Path(os.environ.get("CW_INPUT_DIR", "/data/clipwaltz-ai/input"))
LOG_DIR = Path(os.environ.get("CW_LOG_DIR", "/opt/clipwaltz-ai/logs"))
DATA_MOUNT = os.environ.get("CW_DATA_MOUNT", "/data")

AUDIT_LOG = LOG_DIR / "jobs.jsonl"
TALKING_URL = os.environ.get("CW_TALKING_URL", "http://127.0.0.1:8192").rstrip("/")
TALKING_GPU_BACKEND = os.environ.get(
    "CW_TALKING_GPU_BACKEND", COMFYUI_URLS[1] if len(COMFYUI_URLS) > 1 else ""
).rstrip("/")
TALKING = "talking"  # the `backend` of jobs run by the talking-photo service (not ComfyUI)
# Waltz Avatar cloned voices (aiserver/voice, Chatterbox) — on GPU 0, beside ComfyUI #1.
VOICE_URL = os.environ.get("CW_VOICE_URL", "http://127.0.0.1:8195").rstrip("/")
VOICE_GPU_BACKEND = os.environ.get("CW_VOICE_GPU_BACKEND", COMFYUI_URLS[0] if COMFYUI_URLS else "").rstrip("/")
VOICE = "voice"
# Non-ComfyUI services: backend name -> (URL, the ComfyUI sharing its card). The GPU guard keeps new ComfyUI work off a
# card while that service has a job queued or running.
SERVICES = {TALKING: (TALKING_URL, TALKING_GPU_BACKEND), VOICE: (VOICE_URL, VOICE_GPU_BACKEND)}

# Registry of available workflows. Each maps a logical workflow id to a template
# (ComfyUI API-format graph) and a field mapping. Add entries as workflows land.
WORKFLOWS: Dict[str, Dict[str, str]] = {
    "wan-image-to-video-v1": {
        "template": "wan/workflow.api.json",
        "mapping": "wan/workflow.map.json",
    },
    "wan-text-to-video-v1": {
        "template": "wan/workflow.t2v.api.json",
        "mapping": "wan/workflow.t2v.map.json",
    },
    # ML enhancement: Real-ESRGAN 2x upscale of a source video (source_image = staged video file).
    "esrgan-upscale-v1": {
        "template": "wan/enhance.api.json",
        "mapping": "wan/enhance.map.json",
    },
    # ML enhancement: RIFE 2x frame interpolation (smoother motion) of a source video.
    "rife-interpolate-v1": {
        "template": "wan/rife.api.json",
        "mapping": "wan/rife.map.json",
    },
    # ML restoration: SeedVR2-3B (Apache-2.0) diffusion video restoration + upscale. Caller sets
    # resolution (target short side) and batch_size (4n+1) — both fall back to the template's
    # 960 / 21, which fit one 10 GB RTX 3080 (ADR-0007).
    "seedvr2-restore-v1": {
        "template": "seedvr2/restore.api.json",
        "mapping": "seedvr2/restore.map.json",
    },
    # Talking photo (Phase C2): EchoMimic v3-Flash in the clipwaltz-talking service, not ComfyUI.
    # source_image = staged photo; audio = staged speech, or text + voice for Kokoro.
    "echomimic-talking-v1": {"service": TALKING},
    # Waltz Avatar presenters (MuseTalk 1.5 + MediaPipe) in the same service: consent check + cache, then lip-sync.
    "presenter-prepare-v1": {"service": TALKING, "kind": "prepare"},
    "presenter-lipsync-v1": {"service": TALKING, "kind": "lipsync"},
    "presenter-consent-v1": {"service": TALKING, "kind": "consent"},
    # Waltz Avatar Phase 2: lines in a presenter's cloned voice (+ word timings), clipwaltz-voice service.
    "voice-clone-tts-v1": {"service": VOICE},
}

app = FastAPI(title="ClipWaltz AISERVER API", version="1.0")
bearer = HTTPBearer(auto_error=True)

# In-memory job table. Durable audit is appended to AUDIT_LOG.
_jobs: Dict[str, Dict[str, Any]] = {}
_jobs_lock = threading.Lock()
_dispatch_lock = threading.Lock()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def require_token(creds: HTTPAuthorizationCredentials = Depends(bearer)) -> None:
    if not API_TOKEN:
        # Fail closed: never run unauthenticated.
        raise HTTPException(status_code=503, detail="server auth not configured")
    if creds.credentials != API_TOKEN:
        raise HTTPException(status_code=401, detail="invalid token")


# --------------------------------------------------------------------------- #
# GPU / disk helpers
# --------------------------------------------------------------------------- #
def query_gpus() -> List[Dict[str, Any]]:
    try:
        out = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=index,name,memory.total,memory.used,utilization.gpu,driver_version",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=10,
        )
        gpus = []
        for line in out.stdout.strip().splitlines():
            idx, name, mtot, mused, util, drv = [p.strip() for p in line.split(",")]
            gpus.append(
                {
                    "index": int(idx),
                    "name": name,
                    "memory_total_mib": int(mtot),
                    "memory_used_mib": int(mused),
                    "utilization_pct": int(util),
                    "driver_version": drv,
                }
            )
        return gpus
    except Exception as exc:  # noqa: BLE001 - report, never crash the endpoint
        return [{"error": str(exc)}]


def disk_free_gb(path: str) -> int:
    try:
        total, used, free = shutil.disk_usage(path)
        return int(free / (1024**3))
    except Exception:  # noqa: BLE001
        return -1


def comfyui_online(base: str) -> bool:
    try:
        r = httpx.get(f"{base}/system_stats", timeout=5)
        return r.status_code == 200
    except Exception:  # noqa: BLE001
        return False


def _active_on(base: str) -> int:
    """Jobs this wrapper has queued/running on a backend (caller holds _jobs_lock)."""
    return len([j for j in _jobs.values() if j.get("backend") == base and j["status"] in ("queued", "running")])


def _comfy_targets(online: List[str]) -> List[str]:
    """GPU guard (caller holds _jobs_lock): while a service job (talking photo / presenter, cloned voice) is queued or
    running, keep ComfyUI work off the card it uses. If every online ComfyUI shares a busy card, they are used anyway
    (better than refusing all work; each service waits for its card's ComfyUI queue to empty before it runs)."""
    held = {gpu for svc, (_, gpu) in SERVICES.items() if gpu and _active_on(svc)}
    free = [b for b in online if b not in held]
    return free or online


# --------------------------------------------------------------------------- #
# Workflow graph building
# --------------------------------------------------------------------------- #
def _load_json(p: Path) -> Any:
    with p.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def build_graph(workflow_id: str, inputs: "JobInputs", job_id: str) -> Dict[str, Any]:
    """Load the template graph and apply logical inputs via the mapping file.

    The mapping file has shape:
      {
        "fields": {
          "<logical_field>": [ ["<node_id>", "<input_key>"], ... ],
          ...
        },
        "seed_fields": [ ["<node_id>", "<input_key>"] ]   # randomised if seed is null
      }
    """
    if workflow_id not in WORKFLOWS:
        raise HTTPException(status_code=404, detail=f"unknown workflow {workflow_id}")
    wf = WORKFLOWS[workflow_id]
    if "service" in wf:
        raise HTTPException(status_code=400, detail=f"{workflow_id} is not a ComfyUI workflow")
    template_path = WORKFLOW_DIR / wf["template"]
    mapping_path = WORKFLOW_DIR / wf["mapping"]
    if not template_path.exists() or not mapping_path.exists():
        raise HTTPException(
            status_code=503,
            detail=f"workflow {workflow_id} template/mapping not installed on host",
        )
    graph = _load_json(template_path)
    mapping = _load_json(mapping_path)

    logical = inputs.model_dump()
    # Resolve seed: null -> random, else fixed for reproducibility.
    if logical.get("seed") is None:
        logical["seed"] = int.from_bytes(os.urandom(4), "big")

    for field, targets in mapping.get("fields", {}).items():
        if field not in logical or logical[field] is None:
            continue
        for node_id, input_key in targets:
            if node_id in graph and "inputs" in graph[node_id]:
                graph[node_id]["inputs"][input_key] = logical[field]

    # "append_fields": add the value to the template's own text (e.g. the user's negative prompt
    # goes after the workflow's built-in negative prompt instead of replacing it).
    for field, targets in mapping.get("append_fields", {}).items():
        value = (logical.get(field) or "").strip()
        if not value:
            continue
        for node_id, input_key in targets:
            if node_id in graph and "inputs" in graph[node_id]:
                base = str(graph[node_id]["inputs"].get(input_key) or "").strip()
                graph[node_id]["inputs"][input_key] = f"{base}, {value}" if base else value

    # Seed: without this every job ran with the template's baked-in seed (identical regenerations).
    for node_id, input_key in mapping.get("seed_fields", []):
        if node_id in graph and "inputs" in graph[node_id]:
            graph[node_id]["inputs"][input_key] = logical["seed"]

    # Per-job output prefix: several ComfyUI instances share the output dir, and each picks its
    # file counter by scanning it — two jobs saving at once under one prefix could collide.
    for node in graph.values():
        if isinstance(node, dict) and "filename_prefix" in node.get("inputs", {}):
            node["inputs"]["filename_prefix"] = f"clipwaltz/{job_id}"

    return graph


# --------------------------------------------------------------------------- #
# ComfyUI interaction
# --------------------------------------------------------------------------- #
def submit_to_comfyui(base: str, graph: Dict[str, Any], client_id: str) -> str:
    try:
        r = httpx.post(
            f"{base}/prompt",
            json={"prompt": graph, "client_id": client_id},
            timeout=30,
        )
        r.raise_for_status()
        return r.json()["prompt_id"]
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=f"comfyui rejected prompt: {exc.response.text[:500]}")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"comfyui unreachable: {exc}")


def _comfyui_is_running(base: str, prompt_id: str) -> bool:
    """True if ComfyUI is currently executing this prompt (queue_running entry [num, id, ...])."""
    try:
        q = httpx.get(f"{base}/queue", timeout=10).json()
    except Exception:  # noqa: BLE001
        return False
    return any(len(item) > 1 and item[1] == prompt_id for item in q.get("queue_running", []))


def poll_job(job_id: str) -> None:
    """Background poller: watches ComfyUI /history until the prompt completes,
    then records output file metadata."""
    with _jobs_lock:
        prompt_id = _jobs[job_id]["prompt_id"]
        base = _jobs[job_id]["backend"]
    while True:
        time.sleep(3)
        try:
            r = httpx.get(f"{base}/history/{prompt_id}", timeout=10)
            hist = r.json()
        except Exception:  # noqa: BLE001
            continue
        if prompt_id not in hist:
            with _jobs_lock:
                if _jobs[job_id]["status"] == "cancelled":
                    return
                waiting = _jobs[job_id]["status"] == "queued"
            # Each ComfyUI runs one prompt at a time: report "running" once ours leaves the queue so
            # callers can time the actual work, not the wait behind other jobs.
            if waiting and _comfyui_is_running(base, prompt_id):
                with _jobs_lock:
                    if _jobs[job_id]["status"] == "queued":
                        _jobs[job_id]["status"] = "running"
                        _jobs[job_id]["started_at"] = _now()
            continue
        entry = hist[prompt_id]
        status = entry.get("status", {})
        completed = status.get("completed", False)
        status_str = status.get("status_str", "")
        outputs = entry.get("outputs", {}) or {}
        files: List[Dict[str, Any]] = []
        for node_out in outputs.values():
            for key in ("gifs", "videos", "images"):
                for f in node_out.get(key, []) or []:
                    files.append(f)
        if completed or status_str == "success" or files:
            out_files = []
            for f in files:
                fn = f.get("filename")
                sub = f.get("subfolder", "")
                full = OUTPUT_DIR / sub / fn if fn else None
                out_files.append(
                    {
                        "filename": fn,
                        "subfolder": sub,
                        "path": str(full) if full else None,
                        "type": f.get("type"),
                        "format": f.get("format"),
                    }
                )
            _finish_job(job_id, "completed", outputs=out_files)
            return
        if status_str == "error":
            _finish_job(job_id, "failed", error=json.dumps(status)[:1000])
            return


def _finish_job(job_id: str, status: str, outputs=None, error=None) -> None:
    with _jobs_lock:
        j = _jobs[job_id]
        j["status"] = status
        j["finished_at"] = _now()
        if outputs is not None:
            j["outputs"] = outputs
        if error is not None:
            j["error"] = error
        record = dict(j)
    _audit(record)


def _audit(record: Dict[str, Any]) -> None:
    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        with AUDIT_LOG.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record) + "\n")
    except Exception:  # noqa: BLE001
        pass


# --------------------------------------------------------------------------- #
# API models
# --------------------------------------------------------------------------- #
class JobInputs(BaseModel):
    prompt: str = ""
    source_image: Optional[str] = None  # filename already staged in CW_INPUT_DIR
    width: int = 768
    height: int = 512
    duration: float = 5.0
    # Frame count for the latent (Wan needs (length-1) % 4 == 0). The caller computes this from
    # duration + fps; if omitted, the workflow's built-in default length is used.
    length: Optional[int] = None
    motion: str = "balanced"
    seed: Optional[int] = Field(default=None, ge=0, le=2**53 - 1)
    negative_prompt: Optional[str] = Field(default=None, max_length=2000)
    # Sampler steps (quality profile from the app's routing rules); template default if omitted.
    steps: Optional[int] = Field(default=None, ge=4, le=60)
    # Restoration (seedvr2-restore-v1): target short-side resolution and frames per batch.
    resolution: Optional[int] = Field(default=None, ge=256, le=1080)
    batch_size: Optional[int] = Field(default=None, ge=1, le=33)
    # Talking photo (echomimic-talking-v1): staged speech file, or a script for Kokoro.
    audio: Optional[str] = Field(default=None, max_length=200)
    text: Optional[str] = Field(default=None, max_length=3000)
    voice: Optional[str] = Field(default=None, max_length=40)
    speed: Optional[float] = Field(default=None, ge=0.7, le=1.4)
    aspect: Optional[str] = Field(default=None, max_length=10)
    # Waltz Avatar (presenter-*-v1): the presenter, its staged footage + live consent clip and the code it shows.
    presenter_id: Optional[str] = Field(default=None, pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
    video: Optional[str] = Field(default=None, max_length=200)
    consent_clip: Optional[str] = Field(default=None, max_length=200)
    consent_code: Optional[str] = Field(default=None, pattern=r"^[0-9]{4,8}$")
    consent_statement: Optional[str] = Field(default=None, max_length=400)
    # Cloned voice (voice-clone-tts-v1): `audio` = the staged reference clip; the lines to speak and their language.
    lines: Optional[List[str]] = Field(default=None, max_length=60)
    language: Optional[str] = Field(default=None, pattern=r"^[a-z]{2}$")


class JobRequest(BaseModel):
    workflow: str = Field(..., examples=["ltx-image-to-video-v1"])
    inputs: JobInputs


# --------------------------------------------------------------------------- #
# Endpoints
# --------------------------------------------------------------------------- #
@app.get("/health")
def health(_: None = Depends(require_token)) -> Dict[str, Any]:
    gpus = query_gpus()
    gpu_count = len([g for g in gpus if "error" not in g])
    backends = [{"url": b, "online": comfyui_online(b)} for b in COMFYUI_URLS]
    with _jobs_lock:
        active = len([j for j in _jobs.values() if j["status"] in ("queued", "running")])
        for b in backends:
            b["active_jobs"] = _active_on(b["url"])
    online = sum(1 for b in backends if b["online"])
    try:
        talking = httpx.get(f"{TALKING_URL}/health", headers=_talk_headers(), timeout=5).json()
    except Exception as exc:  # noqa: BLE001
        talking = {"ok": False, "error": str(exc)[:200]}
    return {
        "talking": talking,
        "status": "healthy" if online == len(backends) else "degraded",
        "comfyui": "online" if online == len(backends) else ("partial" if online else "offline"),
        "backends": backends,
        "gpu_count": gpu_count,
        "active_jobs": active,
        "disk_free_gb": disk_free_gb(DATA_MOUNT),
    }


@app.get("/gpu")
def gpu(_: None = Depends(require_token)) -> Dict[str, Any]:
    return {"gpus": query_gpus()}


@app.get("/models")
def models(_: None = Depends(require_token)) -> Dict[str, Any]:
    return {"workflows": sorted(WORKFLOWS.keys())}


@app.post("/jobs")
def create_job(req: JobRequest, _: None = Depends(require_token)) -> Dict[str, Any]:
    job_id = "cw_" + uuid.uuid4().hex[:12]
    client_id = job_id
    if WORKFLOWS.get(req.workflow, {}).get("service") == TALKING:
        return create_talking_job(job_id, req)
    if WORKFLOWS.get(req.workflow, {}).get("service") == VOICE:
        return create_voice_job(job_id, req)
    graph = build_graph(req.workflow, req.inputs, job_id)
    online = [b for b in COMFYUI_URLS if comfyui_online(b)]
    if not online:
        raise HTTPException(status_code=502, detail="no ComfyUI backend online")
    # Pick + submit + register under one lock so concurrent requests see each other's load.
    with _dispatch_lock:
        with _jobs_lock:
            base = min(_comfy_targets(online), key=_active_on)  # ties → first listed (GPU 0)
        prompt_id = submit_to_comfyui(base, graph, client_id)
        rec = _register_job(job_id, prompt_id, base, req)
    _audit({**rec, "event": "submitted"})
    threading.Thread(target=poll_job, args=(job_id,), daemon=True).start()
    return {"job_id": job_id, "prompt_id": prompt_id, "status": "queued"}


def _register_job(job_id: str, prompt_id: str, base: str, req: JobRequest) -> Dict[str, Any]:
    rec = {
        "job_id": job_id,
        "prompt_id": prompt_id,
        "backend": base,
        "workflow": req.workflow,
        "inputs": req.inputs.model_dump(),
        "status": "queued",
        "created_at": _now(),
        "finished_at": None,
        "outputs": [],
        "error": None,
    }
    with _jobs_lock:
        _jobs[job_id] = rec
    return rec


# --------------------------------------------------------------------------- #
# Talking photo (clipwaltz-talking service, localhost)
# --------------------------------------------------------------------------- #
def _talk_headers() -> Dict[str, str]:
    return {"Authorization": f"Bearer {API_TOKEN}"}


def create_talking_job(job_id: str, req: JobRequest) -> Dict[str, Any]:
    i = req.inputs
    kind = WORKFLOWS[req.workflow].get("kind")
    if kind:
        if not i.presenter_id:
            raise HTTPException(status_code=400, detail="presenter_id is required")
        body = {
            "job_id": job_id, "kind": kind, "presenter_id": i.presenter_id,
            "video": Path(i.video).name if i.video else None,
            "consent_clip": Path(i.consent_clip).name if i.consent_clip else None,
            "consent_code": i.consent_code,
            "consent_statement": i.consent_statement,
            "audio": Path(i.audio).name if i.audio else None,
            "text": i.text, "voice": i.voice or "af_heart", "speed": i.speed or 1.0,
        }
        return _submit_talking(job_id, req, "/presenter/jobs", body)
    if not i.source_image:
        raise HTTPException(status_code=400, detail="source_image (the photo) is required")
    body = {
        "job_id": job_id,
        "image": Path(i.source_image).name,
        "audio": Path(i.audio).name if i.audio else None,
        "text": i.text,
        "voice": i.voice or "af_heart",
        "speed": i.speed or 1.0,
        "max_seconds": min(30.0, max(1.0, float(i.duration or 30))),
        "seed": (i.seed if i.seed is not None else int.from_bytes(os.urandom(4), "big")) % 2**32,
        "aspect": i.aspect or "photo",
        "prompt": i.prompt or None,
    }
    return _submit_talking(job_id, req, "/jobs", body)


def _submit_talking(job_id: str, req: JobRequest, path: str, body: Dict[str, Any], svc: str = TALKING) -> Dict[str, Any]:
    url = SERVICES[svc][0]
    # Register first (under the dispatch lock) so the GPU guard keeps new ComfyUI work off the card at once.
    with _dispatch_lock:
        rec = _register_job(job_id, job_id, svc, req)
    try:
        r = httpx.post(f"{url}{path}", json=body, headers=_talk_headers(), timeout=30)
    except Exception as exc:  # noqa: BLE001
        _finish_job(job_id, "failed", error=f"{svc} service unreachable: {exc}")
        raise HTTPException(status_code=502, detail=f"{svc} service unreachable")
    if r.status_code != 200:
        _finish_job(job_id, "failed", error=r.text[:500])
        raise HTTPException(status_code=502 if r.status_code >= 500 else 400, detail=f"{svc} service: {r.text[:300]}")
    _audit({**rec, "event": "submitted"})
    threading.Thread(target=poll_talking, args=(job_id, svc), daemon=True).start()
    return {"job_id": job_id, "prompt_id": job_id, "status": "queued"}


def create_voice_job(job_id: str, req: JobRequest) -> Dict[str, Any]:
    i = req.inputs
    if not i.audio or not i.lines:
        raise HTTPException(status_code=400, detail="send the voice reference (audio) and the lines")
    body = {"job_id": job_id, "ref": Path(i.audio).name, "language": i.language or "en", "lines": i.lines}
    return _submit_talking(job_id, req, "/jobs", body, VOICE)


def poll_talking(job_id: str, svc: str = TALKING) -> None:
    url = SERVICES[svc][0]
    misses = 0
    while True:
        time.sleep(3)
        with _jobs_lock:
            if _jobs[job_id]["status"] in ("cancelled", "failed", "completed"):
                return
        try:
            r = httpx.get(f"{url}/jobs/{job_id}", headers=_talk_headers(), timeout=10)
            st = r.json() if r.status_code == 200 else None
        except Exception:  # noqa: BLE001
            st = None
        if st is None:
            misses += 1
            if misses > 100:  # ~5 min without an answer (service restarted → the job is gone)
                _finish_job(job_id, "failed", error=f"{svc} service lost the job")
                return
            continue
        misses = 0
        with _jobs_lock:
            j = _jobs[job_id]
            j["progress"] = st.get("progress")
            j["stage"] = st.get("stage")
            if st.get("result") is not None:
                j["result"] = st["result"]  # presenter prepare: consent check + cache stats
            if st["status"] == "running" and j["status"] == "queued":
                j["status"] = "running"
                j["started_at"] = _now()
        if st["status"] == "completed" and st.get("files"):
            # Cloned voice: the manifest (line lengths + word timings) first, then one WAV per line.
            rels = [st["output"], *st["files"]]
            _finish_job(job_id, "completed", outputs=[{
                "filename": Path(rel).name, "subfolder": str(Path(rel).parent), "path": str(OUTPUT_DIR / rel), "type": "output",
            } for rel in rels])
            return
        if st["status"] == "completed" and not st.get("output"):
            _finish_job(job_id, "completed", outputs=[])  # presenter prepare: nothing to download
            return
        if st["status"] == "completed":
            rel = st["output"]
            _finish_job(job_id, "completed", outputs=[{
                "filename": Path(rel).name, "subfolder": str(Path(rel).parent), "path": str(OUTPUT_DIR / rel),
                "type": "output", "format": "video/mp4", "duration": st.get("duration"),
            }])
            return
        if st["status"] in ("failed", "cancelled"):
            _finish_job(job_id, st["status"], error=st.get("error"))
            return


class TtsRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=3000)
    voice: str = Field("af_heart", max_length=40)
    speed: float = Field(1.0, ge=0.7, le=1.4)
    max_seconds: float = Field(30.0, gt=0, le=30.0)


@app.post("/tts")
def tts(req: TtsRequest, _: None = Depends(require_token)) -> Response:
    """Kokoro speech (WAV) from the talking service — for talking photos rendered on a user's own computer."""
    try:
        r = httpx.post(f"{TALKING_URL}/tts", json=req.model_dump(), headers=_talk_headers(), timeout=180)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"talking service unreachable: {exc}")
    if r.status_code != 200:
        raise HTTPException(status_code=502 if r.status_code >= 500 else 400, detail=f"tts: {r.text[:300]}")
    return Response(content=r.content, media_type="audio/wav")


@app.get("/jobs/{job_id}")
def get_job(job_id: str, _: None = Depends(require_token)) -> Dict[str, Any]:
    with _jobs_lock:
        j = _jobs.get(job_id)
        if not j:
            raise HTTPException(status_code=404, detail="unknown job")
        return dict(j)


@app.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str, _: None = Depends(require_token)) -> Dict[str, Any]:
    with _jobs_lock:
        j = _jobs.get(job_id)
        if not j:
            raise HTTPException(status_code=404, detail="unknown job")
        prompt_id = j["prompt_id"]
        base = j["backend"]
    if base in SERVICES:
        try:
            httpx.post(f"{SERVICES[base][0]}/jobs/{job_id}/cancel", headers=_talk_headers(), timeout=10)
        except Exception:  # noqa: BLE001
            pass
        _finish_job(job_id, "cancelled")
        return {"job_id": job_id, "status": "cancelled"}
    # Remove from queue if still pending, and interrupt ONLY if it is the running one (/interrupt
    # stops whatever is executing — it must not kill another job's work).
    try:
        httpx.post(f"{base}/queue", json={"delete": [prompt_id]}, timeout=10)
        if _comfyui_is_running(base, prompt_id):
            httpx.post(f"{base}/interrupt", timeout=10)
    except Exception:  # noqa: BLE001
        pass
    _finish_job(job_id, "cancelled")
    return {"job_id": job_id, "status": "cancelled"}


# --------------------------------------------------------------------------- #
# Media staging (the ClipWaltz worker on linuxg1 owns all MinIO I/O; this is the
# only way media crosses onto/off AISERVER — ComfyUI itself stays isolated).
# --------------------------------------------------------------------------- #
def _safe_under(base: Path, rel: str) -> Path:
    """Resolve `rel` under `base`, rejecting path traversal."""
    target = (base / rel).resolve()
    if base.resolve() not in target.parents and target != base.resolve():
        raise HTTPException(status_code=400, detail="invalid path")
    return target


@app.post("/inputs")
async def upload_input(file: UploadFile = File(...), _: None = Depends(require_token)) -> Dict[str, Any]:
    """Stage a source image into CW_INPUT_DIR (for image-to-video). Returns the staged filename
    to pass as `source_image` in a subsequent /jobs call."""
    INPUT_DIR.mkdir(parents=True, exist_ok=True)
    ext = Path(file.filename or "").suffix.lower() or ".png"
    # images (image-to-video source) + video (enhancement source) + speech (talking photo).
    if ext not in (".png", ".jpg", ".jpeg", ".webp", ".mp4", ".webm", ".mov",
                   ".wav", ".mp3", ".m4a", ".aac", ".ogg", ".flac"):
        raise HTTPException(status_code=400, detail=f"unsupported input type {ext}")
    name = f"cw_{uuid.uuid4().hex[:16]}{ext}"
    dest = INPUT_DIR / name
    with dest.open("wb") as fh:
        while chunk := await file.read(1024 * 1024):
            fh.write(chunk)
    return {"filename": name}


@app.get("/outputs/{rel:path}")
def download_output(rel: str, _: None = Depends(require_token)) -> FileResponse:
    """Stream a generated output file (relative path under CW_OUTPUT_DIR)."""
    target = _safe_under(OUTPUT_DIR, rel)
    if not target.is_file():
        raise HTTPException(status_code=404, detail="output not found")
    return FileResponse(str(target))


@app.delete("/presenters/{presenter_id}")
def delete_presenter(presenter_id: str, _: None = Depends(require_token)) -> Dict[str, Any]:
    """Waltz Avatar: forget a presenter's cache on this box (its footage frames, latents and masks)."""
    try:
        r = httpx.delete(f"{TALKING_URL}/presenter/{presenter_id}", headers=_talk_headers(), timeout=30)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"talking service unreachable: {exc}")
    if r.status_code != 200:
        raise HTTPException(status_code=400, detail=r.text[:300])
    return r.json()

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
  COMFYUI_URL          default http://127.0.0.1:8188
  CW_WORKFLOW_DIR      default /opt/clipwaltz-ai/workflows
  CW_OUTPUT_DIR        default /data/clipwaltz-ai/output
  CW_INPUT_DIR         default /data/clipwaltz-ai/input
  CW_LOG_DIR           default /opt/clipwaltz-ai/logs
  CW_DATA_MOUNT        default /data   (for disk_free_gb reporting)
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
from fastapi.responses import FileResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #
API_TOKEN = os.environ.get("CW_API_TOKEN", "").strip()
COMFYUI_URL = os.environ.get("COMFYUI_URL", "http://127.0.0.1:8188").rstrip("/")
WORKFLOW_DIR = Path(os.environ.get("CW_WORKFLOW_DIR", "/opt/clipwaltz-ai/workflows"))
OUTPUT_DIR = Path(os.environ.get("CW_OUTPUT_DIR", "/data/clipwaltz-ai/output"))
INPUT_DIR = Path(os.environ.get("CW_INPUT_DIR", "/data/clipwaltz-ai/input"))
LOG_DIR = Path(os.environ.get("CW_LOG_DIR", "/opt/clipwaltz-ai/logs"))
DATA_MOUNT = os.environ.get("CW_DATA_MOUNT", "/data")

AUDIT_LOG = LOG_DIR / "jobs.jsonl"

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
}

app = FastAPI(title="ClipWaltz AISERVER API", version="1.0")
bearer = HTTPBearer(auto_error=True)

# In-memory job table. Durable audit is appended to AUDIT_LOG.
_jobs: Dict[str, Dict[str, Any]] = {}
_jobs_lock = threading.Lock()


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


def comfyui_online() -> bool:
    try:
        r = httpx.get(f"{COMFYUI_URL}/system_stats", timeout=5)
        return r.status_code == 200
    except Exception:  # noqa: BLE001
        return False


# --------------------------------------------------------------------------- #
# Workflow graph building
# --------------------------------------------------------------------------- #
def _load_json(p: Path) -> Any:
    with p.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def build_graph(workflow_id: str, inputs: "JobInputs") -> Dict[str, Any]:
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

    return graph


# --------------------------------------------------------------------------- #
# ComfyUI interaction
# --------------------------------------------------------------------------- #
def submit_to_comfyui(graph: Dict[str, Any], client_id: str) -> str:
    try:
        r = httpx.post(
            f"{COMFYUI_URL}/prompt",
            json={"prompt": graph, "client_id": client_id},
            timeout=30,
        )
        r.raise_for_status()
        return r.json()["prompt_id"]
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=f"comfyui rejected prompt: {exc.response.text[:500]}")
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"comfyui unreachable: {exc}")


def poll_job(job_id: str) -> None:
    """Background poller: watches ComfyUI /history until the prompt completes,
    then records output file metadata."""
    with _jobs_lock:
        prompt_id = _jobs[job_id]["prompt_id"]
    while True:
        time.sleep(3)
        try:
            r = httpx.get(f"{COMFYUI_URL}/history/{prompt_id}", timeout=10)
            hist = r.json()
        except Exception:  # noqa: BLE001
            continue
        if prompt_id not in hist:
            with _jobs_lock:
                if _jobs[job_id]["status"] == "cancelled":
                    return
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
    seed: Optional[int] = None


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
    with _jobs_lock:
        active = len([j for j in _jobs.values() if j["status"] in ("queued", "running")])
    online = comfyui_online()
    return {
        "status": "healthy" if online else "degraded",
        "comfyui": "online" if online else "offline",
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
    graph = build_graph(req.workflow, req.inputs)
    prompt_id = submit_to_comfyui(graph, client_id)
    rec = {
        "job_id": job_id,
        "prompt_id": prompt_id,
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
    _audit({**rec, "event": "submitted"})
    threading.Thread(target=poll_job, args=(job_id,), daemon=True).start()
    return {"job_id": job_id, "prompt_id": prompt_id, "status": "queued"}


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
    # Remove from queue if still pending, and interrupt if it is the running one.
    try:
        httpx.post(f"{COMFYUI_URL}/queue", json={"delete": [prompt_id]}, timeout=10)
        httpx.post(f"{COMFYUI_URL}/interrupt", timeout=10)
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
    # images (image-to-video source) + video (enhancement source).
    if ext not in (".png", ".jpg", ".jpeg", ".webp", ".mp4", ".webm", ".mov"):
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

# ClipWaltz AI Video Engine
## Phase 1 Implementation Plan — AISERVER + ComfyUI

**Version:** 1.0  
**Phase:** 1  
**Target System:** AISERVER  

---

# 1. Phase 1 Objective

Phase 1 establishes AISERVER as the dedicated ClipWaltz AI video generation node.

The goal is to prove:

```text
ClipWaltz Backend
      ↓
AISERVER API
      ↓
ComfyUI
      ↓
Video Model
      ↓
Generated Video
      ↓
ClipWaltz
```

No frontend feature should depend directly on raw ComfyUI internals.

---

# 2. Hard Rule

Do not proceed with package installation until AISERVER's actual environment is validated.

The following must be confirmed by command output:

- operating system
- GPU model
- GPU count
- VRAM
- NVIDIA driver
- CUDA support
- Python
- Git
- FFmpeg
- free disk capacity
- existing Docker usage
- network addressing

---

# 3. Phase 1 Workstreams

1. AISERVER discovery
2. Operating system preparation
3. NVIDIA validation
4. ComfyUI installation
5. ComfyUI service configuration
6. Model storage layout
7. Initial model installation
8. Workflow configuration
9. API wrapper
10. ClipWaltz connectivity
11. End-to-end validation
12. Monitoring and documentation

---

# 4. Step 1 — AISERVER Discovery

Capture:

```text
Hostname
OS
Kernel
CPU
System RAM
GPU(s)
GPU VRAM
Storage
Network IP
Docker state
Python state
FFmpeg state
```

No assumptions are permitted.

---

# 5. Step 2 — Define Installation Paths

Recommended Linux layout:

```text
/opt/clipwaltz-ai/
    comfyui/
    workflows/
    scripts/
    logs/
    config/

/data/clipwaltz-ai/
    models/
    input/
    output/
    temp/
    cache/
```

If AISERVER is Windows, equivalent paths must be selected before proceeding.

Do not mix application code, models, and temporary renders in one directory.

---

# 6. Step 3 — GPU Validation

Required tests:

- nvidia-smi
- GPU visibility
- VRAM capacity
- driver compatibility
- CUDA compatibility with selected PyTorch build

Validation must prove each GPU is visible before ComfyUI setup proceeds.

---

# 7. Step 4 — Python Environment

Preferred:

- dedicated virtual environment
- do not modify unrelated global Python environments

Example logical layout:

```text
/opt/clipwaltz-ai/venv
```

Install:
- supported Python version
- pip
- required build packages

Exact versions must follow the selected ComfyUI and model requirements at implementation time.

---

# 8. Step 5 — Install ComfyUI

Install ComfyUI into:

```text
/opt/clipwaltz-ai/comfyui
```

Requirements:

- dedicated service account where practical
- persistent virtual environment
- no public unauthenticated exposure
- output paths mapped to `/data/clipwaltz-ai`

---

# 9. Step 6 — ComfyUI Service

ComfyUI must run persistently.

Preferred Linux option:
- systemd service

Alternative:
- Docker container if the validated AISERVER environment is standardized around Docker

Service must:
- start automatically
- restart on failure
- log to known location
- bind only to approved interface
- not expose public internet access

---

# 10. Step 7 — ComfyUI Manager / Custom Nodes

Install only required custom nodes.

Maintain a manifest:

```text
custom-node-name
source
version
purpose
workflow dependency
```

Do not install random workflow packs.

Every custom node must have a documented reason.

---

# 11. Step 8 — Model Directory Design

Example:

```text
/data/clipwaltz-ai/models/
    checkpoints/
    diffusion_models/
    text_encoders/
    vae/
    clip/
    loras/
    upscale_models/
    controlnet/
```

If model-specific directories are required, document them.

---

# 12. Step 9 — Install Initial Models

Initial order:

## Model 1
Wan

Purpose:
- baseline production model

## Model 2
LTX

Purpose:
- preview / fast generation

## Model 3
Hunyuan

Purpose:
- premium cinematic workflow

Do not download all possible variants.

Select variants based on:
- AISERVER VRAM
- desired resolution
- acceptable generation time
- licensing
- ComfyUI compatibility

---

# 13. Step 10 — Enhancement Models

Install only after baseline generation works.

Candidates:
- RIFE
- Real-ESRGAN
- SUPIR

Validation sequence:

```text
Generate first
Then interpolate
Then upscale
Then final encode
```

Do not troubleshoot the entire chain simultaneously.

---

# 14. Step 11 — Workflow Repository

Create:

```text
/opt/clipwaltz-ai/workflows/
```

Recommended structure:

```text
wan/
ltx/
hunyuan/
enhancement/
```

Each workflow requires:

```text
README.md
workflow.json
workflow-version.txt
sample-input.json
expected-output.md
```

---

# 15. Step 12 — Workflow Parameter Mapping

Each workflow must expose a controlled interface.

Example:

```json
{
  "prompt": "",
  "source_image": "",
  "width": 1280,
  "height": 720,
  "duration": 5,
  "motion": "balanced",
  "seed": null
}
```

ClipWaltz should manipulate these logical values.

It should not generate arbitrary node graphs from the client.

---

# 16. Step 13 — Internal AISERVER API

Create a lightweight wrapper service.

Recommended:
- FastAPI

Responsibilities:
- health
- GPU information
- model registry
- job submission
- ComfyUI request translation
- job status
- output registration
- cancellation

Endpoints:

```http
GET /health
GET /gpu
GET /models
POST /jobs
GET /jobs/{job_id}
POST /jobs/{job_id}/cancel
```

---

# 17. Step 14 — Internal Job Object

Example:

```json
{
  "job_id": "cw_123",
  "workflow": "wan-image-to-video-v1",
  "inputs": {
    "image": "asset://abc",
    "prompt": "slow cinematic orbit",
    "duration": 5,
    "aspect_ratio": "16:9"
  }
}
```

---

# 18. Step 15 — Network Security

ComfyUI itself should not be directly exposed outside AISERVER.

Preferred path:

```text
ClipWaltz Backend
    ↓
AISERVER API Wrapper
    ↓
ComfyUI localhost/private interface
```

Use:
- firewall controls
- private network
- API authentication

---

# 19. Step 16 — Output Handling

ComfyUI output should initially land in:

```text
/data/clipwaltz-ai/output/
```

The AISERVER API should return:

- job id
- result status
- filename
- dimensions
- duration
- codec
- storage handoff state

Production output should eventually be moved to object storage.

---

# 20. Step 17 — ClipWaltz Backend Connectivity

Implement a server-side AI provider interface.

Example abstraction:

```text
AIProvider
  submitJob()
  getJob()
  cancelJob()
  getModels()
  healthCheck()
```

Implement:

```text
ComfyUIAIServerProvider
```

Do not call AISERVER directly from the browser.

---

# 21. Step 18 — First Validation Workflow

First milestone:

**Image-to-video using one known-good workflow.**

Validation:

1. Upload source image.
2. Submit job.
3. Confirm queue.
4. Confirm GPU utilization.
5. Confirm output video.
6. Confirm backend receives completion.
7. Confirm browser plays result.

Do not introduce multiple models before this succeeds.

---

# 22. Step 19 — Second Validation Workflow

Add text-to-video.

Repeat full validation.

---

# 23. Step 20 — Third Validation Workflow

Add fast preview generation using LTX.

Compare:
- generation time
- VRAM
- quality
- resolution

---

# 24. Step 21 — Premium Workflow

Add Hunyuan only after Wan and LTX workflows are stable.

---

# 25. Step 22 — Logging

AISERVER logs must record:

- request id
- ClipWaltz job id
- workflow
- model
- start time
- completion time
- GPU
- error
- output path

Never rely solely on ComfyUI console output.

---

# 26. Step 23 — Health Monitoring

Health endpoint should report:

```json
{
  "status": "healthy",
  "comfyui": "online",
  "gpu_count": 2,
  "active_jobs": 1,
  "disk_free_gb": 820
}
```

Exact schema may evolve.

---

# 27. Step 24 — Backup Requirements

Back up:
- workflows
- configuration
- API wrapper
- model manifest
- service files

Do not back up temporary frame files.

Model binaries may be re-downloadable but the model manifest must be retained.

---

# 28. Step 25 — Phase 1 Test Cases

## Test 1
ComfyUI starts after reboot.

## Test 2
AISERVER API reports healthy.

## Test 3
GPU detected.

## Test 4
One image-to-video workflow completes.

## Test 5
Output file is valid.

## Test 6
ClipWaltz backend submits job.

## Test 7
ClipWaltz receives completion.

## Test 8
Failure is returned cleanly.

## Test 9
Retry succeeds.

## Test 10
Temporary files are cleaned.

---

# 29. Phase 1 Exit Criteria

Phase 1 is complete only when:

- AISERVER is validated.
- ComfyUI is persistent.
- ComfyUI is not publicly exposed.
- At least one Wan workflow works.
- ClipWaltz can submit jobs programmatically.
- ClipWaltz can retrieve job status.
- ClipWaltz can access output.
- Error handling works.
- Logging exists.
- Workflow definitions are version controlled.

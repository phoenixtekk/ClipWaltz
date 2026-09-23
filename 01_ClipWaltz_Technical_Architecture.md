# ClipWaltz AI Video Engine
## Full Technical Architecture Document

**Version:** 1.0  
**Status:** Approved Design Baseline  
**Primary Product:** ClipWaltz  
**AI Compute Node:** AISERVER  
**Inference Orchestrator:** ComfyUI  

---

# 1. Purpose

This document defines the technical architecture for the ClipWaltz AI Video Engine.

ClipWaltz will provide a premium, modern, creator-focused AI video generation experience while using AISERVER as the dedicated AI inference system. ComfyUI will operate as an internal orchestration layer and must never be exposed directly to end users.

The architecture is designed to support multiple AI video models, intelligent workflow routing, job queues, asset management, enhancement pipelines, versioning, preview generation, project-based organization, and scalable future expansion.

---

# 2. Architecture Goals

The platform must:

1. Provide a user experience that is simpler and more compelling than Higgsfield.
2. Hide all raw ComfyUI complexity from end users.
3. Support multiple video generation models.
4. Allow model routing based on user intent and requested output.
5. Support image-to-video, text-to-video, and media montage workflows.
6. Support large multi-file uploads.
7. Maintain project, scene, version, and asset history.
8. Support preview-first workflows.
9. Support enhancement, interpolation, and upscaling.
10. Support future multi-GPU scaling.
11. Separate product application logic from AI inference logic.
12. Preserve enough metadata to reproduce every generation job.
13. Provide clear progress, queue state, and failure status.
14. Support future paid SaaS packaging without coupling billing to any specific model.

---

# 3. High-Level Architecture

```text
┌───────────────────────────┐
│        ClipWaltz UI       │
│       Web / Mobile        │
└─────────────┬─────────────┘
              │ HTTPS
              ▼
┌───────────────────────────┐
│   ClipWaltz App Backend   │
│ Auth / Projects / Assets  │
│ Jobs / Routing / Exports  │
└─────────────┬─────────────┘
              │
      ┌───────┴────────┐
      │                │
      ▼                ▼
┌───────────────┐  ┌───────────────┐
│ PostgreSQL DB │  │ Redis / Queue │
└───────────────┘  └───────┬───────┘
                            │
                            ▼
                  ┌──────────────────┐
                  │ AI Orchestrator  │
                  │ ClipWaltz Worker │
                  └────────┬─────────┘
                           │ Internal API
                           ▼
                  ┌──────────────────┐
                  │     AISERVER     │
                  │     ComfyUI      │
                  │ Wan / LTX /      │
                  │ Hunyuan / Tools  │
                  └────────┬─────────┘
                           │
            ┌──────────────┼──────────────┐
            ▼              ▼              ▼
      Video Models     Enhancement      FFmpeg
                         Pipeline
```

---

# 4. Core Components

## 4.1 ClipWaltz Frontend

Recommended framework:

- Next.js
- React
- TypeScript
- Tailwind CSS
- Component library such as shadcn/ui or equivalent
- Framer Motion or equivalent for tasteful animation

Responsibilities:

- Authentication experience
- Dashboard
- Project creation
- Asset uploads
- Prompt creation
- Generation controls
- Preview playback
- Timeline/storyboard
- Version comparison
- Job progress
- Export center
- Brand kits
- Template selection
- User settings

The frontend must never connect directly to ComfyUI.

---

## 4.2 ClipWaltz Application Backend

Recommended stack:

- Node.js
- TypeScript
- Next.js server layer or NestJS
- REST API initially
- WebSockets or Server-Sent Events for realtime generation status

Responsibilities:

- Authentication and authorization
- Workspace management
- Project management
- Asset metadata
- Signed upload handling
- Generation request validation
- Model routing
- Workflow selection
- Job orchestration
- Retry logic
- Output registration
- Version tracking
- Export creation
- Usage accounting
- Audit logging

---

# 5. Persistence Layer

## 5.1 PostgreSQL

PostgreSQL is the canonical relational data store.

Recommended entities:

### User
- id
- email
- display_name
- avatar_url
- created_at
- updated_at

### Workspace
- id
- name
- owner_user_id
- plan
- created_at

### WorkspaceMember
- workspace_id
- user_id
- role

### Project
- id
- workspace_id
- name
- description
- status
- thumbnail_asset_id
- created_at
- updated_at

### Asset
- id
- project_id
- workspace_id
- asset_type
- original_filename
- mime_type
- storage_key
- preview_storage_key
- width
- height
- duration_seconds
- file_size
- metadata_json
- created_at

### Scene
- id
- project_id
- sequence_number
- title
- description
- duration_target
- created_at
- updated_at

### GenerationJob
- id
- project_id
- scene_id
- requested_by
- job_type
- status
- routing_profile
- model_name
- workflow_name
- workflow_version
- prompt
- negative_prompt
- request_json
- started_at
- completed_at
- failed_at
- error_code
- error_message

### GenerationVersion
- id
- generation_job_id
- project_id
- scene_id
- version_number
- output_asset_id
- quality_score
- selected
- created_at

### ExportJob
- id
- project_id
- status
- output_format
- resolution
- aspect_ratio
- preset_name
- output_asset_id

### Template
- id
- name
- category
- workflow_profile
- metadata_json

### BrandKit
- id
- workspace_id
- name
- logo_asset_id
- colors_json
- fonts_json
- style_guidance

---

# 6. Queue Architecture

Recommended:

- Redis
- BullMQ

Queue categories:

1. generation
2. enhancement
3. interpolation
4. upscaling
5. transcoding
6. thumbnail-generation
7. export
8. cleanup

Each job must include:

- job_id
- project_id
- user_id
- workflow
- model
- input assets
- output destination
- priority
- retry count
- timestamps

Job states:

```text
queued
preparing
uploading_to_ai_node
loading_model
generating
enhancing
encoding
uploading_output
completed
failed
cancelled
```

---

# 7. AISERVER Architecture

AISERVER is the dedicated AI compute node.

It must host:

- ComfyUI
- Model weights
- Custom nodes
- FFmpeg
- Python environments
- Generation workflows
- Enhancement workflows
- Model cache
- Local scratch space

AISERVER must not host user-facing application pages.

---

# 8. ComfyUI Integration Model

ClipWaltz must treat ComfyUI as an internal execution engine.

ClipWaltz should maintain version-controlled workflow definitions.

Example:

```text
/workflows/
  wan/
    text-to-video-v1.json
    image-to-video-v1.json
  hunyuan/
    cinematic-v1.json
  ltx/
    preview-v1.json
  enhancement/
    upscale-v1.json
    interpolate-v1.json
```

Each workflow must have:

- workflow id
- version
- supported model
- supported input types
- supported aspect ratios
- supported duration range
- required VRAM profile
- expected output
- workflow JSON
- parameter mapping

---

# 9. Model Strategy

The system must not depend on one model.

Initial model roles:

## Wan
Primary general-purpose model.

Use cases:
- image-to-video
- text-to-video
- general cinematic generation
- standard quality jobs

## Hunyuan
Premium cinematic alternative.

Use cases:
- realism
- complex camera behavior
- premium final renders

## LTX
Fast generation model.

Use cases:
- preview generation
- rapid iteration
- fast draft renders
- workflows where audio/video capabilities become beneficial

---

# 10. Intelligent Routing Engine

The backend must route jobs using a routing policy.

Example routing inputs:

- input_type
- requested_quality
- requested_speed
- prompt_complexity
- source_asset_type
- subject_type
- requested_duration
- camera_motion
- output_resolution
- current GPU availability
- current queue load

Example:

```text
IF mode = preview
  ROUTE -> LTX

ELSE IF style = cinematic AND quality = ultra
  ROUTE -> Hunyuan

ELSE
  ROUTE -> Wan
```

Routing must be configurable, not hardcoded.

---

# 11. GPU Scheduling

The system should support one or more GPUs.

Required future abstraction:

```text
GPU Worker
  gpu_id
  vram_total
  vram_available
  currently_loaded_model
  queue_depth
  health_status
```

Scheduler must consider:

- VRAM requirement
- model load cost
- active job
- queue length
- model affinity

Do not implement unnecessary distributed complexity in MVP, but design interfaces so additional GPU workers can be added later.

---

# 12. Storage Architecture

Recommended storage model:

## Persistent object storage

Use S3-compatible storage for:

- source uploads
- generated clips
- thumbnails
- proxy media
- exports
- brand assets

Examples:
- MinIO
- Cloudflare R2
- AWS S3
- Backblaze B2

## AISERVER scratch storage

Use local high-speed SSD/NVMe for:

- temporary frame sequences
- intermediate tensors
- temporary rendered video
- temporary enhancement files

Temporary files must be cleaned automatically.

---

# 13. Media Processing

FFmpeg must handle:

- proxy generation
- preview generation
- codecs
- final encoding
- audio muxing
- thumbnail extraction
- aspect conversion
- frame rate normalization

Recommended output formats:

- MP4 / H.264
- MP4 / H.265 optional
- WebM optional

---

# 14. Quality Pipeline

Generation should support optional automatic quality refinement.

Pipeline:

```text
Generate
  ↓
Validate output
  ↓
Artifact detection
  ↓
Optional interpolation
  ↓
Optional upscale
  ↓
Optional sharpening/restoration
  ↓
Final encode
  ↓
Store
```

Potential tools:

- RIFE
- Real-ESRGAN
- SUPIR
- FFmpeg

---

# 15. Quality Scoring

Future automated scoring should evaluate:

- motion coherence
- frame stability
- prompt adherence
- face consistency
- subject preservation
- temporal artifacts
- visual sharpness

Quality scoring must be advisory, not treated as objectively perfect.

---

# 16. API Architecture

## Public Application API

Examples:

```http
POST /api/projects
GET  /api/projects/:id
POST /api/projects/:id/assets
POST /api/projects/:id/generate
GET  /api/jobs/:id
POST /api/jobs/:id/cancel
POST /api/jobs/:id/retry
GET  /api/projects/:id/versions
POST /api/projects/:id/export
```

## Internal AISERVER API

Recommended service wrapper:

```http
GET  /health
GET  /gpu
GET  /models
POST /jobs
GET  /jobs/:id
POST /jobs/:id/cancel
```

The application backend should call this wrapper rather than tightly coupling application logic directly to ComfyUI internals.

---

# 17. Security Architecture

Required:

- TLS
- authenticated internal API
- no public ComfyUI exposure
- signed upload URLs
- signed output URLs
- workspace-level authorization
- project-level authorization
- rate limits
- request size limits
- malware/file validation where appropriate
- file extension validation
- MIME validation

AISERVER internal services should be reachable only from authorized systems.

---

# 18. Observability

Track:

- GPU utilization
- VRAM utilization
- job latency
- queue latency
- render time
- model load time
- failure rate
- retries
- storage utilization
- average output size

Recommended tools:

- structured application logs
- Prometheus-compatible metrics later
- Grafana later

---

# 19. Realtime Status

Frontend should receive progress events.

Example:

```json
{
  "jobId": "job_123",
  "status": "generating",
  "progress": 42,
  "message": "Rendering motion sequence"
}
```

Do not expose raw ComfyUI node names to users.

Translate internal state into clear user-facing status messages.

---

# 20. Versioning

Every generation must create immutable history.

Users should be able to:

- compare versions
- favorite a version
- regenerate from previous settings
- duplicate settings
- change one parameter and rerun
- restore a prior selected version

---

# 21. Project Model

Recommended hierarchy:

```text
Workspace
  └── Project
      ├── Assets
      ├── Scenes
      │   └── Generation Versions
      ├── Timeline
      └── Exports
```

---

# 22. Design Principles

ClipWaltz must be:

- project-first
- creator-first
- visual
- modern
- vibrant
- responsive
- guided
- powerful without being technical

The product must not resemble a developer tool.

---

# 23. Scalability Path

Phase 1:
- single AISERVER
- single ComfyUI instance
- local inference

Phase 2:
- multi-GPU scheduling
- multiple ComfyUI workers

Phase 3:
- multiple AI worker nodes
- job routing by GPU capability

Phase 4:
- hybrid local/cloud overflow

---

# 24. Failure Handling

Jobs must fail gracefully.

Required behaviors:

- capture error
- preserve project state
- show useful status
- allow retry
- do not lose uploaded source assets
- clean incomplete temp files

---

# 25. Architecture Decision Summary

ClipWaltz is the product.

AISERVER is the compute platform.

ComfyUI is the hidden orchestration engine.

Wan, Hunyuan, and LTX are swappable generation engines.

Redis and BullMQ manage asynchronous jobs.

PostgreSQL stores product state.

Object storage stores media.

FFmpeg handles final media processing.

This architecture is intentionally modular so ClipWaltz can improve models and workflows without redesigning the user-facing product.

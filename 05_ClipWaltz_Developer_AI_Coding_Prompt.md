# ClipWaltz AI Video Engine
## Formal AI Coding Agent Build Instructions

**Role:** Senior Full-Stack AI Platform Engineer  
**Product:** ClipWaltz  
**Target AI Compute System:** AISERVER  
**Inference Engine:** ComfyUI  

---

# 1. Mission

You are responsible for designing and implementing ClipWaltz, a premium AI video creation platform.

ClipWaltz must provide a superior creator experience while using AISERVER as a hidden, self-hosted AI video generation backend.

ComfyUI is an internal orchestration engine only.

The customer must never be required to use, understand, or interact with ComfyUI.

---

# 2. Product Vision

ClipWaltz should make AI video creation feel:

- simple
- fast
- visual
- modern
- vibrant
- premium
- project-oriented
- controllable without requiring technical AI knowledge

The platform must improve on common weaknesses found in other AI video platforms by emphasizing:

- project organization
- asset management
- large multi-file uploads
- clear generation progress
- version history
- comparison
- templates
- storyboard workflow
- smart model routing
- reusable creative settings

---

# 3. Mandatory Architecture

Use the following architectural boundaries:

```text
ClipWaltz Frontend
      ↓
ClipWaltz Backend
      ↓
Queue / Orchestration
      ↓
AISERVER API
      ↓
ComfyUI
      ↓
Video Model
```

Never:

```text
Browser → ComfyUI
```

---

# 4. Preferred Application Stack

Use unless project repository requirements explicitly dictate otherwise:

## Frontend
- Next.js
- React
- TypeScript
- Tailwind CSS
- shadcn/ui or equivalent
- Framer Motion where appropriate

## Backend
- TypeScript
- Node.js
- Next.js server functions or NestJS

## Database
- PostgreSQL

## Queue
- Redis
- BullMQ

## AISERVER API
- Python
- FastAPI

## Media
- FFmpeg

---

# 5. Development Principles

1. Never expose raw ComfyUI.
2. Never hardcode one model as permanent.
3. Treat AI models as providers/workflows.
4. Separate UI controls from model parameters.
5. Persist generation metadata.
6. Make generation jobs asynchronous.
7. Preserve source assets on failure.
8. Use clear job states.
9. Make retry safe.
10. Use typed interfaces.
11. Prefer modular services.
12. Write readable code.
13. Do not create unnecessary abstraction before it is needed.
14. Preserve a clear future path to multiple GPU workers.
15. Do not silently swallow errors.

---

# 6. Required Product Entities

Implement:

- User
- Workspace
- WorkspaceMember
- Project
- Asset
- Scene
- GenerationJob
- GenerationVersion
- ExportJob
- Template
- BrandKit

---

# 7. Generation Job State Machine

Use:

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

A job may not jump directly from queued to completed without recording lifecycle timestamps.

---

# 8. Required AI Provider Interface

Create an abstraction similar to:

```ts
interface AIVideoProvider {
  healthCheck(): Promise<HealthStatus>;
  submitJob(request: GenerationRequest): Promise<JobSubmission>;
  getJob(jobId: string): Promise<GenerationJobStatus>;
  cancelJob(jobId: string): Promise<void>;
  getCapabilities(): Promise<ModelCapabilities[]>;
}
```

Implement an AISERVER provider.

---

# 9. ComfyUI Workflow Policy

Workflows must be stored outside UI code.

Use versioned workflow definitions.

Each workflow must define:
- id
- version
- model
- supported inputs
- parameter schema
- VRAM class
- output type

The frontend must never know ComfyUI node IDs.

---

# 10. Initial Model Roles

## Wan
Default standard-quality model.

## LTX
Fast-preview model.

## Hunyuan
Premium cinematic model.

The routing engine must determine which model to use.

---

# 11. Routing Logic

Create configurable routing.

Input signals:
- generation type
- quality
- speed
- duration
- aspect ratio
- style
- source assets
- GPU availability
- queue load

Routing configuration must be data-driven.

Do not bury business rules throughout controllers.

---

# 12. Required MVP User Flows

Implement:

## Flow A
Dashboard → Create Project → Prompt → Generate → Preview → Export

## Flow B
Dashboard → Create Project → Upload Image → Image-to-Video → Preview → Generate Variation

## Flow C
Project → Select Existing Version → Duplicate Settings → Modify → Regenerate

## Flow D
Project → Enhance Output → Export

---

# 13. UI Requirements

The application must use a dark-first modern interface.

Visual characteristics:
- dark surfaces
- vibrant gradient accents
- clean typography
- rounded panels
- soft depth
- minimal but polished motion
- prominent media previews

Do not create an enterprise-admin aesthetic.

This is a creative product.

---

# 14. Main Screens

Build:

1. Dashboard
2. New Project
3. Project Workspace
4. Asset Library
5. Version Browser
6. Compare View
7. Template Browser
8. Export Center
9. Settings

---

# 15. Project Workspace

Use three primary regions:

```text
Assets | Preview | Creation Controls
```

Add storyboard/timeline beneath.

The preview must be the visual focus.

---

# 16. Creation Controls

Default visible controls:

- Prompt
- Style
- Camera
- Motion
- Duration
- Aspect Ratio
- Quality
- Generate

Advanced controls must be collapsed.

---

# 17. User Language

Use creator-friendly language.

Do not expose words such as:
- latent
- scheduler
- sampler
- denoise
- checkpoint

except in explicitly enabled Advanced Mode.

---

# 18. Upload Requirements

Support:
- multi-file drag/drop
- concurrent upload
- individual progress
- independent retry
- image preview
- video thumbnail
- video duration

Do not artificially limit the UI to a handful of assets.

Server-side quotas may still exist.

---

# 19. Job Progress UX

Convert technical processing into user-facing states.

Example:

```text
Preparing your scene
Loading generation engine
Building motion
Rendering
Improving detail
Encoding video
```

---

# 20. Versioning Requirements

Every successful generation becomes a version.

User must be able to:
- view
- compare
- favorite
- duplicate
- modify
- regenerate
- enhance
- export

---

# 21. Error Handling

Errors must preserve the user's work.

If generation fails:
- retain prompt
- retain assets
- retain generation settings
- record technical error
- show friendly message
- expose retry

Do not show stack traces to end users.

---

# 22. Backend API

Minimum endpoints:

```http
POST /api/projects
GET /api/projects/:id
POST /api/projects/:id/assets
POST /api/projects/:id/generate
GET /api/jobs/:id
POST /api/jobs/:id/retry
POST /api/jobs/:id/cancel
GET /api/projects/:id/versions
POST /api/projects/:id/export
```

---

# 23. AISERVER API

Implement:

```http
GET /health
GET /gpu
GET /models
POST /jobs
GET /jobs/{id}
POST /jobs/{id}/cancel
```

AISERVER API must authenticate backend requests.

---

# 24. Security

Implement:
- authentication
- authorization
- workspace ownership validation
- project ownership validation
- signed media access
- input validation
- rate limiting where appropriate

ComfyUI must not be exposed publicly.

---

# 25. Logging

Every job must correlate:

```text
ClipWaltz job ID
AISERVER job ID
ComfyUI prompt/workflow ID
```

Log:
- submission
- start
- finish
- failure
- retry
- model
- workflow version

---

# 26. Testing Requirements

Add tests for:

- project creation
- asset upload
- job creation
- routing
- AISERVER failures
- job retry
- version creation
- export creation
- authorization

Add integration tests for the AISERVER provider using a mock service.

---

# 27. Coding Behavior

When making changes:

1. Inspect the existing repository first.
2. Do not assume architecture that has not been verified.
3. Reuse existing conventions where sensible.
4. Avoid rewriting unrelated code.
5. Keep changes scoped.
6. Update documentation.
7. Run tests.
8. Report what changed.
9. Report anything not completed.
10. Do not claim successful validation without actual test output.

---

# 28. Build Order

Implement in this sequence:

## Stage 1
Application skeleton and database.

## Stage 2
Projects and assets.

## Stage 3
Queue and GenerationJob.

## Stage 4
AISERVER provider.

## Stage 5
One working Wan workflow.

## Stage 6
Project workspace UI.

## Stage 7
Generation progress.

## Stage 8
Version history.

## Stage 9
Enhancement.

## Stage 10
Exports.

## Stage 11
LTX preview routing.

## Stage 12
Hunyuan premium routing.

## Stage 13
Templates and storyboard improvements.

---

# 29. Definition of Done

A feature is not complete until:

- code exists
- type checking passes
- tests pass where applicable
- error handling exists
- UI state exists
- API behavior is documented
- no raw ComfyUI UI is exposed
- functionality was validated

---

# 30. Final Product Standard

ClipWaltz must feel like a finished creative application, not a collection of AI demos.

Users should understand:

- what they are creating
- what is happening
- where their media lives
- how to create another version
- how to improve the result
- how to export

The model and workflow complexity should remain invisible unless the user intentionally enters Advanced Mode.

# ClipWaltz AI Video Engine
## Exact MVP Feature Backlog

**Version:** 1.0  
**Product:** ClipWaltz  
**Scope:** MVP  
**Inference Platform:** AISERVER + ComfyUI  

---

# 1. MVP Objective

The MVP must prove that ClipWaltz can provide a polished end-to-end AI video generation workflow using AISERVER without exposing ComfyUI to the customer.

The MVP is complete when a user can:

1. Sign in.
2. Create a project.
3. Upload media.
4. Generate video from text or image.
5. Track generation status.
6. View outputs.
7. compare versions.
8. enhance outputs.
9. export a final clip.
10. return later and continue working.

---

# 2. Backlog Priority Levels

- **P0** — Required for MVP launch
- **P1** — Strong MVP enhancement
- **P2** — Post-MVP

---

# 3. Epic: User Authentication

## CW-MVP-001 — User Sign-In
**Priority:** P0

### Description
Allow users to authenticate securely.

### Acceptance Criteria
- User can sign in.
- User can sign out.
- Session persists securely.
- Unauthorized users cannot access projects.

---

# 4. Epic: Workspace and Project Management

## CW-MVP-010 — Create Project
**Priority:** P0

### Description
Allow users to create a named ClipWaltz project.

### Acceptance Criteria
- Project name required.
- Optional description supported.
- Project stored in database.
- User is redirected to project workspace.

## CW-MVP-011 — Project Dashboard
**Priority:** P0

### Acceptance Criteria
- Recent projects appear.
- Project thumbnail visible when available.
- Last modified date shown.
- Open project action available.

## CW-MVP-012 — Rename Project
**Priority:** P0

## CW-MVP-013 — Delete Project
**Priority:** P0

### Acceptance Criteria
Deletion requires confirmation.

---

# 5. Epic: Asset Management

## CW-MVP-020 — Multi-File Upload
**Priority:** P0

### Description
Allow users to upload multiple images and videos in one action.

### Acceptance Criteria
- Drag and drop supported.
- File selector supported.
- Upload progress visible per file.
- Multiple files upload concurrently.
- Failed files can retry independently.

## CW-MVP-021 — Asset Library
**Priority:** P0

### Acceptance Criteria
- Images and video show thumbnails.
- File type indicated.
- Video duration shown.
- Assets can be selected for generation.

## CW-MVP-022 — Asset Preview
**Priority:** P0

## CW-MVP-023 — Delete Asset
**Priority:** P0

## CW-MVP-024 — Asset Tags
**Priority:** P1

---

# 6. Epic: Text-to-Video Generation

## CW-MVP-030 — Prompt Input
**Priority:** P0

### Acceptance Criteria
- User can enter free-form video prompt.
- Character limit displayed.
- Prompt persists with generation job.

## CW-MVP-031 — Generate Text-to-Video
**Priority:** P0

### Acceptance Criteria
- User can generate from prompt only.
- Backend selects correct workflow.
- Job enters generation queue.
- Output becomes available in project.

---

# 7. Epic: Image-to-Video Generation

## CW-MVP-040 — Select Source Image
**Priority:** P0

## CW-MVP-041 — Generate Image-to-Video
**Priority:** P0

### Acceptance Criteria
- One project image can be selected.
- Prompt can optionally describe movement.
- Backend routes to compatible workflow.
- Result preserves source identity as reasonably as model permits.

---

# 8. Epic: Generation Controls

## CW-MVP-050 — Aspect Ratio
**Priority:** P0

Options:
- 16:9
- 9:16
- 1:1

## CW-MVP-051 — Duration
**Priority:** P0

Initial options should reflect validated model capabilities.

## CW-MVP-052 — Quality Mode
**Priority:** P0

Options:
- Preview
- Standard
- High

## CW-MVP-053 — Motion Intensity
**Priority:** P1

Options:
- Subtle
- Balanced
- Dynamic

## CW-MVP-054 — Style Presets
**Priority:** P1

Initial presets:
- Cinematic
- Commercial
- Documentary
- Social
- Action
- Dreamlike

---

# 9. Epic: Camera Controls

## CW-MVP-060 — Camera Motion Presets
**Priority:** P1

Options:
- Static
- Slow Push
- Pull Back
- Orbit
- Pan
- Tracking
- Handheld
- Drone-like

The UI must map presets to internal prompt/workflow parameters.

---

# 10. Epic: Model Routing

## CW-MVP-070 — Routing Engine
**Priority:** P0

### Description
Select the most appropriate model/workflow.

### Acceptance Criteria
- Preview requests can route to fast workflow.
- Standard requests route to primary model.
- Routing configuration is editable without frontend code changes.

## CW-MVP-071 — Model Metadata Registry
**Priority:** P0

Store:
- model name
- model version
- workflow compatibility
- VRAM class
- enabled state

---

# 11. Epic: AISERVER Integration

## CW-MVP-080 — AISERVER Health Check
**Priority:** P0

## CW-MVP-081 — Submit Generation Job
**Priority:** P0

## CW-MVP-082 — Poll / Receive Job Status
**Priority:** P0

## CW-MVP-083 — Retrieve Completed Output
**Priority:** P0

## CW-MVP-084 — Cancel Job
**Priority:** P1

---

# 12. Epic: Job Queue

## CW-MVP-090 — Redis Queue
**Priority:** P0

## CW-MVP-091 — Queue Status
**Priority:** P0

States:
- queued
- preparing
- generating
- enhancing
- encoding
- completed
- failed

## CW-MVP-092 — Retry Failed Job
**Priority:** P0

## CW-MVP-093 — Priority Queue
**Priority:** P2

---

# 13. Epic: Generation Progress

## CW-MVP-100 — Realtime Job Progress
**Priority:** P0

### Acceptance Criteria
- UI updates without page refresh.
- Friendly stage names shown.
- Failed state clearly visible.
- User sees retry option.

## CW-MVP-101 — Queue Position
**Priority:** P1

---

# 14. Epic: Output Viewer

## CW-MVP-110 — Video Preview Player
**Priority:** P0

## CW-MVP-111 — Fullscreen Preview
**Priority:** P0

## CW-MVP-112 — Output Metadata
**Priority:** P1

Show:
- date
- duration
- resolution
- generation mode
- style

Do not overwhelm the user with raw model parameters.

---

# 15. Epic: Versioning

## CW-MVP-120 — Generation Versions
**Priority:** P0

## CW-MVP-121 — Duplicate and Modify
**Priority:** P0

## CW-MVP-122 — Select Preferred Version
**Priority:** P0

## CW-MVP-123 — Side-by-Side Compare
**Priority:** P1

---

# 16. Epic: Enhancement Pipeline

## CW-MVP-130 — Upscale
**Priority:** P0

## CW-MVP-131 — Frame Interpolation
**Priority:** P1

## CW-MVP-132 — Enhancement Preset
**Priority:** P1

Presets:
- Clean
- Smooth
- Sharp
- Max Quality

---

# 17. Epic: Export

## CW-MVP-140 — Export MP4
**Priority:** P0

## CW-MVP-141 — Export Resolution Selection
**Priority:** P0

## CW-MVP-142 — Export History
**Priority:** P1

---

# 18. Epic: Templates

## CW-MVP-150 — Template Browser
**Priority:** P1

Initial categories:
- Product Promo
- Social Reel
- Story
- Event Recap
- Travel
- Cinematic Intro

## CW-MVP-151 — Start Project from Template
**Priority:** P1

---

# 19. Epic: Storyboard

## CW-MVP-160 — Basic Scene List
**Priority:** P1

## CW-MVP-161 — Reorder Scenes
**Priority:** P1

## CW-MVP-162 — Scene Duration
**Priority:** P1

A full nonlinear editor is not required for MVP.

---

# 20. Epic: UX Differentiators

## CW-MVP-170 — Quick Create
**Priority:** P0

Single prominent create path.

## CW-MVP-171 — Smart Recommendations
**Priority:** P1

Suggest:
- aspect ratio
- style
- motion preset

## CW-MVP-172 — Recent Settings
**Priority:** P1

## CW-MVP-173 — Favorite Presets
**Priority:** P2

---

# 21. Epic: Error Handling

## CW-MVP-180 — User-Friendly Failure Message
**Priority:** P0

## CW-MVP-181 — Retry
**Priority:** P0

## CW-MVP-182 — Preserve Prompt on Failure
**Priority:** P0

## CW-MVP-183 — Preserve Source Assets
**Priority:** P0

---

# 22. Epic: Administration

## CW-MVP-190 — Model Enable/Disable
**Priority:** P0

## CW-MVP-191 — Workflow Enable/Disable
**Priority:** P0

## CW-MVP-192 — Queue Monitoring
**Priority:** P1

## CW-MVP-193 — Basic Usage Metrics
**Priority:** P1

---

# 23. MVP Release Gate

The MVP must not be considered complete until all P0 items pass validation.

Critical release tests:

- Authentication
- Project persistence
- Multi-file upload
- Text-to-video
- Image-to-video
- AISERVER communication
- Queue processing
- Generation status
- Retry
- Video preview
- Version history
- Upscaling
- MP4 export
- Failure recovery

---

# 24. Explicitly Out of Scope for Initial MVP

- mobile native apps
- full Premiere-style editor
- complex collaboration
- public template marketplace
- third-party publishing integrations
- cloud overflow inference
- real-time multi-user editing
- external model marketplace
- advanced billing
- voice cloning
- enterprise SSO

These may be added after core workflow validation.

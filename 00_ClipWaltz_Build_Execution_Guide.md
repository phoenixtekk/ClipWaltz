# ClipWaltz Build Execution Guide for Claude

## Purpose

This document is the **master build instruction** for implementing the ClipWaltz platform using the approved design, architecture, backlog, UI/UX, AISERVER/ComfyUI implementation plan, and AI coding instructions.

Claude must use this file as the **entry point and execution guide** for the build.

The supporting documents listed below are not optional reference material. They collectively define the intended product, technical architecture, development scope, UI/UX direction, AI video infrastructure, and implementation rules for ClipWaltz.

The goal is to build **ClipWaltz as a modern, vibrant, premium AI video creation platform** with a self-hosted AI generation engine running on **AISERVER**, while keeping **ComfyUI completely hidden from end users**.

---

# 1. Required Source Documents

Claude must read and use all of the following files before beginning implementation:

1. `01_ClipWaltz_Technical_Architecture.md`
2. `02_ClipWaltz_MVP_Feature_Backlog.md`
3. `03_ClipWaltz_UI_UX_Screen_Spec.md`
4. `04_ClipWaltz_Phase1_AISERVER_ComfyUI_Implementation.md`
5. `05_ClipWaltz_Developer_AI_Coding_Prompt.md`
6. `ClipWaltz AI Video Engine.md`

These files together define the approved ClipWaltz build.

Claude must **not treat any one file in isolation**.

---

# 2. Document Authority and Precedence

Use the following precedence order when interpreting requirements:

## Priority 1 — This File
`00_ClipWaltz_Build_Execution_Guide.md`

This file controls:
- how the supporting files are used;
- implementation order;
- validation rules;
- conflict resolution;
- development discipline;
- build completion requirements.

## Priority 2 — Developer Coding Instructions
`05_ClipWaltz_Developer_AI_Coding_Prompt.md`

This controls:
- coding behavior;
- implementation rules;
- architecture discipline;
- development workflow;
- code quality;
- AI developer responsibilities.

## Priority 3 — Technical Architecture
`01_ClipWaltz_Technical_Architecture.md`

This controls:
- system architecture;
- service boundaries;
- APIs;
- data architecture;
- queues;
- storage;
- security boundaries;
- backend and frontend responsibilities;
- AISERVER integration architecture.

## Priority 4 — MVP Backlog
`02_ClipWaltz_MVP_Feature_Backlog.md`

This controls:
- what is in scope;
- feature requirements;
- backlog order;
- acceptance requirements;
- MVP completion criteria.

## Priority 5 — UI/UX Specification
`03_ClipWaltz_UI_UX_Screen_Spec.md`

This controls:
- screen behavior;
- page layout;
- visual hierarchy;
- UX flows;
- interaction patterns;
- user-facing terminology;
- modern/vibrant design requirements.

## Priority 6 — AISERVER + ComfyUI Implementation
`04_ClipWaltz_Phase1_AISERVER_ComfyUI_Implementation.md`

This controls:
- AISERVER preparation;
- ComfyUI deployment;
- AI model integration;
- workflow execution;
- inference API behavior;
- video-generation infrastructure.

## Priority 7 — Product Vision
`ClipWaltz AI Video Engine.md`

This controls:
- product intent;
- competitive direction;
- user experience goals;
- AI-generation strategy;
- ClipWaltz differentiation.

---

# 3. Conflict Resolution Rule

If two documents appear to conflict:

1. Do **not guess**.
2. Determine whether the conflict can be resolved using the precedence order above.
3. If the higher-priority document clearly resolves the conflict, follow it.
4. If the conflict is architectural, security-sensitive, infrastructure-sensitive, or could cause rework, **stop and present the conflict before implementation**.
5. Do not silently change an approved requirement.
6. Do not replace an approved technology merely because another library or framework is easier.

---

# 4. Core Product Objective

Build ClipWaltz as a premium AI-assisted video creation platform that converts uploaded photos, videos, prompts, and creative intent into professionally generated video content.

The intended user experience is:

```text
User
  ↓
ClipWaltz UI
  ↓
Project / Scene / Asset Workflow
  ↓
Generation Request
  ↓
ClipWaltz Backend
  ↓
Job Queue / Orchestration
  ↓
AISERVER
  ↓
ComfyUI
  ↓
Wan / LTX / Hunyuan / Enhancement Pipelines
  ↓
Generated Video
  ↓
Preview / Compare / Enhance
  ↓
Final Export
```

The user must never need to understand or interact with:
- ComfyUI nodes;
- model checkpoints;
- samplers;
- schedulers;
- latent video;
- workflow JSON;
- inference internals;
- GPU execution details.

ClipWaltz must translate technical AI-generation complexity into a simple creator-focused experience.

---

# 5. Non-Negotiable Product Rules

The following rules apply throughout the build.

## 5.1 ClipWaltz Is the Product

ComfyUI is an internal inference engine.

Do not expose:
- the ComfyUI interface;
- raw ComfyUI workflow JSON;
- node graphs;
- internal file paths;
- model-loading details;
- backend inference controls intended only for administrators.

---

## 5.2 AISERVER Is the AI Inference Server

All heavy AI video-generation workloads defined by the architecture must run on **AISERVER**.

Do not redirect those workloads to another machine unless explicitly approved.

AISERVER is intended to host:
- ComfyUI;
- supported video models;
- model files;
- AI enhancement workflows;
- video interpolation;
- video upscaling;
- inference workers.

---

## 5.3 Multi-Model Architecture

Do not design the application around one AI model.

The architecture must support a model-provider abstraction capable of routing work to different models and workflows.

Initial model families include:

- Wan
- LTX
- Hunyuan

The system must allow additional models to be introduced later without redesigning the user-facing application.

---

## 5.4 Modern and Vibrant UI

The UI must not look like:
- an administrative dashboard;
- a generic Bootstrap application;
- a traditional enterprise portal;
- ComfyUI;
- a developer tool.

The intended design language is:
- modern;
- premium;
- vibrant;
- cinematic;
- creator-oriented;
- visually polished;
- responsive;
- motion-aware;
- uncluttered.

Use the UI/UX specification as the authoritative source for screen-level implementation.

---

# 6. Product Experience Principle

The application should emphasize:

> **Outcome first. Technology second.**

Users should think in concepts such as:
- cinematic;
- energetic;
- dramatic;
- commercial;
- travel;
- celebration;
- product promo;
- camera movement;
- pacing;
- story;
- duration;
- quality.

They should not have to think in concepts such as:
- CFG;
- VAE;
- checkpoint;
- sampler;
- scheduler;
- inference steps;
- node connections.

Advanced technical settings may eventually exist in a controlled advanced experience, but they are not the primary interface.

---

# 7. Build Strategy

Claude must build ClipWaltz incrementally.

Do not attempt to build the entire application as one monolithic implementation.

Use the following sequence.

---

# 8. Stage 0 — Repository and Existing-Code Inspection

Before modifying code:

1. Inspect the repository structure.
2. Identify:
   - framework;
   - package manager;
   - application entry points;
   - existing authentication;
   - database layer;
   - storage implementation;
   - existing API routes;
   - current UI components;
   - styling system;
   - environment configuration.
3. Determine which capabilities already exist.
4. Do not duplicate functionality that is already correctly implemented.
5. Compare the existing implementation against the six design documents.
6. Create an implementation-gap list before making large changes.

Do not assume the repository is empty.

---

# 9. Stage 1 — Architecture Foundation

Use:

`01_ClipWaltz_Technical_Architecture.md`

Implement or validate the architectural foundation first.

This includes, as applicable:

- frontend application;
- backend API;
- PostgreSQL;
- authentication;
- object storage;
- Redis;
- job queue;
- asynchronous processing;
- realtime job-status updates;
- project model;
- asset model;
- generation-job model;
- generation-version model;
- export model;
- AISERVER communication layer.

Do not build major visual features before the data and service boundaries required to support them are established.

---

# 10. Stage 2 — AISERVER AI Infrastructure

Use:

`04_ClipWaltz_Phase1_AISERVER_ComfyUI_Implementation.md`

Before installing or modifying AISERVER:

1. Validate the actual server environment.
2. Record:
   - operating system;
   - GPU model(s);
   - GPU count;
   - VRAM per GPU;
   - NVIDIA driver;
   - CUDA compatibility;
   - Python version;
   - FFmpeg availability;
   - Git availability;
   - available RAM;
   - available disk space;
   - network reachability from the ClipWaltz backend.

Do not assume these values.

Then deploy the approved ComfyUI architecture.

AISERVER integration must be tested independently before wiring it into the full ClipWaltz UI.

At minimum verify:

```text
ClipWaltz Backend
      ↓
AISERVER API
      ↓
ComfyUI
      ↓
Workflow Execution
      ↓
Generated Artifact
      ↓
Returned Job Result
```

---

# 11. Stage 3 — AI Workflow Abstraction

Create a ClipWaltz abstraction layer between the application and ComfyUI.

The application should call something conceptually similar to:

```text
GenerationService.generate()
```

not:

```text
ComfyUIWorkflowNode123.execute()
```

The abstraction must support:

- model selection;
- workflow selection;
- user intent;
- prompt;
- source media;
- aspect ratio;
- duration;
- quality;
- camera style;
- motion level;
- retry;
- cancellation;
- enhancement;
- interpolation;
- upscaling.

Implementation details belong behind the abstraction.

---

# 12. Stage 4 — MVP Feature Development

Use:

`02_ClipWaltz_MVP_Feature_Backlog.md`

Build backlog items in dependency order.

Each backlog item must pass its acceptance criteria before being marked complete.

Do not implement later-phase features simply because they are technically interesting.

The MVP exists to prove the core ClipWaltz creation experience.

---

# 13. Stage 5 — UI/UX Implementation

Use:

`03_ClipWaltz_UI_UX_Screen_Spec.md`

Implement every approved MVP screen according to the screen specification.

Important:

- preserve navigation consistency;
- preserve terminology;
- preserve information hierarchy;
- preserve creator workflow;
- preserve responsive design behavior;
- use reusable UI components;
- avoid duplicated screen-specific component implementations when a shared component is appropriate.

The experience should feel like one coherent product.

---

# 14. Stage 6 — Generation Experience

Generation must be asynchronous.

Do not force the browser to wait synchronously for GPU processing.

Expected behavior:

```text
User clicks Generate
       ↓
Generation job created
       ↓
Job enters queue
       ↓
UI immediately receives job ID
       ↓
AISERVER processes request
       ↓
UI receives progress/status updates
       ↓
Preview becomes available
       ↓
User may compare, regenerate, enhance, or export
```

Supported status states should be explicit and machine-readable.

Example:

```text
queued
preparing
uploading
processing
enhancing
encoding
completed
failed
cancelled
```

Use the architecture document if it specifies a different canonical status model.

---

# 15. Stage 7 — Project and Asset Experience

ClipWaltz should operate around projects rather than disconnected generations.

A project should logically contain:

```text
Project
 ├── Assets
 ├── Scenes
 ├── Generation Jobs
 ├── Versions
 ├── Prompts
 ├── Settings
 └── Exports
```

Uploaded media must remain reusable within the project.

Do not require the user to upload the same source file again simply to regenerate a version.

---

# 16. Stage 8 — Versioning

Every meaningful generation should be preserved as a version.

Users should be able to:

- view previous versions;
- compare outputs;
- identify the settings used;
- duplicate a version;
- modify settings;
- regenerate from an earlier version;
- select a preferred version.

Do not overwrite previous generated results without an explicit retention rule.

---

# 17. Stage 9 — Enhancement Pipeline

Implement enhancement as a modular pipeline.

Conceptual sequence:

```text
Generation
    ↓
Validation
    ↓
Optional Interpolation
    ↓
Optional Upscaling
    ↓
Optional Cleanup
    ↓
Encoding
    ↓
Preview
    ↓
Final Export
```

Enhancement steps must be independently replaceable.

Do not tightly couple an enhancement technology to the main application.

---

# 18. Stage 10 — Export Pipeline

Exports must be treated as jobs.

An export should record:

- project;
- source generation/version;
- resolution;
- aspect ratio;
- output format;
- quality preset;
- status;
- output asset;
- created time;
- completion time;
- failure reason when applicable.

Export history must remain visible in the application.

---

# 19. Higgsfield Competitive Design Requirement

ClipWaltz should use Higgsfield as a competitive reference, not as a screen-for-screen clone.

The product must aim to improve areas including:

- project organization;
- bulk upload handling;
- generation transparency;
- version comparison;
- asset reuse;
- creator workflow;
- template-driven creation;
- AI-assisted workflow selection;
- model abstraction;
- timeline/storyboard integration;
- predictable job status;
- reusable presets;
- output management.

Do not reproduce proprietary branding, visual identity, or copyrighted UI assets.

Build the ClipWaltz experience around its own identity.

---

# 20. UI Design Rules

Every new screen must comply with the UI/UX specification.

General rules:

- dark-first visual design;
- strong visual hierarchy;
- premium typography;
- purposeful gradients;
- restrained glow effects;
- polished cards;
- high-quality thumbnails;
- clear active states;
- useful hover states;
- smooth transitions;
- responsive layout;
- large media previews;
- obvious primary action;
- minimal technical terminology.

Avoid visual clutter.

---

# 21. Mobile and Desktop UX

ClipWaltz must be designed for both:

- desktop/laptop creation;
- mobile creator workflows.

Desktop should optimize:
- project organization;
- large previews;
- timeline/storyboard;
- detailed comparison;
- asset management.

Mobile should optimize:
- upload;
- capture selection;
- simple generation;
- preview;
- status;
- sharing;
- quick modifications.

Do not force desktop layouts into small-screen responsive containers without rethinking the interaction.

---

# 22. Upload Architecture

Uploads are a critical product capability.

The architecture should support:

- multiple simultaneous files;
- photos;
- video;
- resumable uploads;
- upload progress;
- retry;
- failed-file recovery;
- large media;
- background operation where supported;
- direct object-storage upload where specified by architecture;
- metadata extraction;
- preview/proxy generation.

Do not route large media binaries through application endpoints unnecessarily if the approved architecture uses direct object-storage uploads.

---

# 23. AI Routing Engine

Create the AI routing layer as an extensible service.

It should eventually evaluate inputs such as:

- input media type;
- prompt;
- content type;
- duration;
- aspect ratio;
- desired quality;
- motion requirements;
- realism requirements;
- speed preference;
- GPU availability;
- queue conditions.

The routing service returns an internal generation strategy.

Example:

```json
{
  "provider": "wan",
  "workflow": "image_to_video_cinematic_v1",
  "qualityPreset": "high",
  "enhancement": {
    "interpolation": true,
    "upscale": true
  }
}
```

The exact schema must follow the technical architecture if already defined there.

---

# 24. Workflow Registry

Do not scatter ComfyUI workflow files throughout the application.

Create a workflow registry.

Each workflow should have metadata such as:

```text
workflow ID
workflow version
model family
supported input types
supported aspect ratios
supported quality modes
required VRAM
workflow file
enabled state
description
```

Workflow versioning is required so future workflow changes do not destroy reproducibility of previous generations.

---

# 25. Error Handling

User-facing errors must be understandable.

Never show raw backend exceptions to the user.

Bad:

```text
CUDA error: CUBLAS_STATUS_ALLOC_FAILED
```

Better:

```text
This render could not be completed because the generation server ran out of available GPU memory.

Your project and settings were preserved.

[Try Again]
[Use Standard Quality]
```

Technical details should still be logged for administrators.

---

# 26. Observability

Add structured logging for:

- API requests;
- generation jobs;
- ComfyUI requests;
- workflow IDs;
- model IDs;
- GPU worker;
- generation duration;
- queue wait time;
- upload duration;
- enhancement duration;
- encoding duration;
- failures.

Use correlation/job IDs so an entire generation can be traced across services.

---

# 27. Cost and Performance Metrics

Even though AISERVER is self-hosted, ClipWaltz should collect operational metrics.

Track:

- GPU-seconds per generation;
- total render duration;
- queue duration;
- storage consumed;
- output size;
- resolution;
- model used;
- workflow used;
- retry count;
- success/failure rate.

These metrics will later support:
- pricing;
- subscription limits;
- capacity planning;
- GPU expansion;
- cost-per-generation analysis.

---

# 28. Security Rules

At minimum:

- AISERVER should not expose ComfyUI directly to the public internet unless the architecture explicitly requires and secures it.
- Prefer private/internal API access.
- Authenticate backend-to-AISERVER requests.
- Validate uploaded media.
- Enforce file-size limits.
- Enforce supported MIME types.
- Use signed access where appropriate.
- Never expose internal filesystem paths.
- Never expose environment secrets to the client.
- Keep model administration separate from user-facing routes.

---

# 29. Database Migration Rules

All schema changes must use migrations.

Do not manually mutate production schemas.

Each schema change should include:

- migration;
- updated model/schema definition;
- validation;
- indexes where required;
- relationships;
- rollback consideration where supported.

---

# 30. API Development Rules

APIs must:

- use explicit request schemas;
- validate inputs;
- return consistent errors;
- return stable IDs;
- use authorization checks;
- not leak infrastructure internals;
- support idempotency for operations where duplicate submission would cause duplicate jobs;
- separate public APIs from internal inference APIs.

---

# 31. Coding Standards

Claude must:

- reuse components;
- keep files focused;
- avoid giant components;
- avoid giant service classes;
- avoid hard-coded secrets;
- avoid magic strings where enumerations/constants are appropriate;
- avoid duplicated logic;
- preserve strict typing where the project language supports it;
- document unusual decisions;
- keep environment-dependent values configurable;
- write maintainable production-quality code.

---

# 32. Change Discipline

Before changing an existing major component:

1. Inspect how it is currently used.
2. Identify dependencies.
3. Determine whether the change is backward-compatible.
4. Avoid breaking unrelated functionality.
5. Preserve working functionality unless the design explicitly replaces it.
6. Validate after modification.

Do not perform broad rewrites merely because code can be written differently.

---

# 33. Full-File Rule for Code Changes

When providing or creating a replacement script, configuration file, or substantial source file during guided implementation:

- produce the complete resulting file;
- do not provide fragment-only patches when the full file is required for safe implementation;
- keep the complete file internally consistent.

For repository edits performed directly, apply the actual complete change and show the relevant summary afterward.

---

# 34. No-Assumption Rule

Do not assume:

- ports;
- hostnames;
- credentials;
- service states;
- GPU models;
- model paths;
- application paths;
- DNS configuration;
- container names;
- database credentials;
- storage buckets;
- network connectivity;
- operating systems.

If the required information cannot be obtained from the repository, environment, supplied files, or command output, stop and request the missing information.

---

# 35. Validation Rule

Every major implementation step must be validated before proceeding.

Examples:

## AISERVER
Validate:
- GPU visible;
- driver loaded;
- ComfyUI starts;
- API reachable;
- workflow executes;
- output produced.

## Backend
Validate:
- database connection;
- Redis connection;
- queue execution;
- object storage;
- AISERVER request;
- job state update.

## Frontend
Validate:
- project creation;
- upload;
- generation submission;
- job status;
- preview;
- version display;
- export.

Do not label a feature complete because the code merely compiles.

---

# 36. Definition of Done for an MVP Feature

A feature is complete only when:

1. UI exists where applicable.
2. Backend exists where applicable.
3. Database support exists where applicable.
4. Authorization is enforced.
5. Validation exists.
6. Error handling exists.
7. Loading/processing states exist.
8. Empty states exist.
9. Feature has been functionally tested.
10. Acceptance criteria from the backlog pass.
11. Existing functionality remains operational.
12. Relevant documentation is updated.

---

# 37. Build Progress Tracking

Maintain a build status file in the repository.

Recommended filename:

`CLIPWALTZ_BUILD_STATUS.md`

Update it throughout development.

Suggested format:

```markdown
# ClipWaltz Build Status

## Current Phase
Phase 2 — Backend Foundation

## Completed
- [x] Project schema
- [x] Asset schema
- [x] Redis connection
- [x] BullMQ queue

## In Progress
- [ ] Generation job service

## Blocked
- [ ] AISERVER connection — awaiting network validation

## Next
1. Validate AISERVER API
2. Implement generation service
3. Add realtime job updates
```

Do not mark untested work as complete.

---

# 38. Architecture Decision Log

Maintain:

`docs/architecture/DECISIONS.md`

Record meaningful decisions such as:

- storage provider;
- queue architecture;
- auth implementation;
- workflow registry design;
- AI routing design;
- realtime transport;
- model deployment method.

Each decision should include:

```text
Date
Decision
Reason
Alternatives considered
Impact
```

This prevents architectural drift during AI-assisted development.

---

# 39. Development Session Behavior

At the beginning of each development session:

1. Read this guide.
2. Read `CLIPWALTZ_BUILD_STATUS.md`.
3. Review the relevant design document for the current work.
4. Inspect the current implementation.
5. State the exact work item being implemented.
6. Implement only the required scope.
7. Validate the change.
8. Update build status.
9. Summarize what changed.
10. Identify the next logical work item.

---

# 40. Prohibited Development Behavior

Claude must not:

- redesign ClipWaltz without approval;
- replace the approved architecture casually;
- expose ComfyUI to customers;
- hard-code ClipWaltz to a single AI model;
- invent infrastructure details;
- silently skip backlog acceptance criteria;
- claim something works without testing;
- remove working functionality without reason;
- introduce unnecessary dependencies;
- build features outside MVP solely because they are attractive;
- bypass the job queue for long-running generation;
- store large video binaries directly in PostgreSQL;
- expose secrets in frontend code;
- expose raw AI infrastructure errors to end users.

---

# 41. Recommended Repository Documentation Structure

Use or adapt the following:

```text
/docs
  /architecture
    DECISIONS.md
    AI_ROUTING.md
    AISERVER_INTEGRATION.md

  /workflows
    WORKFLOW_REGISTRY.md

  /development
    LOCAL_SETUP.md
    TESTING.md

  /product
    01_ClipWaltz_Technical_Architecture.md
    02_ClipWaltz_MVP_Feature_Backlog.md
    03_ClipWaltz_UI_UX_Screen_Spec.md
    04_ClipWaltz_Phase1_AISERVER_ComfyUI_Implementation.md
    05_ClipWaltz_Developer_AI_Coding_Prompt.md
    ClipWaltz AI Video Engine.md

CLIPWALTZ_BUILD_STATUS.md
00_ClipWaltz_Build_Execution_Guide.md
```

Do not move files unnecessarily if the existing repository already has a sensible documentation structure.

---

# 42. Immediate Claude Startup Instruction

When Claude receives this document and the six supporting files, the first action should be:

> **Do not begin coding immediately. First read all seven ClipWaltz design/build documents, inspect the existing repository, compare the current implementation against the approved design, identify what already exists, identify what is missing, and produce a build-gap report and proposed implementation sequence. Do not invent missing infrastructure information. After the gap review, begin with the earliest uncompleted dependency in the approved build sequence.**

---

# 43. Initial Build-Gap Report

Before implementation begins, produce:

## Existing
Features/components already implemented.

## Partial
Features that exist but do not meet the specification.

## Missing
Required components not yet built.

## Conflicts
Existing implementation that conflicts with the approved architecture.

## Infrastructure Unknowns
Information that must be validated before proceeding.

## Recommended Build Order
A dependency-aware implementation sequence.

---

# 44. First Technical Priority

If no equivalent capability already exists, prioritize this end-to-end vertical slice:

```text
Create Project
      ↓
Upload One Image
      ↓
Create Generation Job
      ↓
Queue Job
      ↓
Send Job to AISERVER
      ↓
Execute ComfyUI Workflow
      ↓
Receive Generated Video
      ↓
Store Result
      ↓
Update Job Status
      ↓
Display Video in ClipWaltz
```

This proves the most important system integration before implementing broad feature depth.

---

# 45. Second Technical Priority

After the first vertical slice is validated:

```text
Multi-file Upload
      ↓
Asset Library
      ↓
Image-to-Video Controls
      ↓
Generation Versions
      ↓
Compare
      ↓
Enhance
      ↓
Export
```

---

# 46. Third Technical Priority

After the core generation experience is stable:

- templates;
- smarter routing;
- storyboard/timeline;
- reusable styles;
- expanded model workflows;
- scene consistency;
- automatic enhancement;
- additional aspect ratios;
- creator productivity improvements.

Follow the MVP backlog for exact scope boundaries.

---

# 47. Target End State

The MVP should ultimately feel like:

```text
OPEN CLIPWALTZ
       ↓
Create Project
       ↓
Drop Photos / Videos
       ↓
Choose What You Want
       ↓
Describe the Result
       ↓
ClipWaltz Chooses the AI Workflow
       ↓
Generate
       ↓
Preview
       ↓
Compare Versions
       ↓
Make Changes
       ↓
Enhance
       ↓
Export
```

The complexity beneath that experience may include:

```text
Next.js
PostgreSQL
Object Storage
Redis
BullMQ
AISERVER
ComfyUI
Wan
LTX
Hunyuan
RIFE
Upscaling
FFmpeg
GPU Workers
Workflow Registry
Routing Engine
```

The customer should not have to know any of that exists.

---

# 48. Product Standard

The completed experience should meet this standard:

> **ClipWaltz should feel like a polished creative product powered by AI, not like an AI model demonstration wrapped in a website.**

Every architectural, UI, workflow, and development decision should support that principle.

---

# 49. Final Instruction to Claude

Use all seven ClipWaltz documents as a coordinated specification.

Do not cherry-pick requirements.

Do not begin from assumptions.

Inspect first.

Validate infrastructure.

Build dependency-first.

Keep ComfyUI hidden.

Keep AISERVER responsible for inference.

Keep the model architecture modular.

Keep the UI modern, vibrant, and creator-focused.

Preserve project and generation history.

Validate every major integration.

Track progress continuously.

The objective is not simply to recreate Higgsfield.

The objective is to build **ClipWaltz into a more compelling, organized, transparent, flexible, and enjoyable AI video creation platform.**

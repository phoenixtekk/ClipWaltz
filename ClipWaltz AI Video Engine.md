ClipWaltz AI Video Engine
Self-Hosted Higgsfield-Style Generation System
Design and Development Instructions
1. Explanation

ClipWaltz will be a modern AI-powered video creation SaaS that allows users to upload photos and videos, describe what they want, choose a style or workflow, and generate polished video content.

Unlike Higgsfield, ClipWaltz should be designed around these advantages:

Self-hosted generation on AISERVER
Better control over cost
Better control over privacy
Better control over model selection
No dependency on a single third-party generation platform
A better product experience than Higgsfield
More intuitive
More visually compelling
Better project organization
Better timeline/workspace experience
Better support for large uploads and batch workflows
Better visibility into generation status and quality
Multi-model orchestration
Wan for strong core video generation
Hunyuan for cinematic/high-realism outputs
LTX for speed and certain audio/video scenarios
Enhancement stack for polishing final output
ClipWaltz as the branded product layer
Modern vibrant UI
Workflow simplification
Creator-focused controls
Reusable templates and style systems
Versioning and iteration tools
2. Product Goal

Build ClipWaltz as a premium AI video platform that is:

Easier to use than Higgsfield
More visually exciting than Higgsfield
More flexible than Higgsfield
Better for repeat creators and teams
Better for bulk media workflows
Better at helping users go from raw assets to finished content
3. Core Product Positioning
ClipWaltz Positioning Statement

ClipWaltz is a modern AI video creation platform that transforms photos, videos, prompts, and ideas into polished cinematic content through a fast, guided, and visually compelling experience.

Differentiators

ClipWaltz must differentiate itself through:

Self-hosted AI generation
Cleaner and more modern UX
Project-based workflow
Batch upload support
Version history
Timeline-oriented creation
Multi-model backend routing
Scene consistency tools
Transparent queue and status visibility
Creator-focused presets
High-quality output refinement pipeline
4. Gaps to Fix Compared to Higgsfield

ClipWaltz should explicitly improve the areas that often feel limited or frustrating in competing tools.

Gap 1: Too much “model magic,” not enough workflow guidance

Fix:
ClipWaltz should guide the user through clear creation flows:

Start from prompt
Start from image
Start from existing video
Start from a campaign/project
Start from template
Gap 2: Weak project organization

Fix:
Add:

Projects
Scenes
Versions
Assets
Exports
Brand kits
Saved prompts/styles
Gap 3: Limited transparency

Fix:
Show:

Queue position
Model being used
Current generation stage
Estimated processing phase
Preview progress when possible
Gap 4: Poor support for heavy creator workflows

Fix:
Support:

Large batch media upload
Drag-and-drop collections
Asset tagging
Reusable media sets
Shot grouping
Gap 5: Inconsistent output quality

Fix:
Use a routing and quality system:

Try the most appropriate model first
Score result quality
Optionally generate alternates
Allow enhancement pass automatically
Gap 6: Not enough creative control without being too technical

Fix:
Expose simple controls like:

Style
Camera motion
Mood
Energy
Pacing
Aspect ratio
Duration
Output quality

Hide advanced internal complexity unless user wants “Advanced Mode.”

5. Non-Negotiable Product Rules
End users must never be exposed to raw ComfyUI workflows
AISERVER is the dedicated generation/inference server
ClipWaltz is the only user-facing creation interface
The default experience must feel premium, guided, and modern
The UI must be vibrant, clean, and visually exciting
The app must prioritize fast iteration
Uploads must support many images/videos at once
Users must be able to compare versions and regenerate easily
Model selection should usually happen automatically
The system must be designed so more models can be added later
6. High-Level Architecture
Primary Components
1. ClipWaltz Frontend

Responsible for:

User interface
Project creation
Media management
Prompting
Timeline interactions
Version browsing
Export management
2. ClipWaltz Application Backend

Responsible for:

Authentication
Project data
Asset metadata
Job creation
Queue tracking
Orchestration logic
API between frontend and AISERVER services
3. AISERVER Inference Layer

Responsible for:

Running ComfyUI
Hosting models
Executing workflows
Returning outputs
Handling upscaling/enhancement/interpolation pipelines
4. Storage Layer

Responsible for:

Original uploads
Intermediate assets
Generated outputs
Preview proxies
Export files
5. Queue / Job System

Responsible for:

Generation jobs
Retry logic
Progress states
Prioritization
Failure handling
7. Target Deployment Model
Application Layer

Recommended:

Frontend: Next.js
Backend API: Next.js API routes or separate Node/NestJS service
Database: PostgreSQL
Queue: Redis + BullMQ
Storage: S3-compatible object storage or equivalent
Realtime updates: WebSockets / Server-Sent Events
AI Layer on AISERVER

Recommended:

ComfyUI
Python environment for inference tools
Separate workflow folders
Managed model storage
Background worker service
API access restricted to internal/backend communication
Important Design Rule

Do not make ComfyUI the public application.
ComfyUI is an internal generation engine only.

8. AISERVER Role

AISERVER will be the AI compute node.

AISERVER Responsibilities
Host ComfyUI
Host required models
Execute text-to-video and image-to-video pipelines
Execute enhancement workflows
Handle GPU-heavy processing
Return generated file paths or signed URLs back to ClipWaltz services
AISERVER Must Support
Multi-GPU awareness if available
Model caching
Workflow execution queues
Temporary and persistent storage
Monitoring and logging
Restart-safe job execution where practical
Validation Phase Required

Because the exact AISERVER OS, drivers, CUDA version, and installed environment are not confirmed in this request, the first build phase must validate:

Operating system
NVIDIA driver version
CUDA compatibility
Python version
Git availability
FFmpeg availability
Available VRAM per GPU
Available system RAM
Disk capacity for models and outputs
9. Model Strategy

ClipWaltz should use multi-model orchestration, not a single-model dependency.

Primary Models
Wan

Use as the main general-purpose video generation model.
Good for:

Image-to-video
Text-to-video
Reliable core generation pipeline
Hunyuan

Use when:

Higher realism is desired
More cinematic motion is required
User selected “cinematic” or “premium realism” modes
LTX

Use when:

Fast previews are needed
Certain short-form or rapid-iteration workflows are required
Audio-aware or faster generation modes are preferred
10. Enhancement Pipeline

Every output should be eligible for a post-processing pipeline.

Enhancement Steps
Initial generation
Quality scoring
Optional frame interpolation
Optional upscaling
Optional sharpening/cleanup
Export encoding
Final preview generation
Candidate Tools
RIFE for interpolation
ESRGAN / SUPIR for upscale or restoration
FFmpeg for final encoding and derivatives
11. Intelligent Routing Engine

ClipWaltz should include a Routing Engine that selects the best workflow automatically.

Inputs the Routing Engine Evaluates
Prompt type
Number of input images
Whether user uploaded video
Requested style
Requested duration
Requested aspect ratio
Quality mode
Speed mode
Motion intensity
Need for realism vs stylization
Routing Output

The engine chooses:

Which model to use
Which ComfyUI workflow to call
Whether enhancement should be automatic
Whether preview generation should happen first
Whether alternates should be created
12. Recommended User Workflows
Workflow A: Prompt to Video

User enters a prompt and selects:

Style
Duration
Aspect ratio
Motion level
Quality level

System:

Routes to best model
Generates preview
Lets user create final render
Workflow B: Image to Video

User uploads one or more images.

System:

Analyzes the image(s)
Asks optional guidance questions
Suggests motion and style presets
Generates video variants
Workflow C: Media Montage Builder

User uploads many photos/videos.

System:

Groups content
Suggests scenes
Builds a draft sequence
Applies transitions, motion, pacing, and music guidance
Produces social-video output
Workflow D: Template-Based Creator

User selects:

Promo
Reel
Story
Product ad
Travel montage
Event recap

System:

Applies a predefined creative structure
Uses AI to fill the template intelligently
13. UI / UX Direction

The UI must feel:

Modern
Vibrant
High-end
Creative
Fast
Confident
Visual Design Direction

Recommended style:

Dark-first interface
Vibrant accent gradients
Clean spacing
Rounded panels
Soft glow accents
Motion-rich hover states
Strong visual hierarchy
Suggested Visual Tone
Deep charcoal / near-black base
Electric purple accents
Teal/cyan highlights
Warm pink/orange secondary callouts
White/light gray typography
Smooth micro-animations
Product Feeling

The user should feel:

“This is premium”
“This is easier than I expected”
“I understand what is happening”
“I can create fast”
“This is more polished than technical”
14. Primary Screens
1. Dashboard

Must show:

Recent projects
New project button
Templates
Current renders
Favorites
Recent exports
2. Project Workspace

Must include:

Asset panel
Prompt/composition panel
Preview area
Timeline/storyboard area
Versions panel
Generate button
Export button
3. Generation Panel

Must include:

Prompt field
Style selector
Camera/motion selector
Duration selector
Aspect ratio selector
Quality selector
Advanced toggle
4. Asset Library

Must include:

Upload
Tagging
Search
Sort
Filter
Media groups
Brand assets
5. Versions / Compare View

Must include:

Side-by-side previews
Model used
Generation settings
Rerun button
Duplicate and modify
6. Export Center

Must include:

Export history
Resolutions
Aspect ratios
Output formats
Download state
Publish integrations later
15. MVP Feature Set
Core MVP
Authentication
Project management
Media upload
Prompt-based generation
Image-to-video generation
Model routing
Job queue and status tracking
Version history
Preview playback
Export rendering
Enhancement pass
Modern UI
MVP+ Features
Template library
Storyboard builder
Brand kits
Reusable prompt presets
Scene consistency memory
Team collaboration
Asset tagging
Smart recommendations
16. Data Model (High-Level)
Core Entities
User
Workspace
Project
Asset
Scene
GenerationJob
GenerationVersion
WorkflowProfile
ExportJob
Template
BrandKit
Important Metadata

For each GenerationJob store:

Prompt
Negative prompt if used
Input assets
Selected style
Selected duration
Selected aspect ratio
Selected quality mode
Model chosen
Workflow chosen
Job status
Logs
Preview output
Final output
Enhancement status
17. API Design (High-Level)
Backend Endpoints

Examples:

POST /api/projects
GET /api/projects/:id
POST /api/assets/upload
POST /api/generate
GET /api/jobs/:id
POST /api/jobs/:id/retry
POST /api/jobs/:id/enhance
GET /api/projects/:id/versions
POST /api/exports
GET /api/templates
AISERVER Internal Endpoints

Examples:

POST /internal/ai/run-workflow
GET /internal/ai/job-status/:id
POST /internal/ai/cancel/:id
POST /internal/ai/enhance
POST /internal/ai/interpolate
POST /internal/ai/upscale

These should be internal/private only.

18. Prompt and Workflow Abstraction

ClipWaltz must not force users to think in raw AI workflow terms.

User-Facing Controls
Mood
Style
Camera movement
Energy
Scene type
Duration
Format
Output quality
Internal Mapping

The app maps those controls to:

Prompt expansions
ComfyUI nodes
Workflow JSON
Model selection
Parameter presets

This is how ClipWaltz becomes easier to use than Higgsfield.

19. Quality Control Layer

ClipWaltz should include an internal quality scoring step.

Quality Signals
Motion coherence
Subject integrity
Prompt adherence
Visual sharpness
Artifact detection
Scene consistency
Use of Quality Layer
Mark output as passed / weak / retry candidate
Offer “best result” recommendation
Trigger optional enhancement
Help power smarter re-generation logic later
20. Recommended Development Phases
Phase 0 – Validation and Planning
Validate AISERVER environment
Confirm deployment path
Confirm operating system and GPU readiness
Confirm storage strategy
Confirm app/backend hosting location
Finalize architecture
Phase 1 – AI Infrastructure
Install ComfyUI on AISERVER
Set up model directories
Set up base workflows
Set up API communication
Test generation from backend
Test file output handling
Phase 2 – ClipWaltz Backend
Build project model
Build asset upload pipeline
Build job system
Build generation orchestration
Build status and logs model
Phase 3 – ClipWaltz Frontend
Build dashboard
Build project workspace
Build generation panel
Build asset library
Build job/progress views
Build compare/versions screen
Phase 4 – Enhancement and Export
Add interpolation
Add upscale
Add export profiles
Add preview proxies
Add final delivery handling
Phase 5 – Product Differentiators
Templates
Storyboard mode
Smart style presets
Scene consistency
Brand kits
Better prompt guidance
Faster preview mode
21. UX Features That Must Make ClipWaltz Better Than Higgsfield
Must-Have Advantages
Bulk upload support
Project-based organization
Better version compare
Cleaner status visibility
Template-first creation
Story/timeline workflow
Faster preview mode
AI-assisted workflow recommendations
More transparent generation
Better asset reuse
22. Development Rules
Engineering Rules
Do not hardwire ClipWaltz to one model only
Do not expose raw ComfyUI to end users
Separate app logic from inference logic
Store generation metadata for repeatability
Build queueing and retries from the start
Design for future multi-GPU support
Use modular workflow definitions
Support feature flags for experimental workflows
Build for future scalability
Keep UI friendly even when backend complexity grows
23. AI Builder Instruction Set

Use the following instruction set for internal AI-assisted development:

AI Builder Role

You are building ClipWaltz, a premium AI video creation platform.
Your responsibility is to help design and implement a modern, vibrant, user-friendly application that uses AISERVER as the hidden AI inference backend through ComfyUI and multiple video-generation models.

AI Builder Rules
Do not expose ComfyUI directly to users
Treat AISERVER as the dedicated inference environment
Build modularly
Keep the UX premium and simple
Prefer reusable architecture
Prefer project/workspace-driven flows
Hide model complexity behind user-friendly controls
Design for multi-model support
Design for future templates, timeline tools, and collaborative creation
Make ClipWaltz feel more modern and compelling than Higgsfield
AI Builder Priorities
Excellent UX
High-quality video generation
Fast iteration
Clear project organization
Scalable architecture
Internal workflow flexibility
Strong branding and visual identity
24. Recommended Outcome

When complete, ClipWaltz should provide:

A polished AI video generation experience
A self-hosted inference stack on AISERVER
Hidden ComfyUI orchestration
Multi-model flexibility
Better workflow design than Higgsfield
Better organization than Higgsfield
Better creative control than Higgsfield
Better transparency than Higgsfield
Lower long-term generation dependency cost
25. Final Recommendation

Yes — this is the right direction.

The best path is:

Use AISERVER for all heavy AI/video inference
Install and manage ComfyUI there
Make ClipWaltz the branded experience layer
Use Wan, LTX, Hunyuan, and enhancement tools behind the scenes
Win on UX, organization, workflow guidance, and creator experience
Do not try to copy Higgsfield literally
Build something better structured and more useful

If you want, my next step can be one of these:

Write the full technical architecture document
Write the exact MVP feature backlog
Write the complete UI/UX screen-by-screen spec
Write the Phase 1 implementation plan for AISERVER + ComfyUI
Write the developer build instructions as a formal AI coding prompt for your dev agent
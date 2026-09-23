# ClipWaltz
## Complete UI/UX Screen-by-Screen Specification

**Version:** 1.0  
**Design Direction:** Modern, vibrant, premium, creator-first  

---

# 1. UX Objective

ClipWaltz must feel more polished, visual, intuitive, and organized than existing AI video platforms.

The user must never feel like they are operating an AI engineering tool.

The UI should communicate:

- creativity
- speed
- control
- confidence
- premium quality
- modernity

---

# 2. Visual Design System

## Base Theme
Dark-first.

Recommended foundation:
- near-black background
- elevated dark surfaces
- bright typography
- translucent overlays
- subtle glass effects
- vibrant gradient accents

## Accent Direction
Use combinations of:
- violet
- magenta
- cyan
- electric blue
- warm orange

Do not oversaturate every screen.

Accent colors should guide attention.

## Shape Language
- medium-to-large border radius
- rounded cards
- pill controls
- soft shadows
- restrained glow effects

## Typography
Use a modern sans-serif.

Examples:
- Inter
- Geist
- Manrope

## Motion
Use:
- smooth hover transitions
- animated progress states
- subtle panel transitions
- generation-state animations

Avoid distracting animation.

---

# 3. Global Application Shell

## Left Navigation

Items:
- Home
- Projects
- Templates
- Assets
- Exports

Secondary:
- Brand Kits
- Settings

Bottom:
- Workspace
- User avatar
- Plan / usage

## Top Bar
Context-aware.

May contain:
- project name
- autosave state
- generation queue
- notifications
- help
- profile

---

# 4. Screen: Home Dashboard

## Purpose
Get user creating immediately.

## Primary Hero Area

Headline:
**What do you want to create?**

Primary CTA:
**Create Video**

Secondary options:
- From Prompt
- From Image
- From Media
- From Template

## Recent Projects

Cards show:
- project thumbnail
- project name
- last modified
- current status

## Active Renders
Compact live status cards.

Example:
```text
Desert Commercial
Generating • 63%
```

## Templates
Horizontal carousel.

Categories:
- Social
- Product
- Cinematic
- Event
- Travel

---

# 5. Screen: New Project

## Primary Choices

Large visual cards:

### Prompt to Video
Generate from an idea.

### Image to Video
Bring a still image to life.

### Media Story
Turn many photos and videos into a finished sequence.

### Template
Start with a proven format.

---

# 6. Screen: Project Workspace

This is the most important screen in ClipWaltz.

Layout:

```text
┌──────────────┬────────────────────────┬──────────────┐
│ Asset Panel  │      Preview Area      │ Create Panel │
│              │                        │              │
│              │                        │              │
├──────────────┴────────────────────────┴──────────────┤
│                Storyboard / Timeline                │
└─────────────────────────────────────────────────────┘
```

---

# 7. Project Workspace: Asset Panel

## Features
- upload
- images
- videos
- generated media
- favorites

## Asset Card
Show:
- thumbnail
- duration for video
- file type
- selection state

## Upload UX
Large drop target:

**Drop photos and videos here**

Support many simultaneous files.

Show:
- upload progress
- processing status
- errors individually

---

# 8. Project Workspace: Preview Area

Main visual focal point.

Must support:
- image preview
- video preview
- playback controls
- fullscreen
- before/after compare
- version switcher

When no output exists:

Show inspiring empty state rather than blank player.

Example:

**Your next scene starts here.**

---

# 9. Project Workspace: Create Panel

## Prompt

Large text input.

Placeholder example:
**Describe the shot, motion, atmosphere, and feeling you want.**

Below prompt:
- Enhance Prompt toggle
- Prompt history

## Style

Visual preset chips:
- Cinematic
- Commercial
- Documentary
- Social
- Action
- Dreamlike

## Camera

Visual dropdown or card picker:
- Static
- Push In
- Pull Back
- Orbit
- Pan
- Tracking
- Handheld
- Drone

## Motion

Slider:
```text
Subtle ───── Balanced ───── Dynamic
```

## Duration

Pill buttons.

## Aspect Ratio

Visual icons:
- Landscape 16:9
- Portrait 9:16
- Square 1:1

## Quality

Cards:
- Preview
- Standard
- High

## CTA

Large button:
**Generate**

Must visually dominate the panel.

---

# 10. Advanced Settings

Collapsed by default.

May include:
- seed
- negative prompt
- model preference
- FPS
- output resolution
- guidance
- workflow options

Most users should never need this section.

---

# 11. Generation Progress State

Replace generic loading spinners with meaningful progress.

Examples:

```text
Preparing your scene
Loading AI model
Building motion
Rendering frames
Enhancing detail
Encoding video
```

Display:
- progress indicator
- current phase
- cancel action

If queue exists:
**2 jobs ahead of you**

---

# 12. Screen: Version Browser

## Layout
Grid of generated clips.

Each card:
- thumbnail
- duration
- creation time
- favorite
- selected indicator

Actions:
- View
- Compare
- Duplicate
- Enhance
- Export
- Delete

---

# 13. Screen: Version Compare

Two-column comparison.

```text
Version 4              Version 7
[ video ]              [ video ]
```

Controls:
- synchronized playback
- choose left
- choose right
- swap
- create variation

Display meaningful differences:
- style
- motion
- prompt changes
- quality mode

Do not show raw ComfyUI graph details.

---

# 14. Storyboard

MVP storyboard uses cards.

Each scene card:
- scene number
- thumbnail
- title
- duration
- status

Drag to reorder.

Button:
**Add Scene**

---

# 15. Screen: Asset Library

Global asset view.

Filters:
- All
- Images
- Videos
- Generated
- Uploaded

Search.

Sort:
- Recent
- Oldest
- Name
- Size

Grid-focused interface.

---

# 16. Screen: Templates

Hero:
**Start faster with a proven format**

Categories:
- Social Ads
- Product
- Travel
- Event
- Storytelling
- Cinematic

Template card:
- preview video
- title
- intended duration
- aspect ratio
- Use Template

---

# 17. Screen: Export Center

Show completed exports.

Each export:
- thumbnail
- project
- format
- resolution
- date
- download

Export configuration modal:

- MP4
- resolution
- aspect ratio
- quality
- frame rate if supported

CTA:
**Create Export**

---

# 18. Screen: Brand Kits

Future-facing but design should account for it.

Brand Kit contains:
- logo
- primary colors
- secondary colors
- font
- visual style
- tone

Brand kits should become available inside templates and AI prompting.

---

# 19. Screen: Settings

Sections:
- Profile
- Workspace
- Storage
- Generation Preferences
- Notifications
- Privacy
- Billing later

---

# 20. Empty States

Empty states must be purposeful.

Examples:

## No projects
**Create your first video project.**

## No assets
**Drop in your first photo or video.**

## No generations
**Your first AI-generated scene will appear here.**

---

# 21. Error States

Errors must be clear.

Bad:
```text
Workflow execution failed
```

Better:
```text
We couldn't finish this render.

Your project and source files are safe.
Try the generation again or change the quality setting.
```

Actions:
- Retry
- Edit settings
- View details

---

# 22. Mobile / Responsive Behavior

The initial priority is desktop.

Responsive requirements:
- dashboard responsive
- project browsing responsive
- video preview responsive
- generation status responsive

Advanced timeline editing may remain desktop-first.

---

# 23. UX Features Intended to Beat Higgsfield

ClipWaltz should emphasize:

1. Projects instead of isolated generations.
2. Strong asset organization.
3. Batch uploads.
4. Clear generation status.
5. Stronger version history.
6. Compare workflow.
7. Storyboard-based creation.
8. Smart recommendations.
9. Reusable templates.
10. Faster preview workflow.
11. Friendlier generation controls.
12. Less model jargon.

---

# 24. Microcopy Rules

Use simple user language.

Say:
- Create
- Generate
- Enhance
- Smooth Motion
- Improve Detail

Avoid:
- inference
- sampler
- latent
- scheduler
- denoise strength

Technical labels may appear only in Advanced Mode.

---

# 25. Design Validation Questions

Every screen should pass:

1. Can a first-time user understand the main action?
2. Is the primary CTA obvious?
3. Are advanced controls hidden until needed?
4. Is the current project state clear?
5. Can the user recover from errors?
6. Can the user find previous outputs?
7. Does the screen feel like a creative product rather than an engineering console?

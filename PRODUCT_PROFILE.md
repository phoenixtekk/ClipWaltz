<!--
title: ClipWaltz — Product Profile
description: Marketing intake profile emitted at end of development. Consumed by the Go-To-Market marketing framework.
published: false
editor: markdown
-->

# Product Profile — ClipWaltz

> **Purpose:** This file is the handoff from development → marketing. A completed dev session
> writes it; the Go-To-Market marketing framework reads it to pre-fill Phase 1 Discovery.
> Keep it in the product repo root alongside `product.marketing.json`.

## Identity
- **Name:** ClipWaltz
- **Category:** SaaS
- **One-liner:** Turn your photos, clips, product links and ideas into beat-synced videos, image ads, carousels and memes — ready to post.
- **Description:** ClipWaltz is a cloud video maker with two tools. **AutoWaltz** turns your own photos and videos into a music video that cuts on the beat, with licensed music, templates and HD rendering done on ClipWaltz's servers. It also handles Insta360 360° footage, keeping the horizon level and following the action. **Waltz AI** creates brand-new video clips from a description or a photo, which you can enhance, arrange into scenes and export. Since November 2026 it also makes static image ads, carousels and memes (**Waltz Image**), builds ad packs from a product link or a Shopify / WooCommerce catalog, exports image ads for Meta Ads Manager and Google Ads Editor, installs as an app (PWA), and offers a Pro public API and MCP server. A full social publishing suite is built and in **admin-only preview**, not yet open to customers.
- **Website URL:** https://www.clipwaltz.com
- **Repo path:** G:\VisualStudioCode\ClipWaltz

## Audience
- **Primary audience:** Travel and event recap creators: people back from a trip, wedding, birthday or concert with hundreds of photos and clips they'll never edit by hand.
- **Ideal Customer Profile (ICP):** Individual creators and casual posters (TikTok, Reels, Shorts) using a desktop browser, often with a phone or Insta360 camera. Expansion: real-estate agents (listing walk-throughs), small-business product promos, coaches and creators, sports parents, and marketing teams that need on-brand videos often (Pro tier, workspaces).
- **Top pain points:**
  1. Editing apps are still work: sorting, trimming and syncing hundreds of clips takes hours.
  2. Auto-videos get muted or taken down over unlicensed music.
  3. 360° footage (Insta360) needs desktop software to turn into a normal, shareable video.

## Value
- **Desired business outcome for the customer:** A polished, postable music video in about a minute from raw footage, safe to publish, without learning an editor.
- **Key differentiators:**
  - Cloud rendering: heavy work runs on ClipWaltz servers, not your laptop or phone. You can leave and come back.
  - A real auto-edit, not a slideshow: beat-synced cuts, smart trimming to the most active part of each clip, and "Waltz to the Music" pacing.
  - A licensed music catalog that's safe to post.
  - 360-camera ready: Insta360 files (including split `_00_`/`_10_` lens pairs) are stitched, levelled by the camera's own gyro data, and reframed to Front, Follow action or Tiny planet.
  - AI clip generation (Waltz AI) runs on self-hosted GPUs, alongside your own footage in the same project.
  - Waltz Image draws ad text on the server, never by the AI model, so words are pixel-exact and edits are free.
- **Competitive alternatives:** CapCut templates, Google Photos / Apple Memories, VivaVideo, other on-device slideshow makers, and doing it by hand in a video editor. *(From PRODUCT_PLAN.md §3; confirm against current market.)*

## Features (one row per marketable feature)
| Feature | What it does | Customer benefit |
|---|---|---|
| AutoWaltz auto-edit | Assembles uploaded photos and videos into a music video: beat-synced cuts, smart trim, Ken Burns motion, transitions, filters, titles and fades | A finished video without editing |
| Instant draft preview | Plays the whole cut in the editor before rendering | See it and tweak it before committing |
| Cloud HD render | Renders 1080p 9:16 (or 16:9) on ClipWaltz servers and notifies you when it's ready (in-app, email, desktop) | Nothing to install, no waiting at the screen |
| Licensed music catalog | Curated royalty-free tracks by mood | Safe to post, no takedowns |
| Occasion templates | Trip, event/wedding, birthday, "surprise me", plus saved presets | Start from a vibe that fits |
| 360 camera support | Insta360 .insv/.insp files, split-lens pairs stitched, gyro horizon levelling, Front / Follow action / Tiny planet views | Use 360 footage with no desktop software |
| Waltz AI | Text-to-video and image-to-video clips with style, camera, motion, length and quality controls | Create shots you didn't film |
| Waltz AI Remix | Pick any video you've made and weave AI into it: an AI lead-in that flows into the first shot, "moment magic" where a frame comes alive in place, and an AI extension past the last frame, with the song carried on under the AI parts | Turn a finished video into something new without re-editing it |
| Enhance | Clean, Smooth (frame interpolation), Sharp (AI upscale) and Max Quality (AI Restore) | Better-looking clips in one click |
| Versions, compare & scenes | Version history, side-by-side compare, storyboard scenes assembled into one video | Iterate and build longer stories |
| Exports | MP4/WebM at native, 720p or 1080p | Deliverables for any platform |
| Share & community | Share links, public feed, likes and comments, monthly theme challenge | Get views and inspiration |
| Post text | AI-written description and hashtags for your post | Ready to publish, copy and paste |
| Workspaces | Invite teammates with roles (owner, admin, editor, viewer) | Team collaboration on projects |
| Google Drive backup | Back up original uploads to your Drive | Keep your originals safe |
| Waltz Image — image ads | AI or uploaded picture with headline, subhead and button drawn crisply on top, at exact sizes for feed, story, link/ad card and Pinterest (1:1, 4:5, 9:16, 1.91:1, 2:3); brand kit colours, fonts and logo. | Platform-ready ads and social graphics in minutes; text edits cost nothing. |
| Carousels | 2–10 slide carousels (square or 4:5) with hook, value and CTA slides, brand templates free, AI backgrounds optional; download each slide or a ZIP. | Swipeable posts without a design tool. |
| Memes | Four original meme layouts on your own or an AI picture; long text wraps and shrinks to fit. | On-brand memes with no third-party templates. |
| Product link → ad pack | Paste a product page: ClipWaltz reads name, price and photo, then makes image ads in every chosen size plus a WaltzDeck video ad brief with a Shop-now button. | From a product URL to a set of ads in one step. |
| Store catalogs | Connect a Shopify or WooCommerce store (public catalog, no key) and sync up to 250 products, then make an ad pack from any product. Wix connects with an API key (not yet tested against a live Wix store). | Ads for your whole catalog, kept in sync. |
| Export for Meta / Google Ads | Pick image designs and download one ZIP with a Meta Ads Manager bulk-import CSV and a Google Ads Editor Performance Max CSV, images included, UTM-tagged, everything paused. | Upload ready-made ads to your ad accounts without retyping. |
| Brand / client workspaces | Workspace switcher and New workspace: one per client or brand (Pro: up to 5), each with its own projects, images and brand kit. | Agencies keep every client separate. |
| Public API + MCP server (Pro) | Per-workspace API keys with read / generate / publish scopes, OpenAPI 3.1 at /api/v1, and a remote MCP server at /mcp for AI assistants (images, post copy, posts). No video-render endpoints yet. | Automate content from your own tools or an AI assistant. |
| Installable app (PWA) | Install ClipWaltz on a phone or desktop home screen, with an offline page and web push. | ClipWaltz one tap away, no app store. |
| Social publishing (admin-only preview) | Built and on prod but not yet open to customers: post to 20+ networks, calendar, scheduling and queue, Auto Post rules, per-network AI copy and hashtags, suggested posting times, approvals with client review links, analytics and comments for Facebook / Instagram / Threads / Bluesky, Plan a week, competitor feeds, podcast hosting, explainer videos and Shorts. | Make it and post it from one place — once switched on. |

## Pricing
- **Model:** tiered (free plan plus monthly subscriptions)
- **Tiers / prices:** Free $0 (3 videos/mo, watermarked) · Plus $15/mo (1080p HD, 30 videos/mo, up to 60 s, priority queue) · Pro $39/mo (fastest render, 100 videos/mo, up to 3 min, Project Vault). Every video currently carries a small ClipWaltz logo; an admin switch can make paid plans watermark-free.
- **Billing processor:** Stripe (hosted Checkout + Customer Portal)

## Tech & Integrations
- **Stack:** Next.js (App Router, React), TypeScript, Tailwind + shadcn/Base UI, Better Auth, Drizzle ORM + PostgreSQL, BullMQ + Redis, MinIO (S3-compatible) object storage, ffmpeg render worker, ComfyUI (Wan 2.2, Real-ESRGAN, RIFE, SeedVR2) on self-hosted GPUs, Ollama (self-hosted LLM) for post text
- **Integrations:** Stripe, Amazon SES (email), Google Drive, Web Push notifications, Cloudflare (tunnel + media edge), Insta360 telemetry (gyro2bb), Shopify (public catalog), WooCommerce (Store API), Wix (API key, untested live), Meta Ads Manager + Google Ads Editor (CSV export), Model Context Protocol (remote MCP server)
- **Deployment:** linuxg1 (pm2 clipwaltz :3100 + generation worker + social worker) behind a Cloudflare Tunnel at www.clipwaltz.com (apex → www 308); render worker on the AI box; AI inference on AISERVER; image generation on the ComfyUI box; MinIO on linuxg7 with the media.clipwaltz.com edge

## Brand
- **Voice/tone:** Warm, playful and confident: "Let's Waltz", "We waltz it", "Done before your coffee". *(Inferred from site copy; confirm.)*
- **Brand colors:** #4f7cff (blue) · #8b5cf6 (violet) · #e05bd6 (magenta) · #ff7a59 (coral) · ink #08061a; signature spectrum gradient blue → violet → magenta → coral
- **Logo path:** `public/logo-2.png` (mark), `public/logo-name-1.png` (wordmark), `public/WaterMark.png` (video watermark)

## Video readiness
- **Existing video assets:** none published; the product itself produces demo videos (community feed at /community).
- **YouTube channel:** none
- **Can produce demo/screen-capture:** yes

---
*Generated by: dev session on 2026-09-27; refreshed 2026-11-14 (Predis parity P7 — see `docs/PREDIS_PARITY_AND_PUBLISH_MERGE_PLAN.md` §8). Confirm accuracy before building campaigns.*

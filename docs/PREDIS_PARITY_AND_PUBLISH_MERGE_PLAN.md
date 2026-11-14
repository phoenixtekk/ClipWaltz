# ClipWaltz — Predis.ai Parity + Social Publishing Merge: Build Instructions

**Status:** Phase plan (P0–P7) **approved by the owner 2026-11-14**. Decisions D1–D9 and the §4.7 credits answered the same day (§9.1). Ready for P0. Nothing in this document has been built or deployed yet.
**Written:** 2026-11-13 · **Branch verified against:** `claude/continue-previous-25a0b2` @ `eff9e0c` (the dev branch; prod runs cherry-picked `deploy/*` branches, so prod ⊆ dev for everything cited here).
**Inputs:** `Predis_vs_ClipWaltz_Feature_Comparison_2026-11-13.md` (repo parent folder), `https://predis.ai/llm-info/` (read 2026-11-13), the Social Publishing source at `G:\VisualStudioCode\SocialPublishing`, and a read-only probe of linuxg1 on 2026-11-13.

## 0. Evidence rules used in this doc

| Label | Meaning |
|---|---|
| **Verified (code)** | Found (or searched for and not found) in ClipWaltz source at `eff9e0c`; the file is cited. |
| **Verified (live)** | Read on linuxg1 on 2026-11-13 (pm2, env key *names*, DB row counts). No secrets were read into this doc. |
| **From comparison file** | Predis.ai capability taken from the comparison file or Predis's own fact page. **Not hands-on tested.** |
| **Unverified** | Stated as an assumption; must be checked before the phase that depends on it. |

"Missing" for ClipWaltz means a repo-wide search of `src/` and `worker/` found nothing; search terms are listed in §3.

---

## 1. Summary

1. **publish.phoenixtekk.com is the "Social Publishing" app** (SP): Next.js 14.2.35, repo `G:\VisualStudioCode\SocialPublishing` (**not a git repo locally** — risk R1), pm2 `social-publishing` on linuxg1 `:3210`, Postgres db `socialpublishing` on the same `127.0.0.1:5432` instance as ClipWaltz's `clipwaltz` db. Better Auth, Drizzle — the same stack family as ClipWaltz.
2. SP already supplies most of what ClipWaltz lacks against Predis: scheduling, calendar, autopublishing to 21 enabled networks, multi-account, per-network copy, social analytics, comments/replies, AI image generation with ad-text overlay, review/share links, and an RBAC role matrix.
3. After SP is merged, the Predis gaps that remain are: carousel generator, meme generator, dedicated hashtag tool, best-time-to-post, pre-publish engagement score, competitor content/ad intelligence, a formal approval workflow, product-URL → ad, Shopify/WooCommerce/Wix catalog sync, ads-manager export, public API, MCP server, bulk "agent mode", multi-brand switching, mobile app, Semrush listing.
4. Proposed order: **P0 decisions → P1 publishing core → P2 publish UI + "publish this render" → P3 image/carousel/hashtag/meme → P4 SP data migration + cut-over → P5 SP extras (funnels, podcast, research, shorts) → P6 remaining Predis gaps → P7 parity re-check.** Details in §7.

---

## 2. Inventory — what publish.phoenixtekk.com does today

### 2.1 Where it lives (Verified live)

| Item | Value |
|---|---|
| Process | pm2 `social-publishing`, cwd `/home/lacy/social-publishing`, status online, `http://127.0.0.1:3210/` → 200 |
| Public route | Cloudflare tunnel `772914b5…` (linuxg1) → `localhost:3210`; also serves `funnels.phoenixtekk.com` (Autonnel admin SSO proxy) |
| Database | `socialpublishing` on linuxg1 Postgres :5432 |
| Media | Disk at `/home/lacy/social-publishing-data/media` (`MEDIA_STORAGE_DIR`) |
| Scheduler | `lacy` crontab `* * * * * /home/lacy/social-publishing-data/scheduler-sweep.sh` → `POST /api/cron/run` (Bearer `CRON_SECRET`) |
| AI | Ollama `192.168.166.182:11434`, model `qwen3.8:27b`; ComfyUI `COMFY_URL=http://192.168.166.183:8188` (image + SVD clips); `nomic-embed-text` for anti-repetition |
| Voice | ElevenLabs (API key set; one cloned voice id set) — explainer/shorts narration |
| Search | `SEARXNG_URL=https://search.analytikul.ai` (Problem Finder "Web" source) |
| Billing | $99/mo founding subscription coded; **`STRIPE_SECRET_KEY` is not set** — billing is not switched on |
| Sign-up | `AUTH_DISABLE_SIGNUP=false` in env, but the app enforces **invite-only** in code (FEATURES.md "Invite-only access") |
| Enabled networks | `facebook, facebook_group, linkedin, bluesky, pinterest, threads, instagram, telegram, discord, slack, txtya, email, x, youtube, tiktok, mastodon, medium, devto, teams, tumblr, discourse` (21) |
| Migrations | Prod has through `0030_podcast_analytics`; the local copy has `0031_short_rule.sql` → **local is ahead of prod** (Shorts not deployed) |

**Live usage (row counts, 2026-11-13):** 2 users · 2 memberships · 20 connections (bluesky, devto, discord, discourse, facebook_group, mastodon, pinterest, podcast, slack, telegram, threads, txtya, x, youtube) · 494 posts (15 in the last 30 days) · 3 funnels · 11 auto-post rules · 1 podcast show. Facebook Page + Instagram are **env-configured** (`FACEBOOK_*`), owned by the installation owner, not stored as connection rows.

### 2.2 Capabilities (from `SocialPublishing/FEATURES.md`, routes and tables cross-checked against `src/`)

| Area | Capabilities | SP code |
|---|---|---|
| Publishing core | Provider-agnostic `publish()`; concurrent fan-out; per-provider results; 23 provider adapters (bluesky, devto, discord, discourse, email/SES, facebook, facebook-group hand-off, instagram, linkedin, mastodon, medium, pinterest, podcast, reddit, slack, teams, telegram, threads, tiktok, tumblr, txtya, x, youtube) | `src/lib/publishing/**` |
| Connections | Many accounts per network; per-user ownership (fails closed); OAuth flows (FB, LinkedIn, Threads, Mastodon self-registering, Pinterest, TikTok, Tumblr, X, YouTube); paste-credential connects; health checks + pause; token auto-refresh | `src/lib/connections.ts`, `*-oauth.ts`, `network-health.ts`, `src/app/api/<network>/*` |
| Composer | Text + link + media upload; per-network text **and** media overrides; live preview; char meters; format bar; link autocomplete; history & templates with `{{variables}}`; pre-flight fitness (blocked / will-adjust / warn); image fit-to-byte-limit; link-safe trimming; article-title fitting | `compose/page.tsx`, `publishing/{preflight,compose,title,image-fit,link-format}.ts`, `network-capabilities.ts` |
| Scheduling | Publish now / schedule / queue; reschedule; calendar month grid; Auto Post rules (many, recurring, up to 12 times/day, generated slots with topic rotation, review-first, presets, clash warnings); Re-Share; retry failed destination (`FOR UPDATE SKIP LOCKED`); hand-off "Post by Hand" queue | `scheduler.ts`, `auto-post*.ts`, `retry-targets.ts`, `handoff.ts` |
| Engagement | Analytics (live per-post metrics FB/IG/Threads/Bluesky); Comments inbox + reply (FB, Bluesky live; IG/Threads pending scopes); post "View ↗" links | `analytics.ts`, `comments.ts` |
| AI writing | Assistant (write/improve/shorten/hashtags/ideas) on Ollama; generation history; A/B variations; per-network AI context + seed compose; embedding anti-repetition; Workplace-store RAG grounding; page assistant flyout; inline FieldAssist | `ai*.ts`, `similarity.ts`, `workplace.ts` |
| AI images/video | Auto AI Image (Ollama prompt → ComfyUI, Flux supported); styles + art direction; per-network art; AI Art Director chat; **ad-template overlay** (headline/subhead/logo composited); Auto AI Video/GIF (SVD); merge-image (Flux Redux); background render queue | `image-gen.ts`, `ad-overlay.ts`, `video-gen.ts`, `render-queue.ts`, `comfy-pool.ts` |
| Explainer / Shorts | Script → ElevenLabs narration → canvas compositor → ffmpeg; chapters/thumbnail/metadata; per-destination cuts; Shorts rules (local only, not deployed) | `src/lib/explainer/*`, `src/lib/shorts/*` |
| Podcast | Self-hosted RSS `/p/<slug>/rss.xml`, episodes from explainer audio, IAB-style download analytics | `src/lib/podcast/*`, `src/app/p/*` |
| Funnels & commerce | Products + value ladders; funnel builder/blueprints/planner/review/analytics; Autonnel integration (page linking, funnel scaffolding, AI-written pages, results); SSO proxy for `funnels.phoenixtekk.com`; public `/media/<key>` proxy for Autonnel's MinIO bucket | `src/lib/funnels/*`, `src/lib/autonnel/*`, `src/app/commerce-proxy`, `src/app/media/[...key]` |
| Research | Problem Finder (Reddit Atom / SearXNG / Google CSE), clustering, grounded solution matching, finding → draft | `src/lib/reddit/*`, `research/*` |
| Sharing | Public review links `/r/<token>`; signed public media URLs `/api/media/public/[id]` | `posts/[id]/share`, `r/[token]` |
| Accounts | Better Auth; RBAC Admin/Creator/User with editable matrix (~14 capabilities incl. `commerce.*`, `funnels.manage`); invites + waitlist + invite analytics; 14-day trial; $99 founding plan (not live) | `rbac.ts`, `invites.ts`, `membership.ts`, `billing/stripe.ts` |
| Public pages | Landing, `/about`, `/offer`, `/setup-guide` (20 networks), Help Center, privacy, terms | `src/app/*` |

SP tables: `account ai_generation app_setting auto_post_preset auto_post_rule billing_event funnel funnel_build funnel_stage invite invite_request media membership offer podcast_episode podcast_listen podcast_show post post_target product render_job research_finding research_search session short_rule snippet social_connection user verification`.

---

## 3. Gap table — Predis.ai vs ClipWaltz today vs ClipWaltz + SP

ClipWaltz searches run over `src/` and `worker/` (`*.ts,*.tsx,*.mjs,*.py`) at `eff9e0c`. Terms with **0 hits**: `meme`, `carousel`, `shopify`, `woocommerce`, `wix`, `linkedin`, `best time`, `competitor`, `mcp`, `product.?url`. Hits that turned out unrelated: `instagram/tiktok/youtube` (only profile links in `profile-form.tsx` / `u/[id]` and a YouTube description), `schedul` (admin Auto-Batch and cloud-save retries), `calendar` (a motion preset name), `approv` (connector pairing approval), `api.?key` (BYOK model keys only).

| # | Feature (Predis has it — from comparison file / llm-info) | ClipWaltz today | Evidence | With SP merged | Build item |
|---|---|---|---|---|---|
| 1 | Text-to-video / image-to-video | Present | `generation_jobs`, `worker/generation-worker.mjs`, `credits.ts generationCost` | Present | — |
| 2 | Video ads + hook/CTA variants | Present | Campaign packs `src/lib/campaign*.ts`, `deck_campaigns` | Present | — |
| 3 | AI avatars / UGC presenters | Present | `presenters.ts`, `/avatars`, MuseTalk lip-sync in `translate-actions.ts` | Present | — |
| 4 | Voiceover, voice cloning, dubbing + lip-sync | Present | `worker/deck/clone-voice.mjs`, `translate-actions.ts` | Present | — |
| 5 | Captions | Present | `worker/deck/{jobs,motion,camera}.mjs` | Present | — |
| 6 | Licensed music | Present | `music_tracks`, `music-providers.ts` | Present | — |
| 7 | Brand kits | Present (one per workspace) | `brand_kits.workspaceId` in `app-schema.ts:901` | Present | — |
| 8 | Team roles | Present | `workspace.ts` viewer/editor/admin/owner | Present + SP RBAC (to reconcile) | M-auth |
| 9 | Multiple aspect ratios | Present | `aspect.ts` | Present | — |
| 10 | **Static image ads** | Partial — only WaltzDeck AI backdrops (one Wan frame, `BACKDROP_COST=2`); no standalone image product | `credits.ts:18` | Present — SP Auto AI Image + ad overlay (ComfyUI .183) | **G1** surface it as a ClipWaltz tool |
| 11 | **Static social post graphics, platform-sized** | Partial (as #10) | — | Partial — SP renders one image per post/network, no format presets | **G1** |
| 12 | **Social carousels** | Missing | 0 hits `carousel` | Partial — SP *publishes* IG/Threads/FB multi-image; nothing *designs* a carousel | **G2** |
| 13 | **Product URL → ad/video** | Partial — WaltzDeck URL import reads title/description/headings/body + `og:image` | `worker/deck/importer.mjs:9` | Partial | **G3** |
| 14 | **AI hashtags** | Partial — user-pasted channel template only | `project-editor.tsx:590` | Present — SP Assistant "hashtags" action | **G4** (one-click on renders) |
| 15 | **AI memes** | Missing | 0 hits | Missing | **G5** |
| 16 | **Generate complete social posts** | Partial — AI YouTube description on render | `projects.describe`, `renders.description` | Present (SP composer + AI compose) | M-ui |
| 17 | **Content calendar** | Missing | — | Present (SP `/calendar`) | M-port |
| 18 | **Schedule posts / queue** | Missing | — | Present | M-port |
| 19 | **Direct autopublishing** (IG, FB, LinkedIn, TikTok, YouTube) | Missing | — | Present for FB, IG, TikTok (to drafts), YouTube (private by default); **LinkedIn blocked** on LinkedIn's Community Management API approval | M-port + R4 |
| 20 | **Multi-account management** | Missing | — | Present | M-port |
| 21 | **Suggested posting times** | Missing | 0 hits | Missing | **G6** |
| 22 | **Social performance reporting** | Partial — campaign-pack page events only | `/api/c/[id]/event` | Present (FB, IG, Threads, Bluesky) | M-port |
| 23 | **Competitor content analysis** | Missing | 0 hits | Missing | **G7** |
| 24 | **Competitor ad intelligence** | Missing | 0 hits | Missing | **G7** |
| 25 | **Pre-publish engagement score** | Missing | — | Missing (SP has pre-flight *fitness*, not a score) | **G8** |
| 26 | **Content approval workflow** | Missing (render comments only) | `render_comments` | Partial — review-first drafts, funnel review queue, public review links `/r/<token>`; no approver role or approve/reject state | **G9** |
| 27 | **Shopify / WooCommerce / Wix catalog sync** | Missing | 0 hits | Missing | **G10** |
| 28 | **Export to Meta / TikTok Ads Manager** | Missing | — | Missing | **G11** |
| 29 | **Public content-generation API** | Missing (no `/api/v1`, keys are BYOK) | route list | Partial — SP `POST /api/publish` with `x-publish-key` (single shared key) | **G12** |
| 30 | **MCP server** | Missing | 0 hits | Missing | **G13** |
| 31 | **Bulk generation / "Agent Mode" / copilot 4-angle hooks** | Partial — campaign packs vary hooks/CTAs/lengths; admin-only Auto-Batch | `campaign.ts`, `batch-actions.ts:1` | Partial — SP Auto Post generated slots + A/B variations | **G14** |
| 32 | **Multi-brand (agency: many clients)** | Partial — one personal workspace per user (`ensurePersonalWorkspace`); no create-another-workspace function found (**unverified** beyond grep) | `workspace.ts:35` | Partial | **G15** |
| 33 | **Mobile apps (iOS/Android)** | Missing — `public/sw.js` exists for web push; no web manifest | `public/` | Missing | **G16** (decision D7) |
| 34 | **Semrush App Center listing** | Missing | — | Missing | **G17** (decision D8) |
| 35 | Product videos "product-in-hand" from URL | Partial (Waltz AI i2v from product photo; no URL flow) | — | Partial | **G3** |

ClipWaltz-only strengths stay as they are (AutoWaltz beat-sync, WaltzDeck PPTX/PDF, enhancement/restore, Insta360, BYOK/Ollama connector, cloud auto-save, community/contests).

---

## 4. Merge design — moving SP into ClipWaltz

### 4.1 Principles

- **Port, don't rewrite.** SP's provider adapters and pre-flight logic encode many live failures (Bluesky byte limits, Mastodon URL billing, Threads id precision, Telegram escaping). Copy `src/lib/publishing/**` with history notes intact, then adapt imports.
- **ClipWaltz conventions win** where they differ: Next.js 16 server actions, Base UI (`render` prop, not `asChild` — see memory "ClipWaltz UI on Base UI"), MinIO storage, BullMQ queues, workspace tenancy, credits module.
- **Never import `@/db` from client components** (a known prod-build break in this repo).
- **Behind a flag** (`SOCIAL_PUBLISHING_ENABLED`, default off; owner-only allowlist while off) until P4.

### 4.2 Data — new tables in the `clipwaltz` db (Drizzle migrations `0064+`)

| New ClipWaltz table | From SP | Key change |
|---|---|---|
| `social_connections` | `social_connection` | add `workspace_id` (FK workspaces, cascade) + `created_by`; ownership scoped by workspace role (editor+ may publish, admin+ may connect/disconnect). Credentials column encrypted at rest (**new**: SP stores tokens plain in its db — R6) |
| `social_posts` | `post` | add `workspace_id`, nullable `render_id` / `export_id` (FK) so a post can carry a ClipWaltz render; keep `per_network`, `warnings`, `share_token`, `scheduled_at`, `status` |
| `social_post_targets` | `post_target` | unchanged shape (`connection_id`, `label`, `external_id`, `retry_at`, `manual`) |
| `social_media` | `media` | `storage_key` (MinIO) replaces disk path; `source` (`upload`/`ai`/`render`) |
| `social_auto_rules`, `social_auto_presets` | `auto_post_rule`, `auto_post_preset` | add `workspace_id` |
| `social_snippets` | `snippet` | add `workspace_id` |
| `social_ai_generations` | `ai_generation` | add `workspace_id` |
| `social_render_jobs` | `render_job` | or fold into existing `generation_jobs` with a new `kind` (preferred — one GPU accounting path, credits charged in one place) |
| P5 only: `funnels`, `funnel_stages`, `funnel_builds`, `products`, `offers`, `podcast_shows`, `podcast_episodes`, `podcast_listens`, `research_searches`, `research_findings`, `short_rules` | same | add `workspace_id`; **only if decisions D3–D6 keep them** |
| Not ported | `user session account verification invite invite_request membership billing_event app_setting` | Users map to ClipWaltz Better Auth users; SP billing dropped (D2); `app_setting` values move to ClipWaltz `app_settings` keyed `social:*` |

**Migration script** (`scripts/migrate-social-publishing.mjs`, run once in P4): connects to both dbs on linuxg1 (same instance), maps SP `user.email` → ClipWaltz `user.id` (create no accounts: an SP user with no ClipWaltz account is reported, not created — the owner signs up themself per §3b of the global rules), maps each user to their personal workspace, copies rows in FK order, copies media files from disk into MinIO under `social/<workspace>/<id>`, rewrites ids, and writes a row-count reconciliation report. Idempotent (`ON CONFLICT DO NOTHING` on preserved ids). Dry-run mode by default.

The env-configured Facebook Page / Instagram (`FACEBOOK_PAGE_ID`, `FACEBOOK_PAGE_ACCESS_TOKEN`) become a normal `social_connections` row owned by the owner's workspace during migration.

### 4.3 Auth

- ClipWaltz Better Auth is the only login. SP's 2 users must sign in to ClipWaltz (sign-up stays open — no closed beta). The owner account `lacy@phoenixtekk.com` keeps admin via ClipWaltz's existing `ADMIN_EMAILS` overlay (`src/lib/admin.ts`).
- SP RBAC capabilities map onto ClipWaltz workspace roles: `content.*`/`ai.*` → editor; `networks.manage` → admin; `admin.*` → site admin (`ADMIN_EMAILS`). SP's editable role matrix is **not** ported (one role model only). If the owner wants a per-capability matrix, that is decision D9.
- SP's invite-only gate, waitlist and invite analytics are **not** ported (conflicts with "no closed beta"). ClipWaltz workspace invites already exist (`workspace_invites`).

### 4.4 Routes (all under `src/app/(app)/publish/` unless noted)

| ClipWaltz route | SP source |
|---|---|
| `/publish` (dashboard) | `dashboard` |
| `/publish/compose` (+ `?render=<id>` prefill) | `compose`, `instant`, `videos` |
| `/publish/posts`, `/publish/drafts`, `/publish/favorites`, `/publish/shared` | same |
| `/publish/calendar` | `calendar` |
| `/publish/auto` | `auto-post`, `reshare` |
| `/publish/by-hand` | `handoff` |
| `/publish/analytics`, `/publish/comments` | same |
| `/publish/networks` | `networks` |
| `/account/…` existing | `settings`, `notifications` |
| `/r/[token]` (public) | `r/[token]` |
| `/setup-guide` (public) or a Help article | `setup-guide` |
| API: `/api/social/oauth/[provider]/{start,callback}`, `/api/social/media/public/[id]`, `/api/social/webhooks/threads/{deauthorize,delete}` | the per-network routes, collapsed into one dynamic route each |

UI is rebuilt in ClipWaltz components (Base UI + studio shell); SP logic (pre-flight, char meters, per-network overrides) moves into `src/lib/social/` and is called from server actions.

**The integration that makes the merge worth it:** a **Publish** button on every finished render, export and campaign-pack variant, opening the composer with the video attached, the AI-written description in the text, and per-network cuts chosen by aspect ratio (9:16 → TikTok/Reels/Shorts, 16:9 → YouTube/LinkedIn/X).

### 4.5 Workers and queues

- New BullMQ queue `clipwaltz-social` (name derived from `GENERATION_QUEUE` like the others in `src/lib/queue.ts`, so dev never hits prod) consumed by a new pm2 process **`clipwaltz-social-worker`** on linuxg1 (`worker/social-worker.mjs`).
- Job types: `publish-target` (one destination; idempotent on `post_target.id`, claim by clearing `retry_at` as SP does), `sweep` (repeatable every 60 s: due scheduled posts, auto-post slots, retries, token refresh), `metrics-pull` (repeatable hourly, analytics cache), `comments-pull` (on demand).
- This replaces SP's crontab + `/api/cron/run` HTTP sweep.
- AI image renders go through the existing generation queue (GPU slots, credits, cancellation, retries) as a new `kind: "image"`; target box decided in D1.
- Explainer/podcast/shorts jobs (P5, if kept) run on the existing render worker on the `ai` box.

### 4.6 Media

SP stores media on linuxg1 disk and makes **signed public URLs** for networks that pull by URL (Threads, Instagram, TikTok `PULL_FROM_URL`). In ClipWaltz, use MinIO presigned GET URLs via `media.clipwaltz.com` (ADR-0003, already public with no Access by design). Set the expiry ≥ 1 h. TikTok and Instagram fetch asynchronously, and SP's notes record failures when URLs expired too early.

### 4.7 Credits and pricing (proposal — **needs owner sign-off**, payment rule)

| Action | Proposed credits | Reason |
|---|---|---|
| Publish / schedule / analytics / comments | 0 | No GPU cost |
| AI copy, hashtags, captions (Ollama AI Box) | 0 | Self-hosted |
| AI image (G1) | 2 per image (same as `BACKDROP_COST`) | One frame of GPU time |
| Carousel (G2) | 2 per AI-generated slide; 0 for template-only slides | Same unit |
| Meme (G5) | 2 if AI image, 0 with an uploaded image | Same unit |
| AI video clip in a post (SVD) | Existing `generationCost` | Same as Waltz AI |

Plan limits (proposal): connected channels **Plus 10 / Pro 25**, scheduled posts unlimited, and Public API + MCP (G12/G13) for **Pro only**. SP's $99 founding plan is retired (D2). No Stripe changes happen until the owner signs off.

---

## 5. Cut-over of publish.phoenixtekk.com

**Recommendation: keep SP running in parallel until P4 passes, then redirect.** Do not just redirect the whole host on day one, because several SP URLs are load-bearing for third parties:

| SP URL | Who depends on it | Plan |
|---|---|---|
| `/api/<network>/callback`, `/api/*/oauth/callback` | Redirect URIs registered in Meta, LinkedIn, Threads, Pinterest, TikTok, Tumblr, X, YouTube dev apps | **Owner action:** add the new `https://www.clipwaltz.com/api/social/oauth/<p>/callback` URIs to each app *before* P4. Keep the old ones until every connection has been reconnected or migrated with its token |
| `/api/threads/deauthorize`, `/api/threads/delete` | Meta's required Threads callback fields | Update in Meta dashboard (owner), keep old routes alive until then |
| `/p/<slug>/rss.xml`, `/p/<slug>/audio/*`, `/p/<slug>/episode/*` | Apple Podcasts / Spotify subscribers | If the podcast moves (D4): emit `<itunes:new-feed-url>` on the old feed and **301 the feed forever**. Episode GUIDs must not change. If it doesn't move, the path stays on SP |
| `/media/<key>` | Autonnel `cdn.default_url` (public page images in MinIO `autonnel-media`) | Keep on SP, or move the route to ClipWaltz and repoint Autonnel's `cdn.default_url` (D3) |
| `funnels.phoenixtekk.com` (host-rewritten to `/commerce-proxy`) | Autonnel admin SSO | Stays on SP unless funnels move (D3) |
| `/r/<token>` review links | People the owner sent links to | 308 → `https://www.clipwaltz.com/r/<token>` (tokens migrated) |
| Everything else (`/`, `/dashboard`, `/compose`, …) | Signed-in users | 308 → matching `https://www.clipwaltz.com/publish/...` |

**Mechanism:** a `middleware.ts` redirect map in SP (keeps exceptions served), not a Cloudflare rule. Exceptions can only be carved out in the app. The SP process stays up until the exceptions are retired. After that, use a Cloudflare redirect rule and stop `social-publishing`, but only after a 30-day log check shows no hits on the exception paths.

**Done-list for cut-over:** update `server-inventory.md` (linuxg1 SP entry, new `clipwaltz-social-worker`, removed crontab line), My Apps card (repoint or delete the SP card), wiki pages, and SP `ADMIN_DOCS.md` with a "retired" banner.

---

## 6. Build items — what to build for each gap

Each item lists: **What**, **Touch**, **Data**, **Workers**, **UI**, **Credits**, **Accept** (acceptance tests). "M-port" items are the SP port in §4 and are tested in P1/P2.

### G1 — Image & ad generator (static ads, social graphics)
- **What:** A fourth studio tool, "Waltz Image": prompt or brief → image, with format presets (1:1 post, 4:5 feed, 9:16 story, 1.91:1 link/ad, 2:3 pin) and an optional **ad layout** (headline, subhead, CTA, logo from the brand kit) composited crisply. Port SP `ad-overlay.ts` (canvas), and use the brand kit's fonts/colors.
- **Touch:** `src/lib/image-ad/*` (port of `image-gen.ts` prompt building + `ad-overlay.ts`), `src/app/(app)/projects/new` (tool card), `worker/generation-worker.mjs` (`kind: "image"`), `credits.ts` (`IMAGE_COST`).
- **Data:** reuse `generation_jobs`/`generation_versions` with `kind='image'`; `assets` for outputs. Migration: add `'image'` to the kind check if constrained.
- **Workers:** generation queue → ComfyUI. **Decision D1:** use the ComfyUI box SP already uses (`.183`, Flux + Redux installed per SP docs), or AISERVER `.158`, which has **no text-to-image model** (memory "Wan single-frame images") and would need Flux installed (2× RTX 3080 10 GB: Flux-dev fp8 fit is **unverified**).
- **UI:** prompt, format picker, brand kit toggle, 4-up variations, edit headline text after render (re-composite only, no GPU), download PNG/JPG, **Publish**.
- **Credits:** 2/image (proposal §4.7).
- **Accept:** (1) every preset renders at exact pixel size; (2) headline text in the output is pixel-exact (not diffused). Test by OCR on 10 renders = 10/10 match; (3) a failed render refunds credits; (4) editing the headline does not create a GPU job.

### G2 — Carousel generator
- **What:** Topic or URL → 3–10 slide carousel (hook slide, value slides, CTA slide), using WaltzDeck's scene model and themes. Export as PNG set (IG/FB/Threads), a **PDF document** (LinkedIn document posts), and as a 9:16 slideshow video (existing WaltzDeck render).
- **Touch:** `src/lib/deck/*` (new deck `mode: "carousel"`), `worker/deck/*` (still-frame export per scene), `deck_exports` (new format `png-set` / `carousel-pdf`).
- **Data:** `deck_exports.format` enum + values; no new table.
- **Workers:** existing deck export worker on the `ai` box.
- **UI:** carousel mode in the deck editor (square/4:5 canvas, slide counter, swipe preview), Publish → multi-image post.
- **Credits:** 0 for template slides; 2 per AI backdrop (existing).
- **Accept:** (1) 10-slide 1080×1350 export produces 10 files at exact size; (2) the PDF opens with 10 pages; (3) published to Instagram as one carousel post (one post id, 10 children) on the owner's account.

### G3 — Product URL → ad / video pack
- **What:** Paste a product page URL. Read structured product data: JSON-LD `Product` (name, price, images, description) first, then `og:*`, then the existing body-text fallback. Generate an image-ad set (G1), a campaign video pack (existing), and post copy.
- **Touch:** `worker/deck/importer.mjs` (add JSON-LD `Product` parse; keep the existing SSRF guards), `src/lib/campaign-actions.ts` (entry point "From product URL").
- **Data:** `product_sources` table (`workspace_id, url, title, price, currency, images jsonb, fetched_at`) shared with G10.
- **UI:** "Start from a product link" on the new-project screen.
- **Credits:** sum of what it generates; show the total before confirming.
- **Accept:** (1) 5 real product pages (incl. one Shopify, one WooCommerce) → correct name, price and ≥1 image extracted; (2) a private/LAN URL is refused (SSRF test kept green); (3) no images → still produces a text-led pack and says so.

### G4 — Hashtags & post copy on every render
- **What:** One click on a render: platform-specific caption + hashtags (count per network: e.g. IG up to 30, LinkedIn 3–5, X 1–2), via the AI Box. Port SP's assistant prompts and `network-capabilities.ts` limits.
- **Touch:** `src/lib/social/copy.ts`, render detail UI.
- **Credits:** 0.
- **Accept:** output for each selected network passes that network's pre-flight with no "blocked" result; hashtags are deduplicated, contain no spaces, and fit the limits.

### G5 — Meme generator
- **What:** Template memes (top/bottom text, label-on-image layouts) on an uploaded or AI image, with AI caption suggestions from a topic. Text drawn by canvas (same compositor as G1), never diffused. **No third-party copyrighted meme templates shipped**: layouts only, with user images or AI images.
- **Touch:** `src/lib/image-ad/meme.ts`, a "Meme" preset in G1's UI.
- **Credits:** 0 with uploaded image; 2 with AI image.
- **Accept:** (1) long captions wrap and auto-shrink without overflowing (test 5 lengths); (2) output at chosen preset size.

### G6 — Suggested posting times
- **What:** Per connected channel, recommend time slots from **the workspace's own published-post metrics** (engagement per weekday×hour, last 90 days, min sample size). Below the minimum, show clearly-labelled generic defaults, not a fake personalised answer.
- **Touch:** `src/lib/social/best-time.ts`; composer schedule picker shows "Suggested" chips.
- **Data:** `social_post_metrics` (`target_id, captured_at, impressions, reactions, comments, shares, clicks`) filled by the `metrics-pull` job (also feeds G8).
- **Accept:** with seeded fixture data, the top slot is the known best bucket; with < N posts the UI says "not enough history yet — showing general guidance".

### G7 — Competitor content & ad intelligence (research spike first)
- **What:** Track named competitor accounts: posting frequency, timing, top themes (AI Box clustering, port SP's embedding code), and their public ads where an official source exists.
- **Spike required (unverified):** which sources are allowed. Candidates: Bluesky/Mastodon public APIs (open), YouTube Data API public channel stats, Meta Ad Library API (eligibility/coverage outside political/EU ads **unverified**), TikTok Commercial Content API (**unverified**). Scraping logged-in platforms is excluded (ToS risk R7).
- **Touch:** `src/lib/social/competitors/*`, `/publish/competitors`.
- **Data:** `competitor_accounts`, `competitor_posts` (public fields only, with source + fetched_at).
- **Workers:** `competitor-pull` repeatable job, rate-limited per source.
- **Accept:** for each supported source, a known public account's last 20 posts load with correct timestamps; unsupported networks are shown as "not available" rather than empty.

### G8 — Pre-publish engagement score
- **What:** A 0–100 score with reasons (hook length, media present, hashtag count, posting time vs G6, similarity to own past top posts). Shown as **guidance, labelled as an estimate**. Calibrate on the workspace's own `social_post_metrics`; no category benchmark data exists in-house, so don't claim one.
- **Touch:** `src/lib/social/score.ts`, composer side panel.
- **Accept:** on a held-out set of the owner's past posts, the score correlates positively with actual engagement (report the coefficient; do not ship the badge if it is ≤ 0).

### G9 — Approval workflow
- **What:** Post states `draft → in_review → approved | changes_requested → scheduled → published`. Workspace setting "posts need approval" (per workspace, optionally per channel). Approver = workspace admin, or a new `approver` capability (D9). External client approval through the existing `/r/<token>` review link with Approve / Request changes buttons (no login; token-scoped). Notifications by web push (existing `push_subscriptions`) and email (SES).
- **Touch:** `src/lib/social/approval.ts`, composer submit, `/publish/review`, `/r/[token]`.
- **Data:** `social_posts.approval_state`, `social_post_reviews` (`post_id, reviewer_user_id|token, decision, note, at`).
- **Accept:** (1) with approval on, an editor cannot schedule or publish (server-enforced, test calls the action directly); (2) the scheduler never publishes a post that is not `approved`; (3) a token review link can approve exactly its own post and expires on revoke.

### G10 — Shopify / WooCommerce / Wix catalog sync
- **What:** Connect a store, then sync products (title, price, images, URL, availability) into `product_sources` and generate ads/videos/carousels from any product (G1/G2/G3). Optional: on new product webhook, auto-create a draft pack.
- **Touch:** `src/lib/commerce/{shopify,woocommerce,wix}.ts`, `/account/integrations`, webhooks `/api/commerce/<p>/webhook`.
- **Data:** `commerce_connections` (encrypted creds, `workspace_id`), `product_sources.connection_id, external_id`.
- **Owner actions:** Shopify Partner app (custom/unlisted app first; App Store review later), Wix app registration. WooCommerce uses per-store REST keys (no app review).
- **Accept:** against a dev store per platform: sync 25 products correctly; price/title change reflected on re-sync; uninstall revokes and deletes creds; webhook signature checked (bad HMAC → 401).

### G11 — Ads-manager export
- **What:** Phase 1: export a campaign pack as a ready-to-upload bundle (named creatives by aspect + a CSV of headline/primary text/CTA/URL with UTMs from `campaign.ts`). Phase 2 (spike): push creatives via Meta Marketing API / TikTok Marketing API. That needs app review and ad-account permissions (**unverified**). No ad spend is ever created or changed by ClipWaltz.
- **Accept (phase 1):** bundle ZIP contains every variant with names matching the CSV rows; the CSV has all UTM parameters.

### G12 — Public API
- **What:** `/api/v1` with per-workspace API keys (hashed, scoped: `read`, `generate`, `publish`), rate limits, idempotency keys, and outgoing webhooks (`render.ready`, `post.published`, `post.failed`). Endpoints: create project from brief, start render/campaign pack, get status, list assets, create/schedule post. OpenAPI spec published in the Help Center.
- **Touch:** `src/app/api/v1/**`, `src/lib/api-keys.ts`, `/account/api`.
- **Data:** `api_keys` (`workspace_id, name, prefix, hash, scopes, last_used_at, revoked_at`), `webhook_endpoints`, `webhook_deliveries`.
- **Credits:** same costs as the UI; Pro only (proposal).
- **Accept:** key shown once; revoked key → 401; scope `read` cannot publish (403); the same `Idempotency-Key` twice creates one job; webhook signed (HMAC) and retried on 5xx.

### G13 — MCP server
- **What:** A remote MCP server (streamable HTTP) at `https://www.clipwaltz.com/mcp` wrapping G12, OAuth or API-key auth. Tools: `create_video_from_brief`, `get_render_status`, `create_image_ad`, `list_channels`, `schedule_post`.
- **Touch:** `src/app/mcp/route.ts` (or a small sidecar if the SDK needs a long-lived process — **unverified**, decide in build).
- **Accept:** connect from Claude Desktop / Claude Code, run each tool end-to-end on a test workspace; a key without `publish` scope cannot call `schedule_post`.

### G14 — Bulk generation / multi-angle copilot
- **What:** "Make a week": brief → 4 distinct angles (problem-solution, educational, social proof, minimalist) × chosen formats, laid onto the calendar as drafts (respecting G6 slots and approval G9). Builds on campaign packs + SP Auto Post generated slots. Open Auto-Batch (admin-only today, server paths) stays admin-only. This is a new user-facing flow, not that tool.
- **Accept:** a 7-day plan creates N drafts on the calendar, no two with cosine similarity ≥ 0.94 (SP's existing threshold), total credits shown and confirmed before any GPU job starts.

### G15 — Multi-brand / agency workspaces
- **What:** Let a user own several workspaces (one per client/brand), each with its own brand kit, channels, calendar and members, plus a workspace switcher in the top bar. Per-plan workspace limit (proposal: Plus 1, Pro 5).
- **Touch:** `src/lib/workspace-actions.ts` (`createWorkspace`), app shell switcher, active-workspace cookie checked server-side on every action.
- **Accept:** a project, channel or post in workspace A is never visible or publishable from workspace B (direct action calls with B's context → 403).

### G16 — Mobile (decision D7)
- **Recommended:** installable PWA (web manifest + existing `sw.js` push), with approval notifications and a mobile composer. Native iOS/Android apps only if the owner wants store presence.
- **Accept (PWA):** Lighthouse installable check passes; push for "needs approval" arrives on Android Chrome.

### G17 — Semrush App Center (decision D8)
- Listing on Semrush's App Center is a business/partner process (terms **unverified**). Recommend deferring until G12 exists.

---

## 7. Phases and order of work

| Phase | Contents | Depends on | Exit test |
|---|---|---|---|
| **P0 — Decisions & prep** | Owner answers D1–D9 (§9). Put SP source under git (R1). Register new OAuth redirect URIs (owner, §5). Agree credits/plan limits (§4.7). | — | Decisions recorded in `docs/architecture/DECISIONS.md` |
| **P1 — Publishing core** | Migrations `social_*`; port `src/lib/publishing/**`, `network-capabilities`, pre-flight, compose/title/image-fit/link-format; connections (workspace-scoped, encrypted creds); OAuth + paste-credential connects; `clipwaltz-social` queue + `clipwaltz-social-worker`; MinIO media + presigned pull URLs. Flag off, owner-only. | P0 | Owner workspace: connect Bluesky, Mastodon, Telegram, Discord; publish text+image+video to each; delete the test posts; retry + idempotency test (double-submit = one post) |
| **P2 — Publish UI + render integration** | Composer, posts/drafts/favorites, calendar, schedule/queue/reschedule, Auto Post rules + presets, Re-Share, by-hand queue, analytics, comments, review links; **Publish button on renders/exports/campaign variants**; G4 copy+hashtags | P1 | Schedule a render to 3 networks 5 min ahead → published on time by the worker; analytics shows metrics for it within 1 h |
| **P3 — Images & carousels** | G1 image/ad tool (after D1 box choice), G5 memes, G2 carousels, AI image in posts via the generation queue | P1 (P2 for publish) | G1/G2/G5 acceptance tests |
| **P4 — Data migration + cut-over** | Dry-run migration → reconciliation report → owner review → real run; reconnect or migrate tokens; parallel run ≥ 7 days with SP read-only for publishing (scheduler sweep disabled on SP **only after** ClipWaltz's sweep is proven, never both live on the same rule — R3); SP redirect map; inventory/My Apps/wiki updates | P2 | Row counts match (494 posts, 20 connections, 11 rules — or the then-current numbers); no post published twice; no scheduled post missed in the parallel window |
| **P5 — SP extras (per decisions)** | Funnels + Autonnel + SSO proxy + `/media` (D3); podcast + feed move (D4); Problem Finder (D5); explainer/Shorts (D6) | P4 | Per-feature tests from SP FEATURES.md re-run on ClipWaltz |
| **P6 — Remaining Predis gaps** | G9 approval → G6 best time → G15 multi-brand → G14 bulk → G3 product URL → G10 e-commerce → G12 API → G13 MCP → G8 score → G11 export → G7 competitor spike → G16/G17 per decisions | P2 (G6/G8 need P2 metrics history) | Each G-item's acceptance tests |
| **P7 — Parity re-check + docs** | Re-run §8 against the built code; FEATURES.md, ADMIN_DOCS.md, HELP_CENTER.md, wiki, My Apps; marketing handoff refresh (`PRODUCT_PROFILE.md`, `product.marketing.json`) | P6 | §8 table has no "Missing" row without an owner-approved exclusion |

Ordering rationale: P1–P2 deliver the biggest Predis gaps (rows 16–22) by porting proven code. P4 runs before P5/P6 so there is one product to maintain as soon as possible. Within P6, approval and best-time come first because they build on P2 data; external-platform items (e-commerce, ads export, competitor) come last because they depend on third-party app approvals.

---

## 8. Parity re-check — combined product after all phases (target state)

| Predis capability | ClipWaltz after plan | Source |
|---|---|---|
| Text/image-to-video, video ads, UGC avatars, voiceover/cloning/dubbing, captions, music, brand kits, aspect ratios | Present (today) | §3 rows 1–9 |
| Static image ads + social graphics | Present | G1 |
| Carousels | Present | G2 |
| Product URL → ads/videos | Present | G3 |
| Hashtags / complete posts | Present | SP port + G4 |
| Memes | Present | G5 |
| Calendar, scheduling, autopublishing, multi-account | Present (LinkedIn pending LinkedIn's API approval) | SP port |
| Best time to post | Present (own-history based) | G6 |
| Social analytics | Present (FB, IG, Threads, Bluesky; others where APIs allow) | SP port |
| Competitor content/ad intelligence | **Partial** (open APIs only; closed networks depend on G7 spike) | G7 |
| Engagement score | Present (labelled estimate) | G8 |
| Approval workflow | Present | G9 |
| Shopify / WooCommerce / Wix | Present (after partner-app approvals) | G10 |
| Export to ads managers | Present (bundle); direct push = spike | G11 |
| Public API, MCP | Present | G12, G13 |
| Bulk / agent mode / multi-angle | Present | G14 |
| Multi-brand agency workspaces | Present | G15 |
| Mobile app | PWA (native only if D7 says so) | G16 |
| Semrush listing | Deferred (D8) | G17 |

Honest residue: competitor intelligence on Meta/TikTok, direct ads-manager push, and LinkedIn posting each depend on a third party granting API access. Parity there cannot be promised by code alone.

---

## 9. Owner decisions needed (P0)

| # | Decision | Options (recommendation first) |
|---|---|---|
| D1 | GPU box for AI images (G1) | Use the ComfyUI box SP already uses (`192.168.166.183`) · install Flux on AISERVER `.158` (fit **unverified**) |
| D2 | SP's $99 founding plan (never switched on) | Retire it; social publishing becomes part of ClipWaltz Plus/Pro · keep a separate "Publish" add-on (needs Stripe work + sign-off) |
| D3 | Funnels + Autonnel + `funnels.phoenixtekk.com` SSO + `/media` proxy | Leave on SP (Phoenixtekk-internal) · move into ClipWaltz |
| D4 | Podcast hosting (1 show live) | Move with `itunes:new-feed-url` + permanent 301 · leave on SP |
| D5 | Problem Finder (Reddit/Intune research, Workplace-store grounding) | Leave on SP (Phoenixtekk-specific) · generalise for ClipWaltz users |
| D6 | Explainer + Shorts pipeline (ElevenLabs, Workplace catalogue) | Fold the *publishing* of ClipWaltz renders in; leave Phoenixtekk explainers on SP · port fully |
| D7 | Mobile | PWA · native apps |
| D8 | Semrush listing | Defer · pursue |
| D9 | Permissions | Workspace roles + one new `approver` capability · port SP's editable role matrix |

### 9.1 Owner answers (2026-11-14)

| # | Answer |
|---|---|
| D1 | ComfyUI box `192.168.166.183` (the one SP already uses) |
| D2 | Retire SP's $99 plan; social publishing is part of ClipWaltz Plus/Pro. No new Stripe products |
| D3 | Funnels, Autonnel, `funnels.phoenixtekk.com` SSO and `/media` proxy **stay on SP** |
| D4 | Podcast **moves** to ClipWaltz with `itunes:new-feed-url` + permanent 301 |
| D5 | Problem Finder **stays on SP** |
| D6 | Explainer + Shorts pipeline **ports fully** into ClipWaltz (P5) |
| D7 | PWA |
| D8 | Semrush deferred |
| D9 | Workspace roles + one new `approver` capability |
| §4.7 | Credits and plan limits **approved as proposed** |
| UI | **All new screens use shadcn/ui (https://ui.shadcn.com/)** via the repo's existing `components.json` (`style: base-nova`, Base UI primitives, lucide icons). Add components with `npx shadcn@latest add <name>`; do not port SP's own UI components. |

Consequence: `publish.phoenixtekk.com` stays alive as a Phoenixtekk-internal tool (funnels, Autonnel, Problem Finder); only the social-publishing user surface, the podcast and the explainer/Shorts pipeline move.

If D3–D6 keep pieces on SP, `publish.phoenixtekk.com` stays alive as a Phoenixtekk-internal tool, and only the social-publishing user surface redirects. §5 covers both cases.

---

## 10. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | **SP source is not under git locally**, and local differs from prod (local has migration `0031`, prod stops at `0030`) | P0: `git init` + commit local, diff against a tarball of `/home/lacy/social-publishing` (read-only copy), reconcile before porting |
| R2 | Platform app review for a **multi-tenant** public product: SP works at owner scale. Meta (FB/IG/Threads), TikTok (unaudited → drafts/private), YouTube (unaudited → private), LinkedIn (CM API not approved), Pinterest (not approved). Public users may be limited until each review passes (exact per-platform limits **unverified**) | Ship networks per review status; show "owner-only / pending review" honestly in Networks; start reviews in P0 since they gate P4 |
| R3 | Double publishing during parallel run | Only one sweep owns a given rule/post at a time; migration flips ownership per row; idempotency on `post_target.id`; verify zero duplicates in P4 |
| R4 | OAuth redirect URI change breaks reconnects | Register new URIs before P4 (owner); keep old ones until all tokens migrated |
| R5 | Token portability: some tokens are bound to the app/redirect, not the host. Migrated tokens may still work; refresh flows may not (**unverified** per provider) | Test refresh per provider in P1 with owner accounts; fall back to "Reconnect" prompt |
| R6 | Credentials stored unencrypted in SP's `social_connection` | Encrypt at rest in ClipWaltz (`SOCIAL_CREDS_KEY`, AES-GCM), never sent to the client; Security Engineer review in P1 |
| R7 | Competitor scraping ToS / legal exposure | Official APIs only (G7 spike); Legal Compliance review before build |
| R8 | GPU contention: image renders compete with Waltz AI video for the same slots | Route images to the generation queue with their own concurrency, or to D1's separate box |
| R9 | Next 14 → 16 and Radix/shadcn → Base UI differences | Port logic only; rebuild UI in ClipWaltz components |
| R10 | Next.js prod build breaks if client code imports `@/db` | Keep `src/lib/social/*` server-only (`import "server-only"`); only restart pm2 if `next build` exits 0 |
| R11 | Podcast subscribers lost if the feed URL changes wrongly | `itunes:new-feed-url` + permanent 301; GUIDs preserved; verify in Apple Podcasts Connect (owner) |
| R12 | Scope size: this is several months of work across 7 phases | Each phase ships independently behind the flag; P2 alone closes most Predis gaps |

---

## 11. Definition of done (every phase)

Per the standing rules: `FEATURES.md`, `ADMIN_DOCS.md` (env vars incl. `SOCIAL_PUBLISHING_ENABLED`, `SOCIAL_CREDS_KEY`, per-provider client ids; runbooks for the social worker), `HELP_CENTER.md` updated as built; wiki mirror verified; `server-inventory.md` updated for any new pm2 process/port/route; My Apps card for any new public URL; Feedback button already present in ClipWaltz (`feedback` table), so nothing new is needed there.

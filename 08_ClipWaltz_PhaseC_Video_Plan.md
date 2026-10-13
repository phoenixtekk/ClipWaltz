# ClipWaltz — Phase C: outside video models, talking photo & GPU jobs on the user's computer

**Status:** approved 2026-10-13 (decisions in §6) · C0 done (§7) · C1 built + dev-verified with a vendor mock (not deployed, no real keys yet) · C2/C3 next · builds on Phase A (outside writing models, live) and Phase B (ClipWaltz
Connector, live). Every vendor fact below was checked on 2026-10-13 against the vendor's own docs/pricing pages (links in
the appendix); anything not confirmed there is marked **unverified**.

## 1. What Phase C adds

| | Today | After Phase C |
|---|---|---|
| **Waltz AI clips** (text/image → video) | Built-in Wan 2.2 5B on AISERVER only | + cloud models (Kling, Runway…) with ClipWaltz's key and/or the user's own key, per plan |
| **Talking photo** (photo + voice → speaking video) | Not possible (EchoMimic v3 didn't fit 10 GB) | Cloud (HeyGen), the user's own GPU (Connector), and — if the Flash test passes — our own AISERVER |
| **Lip-sync a video to new audio** (translate, re-voice) | Not possible | Cloud (HeyGen video translate / Sync) |
| **The user's own GPU** | Connector runs writing jobs on Ollama | Connector also runs fixed ComfyUI video templates on the user's NVIDIA GPU |

## 2. Findings that shape the plan

- **OpenAI Sora API was shut down on 2026-09-24** — not an option. **Google Veo 3.1**: 4/6/8 s only, no 1:1, and it can't
  lip-sync to a given audio track (speech only from the prompt) — weak fit for both jobs.
- **Kling 3.0** (direct API): 3–15 s, 720p–4K, first+last frame, optional native audio, webhooks, files kept 30 days;
  $0.084/s at 720p (no audio). English API terms **unverified** (Chinese agreement: commercial use not restricted).
- **Runway**: one key reaches gen4.5 ($0.12/s), gen4_turbo ($0.05/s, image→video) and partner models (Veo 3.1, Hailuo,
  Wan…); commercial use allowed; requires a **"Powered by Runway"** credit in apps; Tier-1 accounts: 1 concurrent task,
  50/day.
- **MiniMax H3-Max**: $0.05/s (480P), 5–15 s, 1:1 — cheapest usable; terms page **unverified**. **Luma Ray 3.2**: image→video 5 s only.
- **Talking photo — HeyGen Avatar IV**: photo + your own audio, $0.05/s, self-serve $5 wallet, video translate $2–4/min.
  HeyGen does **not** check consent for photo avatars (its consent API covers digital twins only) — ClipWaltz must.
- **Lip-sync existing video — Sync (sync.so) lipsync-2**: ~$0.05/s, up to 30 min (Scale), no watermark from Creator.
- **Hedra**: its published API terms forbid integrating the API into your own product → **excluded**. Veo: no given-audio.
- **Own GPU (Connector)**: ComfyUI has a simple local HTTP API (no auth, localhost). Commercial-licence talking-photo
  models: **EchoMimic v3-Flash** (documented 12 GB; ~6.5 GB at 768×512 with block offload — **we only tested the
  non-Flash 1.3B, which ran out of memory on 10 GB**), **InfiniteTalk / MultiTalk** (Apache-2.0; 24 GB class),
  Wan2.2-S2V (80 GB official). Sonic is non-commercial (excluded).
- **Credits vs cost:** a credit is worth ≈ $0.05 on Plus ($15/300) and ≈ $0.039 on Pro ($39/1,000). Today 1 credit = 1 s
  of standard video. Cloud video at $0.05–0.12/s therefore needs **2–3+ credits per second** to not lose money on
  ClipWaltz's key. (User's own key or own computer: the user pays / it's free to ClipWaltz.)

## 3. Design (reuses Phase A/B)

- **Provider modules in the generation worker** (`worker/video/providers/*.mjs`), one interface:
  `submit(job) → id`, `poll(id) → {status, outputUrl}`, `fetch(output) → bytes`, `cancel(id)`. The existing AISERVER code
  (today inline in `generation-worker.mjs`) becomes the `aiserver` module — no behaviour change. Outputs go through the
  existing `storeVersionVideo` (MinIO, watermark, versions), so the editor, exports and credits keep working.
- **Admin (`/admin/ai` → Video models):** per provider — on/off, plans, ClipWaltz's key (tested), users' own keys
  allowed, **credits per second** (admin-set; defaults proposed from cost), **daily clip limit per user** on ClipWaltz's
  key. Same storage pattern as Phase A (`app_settings`, encrypted keys in `user_ai_keys`).
- **Users:** the Generate tab gets a **Model** picker: *ClipWaltz AI (built-in)* + each provider offered on their plan,
  showing the credit cost (or "your key — billed by <vendor>", or "your computer — free"). Unsupported shapes are greyed
  out per model (e.g. Veo: no 1:1).
- **Talking photo & lip-sync** become job types `talking_photo` (photo + script→Kokoro voice, or uploaded audio) and
  `lipsync` (video + audio) — the first piece of **Waltz Avatar** that users can try. Voice comes from the existing Kokoro
  TTS (needs a route from linuxg1 to the AI box's TTS service — today it's localhost-only on the AI box).
- **Consent & disclosure (owner: automatic only):** before any talking-photo job the user confirms *"This is me, or I have
  this person's permission"* (stored with the job); public-figure photos are refused where the vendor flags them (HeyGen/
  D-ID moderation); every talking-photo/lip-sync output gets the visible **"AI-generated"** label by default (EU AI Act
  Art. 50). Twin creation with a live consent clip stays Waltz Avatar Phase 1.
- **Connector v0.2 (GPU jobs):** new job kind `comfy.run` = a **template shipped inside the Connector** (versioned; the
  server only fills typed values — text, numbers, file references — never nodes or graph). Inputs downloaded from
  short-lived signed URLs; outputs uploaded to a new token-gated `/api/connector/jobs/:id/output` (size-capped, streamed
  to MinIO). The Connector reports its GPU (`nvidia-smi`), ComfyUI presence (`/system_stats`) and installed node packs
  (`/object_info`), so ClipWaltz only offers what that computer can run. Templates: talking photo (EchoMimic v3-Flash for
  12–16 GB, InfiniteTalk for 24 GB) and image→video (Wan 2.2 TI2V-5B, 24 GB). ComfyUI stays on localhost.

## 4. Phases

| Step | What | Effort | Done when |
|---|---|---|---|
| **C0** | Spike: EchoMimic v3-**Flash** on AISERVER (10 GB) — if it fits, self-hosted talking photo with no vendor | ~½ day | measured VRAM + s/video-second + sample you approve |
| **C1** | Video provider framework + **Kling** + **Runway**; admin cards, keys, credit rates, daily caps; Generate-tab model picker | ~1–1.5 wk | a Kling and a Runway clip made from the Generate tab, charged per the admin's rate |
| **C2** | **Talking photo** (HeyGen; AISERVER if C0 passes) + **lip-sync** (Sync); TTS route; consent confirm + AI label | ~1 wk | a photo + script → speaking video, and a clip re-voiced, from the UI |
| **C3** | **Connector v0.2**: GPU detection, ComfyUI templates (talking photo, image→video), binary in/out | ~1–1.5 wk | a talking photo rendered on a user's own GPU end to end |

Each step: security review, dev-verified end to end, docs + wiki, then deploy on your go-ahead.

## 5. Decisions for the owner

1. **Cloud video providers to start with** — recommended **Kling + Runway** (Runway also unlocks Veo/Hailuo/Wan with one key,
   but needs a "Powered by Runway" credit). Alternative cheap option: MiniMax.
2. **Talking photo / lip-sync vendors** — recommended **HeyGen** (talking photo + translate) **+ Sync** (lip-sync).
3. **Credit price on ClipWaltz's key** — proposed defaults (admin can change): Kling 720p **3 credits/s**, Runway gen4_turbo
   **2/s**, gen4.5 **4/s**, HeyGen talking photo **2/s**, Sync lip-sync **2/s**. Own key / own computer: **0 credits**.
4. **Talking photo of other people** — allow with the user's "I have permission" confirmation (recommended, matches your
   automatic-only consent), or own face only.
5. **Order** — recommended **C0 now** (cheap, may remove the need for a vendor), then C1 → C2 → C3.

## 6. Owner decisions (2026-10-13)

1. **Cloud video:** **Kling, Runway and MiniMax** (C1).
2. **Talking photo / lip-sync:** **own GPUs only for now** — no vendor. C2 becomes: talking photo on AISERVER if the C0
   EchoMimic v3-Flash test fits 10 GB, and on users' GPUs through the Connector (C3). HeyGen / Sync not integrated.
3. **Credits on ClipWaltz's key:** the proposed defaults (Kling 720p 3/s, Runway gen4_turbo 2/s, gen4.5 4/s; MiniMax
   H3-Max 480P 2/s, 768P 3/s by the same cost rule; own key / own computer 0) — admin-editable.
4. **Talking photo of other people:** allowed with the user's "this is me / I have their permission" confirmation, stored
   with the job; outputs labelled AI-generated.
5. **Order:** C0 → C1 → C2 → C3.

## 7. C0 result — EchoMimic v3-Flash on AISERVER (2026-10-13): **fits 10 GB**

One RTX 3080 10 GB (GPU 1), Flash weights (`echomimicv3-flash-pro`, Apache-2.0) on Wan2.1-Fun-V1.1-1.3B-InP, 8 steps,
TeaCache, umT5 text encoder on the CPU, model CPU offload; 81 frames = 3.24 s at 25 fps; EchoMimic's sample photo + 5 s audio.

| Sample size | Output | Peak VRAM | Diffusion | Run (excl. ~2 min model load) | GPU-s per video-s |
|---|---|---|---|---|---|
| 768×512 | 464×832 | **9.39 GB** | 8 × 40.1 s | 364 s | ≈ 112 |
| 512×384 | 320×576 | **6.82 GB** | 8 × 11.3 s | 122 s | ≈ 38 |

- Frames look realistic (blinks, mouth shapes, stable background and hands); lip-sync accuracy is for the owner to judge
  from the clips in `docs/phase-c/`.
- Fixes needed on our stack: the official script ignores its memory-mode flag (loads everything on the GPU); transformers
  5.x needs a hook to read the audio encoder's layer outputs; `pyloudnorm` missing from requirements.
- **Implication:** talking photo on AISERVER is feasible for short clips (≤ 10 s ≈ 6–19 GPU-minutes); a resident service
  avoids the 2-min load; Real-ESRGAN (already on AISERVER) can upscale the 512×384 output. Longer clips → users' GPUs (C3).

## Appendix — sources (fetched 2026-10-13)

Video: ai.google.dev/gemini-api/docs/veo · ai.google.dev/gemini-api/docs/pricing · ai.google.dev/gemini-api/terms ·
developers.openai.com/api/docs/guides/video-generation · docs.dev.runwayml.com/api · docs.dev.runwayml.com/guides/pricing ·
docs.dev.runwayml.com/usage/tiers · runway.com/terms-of-use · kling.ai/document-api/api/video/3-0-omni/image-to-video ·
kling.ai/document-api/pricing/base/video · docs.agents.lumalabs.ai · lumalabs.ai/legal/tos ·
platform.minimax.io/docs/api-reference/video-generation-v2-create.md · platform.minimax.io/docs/pricing/overview.md ·
fal.ai/pricing · replicate.com/pricing.
Talking photo / lip-sync: docs.heygen.com/docs/create-avatar-iv-videos · developers.heygen.com/docs/avatar-consent ·
docs.heygen.com/reference/limits · docs.d-id.com/reference/createtalk · hedra.com/api-terms · hedra.com/acceptable-use ·
sync.so/docs/models · sync.so/pricing · sync.so/terms · byteplus.com/en/product/OmniHuman · fal.ai/models/fal-ai/bytedance/omnihuman ·
github.com/MeiGen-AI/InfiniteTalk.
Own GPU: docs.comfy.org/development/comfyui-server/comms_routes · github.com/comfyanonymous/ComfyUI (server.py, cli_args.py) ·
blog.comfy.org/p/comfyui-2025-jan-security-update · github.com/antgroup/echomimic_v3 · github.com/smthemex/ComfyUI_EchoMimic ·
github.com/kijai/ComfyUI-WanVideoWrapper · github.com/MeiGen-AI/MultiTalk · github.com/Fantasy-AMAP/fantasy-talking ·
github.com/jixiaozhong/Sonic · github.com/Wan-Video/Wan2.2 · github.com/Wan-Video/Wan2.1 · docs.comfy.org/tutorials/video/wan/wan2-2-s2v.

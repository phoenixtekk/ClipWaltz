# ClipWaltz — Phase C: outside video models, talking photo & GPU jobs on the user's computer

**Status:** approved 2026-10-13 (decisions in §6) · C0 done (§7) · C1 live 2026-10-13 · C2 designed (§8) · C3 next · builds on Phase A (outside writing models, live) and Phase B (ClipWaltz
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

## 8. C2 design — talking photo on AISERVER (2026-10-13)

**Measured (one RTX 3080 10 GB, EchoMimic v3-Flash, 8 steps, 512×384):** 81 frames (3.2 s) 6.8 GB / 122 s; **161 frames
(6.4 s) 9.05 GB / 324 s**; 249 frames (10 s) **ran out of memory**. The Flash script renders one pass (no chunking), and
cost grows faster than length — so clips longer than ~6 s need **chunked rendering** (≈ 3 s windows with a short overlap,
like EchoMimic's non-Flash `partial_video_length` loop) at ≈ 38 GPU-s per video-s. For comparison, a built-in Wan
image→video clip on prod takes a median **578 s for ~5.4 s ≈ 107 GPU-s per video-s** and costs 1 credit/s.

**Design:**
1. **AISERVER `clipwaltz-talking` service** (own venv from the spike, `127.0.0.1:8192`, systemd): EchoMimic v3-Flash kept
   loaded with CPU offload, chunked rendering at 512×384, then Real-ESRGAN 2× (already on AISERVER) → e.g. 640×1152 for 9:16.
2. **Wrapper** (`aiserver/wrapper/app.py`): new id `echomimic-talking-v1` with a non-ComfyUI branch; audio accepted by
   `/inputs`; **GPU guard** — a talking job waits until GPU 1's ComfyUI queue is empty and, while it runs, new ComfyUI jobs
   go to GPU 0 (EchoMimic + Wan on one 10 GB card would run out of memory).
3. **Voice:** the script is spoken by Kokoro. It runs only on the AI box (localhost); recommended: install Kokoro inside
   the talking service on AISERVER (same voices, CPU, Apache-2.0) instead of a linuxg1→AI-box tunnel.
4. **App:** Waltz AI → **Talking photo**: pick a photo, type the script + voice (or upload audio), confirm "this is me /
   I have their permission" (stored), output labelled AI-generated; job type `talking_photo` on the GPU queue.

**Owner decisions (2026-10-13):** price **1 credit/s** (same as built-in clips); max length **30 s** for everyone; voice
from **Kokoro installed on AISERVER** inside the talking service.

**C2 built (2026-10-13, dev-verified; prod app not yet deployed):**
- `clipwaltz-talking` is **live on AISERVER** (127.0.0.1:8192, GPU 1) and the wrapper with `echomimic-talking-v1` + GPU
  guard is **live** (wrapper idle at restart; backup `/opt/clipwaltz-ai/scripts/app.py.bak-*`).
- Chunks of 113 frames with 8-frame cross-fade: **peak 7.7 GB**; 5.2 s → 246 s, 18.8 s (5 chunks) → 873 s ≈ **47 GPU-s per
  video-s** (the 512×384 single-pass figure of 38 did not include the per-chunk prompt encoding, now cached). Seams show
  no visible jump. Samples: `docs/phase-c/c2-talking-5s.mp4`, `c2-talking-19s-chunked.mp4`, `c2-talking-e2e-v7.mp4`.
- Two fixes found on the way: diffusers' `maybe_free_model_hooks()` re-hooks the CPU-kept umT5 onto the GPU after every
  call (chunk 2 ran out of memory) — re-pinned after each call; umT5 prompt encoding (~30–50 s/call on CPU) cached.
- Real-ESRGAN 2× is wired but **blocked by the NVIDIA driver/library mismatch** (NVENC) until the AISERVER reboot; clips
  are kept at 320×576 meanwhile.
- App: Generate tab → Talking photo (script + 15 Kokoro voices, or upload a recording), consent stored, AI label, credits
  settled to rendered seconds; migration 0057. Details in `FEATURES.md` / `ADMIN_DOCS.md`.

## 9. C3 — video on the user's own GPU (built 2026-10-14, dev-verified, not deployed)

**Done-when met:** a talking photo rendered on a user's own GPU end to end — the owner's workstation (Windows, RTX 3080
10 GB, ComfyUI portable 0.40.0) as the "user's computer", paired to the dev app: 4.7 s clip in 61 s, 11.2 s in 175 s
(3 chunks), stored as a version with label + watermark, 0 credits. Image → video (Wan 2.2 5B) also runs there.

**Decisions on the way (owner 2026-10-14):**
- The public EchoMimic node pack (smthemex/ComfyUI_EchoMimic) fails on a fresh ComfyUI — mediapipe on Python 3.13 has
  no legacy API, a missing `.dist` module, `librosa` not listed (upstream issue #168, unanswered). → **Our own node pack
  "ComfyUI-ClipWaltz"** built from the AISERVER service code (`comfyui-clipwaltz/`, `/connector/comfyui-clipwaltz.zip`).
- InfiniteTalk (24 GB) not done — no 24 GB card to test on.

**Design as built:** Connector 0.2 detects ComfyUI + GPU (`/system_stats`, `/object_info`) and reports per template
ready/missing; two templates written in the Connector (`wan-i2v-v1`, `clipwaltz-talking-v1`); files in via token-gated
`input/:name`, video out via `output` (MP4, ≤ 50 MB), progress/cancel via `progress`; typed scripts spoken by Kokoro on
AISERVER (`/tts`); jobs on their own queue (`-computer`), max 2 active per user, max 5 computers per user.

**Measured on the 10 GB desktop card:** talking ≈ 13–16 s of GPU per second of speech (precomputed prompt embeddings,
no 11 GB text encoder; 4.7 s in 61 s, 11.2 s in 175 s) — vs AISERVER's 47, measured before its prompt cache; image → video sampling
26 s/step (20 steps), and the full-frame VAE decode had to become tiled (full decode overflowed the card → Windows
spilled to RAM).

**Security review (2026-10-14), 6 fixes:** own queue + per-user caps (a computer job held a cloud-clip slot for hours);
pinned model downloads with sha256/git-blob checks + `weights_only=True`; `Object.hasOwn` for input names; orphan
upload deleted; Connector accepts only UUID job ids and caps downloads while reading.

**Not done / next:** deploy (migration 0058, app + gen worker, AISERVER wrapper/service already live); hosting the node
pack on GitHub (today a zip from clipwaltz.com); InfiniteTalk/24 GB template; talking-photo upscale for computer jobs.

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

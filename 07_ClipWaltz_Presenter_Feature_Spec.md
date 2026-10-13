# ClipWaltz — Presenter (AI avatar videos) · Feature design & plan

**Status:** approved — Phase 0 (spike) complete, Phase 1 not started · 2026-10-13 · name **Waltz Avatar**
**Goal:** HeyGen-style videos — a presenter (the user's own "digital twin", or an AI presenter) speaks a script, with
slides, b-roll, captions, music and brand — built on ClipWaltz's self-hosted stack (no per-minute vendor fees).

Every model/licence/legal fact below was checked against primary sources on 2026-10-13 (links in the appendix);
anything not confirmed is marked **unverified** and is a Phase 0 task.

---

## 1. What HeyGen offers (verified) and what we'll match

| HeyGen feature | ClipWaltz plan | Phase |
|---|---|---|
| Digital twin from a video (+ consent video, voice clone) | **Your Presenter**: record 2–5 min of yourself + a live consent clip → re-lip-synced to any script | 1 |
| Stock avatars (500–700+) | **AI presenters**: a starter library of *fictional* generated people (no likeness rights) + later licensed actors | 2 |
| Voice cloning | Clone your own voice (consent-gated); Kokoro voices stay as the free option | 2 |
| Script-to-video with scenes/templates, brand kit, captions | Reuse **WaltzDeck** planner, scene editor, brand kits, word-timed captions, music, exports | 1 |
| Video translation with lip-sync, keeps your voice | **Translate a video**: translated script → your cloned voice → lips re-synced | 3 |
| Photo avatar ("talking photo", Avatar IV) | One photo → talking presenter — **only if a model passes the Phase 0 fit test** | 4 |
| Real-time/interactive avatar (LiveAvatar) | Out of scope for now; revisit after Phase 3 | later |

HeyGen pricing for reference: Free 1-min videos, Creator $29/mo, Pro $49/mo, Business $149/mo (pricing page).

## 2. How it works for the user

1. **Create your presenter (once):** record or upload 2–5 min of yourself talking naturally to camera (good light,
   steady frame) → record a **live consent clip** reading a sentence with a one-time code shown on screen → ClipWaltz
   checks it's the same person, then builds your presenter (minutes). Optional: also clone your voice from the same audio.
2. **Make a video:** "New → Presenter video" → paste a script *or* describe the goal (the WaltzDeck planner writes it)
   → pick presenter + voice + look → scene cards appear: *presenter full-frame*, *presenter + slide*, *slide with a
   presenter bubble*, *b-roll with voiceover* → edit any line → **Render**.
3. **Translate:** pick a finished video (or upload one of yourself) → language → review the translated script →
   render with your voice and re-synced lips.

Everything else is shared with the rest of ClipWaltz: brand kits, captions (top/bottom), music + voice mix, aspect
ratios, render queue (paid first), cloud auto-save, community sharing, credits.

## 3. Technology choices (self-hosted, commercial-use licences only)

| Job | Choice | Why | Licence (verified) | Fits a 10 GB RTX 3080? |
|---|---|---|---|---|
| Lip-sync a presenter video to new audio | **MuseTalk 1.5** | Works on real footage → most realistic for twins; small | Code MIT; README says weights usable "for any purpose, including commercially" (dependencies keep their own licences — check in Phase 0) | Yes — ran on a 4 GB laptop GPU; 30 fps+ on V100 |
| Lip-sync backup / quality option | LatentSync 1.5 | Diffusion lip-sync | Code Apache-2.0; weights "openrail++" — commercial terms **unverified** | 1.5 needs 8 GB (1.6 needs 18 GB — no) |
| Photo → talking presenter (Phase 4) | Candidates: **InfiniteTalk**, FantasyTalking, EchoMimic v3 | Lips + head + body from one image | InfiniteTalk Apache-2.0 code+weights; EchoMimic v3 Apache-2.0; FantasyTalking code Apache, weights licence **not stated** | **Unverified** for all three (14B / 12–16 GB stated) — Phase 0 test |
| Voice cloning | **Chatterbox (Resemble AI)** | 23 languages, adds an inaudible PerTh watermark to every output | MIT code + weights | VRAM not stated; "Nano" runs on CPU ~3× realtime — Phase 0 test |
| Stock voices | **Kokoro** (already running) | 15 voices, 5 languages, word timings | Apache-2.0 | CPU |
| Script / translation | Ollama (already running) via WaltzDeck planner | Reuse | — | — |
| Fictional AI presenters | Wan 2.2 (already on AISERVER) → short base clips → MuseTalk | No real person's likeness | Apache-2.0 | Yes (in use) |

**Rejected (licence):** Wav2Lip (commercial use prohibited), Sonic (CC BY-NC-SA), XTTS-v2 (non-commercial),
F5-TTS (weights CC-BY-NC), Fish Audio (no hosted-service licence), HunyuanVideo-Avatar (excludes EU/UK/S. Korea),
**InsightFace models** (non-commercial — used inside LivePortrait/Hallo; we must not ship them).
**Too big for our GPUs:** Wan2.2-S2V (80 GB stated), MultiTalk 720p (multi-GPU), LatentSync 1.6 (18 GB).

## 4. Architecture (mostly reuse)

```
Script / goal ─► Planner (Ollama, WaltzDeck) ─► Scene cards (UI) ─► Voice (Kokoro or cloned voice)
      ─► Lip-sync job (AISERVER GPU: MuseTalk) ─► Compose (render worker: layouts, slides, b-roll, captions,
      brand, music) ─► MP4 per aspect ─► cloud auto-save / share / download
```

- **New GPU service on AISERVER:** `presenter-api` (FastAPI, localhost-only behind the existing authenticated
  `clipwaltz-aiserver-api` wrapper) exposing `/lipsync` and later `/photo-avatar`, `/voice-clone`. GPU time is shared
  with Wan (one ComfyUI per GPU today), so jobs go through a **GPU job queue** with a slot per GPU (reuse the
  generation-jobs pattern + the new worker leases).
- **New tables:** `presenters` (owner, kind = twin | ai | photo, status, base_video_key, face_crop meta, voice_id,
  consent_id, deleted_at), `voice_clones` (owner, sample_key, embedding_key, consent_id), `consents` (owner, subject
  name, type = likeness | voice, video_key, spoken_code, verified_by/at, method), `presenter_jobs` (lease + attempts,
  like renders). Scenes reuse `deck_scenes` with new layouts `presenter_full | presenter_slide | presenter_bubble`.
- **Compositing:** presenter footage is lip-synced full-frame; for split / bubble layouts the worker crops or masks the
  person. Background removal model to pick in Phase 0 (must be a commercial licence — e.g. **not** GPL RobustVideoMatting).
- **Credits:** presenter seconds cost AI credits (lip-sync GPU time), priced after Phase 0 measures GPU-seconds per
  video-second. Paid plans get longer videos and more presenters (mirrors HeyGen tiers).

## 5. Consent, safety and the law (designed in, not bolted on)

- **Live consent for every twin and every voice clone:** webcam recording, on-screen sentence + one-time code, same
  person as the footage (automatic face/voice match with a commercial-licence model — **automatic only**, no admin
  review queue, owner decision 2026-10-13). Stored in `consents`; deleting a presenter deletes its footage, models and voice embedding.
- **No twins of other people without their own consent clip** (sent to them by link, as HeyGen does); no public
  figures; no deceased people (California AB 1836 requires the estate's consent).
- **Disclosure:** every presenter video carries machine-readable "AI-generated" metadata and a visible **"AI-generated"
  label by default** (EU AI Act Art. 50 transparency duties apply from 2 Aug 2026). Chatterbox's audio watermark stays on.
- **Abuse handling:** report button on watch/community pages, takedown queue in Admin, rate limits on new presenters.
- Legal review recommended before launch (Tennessee ELVIS Act covers tools whose primary purpose is producing someone's
  likeness/voice without authorization; California AB 2602 on digital-replica contracts).

## 6. Phased plan

| Phase | Deliverable | Est. effort | Exit criteria |
|---|---|---|---|
| **0 — Spike** | On AISERVER: run MuseTalk 1.5, Chatterbox, InfiniteTalk/FantasyTalking/EchoMimic v3 (low-VRAM modes), 1–2 background-removal models; verify every dependency/weight licence | ~1 week | Measured GPU-sec per video-sec + quality samples you approve; licence table all green |
| **1 — Your Presenter (MVP)** | Consent flow, twin creation, presenter scenes in WaltzDeck, Kokoro voices, lip-sync queue, compositing layouts, credits | 3–4 weeks | A 60 s script → finished presenter video you'd post |
| **2 — Voices & AI presenters** | Voice cloning (consent-gated), 10–20 fictional AI presenters, templates | 2–3 weeks | Cloned-voice videos + presenter library live |
| **3 — Translate a video** | Upload/finished video → translated script review → cloned voice → re-synced lips; 5 languages, then Chatterbox's 23 | 2–3 weeks | A 1–2 min video translated with matching lips |
| **4 — Photo avatar** | Talking photo — only if Phase 0 found a model that fits 10 GB at acceptable quality/speed | 2 weeks | — |
| later | Interactive/streaming presenter; more GPU capacity | — | — |

## 7. Risks

- **GPU capacity:** two 10 GB 3080s already run Wan. Presenter jobs compete with Waltz AI — the queue + credits keep it
  fair; growth means another GPU box. Phase 0 sets real numbers.
- **Quality bar:** MuseTalk edits a 256×256 face region; close-ups may look soft → mitigate with good twin footage
  guidelines, face restoration (commercial-licence model only), or LatentSync as a premium pass.
- **Licences drift:** re-check weights licences at every model upgrade; keep a licence table in ADMIN_DOCS.
- **Misuse / legal exposure:** consent + review + labels + takedown above; legal review before public launch.

## 8. Decisions (owner, 2026-10-13)

1. Name: **Waltz Avatar** (changed from "Waltz Presenter" on 2026-10-13; this doc keeps "presenter" for the on-screen person).
2. AI presenters: **both** fictional generated presenters **and** licensed real actors (actors need signed releases
   covering AI likeness + voice use, scope, territory and term — per California AB 2602 the uses must be specific).
3. Consent check for launch: **automatic only** (face/voice match against the live consent clip; no admin review queue).
4. **Phase 0 approved** — started 2026-10-13 (results in §9).

## 9. Phase 0 results (AISERVER, 2026-10-13)

Test inputs: MuseTalk's bundled sample presenters (no personal footage) + a Kokoro "am_michael" script. GPU 1 (RTX 3080
10 GB); memory measured with `torch.cuda.mem_get_info` (nvidia-smi is down — see the note at the end).

| Test | Result |
|---|---|
| MuseTalk 1.5, one-shot (prep + lip-sync per video) | 2 × 13.5 s videos in 341 s (~12.7 s per video-second, incl. landmark extraction); **peak 8.3 GB of 9.9 GB** |
| MuseTalk 1.5, **prepared presenter** (realtime mode) | Prep once ≈ 4.5 min (22 s base clip → **677 MB** cache). Then 13.4 s audio → 14.9 s, **60 s audio → 39.3 s (0.65× realtime)**; ~25 s model load per process (a resident service pays it once) |
| Chatterbox voice clone (GPU) | 7 s EN audio in 3.7 s, 9 s ES in 5.0 s (~0.53× realtime) after warm-up; **3.6 GB**; PerTh watermark on (needed `setuptools<70` for `pkg_resources`) |
| Chatterbox (CPU fallback) | ~4× realtime (60 s script ≈ 4 min) |
| End-to-end translation flow | Cloned voice → Spanish → lip-synced on the prepared presenter: 9 s of video in 9.9 s |
| BiRefNet matting (split/bubble layouts) | 60 frames 576×768 in 10.1 s = **6.0 fps**, **1.6 GB** peak; clean cut-out, slight fringe on hair/shoulder edges (re-run 2026-10-13) |
| EchoMimic v3 photo avatar (Wan2.1-Fun 1.3B, 512×512, umT5 encoder moved to CPU) | **Does not fit 10 GB.** 65-frame chunks: crashed 2 s into the first diffusion step (PyTorch allocator NVML assert — the allocator path that runs under memory pressure; NVML is broken until the reboot). 33-frame chunks: one step took **285 s** (20 steps per chunk needed), then `CUDA error: out of memory`. Not usable on these cards |
| GPU co-residency | MuseTalk (8.3 GB) + Chatterbox (3.6 GB) do **not** fit one 10 GB card together, nor alongside a Wan job → one GPU job at a time per card, queued |

**Licence findings (primary sources, see the dependency audit):**
- Commercial-OK: MuseTalk weights (MIT), sd-vae-ft-mse (MIT), whisper-tiny (Apache-2.0), Chatterbox (MIT), EchoMimic v3 +
  Wan2.1-Fun-V1.1-1.3B-InP + wav2vec2-base-960h / chinese-wav2vec2-base (Apache/MIT).
- **Must replace before launch:** BiSeNet face-parsing (trained on CelebAMask-HQ — non-commercial), DWPose landmarks
  (Apache label but trained on COCO-WholeBody, CC BY-NC — get counsel or replace), S3FD detector weights (no stated
  licence), EchoMimic's `retina-face` detector (weights likely InsightFace-derived — unverified). **Replacement:
  Google MediaPipe Face Landmarker / Face Mesh V2 + BlazeFace (Apache-2.0)** for detection, landmarks and the mouth mask.
- LatentSync SyncNet is **not needed** for MuseTalk inference.
- Background removal for split layouts: **BiRefNet (MIT)**, MODNet (Apache-2.0), SAM 2 (Apache-2.0, video), MediaPipe
  Selfie Segmentation (Apache-2.0). Ruled out: BRIA RMBG 1.4/2.0 (non-commercial unless licensed), Robust Video Matting (GPL-3.0).

**Ops note:** Ubuntu unattended-upgrades updated the NVIDIA userspace libraries 595.91 → 595.99 on 2026-10-11 while the
595.91 kernel module stayed loaded (no reboot since 2026-09-24). CUDA still works for new processes (ComfyUI restarted
and sees both GPUs); only `nvidia-smi`/NVML fails until a reboot loads the already-installed 595.99 module. Recommend a
planned reboot and holding NVIDIA packages from unattended upgrades (`apt-mark hold`).

**Phase 0 conclusion (2026-10-13):**
- **Phase 1 (Your Avatar / twin) is feasible on AISERVER today:** prepared-presenter MuseTalk at 0.65× realtime (8.3 GB) + Kokoro or Chatterbox voice + BiRefNet compositing (1.6 GB). One lip-sync job per GPU at a time, queued.
- **Phase 4 (talking photo) is not feasible on 10 GB cards** — EchoMimic v3 ran out of memory even at 512×512/33 frames. InfiniteTalk and FantasyTalking are larger (14B), so they were not run. Phase 4 waits for a GPU with more memory (how much was not measured).
- **Before launch:** swap the non-commercial face pipeline pieces (BiSeNet, DWPose, S3FD) for MediaPipe (Apache-2.0). MuseTalk with MediaPipe landmarks/mask is **untested**: it's the first Phase 1 task.
- **Credits basis:** about 0.65 GPU-seconds of lip-sync per video-second, plus about 0.5 for a cloned voice (Kokoro voices run on the CPU).

## Appendix — sources (fetched 2026-10-13)

HeyGen: heygen.com/pricing · heygen.com/photo-avatar · help.heygen.com/en/articles/9380615-digital-twin-faq ·
help.heygen.com/en/articles/12092609-recording-your-consent-video · developers.heygen.com/docs/avatar-consent ·
heygen.com/translate · help.heygen.com/en/articles/12758516-introducing-liveavatar.
Models: github.com/TMElyralab/MuseTalk · github.com/bytedance/LatentSync · github.com/MeiGen-AI/InfiniteTalk ·
github.com/MeiGen-AI/MultiTalk · github.com/Fantasy-AMAP/fantasy-talking · github.com/antgroup/echomimic_v3 ·
github.com/Wan-Video/Wan2.2 · github.com/Tencent-Hunyuan/HunyuanVideo-Avatar · github.com/deepinsight/insightface ·
github.com/Rudrabha/Wav2Lip · github.com/jixiaozhong/Sonic.
Voice: github.com/resemble-ai/chatterbox · github.com/myshell-ai/OpenVoice · github.com/FunAudioLLM/CosyVoice ·
huggingface.co/coqui/XTTS-v2 · github.com/SWivid/F5-TTS · github.com/fishaudio/fish-speech · huggingface.co/hexgrad/Kokoro-82M.
Law: artificialintelligenceact.eu/article/50 · capitol.tn.gov/Bills/113/Bill/HB2091.pdf · leginfo.legislature.ca.gov
(AB 2602, AB 1836 — summaries via globalpolicywatch.com and manatt.com; statute pages blocked our fetcher).

# ClipWaltz AISERVER — Model Manifest

Phase 1 uses **Wan 2.2 TI2V-5B** (fp8) for image→video (see ADR-0005). The original
plan led with LTX, but ComfyUI-LTXVideo has moved to **LTX-2.3 (22B)** — too large for
the AISERVER's 2× RTX 3080 **10 GB** cards. Wan 2.2 TI2V-5B fits 10 GB with fp8 weights +
offload and is the design doc's "baseline" model family. Verified E2E on 2026-09-23.

Served via ComfyUI **core** Wan nodes (`UNETLoader` + `CLIPLoader type=wan` + `VAELoader`
+ `Wan22ImageToVideoLatent` + `KSampler` + `ModelSamplingSD3` + `VAEDecode` + `CreateVideo`/
`SaveVideo`) — no extra custom node required. Models are found via
`extra_model_paths.yaml` pointing ComfyUI at `/data/clipwaltz-ai/models`.

## Models (verified on install, 2026-09-23)

| Component | Source repo (HF) | File | Size | Local path |
|-----------|------------------|------|------|------------|
| Diffusion (5B TI2V) | `Comfy-Org/Wan_2.2_ComfyUI_Repackaged` | `wan2.2_ti2v_5B_fp16.safetensors` | 9.4 GB | `/data/clipwaltz-ai/models/diffusion_models/` |
| Text encoder | `Comfy-Org/Wan_2.2_ComfyUI_Repackaged` | `umt5_xxl_fp8_e4m3fn_scaled.safetensors` | 6.3 GB | `/data/clipwaltz-ai/models/text_encoders/` |
| VAE | `Comfy-Org/Wan_2.2_ComfyUI_Repackaged` | `wan2.2_vae.safetensors` | 1.4 GB | `/data/clipwaltz-ai/models/vae/` |

**10 GB fit:** `UNETLoader.weight_dtype = fp8_e4m3fn` casts the 5B to ~5–6 GB resident; the
umt5 text encoder is the fp8 build and is offloaded after encode. First run (704×480, 49
frames) completed on a single RTX 3080 in ~60 s incl. model load.

## Workflow
`wan-image-to-video-v1` — graph `aiserver/workflows/wan/workflow.api.json`, logical-field map
`workflow.map.json` (prompt→CLIPTextEncode, source_image→LoadImage, width/height→
Wan22ImageToVideoLatent, seed→KSampler). Built from ComfyUI's bundled
`video_wan2_2_5B_ti2v` template via `aiserver/scripts/ui2api.py`.

## Enhancement models
| Component | File | Size | Local path | Used by |
|-----------|------|------|------------|---------|
| Real-ESRGAN 2× upscaler | `RealESRGAN_x2plus.pth` | 64 MB | `/data/clipwaltz-ai/models/upscale_models/` | `esrgan-upscale-v1` workflow (AI Enhance) |

Enhancement workflow `esrgan-upscale-v1` (`aiserver/workflows/wan/enhance.api.json`): VHS_LoadVideo →
ImageUpscaleWithModel(RealESRGAN_x2plus) → VHS_VideoCombine (NVENC h264). Verified E2E: 704×480 →
1408×960 in ~20 s, no OOM. Deferred: RIFE (ML interpolation), SUPIR.

## Notes / owner actions
- The Comfy-Org repackaged Wan 2.2 files are public (not gated) — downloaded without a token.
- Model binaries are re-downloadable; **this manifest is the retained artifact** (doc §27).
  Binaries are intentionally not committed.
- Variable clip length (duration→frames) is not yet wired — the workflow uses a fixed 49-frame
  default; the provider/worker will map duration later.

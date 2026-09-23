# ClipWaltz AISERVER — Model Manifest

Phase 1 leads with **LTX-Video** for image-to-video. This is a deliberate,
doc-04 §12-sanctioned VRAM choice: the target GPUs are 2× RTX 3080 with **10 GB
each**, and LTX-Video is the model in the doc's set that fits 10 GB while giving
fast preview-grade generation. Wan and Hunyuan (doc §12 Models 1 and 3) are
deferred to a later phase / larger-VRAM node.

> Sizes and "VRAM at load" are recorded from the **actual download and first
> load on AISERVER** during deployment. Rows marked `TBD (verify on install)`
> are filled in at that point rather than guessed here.

## Models

| # | Model | Component | Source (repo) | File | Size | VRAM at load | License | Local path |
|---|-------|-----------|---------------|------|------|--------------|---------|------------|
| 1 | LTX-Video | diffusion model | `Lightricks/LTX-Video` (Hugging Face) | `ltx-video-*.safetensors` | TBD (verify on install) | TBD (verify on install) | LTX-Video / OpenRAIL-style — **confirm license terms on the HF repo before use** | `/data/clipwaltz-ai/models/checkpoints/` |
| 2 | T5 text encoder | text encoder | (paired with LTX-Video; PixArt/T5-XXL) | `t5xxl_*.safetensors` | TBD (verify on install) | Apache-2.0 (T5) | `/data/clipwaltz-ai/models/text_encoders/` |

## Enhancement models (doc §13 — NOT installed in Phase 1)

Deferred until baseline LTX generation is proven end-to-end:
- RIFE (frame interpolation)
- Real-ESRGAN (upscale)
- SUPIR (detail restoration)

## Notes / owner actions

- If the LTX-Video weights or the T5 encoder are **gated or require accepting a
  license** on Hugging Face, deployment STOPS and the owner is asked to accept
  the license / provide a token — per the standing rule, no working around gates.
- Model binaries are re-downloadable; **this manifest is the artifact that must
  be retained** (doc §27). Binaries are intentionally not committed to the repo.

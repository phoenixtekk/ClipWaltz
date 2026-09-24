# ClipWaltz AISERVER — ComfyUI Custom Node Manifest

Format per doc 04 §10. Only nodes required by the installed workflow are listed.
No general-purpose "workflow packs" are installed. Every node has a documented
reason and a pinned commit is recorded on install.

> Versions (`commit`) are filled from the actual clone on AISERVER during
> deployment. Rows marked `TBD (pin on install)` are completed at that point.

| custom-node-name | source | version (commit) | purpose | workflow dependency |
|------------------|--------|------------------|---------|---------------------|
| ComfyUI-LTXVideo | https://github.com/Lightricks/ComfyUI-LTXVideo | TBD (pin on install) | LTX-Video sampler / model loader nodes | ltx-image-to-video-v1 |
| ComfyUI-VideoHelperSuite | https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite | TBD (pin on install) | encode frames to MP4 (VHS_VideoCombine) into /data/clipwaltz-ai/output | ltx-image-to-video-v1 |
| ComfyUI-SeedVR2_VideoUpscaler | https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler | `v2.5.23` (`5a4bf428f3735cc72ac760d40f372f94dec28422`), Apache-2.0 | SeedVR2 DiT/VAE loaders + video upscaler (restoration) | seedvr2-restore-v1 |

Notes:
- The exact node set is confirmed against the LTX example workflow that ships
  with `ComfyUI-LTXVideo` at install time; if the native ComfyUI video nodes
  suffice, VideoHelperSuite is dropped and this manifest updated accordingly.
- ffmpeg (system package) is a hard dependency of MP4 encoding and is installed
  via apt on the host (not a ComfyUI custom node).

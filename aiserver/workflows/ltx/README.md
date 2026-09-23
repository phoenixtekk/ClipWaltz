# LTX-Video — image-to-video workflow (`ltx-image-to-video-v1`)

Phase 1 first-milestone workflow (doc 04 §21): one known-good image→video
generation producing an MP4 in `/data/clipwaltz-ai/output`.

## Files (doc §14)

| File | Purpose | State |
|------|---------|-------|
| `README.md` | this file | committed |
| `workflow.api.json` | ComfyUI **API-format** graph the wrapper submits | **captured live** during deployment from the running ComfyUI (Save → "Save (API Format)") against the installed LTX nodes, then committed |
| `workflow.map.json` | maps logical job fields → `[node_id, input_key]` in the graph | authored alongside `workflow.api.json` once node ids are known, then committed |
| `workflow-version.txt` | model + node commit pins for this workflow | filled on install |
| `sample-input.json` | example logical job payload | committed |
| `expected-output.md` | what a successful run yields | committed |

> `workflow.api.json` and `workflow.map.json` are intentionally **not guessed**
> ahead of install — their node ids depend on the exact LTX example graph loaded
> into ComfyUI. They are captured from the live, working graph and committed as
> part of "done".

## Logical interface (doc §15)

The ClipWaltz backend submits only these logical fields; it never sends a raw
node graph:

```json
{
  "prompt": "",
  "source_image": "input-file-name.png",
  "width": 768,
  "height": 512,
  "duration": 5,
  "motion": "balanced",
  "seed": null
}
```

`source_image` is a filename already staged into `/data/clipwaltz-ai/input`.
`seed: null` → the wrapper randomises and records the effective seed.

## How the wrapper uses these

1. Loads `workflow.api.json` (template graph).
2. Applies each logical field to the node/input listed in `workflow.map.json`.
3. `POST /prompt` to ComfyUI (localhost:8188), tracks the returned `prompt_id`.
4. Polls `/history/{prompt_id}` until complete, then registers the MP4 under
   `/data/clipwaltz-ai/output`.

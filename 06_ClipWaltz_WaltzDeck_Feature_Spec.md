# ClipWaltz — WaltzDeck: ads, campaigns & presentations from your own media

**Status:** proposal / design — nothing built yet. 2026-09-29.
**Working name:** **WaltzDeck** (sits beside **AutoWaltz** = media → music video and **Waltz AI** = AI clips).
Name is the owner's call; alternatives: *WaltzStudio*, *PitchWaltz*, *Waltz Story*.

---

## 1. The idea, sharpened

The user brings **their own photos and videos**, writes **one overall brief** ("15-second Instagram ad for our
new cold-brew — summer vibe, end on 20% off with code SUN20") and, optionally, **a note per image/video**
("hero shot — say it's organic", "show this last"). WaltzDeck turns that into a finished, on-brand video:
a structured **storyboard** of scenes (each scene = one of the user's clips + on-screen text + optional voice
line + layout + motion), timed to the music, with a real CTA end card — and, for presentations, the same
storyboard also exports as an **editable PowerPoint and a PDF**.

It is one engine with **output modes** that change the structure the AI writes:

| Mode | Structure the AI plans | Typical length / format |
|---|---|---|
| **Ad** | Hook (≤2 s) → problem/desire → product/benefit → proof → **CTA end card** | 6 / 15 / 30 s · 9:16, 1:1, 4:5, 16:9 |
| **Campaign** | One brief → a **pack** of ads: several hooks × CTAs × lengths × aspect ratios, consistently branded | 3–12 variants |
| **Presentation** | Title → agenda → section slides → content slides (headline + bullets + media) → summary → contact | 1–10 min · 16:9 · **MP4 + PPTX + PDF** |
| **Slideshow / story** | Chronological or thematic story with captions; beat-synced (today's AutoWaltz look + text) | any |
| **Explainer / how-to** | Numbered steps, one per scene, narration-led | 30 s–3 min |
| **Event / recap / listing** | Real-estate listing, event recap, menu, portfolio — templated scene roles | 15–90 s |

The overall brief sets **goal, audience, tone, offer, CTA, length, platform**; per-item notes steer **what that
scene says and where it goes**; the AI fills everything else and shows its reasoning per scene.

---

## 2. What invideo does today (verified 2026-09-29) — and where it falls short

Research with sources: see the appendix. In short:

- **Workflow:** prompt (+ duration, platform, optional uploads, a product/brand URL) → AI writes script, scenes,
  voiceover, subtitles, SFX, picks stock or generative media (Sora 2, Veo 3.1, Kling, Seedance) → edit by text
  commands ("replace the media in scene 2…") or a new multitrack editor → export MP4 up to 4K.
- **Ads:** product / UGC / testimonial templates, AI "twins" and voice cloning, lip-sync, shots approved as stills
  before animating. **Presentations:** video only.
- **Pricing:** Starter $20/mo (400 credits), Plus $50 (2,000), Max $100 (5,000) annual; credits don't roll over;
  generation and agent edits cost credits.

**The gaps ClipWaltz can own** (ranked by how often users complain or by how clearly they're missing):

1. **Credit burn & failed runs cost money** — the #1 complaint (Trustpilot 1.9/5): unfinished videos eat the month's
   credits, re-rolls cost, refunds denied.
2. **Output doesn't match intent / generic stock look** — recycled stock, AI artifacts, "visuals don't match".
3. **The customer's own uploads aren't used properly** — their own help docs don't say the AI places your media;
   third parties say you swap it in by hand after generation.
4. **Last-10% fixes are hard** — control is "scene number + text command", not real per-scene intent.
5. **No publish/performance loop** — no analytics, no variant testing (their ad page gives A/B advice, no tool).
6. **Beat sync is a prompt wish, not a feature** (Canva and CapCut do it properly).
7. **No PPTX in or out** — presentations are video only; PDFs are pasted as text (Synthesia and Pictory import
   PPTX; Gamma exports it).

---

## 3. How ClipWaltz beats it — the eight differentiators

1. **Your media first, and provably so.** Every uploaded asset is analysed and placed by the AI; the storyboard
   says *why* each one went where ("scene 3: your product close-up — matches 'say it's organic'"). AI-generated
   filler is used **only for gaps you allow**, is labelled **AI** in the storyboard, and there is **no stock
   footage by default** ("no stranger's footage in your ad").
2. **Real per-scene prompts + locks.** Each scene card has its own prompt field; "rewrite this scene", "shorter",
   "more premium" apply to that scene only. **Lock** a scene (text, media, timing) and whole-video regenerations
   never touch it — the fix-the-last-10% problem, solved structurally.
3. **Beat-synced *and* narration-aware timing.** Reuses AutoWaltz's beat detection / energy curve: cuts land on
   beats, but never mid-sentence; music ducks under the voice automatically.
4. **Predictable, fair cost.** Planning, text, layouts, voice, captions and re-renders run on **our own hardware**
   (Ollama + CPU/GPU on the AI box) → **unlimited and free on every plan**. Only *generative video clips* use
   credits, the price is shown **before** generating, and **failed or cancelled generations are refunded
   automatically**. This is the single loudest invideo complaint, answered as a product rule.
5. **One storyboard → video + editable PowerPoint + PDF.** Presentation mode exports native PPTX (real text boxes,
   the user's images, embedded clips, narration in speaker notes). **Import** PPTX / PDF / a web page URL as the
   starting brief.
6. **Campaign packs.** One brief → a set of variants (hooks, CTAs, 6/15/30 s, 9:16 / 1:1 / 4:5 / 16:9), rendered as a
   batch, named consistently, each with its own share link.
7. **Built-in performance loop.** Watch pages already exist: add per-variant views, completion rate, CTA clicks
   (UTM-tagged links) so users see which hook won — then "make more like the winner".
8. **Brand kit enforced + private AI.** Logo, colours, fonts, CTA style, intro/outro applied to every scene (activates
   the empty `brand_kits` table); optional "build my kit from my website". Media and prompts never leave our
   infrastructure (self-hosted models) — a selling point for businesses.

---

## 4. User flow

1. **New → WaltzDeck** → pick a mode (Ad / Campaign / Presentation / Slideshow / Explainer / Recap) and platform(s).
2. **Brief:** overall prompt + structured fields the AI pre-fills from the prompt (goal, audience, tone, offer, CTA +
   URL, length). Optional: import PPTX / PDF / URL; choose brand kit; choose music (or "match the mood").
3. **Media:** upload / pick from library; per item: note, "must include", "use as hero", "use last", trim.
4. **Storyboard (the heart):** the AI proposes scene cards in ~10–30 s. Each card: thumbnail of the chosen media,
   role (hook/benefit/CTA…), on-screen text (headline / sub / bullets), voice line, layout, motion, duration, and a
   one-line "why". Drag to reorder, swap media, edit text inline, per-scene prompt, lock. Unused media is listed
   ("not used: 3 — add them?"). Costs shown only if AI clips are requested.
5. **Preview:** instant low-res browser preview (like today's draft preview) with text, layout and timing.
6. **Render & export:** MP4 per aspect ratio; for Presentation also PPTX + PDF; captions file (SRT); campaign packs
   render as a batch.
7. **Share & learn:** watch links per variant, stats, "make 3 more like this one".

---

## 5. Architecture (reuses most of what exists)

```
Brief + media ─► 1 Understand ─► 2 Plan ─► 3 Review (UI) ─► 4 Fill gaps ─► 5 Voice/captions ─► 6 Compose/render ─► 7 Export
                (vision, OCR)    (LLM →     (scene cards,    (Waltz AI      (TTS, Whisper)       (layout engine +      (MP4 ×AR,
                                 storyboard   locks, per-      i2v/t2v,                          AutoWaltz timing)      PPTX, PDF, SRT)
                                 JSON)        scene prompts)   optional)
```

| Stage | What | Reuse / new |
|---|---|---|
| 1 Understand | Caption each image/video window (subject, product, people, text in image, mood, quality); detect logos/faces for safe text placement | **Reuse** `visionScore`/`rankWindows` (qwen-vl on the AI box); **new** stored per-asset descriptions |
| 2 Plan | LLM writes a **storyboard JSON** (schema below) from brief + per-item notes + asset descriptions + mode template; validated and repaired server-side | **New** text-LLM step (AI box `qwen3.8:27b` per fleet notes — `OLLAMA_TEXT_MODEL` is documented but not wired yet) behind a provider interface |
| 3 Review | Scene-card editor; per-scene regenerate calls the LLM for that scene only | **New** UI; storage extends the existing `scenes` table |
| 4 Fill gaps | Animate a still ("bring this photo to life"), extend a short clip, or generate a missing shot | **Reuse** Waltz AI `image_to_video` / `text_to_video` (Wan 2.2, 3–8 s), Remix moment/extend |
| 5 Voice | Narration per scene (TTS), word-timed captions (Whisper), ducking | **New** — nothing exists (TTS/STT listed as "later" in the plan). Self-host on AISERVER |
| 6 Compose | Scene layouts (headline/bullets/CTA/lower-third/price tag/split-screen), motion, transitions, beat-snapped durations | **Reuse** render worker timing, Ken Burns, transitions, overlays, watermark. **New** layout engine (below) |
| 7 Export | MP4 per aspect, PPTX, PDF, SRT, thumbnails | **New** PPTX/PDF writer; **new** multi-aspect renders (worker `dims()` knows only 16:9 / 9:16 today) |

**Storyboard JSON (sketch):**
```json
{ "mode": "ad", "aspect": ["9:16","1:1"], "lengthSec": 15, "music": {"mood": "sunny", "trackId": null},
  "brand": {"kitId": "…"}, "cta": {"text": "20% off — code SUN20", "url": "https://…"},
  "scenes": [
    { "id": "s1", "role": "hook", "asset": {"id": "…", "in": 3.2, "out": 5.0}, "durationSec": 1.8,
      "text": {"headline": "Summer in a can.", "sub": null, "bullets": []},
      "voice": "Meet the cold brew that tastes like July.", "layout": "headline-bottom",
      "motion": "push-in", "transition": "cut-on-beat", "locked": false,
      "why": "Your pour shot has the most motion — best hook." } ] }
```

**Layout engine — the key build decision.** Recommendation: **HTML/CSS scene templates rendered to transparent
PNG frames in headless Chromium on the AI box, composited over the media by ffmpeg.** Gives real typography, brand
fonts, auto-fit text, RTL/emoji, and the same template renders the browser preview, the video and (as positioned
boxes) the PPTX. Alternative: extend today's ffmpeg `drawtext` overlays (fast, no new runtime, but no font choice,
no auto-fit, weak layouts). Needs a quick spike to measure render time per scene.

**Data model (sketch):** `projects.kind = 'deck'` + `projects.deck` (brief, mode, platforms, cta); extend `scenes`
(role, asset ref + in/out, text jsonb, voice, layout, motion, locked, why); activate `brand_kits`; `renders.aspect`
honoured per render + `renders.variant` (campaign); `deck_exports` (pptx/pdf/srt keys); asset descriptions
(`assets.ai_description` jsonb).

---

## 6. Phased roadmap

| Phase | Ships | Depends on |
|---|---|---|
| **1 — MVP (Ad + Slideshow)** | Brief + per-item notes → LLM storyboard → scene-card editor (reorder, edit text, swap media, per-scene prompt, lock) → render with text layouts, beat sync, brand kit (logo/colours/fonts), CTA end card; **9:16, 1:1, 16:9** | text-LLM wiring, layout engine spike, 1:1 in the worker, brand kits |
| **2 — Voice & captions** | TTS narration per scene, Whisper word-timed captions (styled, burned in + SRT), auto-ducking, narration-aware timing | TTS + STT services on AISERVER |
| **3 — Presentation** | Presentation mode; **PPTX + PDF export**; PPTX / PDF / URL import → brief + scenes | PPTX writer (e.g. python-pptx or pptxgenjs), PDF from the same templates |
| **4 — Campaigns + analytics** | Variant packs (hooks × CTAs × lengths × aspects), batch render, per-variant watch stats + UTM links, "make more like the winner" | multi-aspect renders, analytics events on watch pages |
| **5 — AI fill & extras** | Animate stills / generate missing shots inline (with credit estimate + auto-refund on failure), brand kit from website, translations (re-voice + re-caption) | credits system (none today), Waltz AI |

---

## 7. Decisions for the owner

1. **Name** — WaltzDeck or another.
2. **Stock footage** — none (our "your media only" stance; recommended) vs a licensed library later.
3. **Voice** — which self-hosted TTS to evaluate first (candidates: Piper, Kokoro, XTTS-v2/F5 for cloning — licences
   differ; to be checked before choosing), and whether voice cloning / avatars are in scope at all (avatars
   recommended *out* — invideo's lip-sync is a complaint source and it needs heavy GPU).
4. **Plans & credits** — which modes/outputs are Plus/Pro (e.g. PPTX export, campaign packs, 4K), and the credit
   model for AI clips (there is no credits system today; render quotas are display-only).
5. **Layout engine** — approve the Chromium-template spike vs extending ffmpeg overlays.

## 8. Risks

- **LLM quality/speed** on a local 27B model for copywriting and structured JSON — mitigate with schema validation +
  repair, mode templates and few-shot examples; measure before committing.
- **GPU contention** — AISERVER has 2× RTX 3080 10 GB shared by Waltz AI; TTS/Whisper/vision queue behind clips.
  Needs queue priorities (and CPU fallbacks for TTS/Whisper).
- **Licensing** — fonts (use OFL/Google Fonts), TTS voice licences, music already licensed.
- **Scope** — Phase 1 alone is sizeable (new editor + layout engine); keep it to Ad + Slideshow.

---

## Appendix — invideo sources (fetched 2026-09-29)

- Product & positioning: https://invideo.io/ · pricing: https://invideo.io/pricing
- Credits: https://help.invideo.io/en/articles/11528140-invideo-plans-and-credits-everything-you-need-to-know
- Uploads: https://help.invideo.io/en/articles/9387663-how-can-i-upload-images-and-videos
- Replace media / scene commands: https://help.invideo.io/en/articles/9974099-how-can-i-replace-the-media-in-my-video-with-another-media-or-my-own
- Editor: https://help.invideo.io/en/articles/16819946-introducing-invideo-editor
- Aspect ratio: https://help.invideo.io/en/articles/9380486-how-can-i-change-the-aspect-ratio-of-my-video
- Voice clone / avatar: https://help.invideo.io/en/articles/11393727-how-to-clone-your-voice · https://help.invideo.io/en/articles/11388821-how-to-create-an-avatar-by-uploading-a-video
- Ads / UGC / presentations: https://invideo.io/make/ad-maker/ · https://invideo.io/make/ugc-ads/ · https://invideo.io/make/video-presentation/
- PDF explainer (paste text): https://info.invideo.io/ai-generate-explainer-video-from-pdf
- Reviews: https://www.trustpilot.com/review/invideo.io · https://www.capterra.com/p/180680/InVideo/reviews/ ·
  https://www.zebracat.ai/post/my-invideo-review (competitor-written) · https://aireiter.com/blog/invideo-ai-review ·
  https://flowith.io/blog/invideo-ai-faq-stock-footage-voiceover-export-quality-commercial/
- Competitors: Canva Beat Sync https://www.canva.com/features/beat-sync/ · Synthesia PPTX https://www.synthesia.io/powerpoint-to-video ·
  Pictory https://pictory.ai/ppt-to-video · Gamma PPTX export https://help.gamma.app/en/articles/8022861-what-s-the-easiest-way-to-export-my-gamma ·
  HeyGen https://www.heygen.com/blog/heygen-july-2026-release
- Not verified: whether invideo's AI auto-places user uploads (sources conflict); invideo length limits; watermark rules.

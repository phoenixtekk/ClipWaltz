import { createCanvas, loadImage } from "@napi-rs/canvas";

// ─── Making an image small enough for a network to accept ────────────────────
//
// Several networks cap an upload in BYTES and reject the whole post when it is
// exceeded — Bluesky answers
//
//   Invalid app.bsky.feed.post record: blob too big (maximum 2000000, got 2109815)
//
// and the post never lands. 2,109,815 is not a big picture; it is an ordinary
// AI-generated PNG a hundred kilobytes over the line. Failing a post over that
// is the wrong trade, so the image is re-encoded to fit instead.
//
// Re-encoding as JPEG comes first and scaling second, deliberately: quality 82
// JPEG is visually near-identical to the PNG it replaces and routinely a
// quarter of the size, whereas shrinking the pixels is visible immediately.
// Transparency is lost in the conversion — every network here composites on a
// solid background anyway, so what a reader sees is unchanged.
//
// `@napi-rs/canvas` is already a dependency and already renders production
// output in `ad-overlay.ts` and the explainer compositor, so this adds nothing
// to the host.

export interface FittedImage {
  data: Buffer;
  mime: string;
  /** True when the image had to be re-encoded — it is byte-identical if not. */
  changed: boolean;
}

/** Quality first, then pixels — each step only taken if the last still overshot. */
const LADDER: Array<{ scale: number; quality: number }> = [
  { scale: 1, quality: 82 },
  { scale: 1, quality: 70 },
  { scale: 0.85, quality: 70 },
  { scale: 0.7, quality: 65 },
  { scale: 0.55, quality: 60 },
  { scale: 0.4, quality: 55 },
  { scale: 0.3, quality: 50 },
];

/**
 * Return `data` unchanged when it already fits, otherwise the smallest
 * re-encoding that does.
 *
 * Never throws: an image that cannot be decoded (an unsupported format, a
 * truncated file) is handed back untouched so the provider still attempts the
 * upload and reports the network's own refusal, which is more useful than a
 * decode error from here.
 */
export async function fitImage(data: Buffer, mime: string, maxBytes: number): Promise<FittedImage> {
  if (data.length <= maxBytes) return { data, mime, changed: false };

  try {
    const img = await loadImage(data);
    let best: Buffer | null = null;

    for (const step of LADDER) {
      const w = Math.max(1, Math.round(img.width * step.scale));
      const h = Math.max(1, Math.round(img.height * step.scale));
      const canvas = createCanvas(w, h);
      const ctx = canvas.getContext("2d");
      // JPEG has no alpha, and an undrawn canvas is transparent black — which
      // encodes as BLACK, not white. Paint the background first or every image
      // with transparency comes out on a black field.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);

      const out = canvas.toBuffer("image/jpeg", step.quality);
      best = out;
      if (out.length <= maxBytes) return { data: out, mime: "image/jpeg", changed: true };
    }

    // Everything overshot. Send the smallest attempt and let the network answer
    // — it is closer to fitting than the original, and the alternative is to
    // fail a post we might still be able to publish.
    return best ? { data: best, mime: "image/jpeg", changed: true } : { data, mime, changed: false };
  } catch {
    return { data, mime, changed: false };
  }
}

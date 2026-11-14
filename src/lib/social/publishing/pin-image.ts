import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";

// Reshaping a post's image into a Pin.
//
// Pinterest is the one destination where the SHAPE of the image decides whether
// the post works. Verified against Pinterest's own guidance (help.pinterest.com
// "Review Pin specs" and business.pinterest.com creative best practices, read
// 2026-09-20):
//
//   • 2:3, 1000 x 1500 is the recommended Pin.
//   • "Fully vertical images get more engagement" — almost all of the audience
//     is on a phone.
//   • Text on the Pin is encouraged rather than merely tolerated.
//
// Our generated images are landscape, 1216 x 832 by default. Sent as they are,
// they appear as a thin strip in a vertical feed — the shape Pinterest says
// performs worst. Cropping a landscape frame to 2:3 is not the answer either:
// it throws away two thirds of the picture, usually including the subject.
//
// So the image is RESHAPED, not cropped and not re-lettered:
//
//   • the picture is scaled to FIT and centred, so nothing is cut off;
//   • behind it sits a blurred, zoomed copy of itself filling the frame — the
//     same technique as the 9:16 video cut, and the convention these feeds'
//     own editors use.
//
// **No headline is drawn onto it.** The first version of this added one, and
// the render showed the message twice: every image this app generates already
// has the post's headline burned in by the ad overlay, so the composed Pin read
// as a caption under a caption — with the burned-in copy sliced mid-word by the
// crop ("s built for speed", "pdates to your team or"). Looking at one output
// made that obvious in a way reading the code did not. The picture already
// carries the text Pinterest wants on a Pin; this only has to fix its shape.

let FONT_REG = "sans-serif";
try {
  const base = "/usr/share/fonts/truetype/liberation";
  if (GlobalFonts.registerFromPath(`${base}/LiberationSans-Regular.ttf`, "PinReg")) FONT_REG = "PinReg";
} catch {
  /* fallback */
}

/** Pinterest's recommended Pin size. */
export const PIN_W = 1000;
export const PIN_H = 1500;

export interface PinOptions {
  /** Shown small at the foot of the Pin, e.g. "txtya.com". */
  domain?: string;
  background?: string;
  accent?: string;
}

/**
 * Reshape an image into a 2:3 Pin.
 *
 * Returns **null** when nothing needs doing — the image cannot be decoded, or it
 * is already 2:3 or taller. Null means "use the original": re-encoding a Pin
 * that is already the right shape only costs quality, and a failed compose must
 * never cost the destination.
 */
export async function composePin(image: Buffer, opts: PinOptions = {}): Promise<Buffer | null> {
  let img;
  try {
    img = await loadImage(image);
  } catch {
    return null;
  }

  // Already portrait enough to pass for a Pin.
  if (img.width / img.height <= PIN_W / PIN_H + 0.01) return null;

  const canvas = createCanvas(PIN_W, PIN_H);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = opts.background ?? "#0b0e14";
  ctx.fillRect(0, 0, PIN_W, PIN_H);

  // Backdrop: the same picture, filling the frame, blurred.
  //
  // Blurred SMALL and scaled up. Blurring at full size costs many times more
  // for a result the eye cannot distinguish — the measurement that took the
  // 9:16 video cut from 525s to 170s. Drawing a 50x75 copy up to 1000x1500 is
  // the blur: the scaler does the smoothing.
  const small = createCanvas(50, 75);
  const sctx = small.getContext("2d");
  const cover = Math.max(50 / img.width, 75 / img.height);
  sctx.drawImage(
    img,
    (50 - img.width * cover) / 2,
    (75 - img.height * cover) / 2,
    img.width * cover,
    img.height * cover,
  );
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.drawImage(small, 0, 0, PIN_W, PIN_H);
  ctx.restore();

  // The picture itself, whole.
  const fit = Math.min(PIN_W / img.width, PIN_H / img.height);
  const dw = img.width * fit;
  const dh = img.height * fit;
  const top = (PIN_H - dh) / 2;
  ctx.drawImage(img, (PIN_W - dw) / 2, top, dw, dh);

  // Thin rules above and below, so the picture reads as placed on the backdrop
  // rather than as one that failed to fill the frame.
  ctx.fillStyle = opts.accent ?? "#e60023";
  ctx.fillRect(0, top - 4, PIN_W, 4);
  ctx.fillRect(0, top + dh, PIN_W, 4);

  if (opts.domain) {
    // On its own strip: the backdrop behind it is whatever the picture happens
    // to be, so the contrast cannot be left to luck.
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(0, PIN_H - 92, PIN_W, 92);
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = `400 34px ${FONT_REG}`;
    ctx.fillText(opts.domain, PIN_W / 2, PIN_H - 36);
  }

  return canvas.toBuffer("image/jpeg", 90);
}

/** "https://www.txtya.com/x?y" → "txtya.com". Undefined when there is no usable link. */
export function domainOf(link: string | null | undefined): string | undefined {
  if (!link) return undefined;
  try {
    return new URL(link).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

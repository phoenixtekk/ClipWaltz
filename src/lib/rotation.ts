import type { CSSProperties } from "react";

// Per-clip user rotation (assets.rotation, degrees clockwise) for <video>/<img> elements. The browser
// already applies the file's own rotation flag, exactly like ffmpeg's autorotate in the render
// worker, so the user rotation is simply added on top in both places.

/** Next rotation step for a "Rotate 90°" button. */
export const nextRotation = (deg: number) => ((deg || 0) + 90) % 360;

/**
 * Style for the parent of a rotated element: a size container, so the child can be sized in
 * container units. The parent must have a definite width and height (not sized by its content).
 */
export const rotationParent = (deg: number | null | undefined): CSSProperties | undefined =>
  deg ? { containerType: "size", position: "relative", overflow: "hidden" } : undefined;

/**
 * Style for a rotated <video>/<img> that fills its parent (use with `rotationParent` on the parent).
 * At 90/270 the element is laid out with the parent's width and height swapped, then turned, so
 * object-cover / object-contain still fill the parent's box. undefined at 0: nothing changes.
 */
export function rotatedFill(deg: number | null | undefined): CSSProperties | undefined {
  if (!deg) return undefined;
  const swap = deg % 180 !== 0;
  return {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: swap ? "100cqh" : "100cqw",
    height: swap ? "100cqw" : "100cqh",
    maxWidth: "none",
    maxHeight: "none",
    transform: `translate(-50%, -50%) rotate(${deg}deg)`,
  };
}

/** Style for a rotated element sized by its content (a lightbox): turned in place, bounds swapped. */
export const lightboxRotation = (deg: number | null | undefined): CSSProperties | undefined =>
  deg ? { transform: `rotate(${deg}deg)`, ...(deg % 180 ? { maxWidth: "85vh", maxHeight: "90vw" } : {}) } : undefined;

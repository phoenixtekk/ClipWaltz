// Text + emoji overlays (project.overlays JSONB). Positions are fractional (0..1, centre
// anchor) so they scale to any aspect. Rendered by the worker: text via drawtext, emoji via
// Twemoji PNG overlay. Kept small + validated so bad data can never reach FFmpeg.

export type OverlayAnim = "none" | "fade" | "slide" | "pop";

export type Overlay = {
  id: string;
  type: "text" | "emoji";
  content: string;
  x: number; // 0..1
  y: number; // 0..1
  size: number; // fraction of video height (text font size / emoji height)
  color: string; // text colour (#rrggbb)
  box: boolean; // text background box
  start: number | null; // seconds; null = from start
  end: number | null; // seconds; null = to end
  anim: OverlayAnim;
  beatSnap: boolean; // snap entrance to nearest beat
};

const ANIMS: OverlayAnim[] = ["none", "fade", "slide", "pop"];
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Validate + normalize raw overlay data (from the client or DB) so it's always safe. */
export function sanitizeOverlays(raw: unknown): Overlay[] {
  if (!Array.isArray(raw)) return [];
  const out: Overlay[] = [];
  for (const r of raw.slice(0, 20)) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const type = o.type === "emoji" ? "emoji" : "text";
    const content = String(o.content ?? "").slice(0, type === "text" ? 120 : 8);
    if (!content.trim()) continue;
    const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);
    const start = o.start == null ? null : clamp(num(o.start, 0), 0, 3600);
    const end = o.end == null ? null : clamp(num(o.end, 0), 0, 3600);
    out.push({
      id: String(o.id ?? "").slice(0, 40) || crypto.randomUUID(),
      type,
      content,
      x: clamp(num(o.x, 0.5), 0, 1),
      y: clamp(num(o.y, 0.5), 0, 1),
      size: clamp(num(o.size, 0.08), 0.03, 0.4),
      color: /^#[0-9a-fA-F]{6}$/.test(String(o.color)) ? String(o.color) : "#ffffff",
      box: !!o.box,
      start,
      end: end != null && start != null && end <= start ? null : end,
      anim: ANIMS.includes(o.anim as OverlayAnim) ? (o.anim as OverlayAnim) : "fade",
      beatSnap: !!o.beatSnap,
    });
  }
  return out;
}

/** Read overlays off a project row's JSONB. */
export function parseOverlays(value: unknown): Overlay[] {
  return sanitizeOverlays(value);
}

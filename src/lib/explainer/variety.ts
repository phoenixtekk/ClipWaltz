import { createHash } from "node:crypto";
import type { ExplainerScript, VisualType } from "./script";

// Per-topic template variety.
//
// Without this every episode looks the same, in two distinct ways:
//
//   1. WITHIN an episode, the model reaches for `bullets` repeatedly — it is the
//      safest shape and the one it defaults to when unsure — so three sections
//      in a row render as identical dotted lists.
//   2. ACROSS episodes, the same topic shape produces the same sequence of
//      templates, so a viewer who watches two videos sees one design twice.
//
// Both are fixed here rather than in the prompt. The model's five-type contract
// took several rounds to make reliable (it invented numbered keys and wrote
// picture prompts into the data), and widening the shape list it must hold is
// the change most likely to break that again. So the model keeps its proven
// contract, and this rewrites the choice afterwards — a pure function over data
// that has already been validated, which cannot fail in a way that reaches the
// renderer.
//
// The whole design rests on one property: **a variant shares its spec shape with
// its original.** Swapping `bullets` for `layers` hands the same `{items: [...]}`
// to a different drawing routine. No data is re-read, re-shaped or re-validated,
// so a swap can never produce a spec its template cannot draw.

/**
 * Templates grouped by the spec shape they consume. Order matters: the first
 * entry is the model's own type, and rotation walks forward from it.
 */
const FAMILIES: VisualType[][] = [
  ["bullets", "checklist", "layers"], // {items: string[]}
  ["flow", "timeline"],               // {steps: string[]}
  ["title", "stat"],                  // {text, subtext}
];

/** Templates with a shape all their own — nothing can stand in for them. */
function familyOf(type: VisualType): VisualType[] | null {
  return FAMILIES.find((f) => f.includes(type)) ?? null;
}

/**
 * A stable number from the topic.
 *
 * Per-TOPIC rather than random: re-running a failed job must produce the same
 * episode, and the whole pipeline is built to be resumable. A random seed would
 * make a retried `scripting` stage render differently from the one that failed,
 * which is the sort of thing that turns a reproducible bug into a ghost.
 */
function seedFrom(topic: string): number {
  return parseInt(createHash("sha256").update(topic).digest("hex").slice(0, 8), 16);
}

/**
 * Re-assign visual templates for variety, in place of the model's choices.
 *
 * Two rules, applied in order:
 *
 *   • **Rotate by topic.** Each section's template is stepped forward within its
 *     family by an offset derived from the topic, so a different episode lays the
 *     same content out differently.
 *   • **Never twice in a row.** If a section still matches the one before it, it
 *     is stepped again. Consecutive identical layouts are what actually makes an
 *     episode look monotonous — far more than the overall mix does.
 *
 * `comparison` and `diagram` are left exactly as the model chose them: they have
 * no siblings, and they are also the two types that carry the most meaning in
 * their arrangement, so substituting something else would change what the
 * section says rather than just how it looks.
 */
export function varyTemplates(script: ExplainerScript, topic: string): ExplainerScript {
  const seed = seedFrom(topic);
  let previous: VisualType | null = null;

  const sections = script.sections.map((section, i) => {
    const family = familyOf(section.visual.type);
    if (!family) {
      previous = section.visual.type;
      return section;
    }

    const base = family.indexOf(section.visual.type);
    // A per-section step, so an episode does not simply shift every template by
    // the same amount — that would still produce runs of identical layouts.
    let idx = (base + seed + i * 7) % family.length;
    if (family[idx] === previous && family.length > 1) idx = (idx + 1) % family.length;

    const chosen = family[idx];
    previous = chosen;
    if (chosen === section.visual.type) return section;
    return { ...section, visual: { ...section.visual, type: chosen } };
  });

  return { ...script, sections };
}

/** What changed, for the job's warnings and for tests. */
export function varietyReport(before: ExplainerScript, after: ExplainerScript): string {
  const from = before.sections.map((s) => s.visual.type).join(", ");
  const to = after.sections.map((s) => s.visual.type).join(", ");
  return from === to ? `templates unchanged (${to})` : `templates ${from} → ${to}`;
}

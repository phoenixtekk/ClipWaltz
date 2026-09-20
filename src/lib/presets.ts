import { and, desc, eq, isNull, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUserId } from "./auth";
import { parseOverlays, type Overlay } from "./overlays";

// The set of Format + Style + overlay fields a preset snapshots and can apply to a project.
export type PresetShape = {
  aspect: string;
  lengthSec: number;
  maxFootage: boolean;
  styleFilter: string;
  lightFx: string;
  transition: string;
  motion: boolean;
  fades: boolean;
  fadeOut: boolean;
  smartCut: boolean;
  beatSync: boolean;
  waltzToMusic: boolean;
  loopToFill: boolean;
  overlays: Overlay[];
};

export type Preset = PresetShape & {
  id: string;
  name: string;
  kind: "builtin" | "user" | "global"; // where it came from
  isDefault: boolean; // user default, auto-applied to new projects
};

// Built-in starter presets — always available, live in code (not the DB). Ids are prefixed so
// they never collide with DB uuids and callers can branch on "builtin:".
export const BUILTIN_PRESETS: Preset[] = [
  {
    id: "builtin:tiktok",
    name: "TikTok Punchy",
    kind: "builtin",
    isDefault: false,
    aspect: "9:16",
    lengthSec: 30,
    maxFootage: false,
    styleFilter: "vivid",
    lightFx: "glow",
    transition: "crossfade",
    motion: true,
    fades: true,
    fadeOut: true,
    smartCut: true,
    beatSync: true,
    waltzToMusic: true,
    loopToFill: false,
    overlays: [],
  },
  {
    id: "builtin:cinematic",
    name: "Cinematic",
    kind: "builtin",
    isDefault: false,
    aspect: "16:9",
    lengthSec: 60,
    maxFootage: false,
    styleFilter: "vintage",
    lightFx: "noir",
    transition: "crossfade",
    motion: true,
    fades: true,
    fadeOut: true,
    smartCut: true,
    beatSync: false,
    waltzToMusic: false,
    loopToFill: false,
    overlays: [],
  },
  {
    id: "builtin:vlog",
    name: "Vlog",
    kind: "builtin",
    isDefault: false,
    aspect: "9:16",
    lengthSec: 60,
    maxFootage: false,
    styleFilter: "warm",
    lightFx: "none",
    transition: "cut",
    motion: false,
    fades: true,
    fadeOut: true,
    smartCut: true,
    beatSync: true,
    waltzToMusic: false,
    loopToFill: false,
    overlays: [],
  },
];

function rowToShape(r: typeof schema.presets.$inferSelect): PresetShape {
  return {
    aspect: r.aspect,
    lengthSec: r.lengthSec,
    maxFootage: r.maxFootage,
    styleFilter: r.styleFilter,
    lightFx: r.lightFx,
    transition: r.transition,
    motion: r.motion,
    fades: r.fades,
    fadeOut: r.fadeOut,
    smartCut: r.smartCut,
    beatSync: r.beatSync,
    waltzToMusic: r.waltzToMusic,
    loopToFill: r.loopToFill,
    overlays: parseOverlays(r.overlays),
  };
}

/** Presets available to the current user: their own + admin globals + built-in starters. */
export async function listPresets(): Promise<Preset[]> {
  const userId = await requireUserId();
  const rows = await db
    .select()
    .from(schema.presets)
    .where(or(eq(schema.presets.ownerId, userId), eq(schema.presets.isGlobal, true)))
    .orderBy(desc(schema.presets.isDefault), desc(schema.presets.updatedAt));

  const dbPresets: Preset[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.isGlobal ? "global" : "user",
    isDefault: r.isDefault,
    ...rowToShape(r),
  }));

  // user + global presets first, then the built-in starters
  return [...dbPresets, ...BUILTIN_PRESETS];
}

/** Resolve a preset id (builtin: or db uuid) to its applyable shape, for the current user. */
export async function getPresetShape(id: string): Promise<PresetShape | null> {
  if (id.startsWith("builtin:")) {
    const b = BUILTIN_PRESETS.find((p) => p.id === id);
    return b ? b : null;
  }
  const userId = await requireUserId();
  const [r] = await db
    .select()
    .from(schema.presets)
    .where(
      and(
        eq(schema.presets.id, id),
        or(eq(schema.presets.ownerId, userId), eq(schema.presets.isGlobal, true)),
      ),
    );
  return r ? rowToShape(r) : null;
}

/** The current user's default preset shape, if they have one set. Null otherwise. */
export async function getDefaultPresetShape(userId: string): Promise<PresetShape | null> {
  const [r] = await db
    .select()
    .from(schema.presets)
    .where(and(eq(schema.presets.ownerId, userId), eq(schema.presets.isDefault, true)))
    .limit(1);
  return r ? rowToShape(r) : null;
}

/** Admin: every global preset (for the admin content area). */
export async function listGlobalPresets() {
  const rows = await db
    .select()
    .from(schema.presets)
    .where(and(eq(schema.presets.isGlobal, true), isNull(schema.presets.ownerId)))
    .orderBy(desc(schema.presets.updatedAt));
  return rows.map((r) => ({ id: r.id, name: r.name, ...rowToShape(r) }));
}

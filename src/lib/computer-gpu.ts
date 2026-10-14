import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { getEffectiveTier, type Tier } from "./tier";
import { ONLINE_MS } from "./connector";
import { LLM_SETTINGS_KEY } from "../../worker/deck/llm.mjs";

// Phase C3: video on the user's own GPU through the ClipWaltz Connector (v0.2, local ComfyUI). The Connector reports its
// GPU and which built-in templates its ComfyUI can run (connectors.gpu / .comfy); jobs go out as connector_jobs
// kind "comfy.run" (worker/generation-worker.mjs → runComputer). Same admin switch as writing on the user's computer:
// /admin/ai → "Users' own computers" (app_settings llm_providers.connector: enabled + plans). Always 0 credits.

/** Template ids — must match TEMPLATES in public/connector/clipwaltz-connector.mjs. */
export const COMPUTER_TEMPLATES = {
  i2v: "wan-i2v-v1",
  talking: "clipwaltz-talking-v1",
  /** Talking photo, high quality: InfiniteTalk on Wan 2.1 14B (24 GB class card; Connector 0.3+). */
  talkingHq: "infinitetalk-v1",
} as const;
/** Talking-photo engines on the user's computer → their Connector template. */
export const TALKING_ENGINES = { clipwaltz: COMPUTER_TEMPLATES.talking, infinitetalk: COMPUTER_TEMPLATES.talkingHq } as const;
export type TalkingEngine = keyof typeof TALKING_ENGINES;
export type ComputerTemplate = (typeof COMPUTER_TEMPLATES)[keyof typeof COMPUTER_TEMPLATES];

export type GpuComputer = {
  id: string;
  name: string;
  online: boolean;
  gpu: { name: string; vramMb: number } | null;
  ready: string[];
  missing: Record<string, string[]>;
  comfyError: string | null;
  version: string | null;
};

export async function computersAllowed(userId: string): Promise<boolean> {
  const [row] = await db.select({ value: schema.appSettings.value }).from(schema.appSettings).where(eq(schema.appSettings.key, LLM_SETTINGS_KEY));
  const c = (row?.value as { connector?: { enabled?: boolean; plans?: Tier[] } } | undefined)?.connector;
  if (!c?.enabled) return false;
  return (c.plans ?? []).includes(await getEffectiveTier(userId));
}

export async function listGpuComputers(userId: string): Promise<GpuComputer[]> {
  const rows = await db.select().from(schema.connectors)
    .where(and(eq(schema.connectors.userId, userId), isNull(schema.connectors.revokedAt)));
  return rows.map((c) => {
    const comfy = (c.comfy ?? null) as { ok?: boolean; ready?: string[]; missing?: Record<string, string[]>; error?: string | null } | null;
    return {
      id: c.id,
      name: c.name,
      online: !!c.lastSeenAt && Date.now() - c.lastSeenAt.getTime() < ONLINE_MS,
      gpu: (c.gpu ?? null) as GpuComputer["gpu"],
      ready: comfy?.ok ? comfy.ready ?? [] : [],
      missing: comfy?.missing ?? {},
      comfyError: comfy && !comfy.ok ? comfy.error ?? "ComfyUI not reachable" : null,
      version: c.version,
    };
  });
}

const ACTIVE = ["queued", "preparing", "uploading_to_ai_node", "generating", "uploading_output"];
/** Jobs a user may have running on their computers at once (each holds a worker poller; typed scripts use AISERVER TTS). */
export const MAX_COMPUTER_JOBS = 2;

/** The user's computer for a GPU job, checked now: allowed on their plan, theirs, online and able to run the template. */
export async function computerFor(userId: string, connectorId: string, template: ComputerTemplate): Promise<GpuComputer> {
  if (!(await computersAllowed(userId))) throw new Error("Using your own computer isn't available on your plan right now");
  const c = (await listGpuComputers(userId)).find((x) => x.id === connectorId);
  if (!c) throw new Error("That computer isn't connected to your account");
  if (!c.online) throw new Error(`"${c.name}" is offline — start the ClipWaltz Connector on it`);
  const [{ n }] = await db.execute<{ n: number }>(sql`select count(*)::int n from generation_jobs
    where requested_by = ${userId} and request_json ? 'computer' and status in ${sql.raw(`('${ACTIVE.join("','")}')`)}`);
  if (n >= MAX_COMPUTER_JOBS) throw new Error(`You already have ${n} clips being made on your computers — wait for one to finish`);
  if (!c.ready.includes(template)) {
    const miss = c.missing[template];
    throw new Error(`"${c.name}" can't run this yet${miss?.length ? ` — it needs ${miss.join(", ")}` : " — update the ClipWaltz Connector to 0.2"}`);
  }
  return c;
}

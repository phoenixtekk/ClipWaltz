import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";

// Routing engine (CW-MVP-070, ADR-0009). Decisions come from the DB — `routing_rules` (task +
// quality → workflow + steps) filtered by `workflow_registry.enabled` and `model_registry.enabled`
// — so admins change routing from /admin/ai without a frontend deploy.

export type GenerationTask = "text_to_video" | "image_to_video";
export type EnhanceTask = "upscale" | "interpolate" | "restore";
export type Quality = "preview" | "standard" | "high";
export const QUALITIES: readonly Quality[] = ["preview", "standard", "high"];

export type GenerationRoute = {
  ruleId: string;
  /** AISERVER wrapper workflow id (`${workflowId}-${version}`). */
  workflow: string;
  workflowVersion: string;
  modelName: string | null;
  steps: number | null;
};

/** Thrown when nothing enabled can serve a request; the message is safe to show users. */
export class RouteUnavailableError extends Error {}

const wrapperId = (w: { workflowId: string; version: string }) => `${w.workflowId}-${w.version}`;

/** Pick the workflow + steps for a generation. Lowest priority wins; later rules are fallbacks. */
export async function resolveGenerationRoute(task: GenerationTask, quality: Quality): Promise<GenerationRoute> {
  const rows = await db
    .select({
      ruleId: schema.routingRules.id,
      steps: schema.routingRules.steps,
      workflowId: schema.workflowRegistry.workflowId,
      version: schema.workflowRegistry.version,
      modelName: schema.workflowRegistry.modelName,
    })
    .from(schema.routingRules)
    .innerJoin(schema.workflowRegistry, eq(schema.routingRules.workflowRegistryId, schema.workflowRegistry.id))
    .innerJoin(schema.modelRegistry, eq(schema.workflowRegistry.modelName, schema.modelRegistry.name))
    .where(
      and(
        eq(schema.routingRules.task, task),
        eq(schema.workflowRegistry.task, task), // never route to a workflow built for another task
        eq(schema.routingRules.quality, quality),
        eq(schema.routingRules.enabled, true),
        eq(schema.workflowRegistry.enabled, true),
        eq(schema.modelRegistry.enabled, true),
      ),
    )
    .orderBy(asc(schema.routingRules.priority), asc(schema.routingRules.id))
    .limit(1);
  const r = rows[0];
  if (!r) {
    const what = task === "text_to_video" ? "Text-to-video" : "Image-to-video";
    throw new RouteUnavailableError(`${what} at ${quality} quality is temporarily unavailable. Try another quality or check back soon.`);
  }
  return { ruleId: r.ruleId, workflow: wrapperId(r), workflowVersion: r.version, modelName: r.modelName, steps: r.steps };
}

/** The enabled wrapper workflow for an enhancement task, or null if none is enabled. */
export async function resolveEnhanceWorkflow(task: EnhanceTask): Promise<string | null> {
  const [w] = await db
    .select({ workflowId: schema.workflowRegistry.workflowId, version: schema.workflowRegistry.version })
    .from(schema.workflowRegistry)
    .innerJoin(schema.modelRegistry, eq(schema.workflowRegistry.modelName, schema.modelRegistry.name))
    .where(
      and(
        eq(schema.workflowRegistry.task, task),
        eq(schema.workflowRegistry.enabled, true),
        eq(schema.modelRegistry.enabled, true),
      ),
    )
    .orderBy(asc(schema.workflowRegistry.id))
    .limit(1);
  return w ? wrapperId(w) : null;
}

export type AiAvailability = {
  textToVideo: Record<Quality, boolean>;
  imageToVideo: Record<Quality, boolean>;
  upscale: boolean;
  interpolate: boolean;
  restore: boolean;
};

/** What the Generate tab can offer right now (drives which options are enabled in the UI). */
export async function getAiAvailability(): Promise<AiAvailability> {
  const can = async (task: GenerationTask, q: Quality) =>
    resolveGenerationRoute(task, q).then(() => true, () => false);
  const per = async (task: GenerationTask) =>
    Object.fromEntries(await Promise.all(QUALITIES.map(async (q) => [q, await can(task, q)] as const))) as Record<Quality, boolean>;
  const [textToVideo, imageToVideo, upscale, interpolate, restore] = await Promise.all([
    per("text_to_video"),
    per("image_to_video"),
    resolveEnhanceWorkflow("upscale"),
    resolveEnhanceWorkflow("interpolate"),
    resolveEnhanceWorkflow("restore"),
  ]);
  return { textToVideo, imageToVideo, upscale: !!upscale, interpolate: !!interpolate, restore: !!restore };
}

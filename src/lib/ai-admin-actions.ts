"use server";
import { randomUUID } from "crypto";
import { asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireAdmin } from "./admin";

// Admin control of the AI registry + routing rules (CW-MVP-070/071/190/191, ADR-0009).
// All actions are admin-only; the routing engine (src/lib/ai/routing.ts) reads these tables live.

const TASKS = ["text_to_video", "image_to_video"] as const;
const QUALITIES = ["preview", "standard", "high"] as const;

export type AiRegistry = {
  models: { id: string; name: string; family: string | null; role: string | null; enabled: boolean; vramProfileMb: number | null; description: string | null }[];
  workflows: { id: string; workflowId: string; version: string; task: string | null; modelName: string | null; enabled: boolean; requiredVramMb: number | null }[];
  rules: { id: string; task: string; quality: string; workflowRegistryId: string; steps: number | null; priority: number; enabled: boolean }[];
};

export async function getAiRegistry(): Promise<AiRegistry> {
  await requireAdmin();
  const [models, workflows, rules] = await Promise.all([
    db.select({
      id: schema.modelRegistry.id, name: schema.modelRegistry.name, family: schema.modelRegistry.family,
      role: schema.modelRegistry.role, enabled: schema.modelRegistry.enabled,
      vramProfileMb: schema.modelRegistry.vramProfileMb, description: schema.modelRegistry.description,
    }).from(schema.modelRegistry).orderBy(asc(schema.modelRegistry.name)),
    db.select({
      id: schema.workflowRegistry.id, workflowId: schema.workflowRegistry.workflowId, version: schema.workflowRegistry.version,
      task: schema.workflowRegistry.task, modelName: schema.workflowRegistry.modelName,
      enabled: schema.workflowRegistry.enabled, requiredVramMb: schema.workflowRegistry.requiredVramMb,
    }).from(schema.workflowRegistry).orderBy(asc(schema.workflowRegistry.task), asc(schema.workflowRegistry.id)),
    db.select({
      id: schema.routingRules.id, task: schema.routingRules.task, quality: schema.routingRules.quality,
      workflowRegistryId: schema.routingRules.workflowRegistryId, steps: schema.routingRules.steps,
      priority: schema.routingRules.priority, enabled: schema.routingRules.enabled,
    }).from(schema.routingRules).orderBy(asc(schema.routingRules.task), asc(schema.routingRules.quality), asc(schema.routingRules.priority)),
  ]);
  return { models, workflows, rules };
}

function done() {
  revalidatePath("/admin/ai");
}

export async function setModelEnabled(id: string, enabled: boolean): Promise<void> {
  await requireAdmin();
  const r = await db.update(schema.modelRegistry).set({ enabled: !!enabled, updatedAt: new Date() })
    .where(eq(schema.modelRegistry.id, id)).returning({ id: schema.modelRegistry.id });
  if (!r.length) throw new Error("Model not found");
  done();
}

export async function setWorkflowEnabled(id: string, enabled: boolean): Promise<void> {
  await requireAdmin();
  const r = await db.update(schema.workflowRegistry).set({ enabled: !!enabled, updatedAt: new Date() })
    .where(eq(schema.workflowRegistry.id, id)).returning({ id: schema.workflowRegistry.id });
  if (!r.length) throw new Error("Workflow not found");
  done();
}

type RuleInput = { task: string; quality: string; workflowRegistryId: string; steps: number | null; priority: number; enabled: boolean };

// Validate a rule: known task/quality, sane steps/priority, and a workflow that does that task.
async function validRule(input: RuleInput): Promise<RuleInput> {
  if (!(TASKS as readonly string[]).includes(input.task)) throw new Error("Unknown task");
  if (!(QUALITIES as readonly string[]).includes(input.quality)) throw new Error("Unknown quality");
  const steps = input.steps == null ? null : Math.round(Number(input.steps));
  if (steps != null && !(steps >= 4 && steps <= 60)) throw new Error("Steps must be 4–60 (or blank for the workflow default)");
  const priority = Math.round(Number(input.priority));
  if (!Number.isFinite(priority) || priority < 0 || priority > 1000) throw new Error("Priority must be 0–1000");
  const [wf] = await db.select({ task: schema.workflowRegistry.task }).from(schema.workflowRegistry)
    .where(eq(schema.workflowRegistry.id, input.workflowRegistryId));
  if (!wf) throw new Error("Workflow not found");
  if (wf.task !== input.task) throw new Error(`That workflow does ${wf.task ?? "an unknown task"}, not ${input.task}`);
  return { task: input.task, quality: input.quality, workflowRegistryId: input.workflowRegistryId, steps, priority, enabled: !!input.enabled };
}

export async function saveRoutingRule(id: string | null, input: RuleInput): Promise<void> {
  await requireAdmin();
  const v = await validRule(input);
  if (id) {
    const r = await db.update(schema.routingRules).set({ ...v, updatedAt: new Date() })
      .where(eq(schema.routingRules.id, id)).returning({ id: schema.routingRules.id });
    if (!r.length) throw new Error("Rule not found");
  } else {
    await db.insert(schema.routingRules).values({ id: randomUUID(), ...v });
  }
  done();
}

export async function deleteRoutingRule(id: string): Promise<void> {
  await requireAdmin();
  await db.delete(schema.routingRules).where(eq(schema.routingRules.id, id));
  done();
}

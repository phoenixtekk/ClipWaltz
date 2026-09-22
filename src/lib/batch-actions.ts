"use server";
import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireAdmin } from "./admin";
import { getPresetShape } from "./presets";

// Auto-Batch is admin-only: it stores absolute server paths that the batch worker reads/writes as
// the `lacy` user, so only a trusted operator may configure it.

const abs = (p: string) => {
  const s = (p ?? "").trim();
  if (!s.startsWith("/")) throw new Error(`Path must be absolute (start with /): ${s || "(empty)"}`);
  if (s.includes("..")) throw new Error("Path may not contain '..'");
  return s.replace(/\/+$/, "");
};

export type BatchSettings = {
  aspect: string;
  lengthSec: number;
  maxFootage: boolean;
  loopToFill: boolean;
  styleFilter: string;
  lightFx: string;
  transition: string;
  motion: boolean;
  fades: boolean;
  fadeOut: boolean;
  smartCut: boolean;
  beatSync: boolean;
  waltzToMusic: boolean;
  musicTrackId: string | null;
  describe: boolean;
  postTopic: string | null;
  postTemplate: string | null;
  originalAudio: boolean;
};

/** Create an auto-batch. Settings come from a preset (if given) + a couple of explicit options. */
export async function createBatch(input: {
  name: string;
  inboxPath: string;
  outputPath: string;
  donePath: string;
  grouping: "subfolder" | "whole" | "file";
  scheduleMinutes: number;
  presetId?: string | null;
  musicTrackId?: string | null;
  describe?: boolean;
}): Promise<string> {
  const s = await requireAdmin();
  const userId = (s as { user: { id: string } }).user.id;
  const name = input.name.trim().slice(0, 80);
  if (!name) throw new Error("Batch name can't be empty");

  const shape = input.presetId ? await getPresetShape(input.presetId) : null;
  const settings: BatchSettings = {
    aspect: shape?.aspect ?? "9:16",
    lengthSec: shape?.lengthSec ?? 60,
    maxFootage: shape?.maxFootage ?? false,
    loopToFill: shape?.loopToFill ?? false,
    styleFilter: shape?.styleFilter ?? "none",
    lightFx: shape?.lightFx ?? "none",
    transition: shape?.transition ?? "cut",
    motion: shape?.motion ?? true,
    fades: shape?.fades ?? true,
    fadeOut: shape?.fadeOut ?? true,
    smartCut: shape?.smartCut ?? true,
    beatSync: shape?.beatSync ?? true,
    waltzToMusic: shape?.waltzToMusic ?? false,
    musicTrackId: input.musicTrackId ?? null,
    describe: !!input.describe,
    postTopic: null,
    postTemplate: null,
    originalAudio: false,
  };

  const id = randomUUID();
  await db.insert(schema.batchJobs).values({
    id,
    ownerId: userId,
    name,
    inboxPath: abs(input.inboxPath),
    outputPath: abs(input.outputPath),
    donePath: abs(input.donePath),
    grouping: ["subfolder", "whole", "file"].includes(input.grouping) ? input.grouping : "subfolder",
    scheduleMinutes: Math.max(0, Math.min(10080, Math.round(input.scheduleMinutes || 0))),
    settings,
    status: "active",
  });
  revalidatePath("/admin/batch");
  return id;
}

/** active ⇄ paused (or reactivate a finished batch to rescan). */
export async function setBatchStatus(id: string, status: "active" | "paused"): Promise<void> {
  const s = await requireAdmin();
  const userId = (s as { user: { id: string } }).user.id;
  await db
    .update(schema.batchJobs)
    .set({ status })
    .where(and(eq(schema.batchJobs.id, id), eq(schema.batchJobs.ownerId, userId)));
  revalidatePath("/admin/batch");
}

export async function deleteBatch(id: string): Promise<void> {
  const s = await requireAdmin();
  const userId = (s as { user: { id: string } }).user.id;
  await db.delete(schema.batchJobs).where(and(eq(schema.batchJobs.id, id), eq(schema.batchJobs.ownerId, userId)));
  revalidatePath("/admin/batch");
}

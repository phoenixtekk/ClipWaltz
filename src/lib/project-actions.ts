"use server";
import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireUserId } from "./auth";

// Confirm the current user owns the project before any mutation (defends against
// a tampered projectId from the client).
async function assertOwner(userId: string, projectId: string) {
  const [row] = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.ownerId, userId)));
  if (!row) throw new Error("Project not found");
}

// Templates selectable at MVP. "birthday" ships later, so it's not accepted yet.
const ACTIVE_TEMPLATES = new Set(["trip", "event", "surprise"]);
const DEFAULT_TITLE: Record<string, string> = {
  trip: "Trip video",
  event: "Event video",
  surprise: "Untitled project",
};

/** Create a new draft project for the current user. Returns its id. */
export async function createProject(template?: string): Promise<string> {
  const userId = await requireUserId();
  const t = template && ACTIVE_TEMPLATES.has(template) ? template : "surprise";
  const id = randomUUID();
  await db.insert(schema.projects).values({
    id,
    ownerId: userId,
    template: t,
    title: DEFAULT_TITLE[t] ?? "Untitled project",
  });
  revalidatePath("/projects");
  return id;
}

export async function deleteProject(projectId: string): Promise<void> {
  const userId = await requireUserId();
  await assertOwner(userId, projectId);
  await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
  revalidatePath("/projects");
}

export async function renameProject(projectId: string, title: string): Promise<void> {
  const userId = await requireUserId();
  await assertOwner(userId, projectId);
  const clean = title.trim().slice(0, 120) || "Untitled project";
  await db
    .update(schema.projects)
    .set({ title: clean, updatedAt: new Date() })
    .where(eq(schema.projects.id, projectId));
  revalidatePath("/projects");
}

export async function duplicateProject(projectId: string): Promise<string> {
  const userId = await requireUserId();
  await assertOwner(userId, projectId);
  const [orig] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId));
  if (!orig) throw new Error("Project not found");
  const id = randomUUID();
  await db.insert(schema.projects).values({
    id,
    ownerId: userId,
    title: `${orig.title} (copy)`,
    template: orig.template,
    aspect: orig.aspect,
    lengthSec: orig.lengthSec,
    status: "draft",
    musicTrackId: orig.musicTrackId,
  });
  revalidatePath("/projects");
  return id;
}

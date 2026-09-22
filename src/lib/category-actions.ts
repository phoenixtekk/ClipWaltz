"use server";
import { randomUUID } from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireUserId } from "./auth";

const clean = (s: string, max = 60) => s.trim().slice(0, max);

/** Create a category (folder). Idempotent on name — returns the existing/created id. */
export async function createCategory(name: string, color?: string | null): Promise<string> {
  const userId = await requireUserId();
  const nm = clean(name);
  if (!nm) throw new Error("Category name can't be empty");
  const [existing] = await db
    .select({ id: schema.projectCategories.id })
    .from(schema.projectCategories)
    .where(and(eq(schema.projectCategories.ownerId, userId), eq(schema.projectCategories.name, nm)));
  if (existing) return existing.id;
  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${schema.projectCategories.sortOrder}), -1)::int` })
    .from(schema.projectCategories)
    .where(eq(schema.projectCategories.ownerId, userId));
  const id = randomUUID();
  await db.insert(schema.projectCategories).values({
    id,
    ownerId: userId,
    name: nm,
    color: color ? clean(color, 9) : null,
    sortOrder: (max ?? -1) + 1,
  });
  revalidatePath("/projects");
  return id;
}

/** Rename a category and re-point every project currently in it. */
export async function renameCategory(id: string, name: string): Promise<void> {
  const userId = await requireUserId();
  const nm = clean(name);
  if (!nm) throw new Error("Category name can't be empty");
  const [row] = await db
    .select({ name: schema.projectCategories.name })
    .from(schema.projectCategories)
    .where(and(eq(schema.projectCategories.id, id), eq(schema.projectCategories.ownerId, userId)));
  if (!row) throw new Error("Category not found");
  await db
    .update(schema.projectCategories)
    .set({ name: nm })
    .where(and(eq(schema.projectCategories.id, id), eq(schema.projectCategories.ownerId, userId)));
  await db
    .update(schema.projects)
    .set({ category: nm })
    .where(and(eq(schema.projects.ownerId, userId), eq(schema.projects.category, row.name)));
  revalidatePath("/projects");
}

/** Delete a category; its projects fall back to Uncategorized (category = null). */
export async function deleteCategory(id: string): Promise<void> {
  const userId = await requireUserId();
  const [row] = await db
    .select({ name: schema.projectCategories.name })
    .from(schema.projectCategories)
    .where(and(eq(schema.projectCategories.id, id), eq(schema.projectCategories.ownerId, userId)));
  if (!row) return;
  await db
    .update(schema.projects)
    .set({ category: null })
    .where(and(eq(schema.projects.ownerId, userId), eq(schema.projects.category, row.name)));
  await db
    .delete(schema.projectCategories)
    .where(and(eq(schema.projectCategories.id, id), eq(schema.projectCategories.ownerId, userId)));
  revalidatePath("/projects");
}

/** Set (or clear, with null) a category's accent colour. */
export async function setCategoryColor(id: string, color: string | null): Promise<void> {
  const userId = await requireUserId();
  await db
    .update(schema.projectCategories)
    .set({ color: color ? clean(color, 9) : null })
    .where(and(eq(schema.projectCategories.id, id), eq(schema.projectCategories.ownerId, userId)));
  revalidatePath("/projects");
}

/** Move a category one slot up (-1) or down (+1) by swapping sortOrder with its neighbour. */
export async function moveCategory(id: string, dir: -1 | 1): Promise<void> {
  const userId = await requireUserId();
  const cats = await db
    .select({ id: schema.projectCategories.id, sortOrder: schema.projectCategories.sortOrder })
    .from(schema.projectCategories)
    .where(eq(schema.projectCategories.ownerId, userId))
    .orderBy(schema.projectCategories.sortOrder, schema.projectCategories.createdAt);
  const i = cats.findIndex((c) => c.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= cats.length) return;
  const a = cats[i];
  const b = cats[j];
  await db.update(schema.projectCategories).set({ sortOrder: b.sortOrder }).where(and(eq(schema.projectCategories.id, a.id), eq(schema.projectCategories.ownerId, userId)));
  await db.update(schema.projectCategories).set({ sortOrder: a.sortOrder }).where(and(eq(schema.projectCategories.id, b.id), eq(schema.projectCategories.ownerId, userId)));
  revalidatePath("/projects");
}

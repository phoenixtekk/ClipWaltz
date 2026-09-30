"use server";
import { randomUUID } from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireUserId } from "./auth";
import { toResult } from "./action-result";

const clean = (s: string, max = 60) => s.trim().slice(0, max);

/** Create a category (folder). Idempotent on name — returns the existing/created id. */
async function createCategoryImpl(name: string, color?: string | null): Promise<string> {
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
async function renameCategoryImpl(id: string, name: string): Promise<void> {
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
async function deleteCategoryImpl(id: string): Promise<void> {
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
async function setCategoryColorImpl(id: string, color: string | null): Promise<void> {
  const userId = await requireUserId();
  await db
    .update(schema.projectCategories)
    .set({ color: color ? clean(color, 9) : null })
    .where(and(eq(schema.projectCategories.id, id), eq(schema.projectCategories.ownerId, userId)));
  revalidatePath("/projects");
}

/** Move a category one slot up (-1) or down (+1) by swapping sortOrder with its neighbour. */
async function moveCategoryImpl(id: string, dir: -1 | 1): Promise<void> {
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

// Exported actions return ActionResult (action-result.ts — thrown messages are hidden in production builds).
// Client: unwrap(await action(...)).
export async function createCategory(...args: Parameters<typeof createCategoryImpl>) { return toResult(() => createCategoryImpl(...args)); }
export async function renameCategory(...args: Parameters<typeof renameCategoryImpl>) { return toResult(() => renameCategoryImpl(...args)); }
export async function deleteCategory(...args: Parameters<typeof deleteCategoryImpl>) { return toResult(() => deleteCategoryImpl(...args)); }
export async function setCategoryColor(...args: Parameters<typeof setCategoryColorImpl>) { return toResult(() => setCategoryColorImpl(...args)); }
export async function moveCategory(...args: Parameters<typeof moveCategoryImpl>) { return toResult(() => moveCategoryImpl(...args)); }

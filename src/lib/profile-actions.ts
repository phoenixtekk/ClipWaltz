"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireUserId } from "./auth";

function clean(v: string | undefined | null, max = 200): string | null {
  if (!v) return null;
  const s = v.trim().slice(0, max);
  return s || null;
}

/** Update the signed-in user's public profile (name, bio, social links). */
export async function updateProfile(input: {
  name?: string;
  bio?: string;
  website?: string;
  instagram?: string;
  tiktok?: string;
  youtube?: string;
}): Promise<void> {
  const userId = await requireUserId();
  const name = clean(input.name, 80);
  if (input.name !== undefined && !name) throw new Error("Name can't be empty");

  await db
    .update(schema.user)
    .set({
      ...(name ? { name } : {}),
      bio: clean(input.bio, 400),
      website: clean(input.website),
      instagram: clean(input.instagram, 80),
      tiktok: clean(input.tiktok, 80),
      youtube: clean(input.youtube, 80),
      updatedAt: new Date(),
    })
    .where(eq(schema.user.id, userId));

  revalidatePath("/account/profile");
  revalidatePath(`/u/${userId}`);
}

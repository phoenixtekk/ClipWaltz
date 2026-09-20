"use server";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireAdmin } from "./admin";

const PLACEMENTS = new Set(["dashboard_banner", "dashboard_card", "community"]);
const AUDIENCES = new Set(["all", "free", "paid"]);
const ACCENTS = new Set(["violet", "blue", "magenta", "coral"]);

function parseDate(v: FormDataEntryValue | null): Date | null {
  const s = (v ?? "").toString().trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Admin: create an in-app announcement / promo from the admin form. */
export async function createAnnouncement(form: FormData): Promise<void> {
  const admin = await requireAdmin();
  const title = (form.get("title") ?? "").toString().trim().slice(0, 120);
  if (!title) throw new Error("Title is required");
  const placement = (form.get("placement") ?? "dashboard_card").toString();
  const audience = (form.get("audience") ?? "all").toString();
  const accent = (form.get("accent") ?? "violet").toString();

  await db.insert(schema.announcements).values({
    id: randomUUID(),
    title,
    body: (form.get("body") ?? "").toString().trim().slice(0, 500) || null,
    imageUrl: (form.get("imageUrl") ?? "").toString().trim().slice(0, 500) || null,
    ctaLabel: (form.get("ctaLabel") ?? "").toString().trim().slice(0, 40) || null,
    ctaUrl: (form.get("ctaUrl") ?? "").toString().trim().slice(0, 500) || null,
    placement: PLACEMENTS.has(placement) ? placement : "dashboard_card",
    audience: AUDIENCES.has(audience) ? audience : "all",
    accent: ACCENTS.has(accent) ? accent : "violet",
    active: true,
    startsAt: parseDate(form.get("startsAt")),
    endsAt: parseDate(form.get("endsAt")),
    createdBy: admin.user.id,
  });
  revalidatePath("/admin");
  revalidatePath("/dashboard");
}

/** Admin: toggle an announcement live/paused. */
export async function toggleAnnouncement(id: string, active: boolean): Promise<void> {
  await requireAdmin();
  await db
    .update(schema.announcements)
    .set({ active, updatedAt: new Date() })
    .where(eq(schema.announcements.id, id));
  revalidatePath("/admin");
  revalidatePath("/dashboard");
}

/** Admin: delete an announcement. */
export async function deleteAnnouncement(id: string): Promise<void> {
  await requireAdmin();
  await db.delete(schema.announcements).where(eq(schema.announcements.id, id));
  revalidatePath("/admin");
  revalidatePath("/dashboard");
}

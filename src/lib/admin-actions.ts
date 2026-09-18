"use server";
import { randomUUID } from "crypto";
import { desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireAdmin } from "./admin";
import { applyGrant, getEffectiveTier } from "./tier";
import { sendEmail, simpleEmail } from "./email";

export type AdminUser = {
  id: string;
  email: string;
  name: string | null;
  tier: string;
  createdAt: Date;
};

/** All users with their effective tier (admin only). */
export async function listUsersAdmin(): Promise<AdminUser[]> {
  await requireAdmin();
  const users = await db
    .select({ id: schema.user.id, email: schema.user.email, name: schema.user.name, createdAt: schema.user.createdAt })
    .from(schema.user)
    .orderBy(desc(schema.user.createdAt))
    .limit(200);
  return Promise.all(
    users.map(async (u) => ({ ...u, tier: await getEffectiveTier(u.id) })),
  );
}

export async function listInvitesAdmin() {
  await requireAdmin();
  return db.select().from(schema.invites).orderBy(desc(schema.invites.createdAt)).limit(100);
}

/**
 * Grant paid access to an email. If the user already exists the grant applies
 * immediately; otherwise a pending invite is stored and redeemed on their signup.
 * lifetime=true → no expiry; else expiresAt (ISO date) is required.
 */
export async function grantAccess(input: {
  email: string;
  tier: "plus" | "pro";
  lifetime: boolean;
  expiresAt?: string | null;
  note?: string;
}): Promise<{ applied: "user" | "invite" }> {
  const admin = await requireAdmin();
  const email = input.email.trim().toLowerCase();
  if (!email || !email.includes("@")) throw new Error("Enter a valid email");
  const expiresAt = input.lifetime ? null : input.expiresAt ? new Date(input.expiresAt) : null;
  if (!input.lifetime && !expiresAt) throw new Error("Choose Lifetime or pick an expiry date");
  if (expiresAt && expiresAt.getTime() <= Date.now()) throw new Error("Expiry must be in the future");

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.clipwaltz.com";
  const until = expiresAt ? `until ${expiresAt.toDateString()}` : "for life";
  const [existing] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, email));

  if (existing) {
    await applyGrant(existing.id, input.tier, expiresAt);
    await sendEmail({
      to: email,
      subject: `Your ClipWaltz ${input.tier} access is active`,
      html: simpleEmail(
        "You're upgraded 🎬",
        `An admin granted you ClipWaltz <b>${input.tier}</b> access ${until}. Jump in and start waltzing.`,
        { label: "Open ClipWaltz", url: `${base}/projects` },
      ),
      text: `You now have ClipWaltz ${input.tier} access ${until}. ${base}/projects`,
    }).catch(() => {});
    revalidatePath("/admin");
    return { applied: "user" };
  }

  await db.insert(schema.invites).values({
    id: randomUUID(),
    email,
    tier: input.tier,
    expiresAt: expiresAt ?? undefined,
    note: input.note,
    createdBy: admin.user.id,
  });
  await sendEmail({
    to: email,
    subject: "You're invited to ClipWaltz",
    html: simpleEmail(
      "You're invited to ClipWaltz 🎬",
      `Create your account and your <b>${input.tier}</b> access (${until}) unlocks automatically.`,
      { label: "Create your account", url: `${base}/sign-up` },
    ),
    text: `Join ClipWaltz and your ${input.tier} access unlocks on signup: ${base}/sign-up`,
  }).catch(() => {});
  revalidatePath("/admin");
  return { applied: "invite" };
}

/** Revoke a user's paid access (back to free). */
export async function revokeAccess(userId: string) {
  await requireAdmin();
  await applyGrant(userId, "free", null);
  revalidatePath("/admin");
}

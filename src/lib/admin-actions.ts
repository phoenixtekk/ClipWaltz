"use server";
import { randomUUID } from "crypto";
import { desc, eq, gte } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireAdmin } from "./admin";
import { applyGrant, getEffectiveTier } from "./tier";
import { sendEmail, simpleEmail } from "./email";
import { toResult } from "./action-result";
import { MAX_CREDIT_GRANT } from "./credits";

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
async function grantAccessImpl(input: {
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
async function revokeAccessImpl(userId: string) {
  await requireAdmin();
  await applyGrant(userId, "free", null);
  revalidatePath("/admin");
}

/** Admin: watermark paid plans (Plus/Pro) too? Free is always watermarked. Affects new videos only. */
async function setWatermarkPaidPlansImpl(on: boolean): Promise<void> {
  await requireAdmin();
  const { setWatermarkPaidPlansSetting } = await import("./watermark");
  await setWatermarkPaidPlansSetting(!!on);
  revalidatePath("/admin");
  revalidatePath("/account/billing");
  revalidatePath("/");
}

export type AdminCreditGrant = {
  id: string; email: string; name: string | null; amount: number; note: string | null; grantedBy: string | null; createdAt: Date;
};

/** This month's AI credit grants, newest first (admin only). Grants expire at the monthly reset. */
export async function listCreditGrantsAdmin(): Promise<AdminCreditGrant[]> {
  await requireAdmin();
  const { monthStart } = await import("./credits-server");
  const granter = alias(schema.user, "granter");
  return db
    .select({
      id: schema.creditGrants.id, email: schema.user.email, name: schema.user.name, amount: schema.creditGrants.amount,
      note: schema.creditGrants.note, grantedBy: granter.email, createdAt: schema.creditGrants.createdAt,
    })
    .from(schema.creditGrants)
    .innerJoin(schema.user, eq(schema.creditGrants.userId, schema.user.id))
    .leftJoin(granter, eq(schema.creditGrants.grantedBy, granter.id))
    .where(gte(schema.creditGrants.createdAt, monthStart()))
    .orderBy(desc(schema.creditGrants.createdAt));
}

/** Give a user extra AI credits for the current month (on top of their plan's allowance). Existing accounts only. */
async function grantCreditsImpl(input: { email: string; amount: number; note?: string }): Promise<{ email: string; amount: number }> {
  const admin = await requireAdmin();
  const email = input.email.trim().toLowerCase();
  if (!email || !email.includes("@")) throw new Error("Enter a valid email");
  const amount = Math.round(Number(input.amount));
  if (!Number.isFinite(amount) || amount < 1) throw new Error("Enter a number of credits (1 or more)");
  if (amount > MAX_CREDIT_GRANT) throw new Error(`One grant can add at most ${MAX_CREDIT_GRANT.toLocaleString("en-US")} credits`);
  const [u] = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.email, email));
  if (!u) throw new Error("No ClipWaltz account uses that email");
  const note = (input.note ?? "").replace(/\s+/g, " ").trim().slice(0, 200) || null;
  await db.insert(schema.creditGrants).values({ id: randomUUID(), userId: u.id, amount, note, grantedBy: admin.user.id });
  revalidatePath("/admin");
  revalidatePath("/account/billing");
  return { email, amount };
}

/** Take back a grant (its credits leave this month's balance). */
async function revokeCreditGrantImpl(grantId: string): Promise<void> {
  await requireAdmin();
  await db.delete(schema.creditGrants).where(eq(schema.creditGrants.id, grantId));
  revalidatePath("/admin");
  revalidatePath("/account/billing");
}

// Exported actions return ActionResult (action-result.ts — thrown messages are hidden in production builds).
// Client: unwrap(await action(...)).
export async function grantAccess(...args: Parameters<typeof grantAccessImpl>) { return toResult(() => grantAccessImpl(...args)); }
export async function revokeAccess(...args: Parameters<typeof revokeAccessImpl>) { return toResult(() => revokeAccessImpl(...args)); }
export async function setWatermarkPaidPlans(...args: Parameters<typeof setWatermarkPaidPlansImpl>) { return toResult(() => setWatermarkPaidPlansImpl(...args)); }
export async function grantCredits(...args: Parameters<typeof grantCreditsImpl>) { return toResult(() => grantCreditsImpl(...args)); }
export async function revokeCreditGrant(...args: Parameters<typeof revokeCreditGrantImpl>) { return toResult(() => revokeCreditGrantImpl(...args)); }

import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getEffectiveTier } from "./tier";

// Single source of truth for the ClipWaltz logo watermark (bottom-left, worker/WaterMark.png).
// Owner decision 2026-09-25: every video on every plan is watermarked by default; the admin can turn
// it off for paid plans (/admin → "Watermark paid plans"). Free is always watermarked.

const KEY = "watermark_paid_plans";
let cache: { at: number; value: boolean } | null = null;

/** Whether Plus/Pro videos get the logo too (default true until an admin turns it off). */
export async function watermarkPaidPlans(): Promise<boolean> {
  if (cache && Date.now() - cache.at < 30_000) return cache.value;
  const [row] = await db.select({ value: schema.appSettings.value }).from(schema.appSettings).where(eq(schema.appSettings.key, KEY));
  const value = row ? row.value !== false : true;
  cache = { at: Date.now(), value };
  return value;
}

export async function setWatermarkPaidPlansSetting(on: boolean): Promise<void> {
  await db.insert(schema.appSettings).values({ key: KEY, value: !!on })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: !!on, updatedAt: new Date() } });
  cache = null;
}

/** Should a video made for this user carry the watermark? */
export async function shouldWatermark(userId: string): Promise<boolean> {
  if ((await getEffectiveTier(userId)) === "free") return true;
  return watermarkPaidPlans();
}

"use server";
import { requireUserId } from "./auth";
import { getCreditBalance } from "./credits-server";
import type { CreditBalance } from "./credits";

/** The signed-in user's AI credits this month (allowance, used, left, reset date). */
export async function getMyCredits(): Promise<CreditBalance> {
  return getCreditBalance(await requireUserId());
}

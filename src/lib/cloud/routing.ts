import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { CloudProviderId } from "./types";

// Which connected storage each finished video goes to. First answer wins:
//   1. the "Save to" picked when the render was started (renders.cloud_targets)
//   2. the project's own setting (projects.cloud_targets — Video properties)
//   3. the first of the user's rules that matches the video (type / category / format)
//   4. the user's default destinations (no cloud_prefs row = connections with auto_save on)
// Every answer is a list of providers; [] means "don't save". Providers that aren't connected are dropped.

export * from "./routing-shared";
import { cleanRules, cleanTargets, type CloudPrefs } from "./routing-shared";

export async function getPrefs(userId: string): Promise<CloudPrefs> {
  const [row] = await db.select().from(schema.cloudPrefs).where(eq(schema.cloudPrefs.userId, userId));
  if (row) return { defaultTargets: cleanTargets(row.defaultTargets), rules: cleanRules(row.rules), saved: true };
  const auto = await db
    .select({ provider: schema.oauthAccounts.provider })
    .from(schema.oauthAccounts)
    .where(and(eq(schema.oauthAccounts.userId, userId), eq(schema.oauthAccounts.autoSave, true)));
  return { defaultTargets: cleanTargets(auto.map((a) => a.provider)), rules: [], saved: false };
}

/** A newly connected service joins the default destinations ("connect = save there"), when the user has saved prefs. */
export async function addDefaultTarget(userId: string, p: CloudProviderId) {
  const [row] = await db.select().from(schema.cloudPrefs).where(eq(schema.cloudPrefs.userId, userId));
  if (!row) return; // no prefs yet: the default is "every connection with auto_save on", which includes it
  const cur = cleanTargets(row.defaultTargets);
  if (cur.includes(p)) return;
  await db.update(schema.cloudPrefs).set({ defaultTargets: [...cur, p], updatedAt: new Date() }).where(eq(schema.cloudPrefs.userId, userId));
}

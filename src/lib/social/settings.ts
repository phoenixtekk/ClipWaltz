import { eq } from "drizzle-orm";
import { db, schema } from "@/db";

// Social Publishing's small key/value settings, stored in ClipWaltz's `app_settings` (key → jsonb) under a `social:`
// prefix (plan §4.2: SP's `app_setting` values move to `app_settings` keyed `social:*`). Same string-in/string-out
// interface as SP's `src/lib/settings.ts`, so the ported callers (Mastodon app cache, post length cap, timezone) are
// unchanged. Values are stored as JSON strings.

const PREFIX = "social:";
const full = (key: string) => (key.startsWith(PREFIX) ? key : `${PREFIX}${key}`);

/** Read a setting, or null. */
export async function getSetting(key: string): Promise<string | null> {
  const [row] = await db
    .select({ value: schema.appSettings.value })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, full(key)));
  if (!row) return null;
  return typeof row.value === "string" ? row.value : JSON.stringify(row.value);
}

/** Upsert a setting. */
export async function setSetting(key: string, value: string) {
  await db
    .insert(schema.appSettings)
    .values({ key: full(key), value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value, updatedAt: new Date() } });
}

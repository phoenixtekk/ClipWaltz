import "server-only";
import { randomUUID } from "crypto";
import webpush from "web-push";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";

// Web Push (VAPID) for render-complete notifications. The public key is also exposed to
// the client as NEXT_PUBLIC_VAPID_PUBLIC_KEY (safe — it ships to browsers by design).
// Private key stays server-side. If the keys aren't configured, push is a no-op so the
// rest of the app (and the render-ready callback) keeps working.

const PUBLIC = process.env.VAPID_PUBLIC_KEY ?? "";
const PRIVATE = process.env.VAPID_PRIVATE_KEY ?? "";
const SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:hello@clipwaltz.com";

export const pushConfigured = Boolean(PUBLIC && PRIVATE);

let ready = false;
function ensure(): boolean {
  if (!pushConfigured) return false;
  if (!ready) {
    webpush.setVapidDetails(SUBJECT, PUBLIC, PRIVATE);
    ready = true;
  }
  return true;
}

export type WebPushSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

/** Upsert a browser's push subscription for a user (idempotent on endpoint). */
export async function savePushSubscription(
  userId: string,
  sub: WebPushSubscription,
  userAgent?: string | null,
): Promise<void> {
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    throw new Error("Invalid push subscription");
  }
  await db
    .insert(schema.pushSubscriptions)
    .values({
      id: randomUUID(),
      userId,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      userAgent: userAgent?.slice(0, 300) ?? null,
    })
    .onConflictDoUpdate({
      target: schema.pushSubscriptions.endpoint,
      set: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    });
}

/** Remove a subscription by endpoint (this browser turned push off). */
export async function deletePushSubscription(userId: string, endpoint: string): Promise<void> {
  await db
    .delete(schema.pushSubscriptions)
    .where(
      and(
        eq(schema.pushSubscriptions.userId, userId),
        eq(schema.pushSubscriptions.endpoint, endpoint),
      ),
    );
}

/** True if this user's browser (by endpoint) currently has a subscription on file. */
export async function hasPushSubscription(userId: string, endpoint: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.pushSubscriptions.id })
    .from(schema.pushSubscriptions)
    .where(
      and(
        eq(schema.pushSubscriptions.userId, userId),
        eq(schema.pushSubscriptions.endpoint, endpoint),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

/**
 * Send a push to every subscription a user has. Expired endpoints (404/410) are pruned.
 * Never throws — a failed push must not break the render pipeline.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<number> {
  if (!ensure()) return 0;
  const subs = await db
    .select()
    .from(schema.pushSubscriptions)
    .where(eq(schema.pushSubscriptions.userId, userId));
  if (subs.length === 0) return 0;

  const data = JSON.stringify(payload);
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          data,
        );
        sent++;
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) {
          // Subscription is gone — prune it.
          await db
            .delete(schema.pushSubscriptions)
            .where(eq(schema.pushSubscriptions.id, s.id))
            .catch(() => {});
        } else {
          console.error(`[push] send failed (${code ?? "?"}) for ${s.id}`);
        }
      }
    }),
  );
  return sent;
}

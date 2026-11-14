import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";

// Meta's server-to-server callbacks for Threads (app "Uninstall / Deauthorize" and "Data Deletion" URLs).
//
// SP's versions called `deleteConnection("threads")` with no session, which throws inside SP's owner scoping and was
// swallowed — so they acknowledged Meta but deleted nothing. Here the `signed_request` Meta posts is verified
// (HMAC-SHA256 of the payload with the app secret, Meta's documented signed_request format) and the Threads
// connections for that Threads user id are removed from every workspace. If the signature does not verify, nothing
// is deleted.

function b64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/** Verify a Meta signed_request and return its payload, or null. */
export function parseSignedRequest(signed: string, secret: string): { user_id?: string; algorithm?: string } | null {
  const [sigPart, payloadPart] = signed.split(".", 2);
  if (!sigPart || !payloadPart || !secret) return null;
  const expected = createHmac("sha256", secret).update(payloadPart).digest();
  const got = b64url(sigPart);
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  try {
    const payload = JSON.parse(b64url(payloadPart).toString("utf8")) as { user_id?: string | number; algorithm?: string };
    if (payload.algorithm && payload.algorithm.toUpperCase() !== "HMAC-SHA256") return null;
    return { ...payload, user_id: payload.user_id != null ? String(payload.user_id) : undefined };
  } catch {
    return null;
  }
}

/** Read the form-encoded `signed_request`, verify it, and delete that Threads user's connections. */
export async function handleThreadsRemoval(req: Request): Promise<{ ok: boolean; userId?: string; deleted: number }> {
  const form = await req.formData().catch(() => null);
  const signed = typeof form?.get("signed_request") === "string" ? (form!.get("signed_request") as string) : "";
  const payload = parseSignedRequest(signed, process.env.THREADS_CLIENT_SECRET || "");
  if (!payload?.user_id) return { ok: false, deleted: 0 };
  const rows = await db
    .delete(schema.socialConnections)
    .where(and(eq(schema.socialConnections.provider, "threads"), eq(schema.socialConnections.externalId, payload.user_id)))
    .returning({ id: schema.socialConnections.id });
  console.log(`[social] threads removal for user ${payload.user_id}: ${rows.length} connection(s) deleted`);
  return { ok: true, userId: payload.user_id, deleted: rows.length };
}

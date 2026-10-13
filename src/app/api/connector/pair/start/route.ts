import { randomUUID } from "crypto";
import { lt } from "drizzle-orm";
import { db, schema } from "@/db";
import { PAIRING_TTL_MS, clip, newSecret, newUserCode, sha256 } from "@/lib/connector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Step 1 of pairing (no sign-in: the program has no session). Returns a secret device code the program keeps and a
// short user code the signed-in user approves at /account/ai/connect. 10 per IP per 10 minutes.
const hits = new Map<string, number[]>();

export async function POST(req: Request) {
  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 10 * 60_000);
  if (recent.length >= 10) return Response.json({ error: "Too many pairing attempts — wait a few minutes." }, { status: 429 });
  hits.set(ip, [...recent, now]);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const deviceCode = newSecret("cwd_");
  const userCode = newUserCode();
  await db.delete(schema.connectorPairings).where(lt(schema.connectorPairings.expiresAt, new Date()));
  await db.insert(schema.connectorPairings).values({
    id: randomUUID(),
    deviceCodeHash: sha256(deviceCode),
    userCode,
    name: clip(body.name, 60) || "My computer",
    platform: clip(body.platform, 40) || null,
    version: clip(body.version, 20) || null,
    origin: [req.headers.get("cf-ipcountry"), ip].filter((x) => x && x !== "XX").join(" · ").slice(0, 80) || null,
    expiresAt: new Date(now + PAIRING_TTL_MS),
  });
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.clipwaltz.com";
  return Response.json({
    deviceCode,
    userCode,
    // No code in the link: the user types what their own terminal shows (device-flow phishing guard, RFC 8628 §5.4).
    verifyUrl: `${base}/account/ai/connect`,
    interval: 3,
    expiresIn: PAIRING_TTL_MS / 1000,
  });
}

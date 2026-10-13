import { randomUUID } from "crypto";
import { and, eq, isNull, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { newSecret, sha256 } from "@/lib/connector";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Step 2: the program polls with its device code. Pending → 428; approved → the bearer token, exactly once
// (the pairing row is consumed); expired / unknown → 410.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { deviceCode?: unknown };
  const code = typeof body.deviceCode === "string" ? body.deviceCode : "";
  if (!/^cwd_[A-Za-z0-9_-]{20,100}$/.test(code)) return Response.json({ error: "bad device code" }, { status: 400 });
  const [p] = await db.select().from(schema.connectorPairings).where(eq(schema.connectorPairings.deviceCodeHash, sha256(code)));
  if (!p || p.expiresAt.getTime() < Date.now()) return Response.json({ error: "This code expired — run pair again." }, { status: 410 });
  if (!p.approvedBy) return Response.json({ status: "pending" }, { status: 428 });

  // Consume atomically: only the first poll after approval gets the token.
  const [taken] = await db
    .delete(schema.connectorPairings)
    .where(and(eq(schema.connectorPairings.id, p.id), isNotNull(schema.connectorPairings.approvedBy), isNull(schema.connectorPairings.connectorId)))
    .returning();
  if (!taken) return Response.json({ error: "This code was already used — run pair again." }, { status: 410 });
  const token = newSecret("cwc_");
  const id = randomUUID();
  await db.insert(schema.connectors).values({
    id,
    userId: taken.approvedBy!,
    name: taken.name,
    platform: taken.platform,
    version: taken.version,
    tokenHash: sha256(token),
    lastSeenAt: new Date(),
  });
  return Response.json({ token, connectorId: id, name: taken.name });
}

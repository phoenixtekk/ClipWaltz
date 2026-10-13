// ClipWaltz Connector — server side (pairing + job relay). The program on the user's computer
// (public/connector/clipwaltz-connector.mjs) only ever makes outbound HTTPS calls to these routes:
//   POST /api/connector/pair/start  → device code (secret, kept by the program) + user code (typed/approved by the user)
//   POST /api/connector/pair/poll   → the bearer token once the signed-in user approved the code on /account/ai/connect
//   POST /api/connector/hello       → reports version + local Ollama models (also a heartbeat)
//   GET  /api/connector/jobs/next   → long-poll: claims the next queued job for this computer
//   POST /api/connector/jobs/:id/result → the answer (or error)
// Tokens and device codes are stored as sha256 hashes only.
import { createHash, randomBytes, randomInt } from "crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";

export const PAIRING_TTL_MS = 10 * 60_000;
/** A computer counts as online if it called in within this window (it long-polls every ≤ 25 s). */
export const ONLINE_MS = 90_000;

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const newSecret = (prefix: string) => `${prefix}${randomBytes(32).toString("base64url")}`;

// No 0/O/1/I/L — easy to read aloud and type.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function newUserCode() {
  const c = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `${c.slice(0, 4)}-${c.slice(4)}`;
}
export const normalizeUserCode = (s: string) => {
  const c = s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : null;
};

/** Short printable text from the program (names, versions, platform). */
export const clip = (v: unknown, max: number) =>
  typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "";

/** The connector behind a request's `Authorization: Bearer <token>`, or null (unknown / revoked). */
export async function connectorFromRequest(req: Request) {
  const m = /^Bearer\s+(cwc_[A-Za-z0-9_-]{20,100})$/.exec(req.headers.get("authorization") ?? "");
  if (!m) return null;
  const [c] = await db
    .select()
    .from(schema.connectors)
    .where(and(eq(schema.connectors.tokenHash, sha256(m[1])), isNull(schema.connectors.revokedAt)));
  return c ?? null;
}

export const unauthorized = () => Response.json({ error: "This computer isn't connected — run `pair` again." }, { status: 401 });

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

// OAuth tokens at rest: AES-256-GCM with a key from TOKEN_ENC_KEY (any string; hashed to 32 bytes).
// Stored as "enc1:<iv b64>:<tag b64>:<ciphertext b64>". Values without the prefix are legacy plaintext
// rows (written before migration 0049) and are returned as-is, so old connections keep working and are
// re-encrypted the next time their tokens refresh.
const PREFIX = "enc1:";

function key(): Buffer | null {
  const k = process.env.TOKEN_ENC_KEY;
  return k ? createHash("sha256").update(k).digest() : null;
}

export function encryptToken(value: string | null | undefined): string | null {
  if (value == null || value === "") return null;
  const k = key();
  if (!k) {
    if (process.env.NODE_ENV === "production") throw new Error("TOKEN_ENC_KEY is not set");
    return value; // dev without a key: plaintext, like before
  }
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", k, iv);
  const enc = Buffer.concat([c.update(value, "utf8"), c.final()]);
  return `${PREFIX}${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${enc.toString("base64")}`;
}

export function decryptToken(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (!stored.startsWith(PREFIX)) return stored; // legacy plaintext
  const k = key();
  if (!k) throw new Error("TOKEN_ENC_KEY is not set — can't read a stored token");
  const [iv, tag, data] = stored.slice(PREFIX.length).split(":");
  const d = createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
}

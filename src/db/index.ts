import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Postgres client. postgres.js connects lazily (on first query), so importing this
// module during `next build` without a live DB is safe.
const connectionString =
  process.env.DATABASE_URL ?? "postgres://localhost:5432/clipwaltz";

// Bounded pool: the Postgres on linuxg1 is shared by many apps (max_connections 100).
// postgres.js defaults to 10 per client; an unbounded dev session exhausted the server
// on 2026-10-06. Cache the client on globalThis so `next dev` hot reloads reuse one
// pool instead of leaking a fresh pool on every reload.
const globalForDb = globalThis as unknown as { pgClient?: ReturnType<typeof postgres> };
const client =
  globalForDb.pgClient ??
  postgres(connectionString, {
    prepare: false,
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    idle_timeout: 30, // seconds — release idle connections back to the server
  });
if (process.env.NODE_ENV !== "production") globalForDb.pgClient = client;

// casing: "snake_case" → camelCase Drizzle fields map to snake_case DB columns.
export const db = drizzle(client, { schema, casing: "snake_case" });

export { schema };

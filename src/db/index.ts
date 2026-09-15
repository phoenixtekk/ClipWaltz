import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Postgres client. postgres.js connects lazily (on first query), so importing this
// module during `next build` without a live DB is safe.
const connectionString =
  process.env.DATABASE_URL ?? "postgres://localhost:5432/clipwaltz";

const client = postgres(connectionString, { prepare: false });

// casing: "snake_case" → camelCase Drizzle fields map to snake_case DB columns.
export const db = drizzle(client, { schema, casing: "snake_case" });

export { schema };

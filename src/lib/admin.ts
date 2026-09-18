import { getSession } from "./auth";

// Admins are an env allowlist (comma-separated emails). No admin UI to promote — set
// ADMIN_EMAILS in the environment. Keeps admin access out of the DB / user table.
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export function isAdminEmail(email?: string | null): boolean {
  return !!email && ADMIN_EMAILS.includes(email.toLowerCase());
}

/** The current session if it belongs to an admin, else null. */
export async function getAdminSession() {
  const session = await getSession();
  if (!session || !isAdminEmail(session.user.email)) return null;
  return session;
}

/** Throw unless the caller is a signed-in admin. */
export async function requireAdmin() {
  const s = await getAdminSession();
  if (!s) throw new Error("FORBIDDEN");
  return s;
}

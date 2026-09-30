// Server Action errors don't reach the browser in production: React replaces every thrown error with a generic
// "error #441 — message omitted in production builds" (verified 2026-09-29 against a local `next build`). Actions whose
// errors the user must read (e.g. "not enough AI credits") RETURN them instead, as the Next docs recommend for
// expected errors; the client unwraps and throws locally, so existing try/catch + toast code keeps working.
export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

// Messages that are clearly internal (DB / network) are replaced — only hand-written user messages are shown.
const INTERNAL = /duplicate key|violates|relation "|syntax error|ECONN|ETIMEDOUT|socket|fetch failed|Cannot read prop|undefined is not/i;

/** Run a server-side step and turn a thrown Error into a readable result (server-only callers). */
export async function toResult<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (!msg || INTERNAL.test(msg)) {
      console.error("[action] internal error:", e);
      return { ok: false, error: "Something went wrong — please try again." };
    }
    return { ok: false, error: msg.slice(0, 400) };
  }
}

/** Client side: the data, or throw the server's message as a normal Error. */
export function unwrap<T>(r: ActionResult<T>): T {
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

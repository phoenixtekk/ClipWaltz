// Strict shape checks for webhook URLs a user pastes. They decide where the SERVER sends a request, so they parse the
// URL rather than pattern-match the string: a regex like /office\.com/ also accepts `https://attackeroffice.com/` and
// `https://10.0.0.5:8443?office.com`. Pure functions (no I/O) so the connect handler, the adapter and the self-test
// share one definition.

function parse(raw: string): URL | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" || u.username || u.password) return null;
    if (u.port && u.port !== "443") return null;
    return u;
  } catch {
    return null;
  }
}

/** Teams: a Workflows URL (`*.logic.azure.com`) or a legacy connector URL (`*.webhook.office.com`). */
export function isTeamsWebhookUrl(raw: string): boolean {
  const u = parse(raw);
  if (!u) return false;
  const h = u.hostname.toLowerCase();
  return h === "webhook.office.com" || h.endsWith(".webhook.office.com") || h.endsWith(".logic.azure.com");
}

/** TxtYa: https://txtya.com/api/hooks/<id> or the www. form. */
export function isTxtyaWebhookUrl(raw: string): boolean {
  const u = parse(raw);
  if (!u) return false;
  const h = u.hostname.toLowerCase();
  return (h === "txtya.com" || h === "www.txtya.com") && /^\/api\/hooks\/[^/]+/.test(u.pathname);
}

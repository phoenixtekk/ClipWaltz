import { listConnections, type Connection } from "@/lib/social/connections";
import { missingScopes, pinterestAccessToken, pinterestBoards } from "@/lib/social/oauth/pinterest";
import { safeFetch } from "@/lib/social/safe-fetch";

// ─── Can this connection actually publish? ────────────────────────────────────
// Connecting a destination proves less than it looks. Telegram's `getChat`
// succeeds for any public channel whether or not the bot was ever added, so a
// connection can look healthy right up until the first post fails with
// "bot is not a member of the channel chat" — which is exactly what happened,
// twice, after an AI image had already been rendered.
//
// This re-checks a connection the way publishing will actually use it.

export interface Health {
  id: string;
  provider: string;
  label: string;
  ok: boolean;
  /** Why it cannot publish, in the network's own terms. */
  detail?: string;
  /** What to do about it. */
  fix?: string;
  checked: boolean; // false = this provider has no cheap check
  /** Parked by the operator — nothing publishes here. */
  paused: boolean;
}

interface Cat {
  id: number;
  slug: string;
  subcategory_list?: Cat[];
}

/** Discourse nests subcategories; they are just as postable, so flatten them. */
function flattenCats(list: Cat[]): Cat[] {
  return list.flatMap((c) => [c, ...flattenCats(c.subcategory_list ?? [])]);
}

async function checkTelegram(c: Connection): Promise<Health> {
  const base = `https://api.telegram.org/bot${c.accessToken}`;
  const label = c.label || c.displayName || "Telegram";
  const bad = (detail: string, fix?: string): Health => ({ id: c.id, provider: "telegram", label, ok: false, detail, fix, checked: true, paused: c.paused });

  const me = await fetch(`${base}/getMe`).then((r) => r.json()).catch(() => null);
  if (!me?.ok) return bad("The bot token was rejected.", "Re-connect this channel with a valid token from @BotFather.");

  const chatId = c.externalId ?? "";
  if (!chatId) return bad("No chat id stored.", "Reconnect and enter the channel's @username or numeric id.");

  const chat = await fetch(`${base}/getChat?chat_id=${encodeURIComponent(chatId)}`).then((r) => r.json()).catch(() => null);
  if (!chat?.ok) return bad("The bot can't see that chat.", "Add the bot to the channel, then re-check.");

  const member = await fetch(`${base}/getChatMember?chat_id=${encodeURIComponent(chatId)}&user_id=${me.result.id}`)
    .then((r) => r.json())
    .catch(() => null);
  const status = member?.ok ? (member.result?.status as string | undefined) : undefined;

  if (!member?.ok || status === "left" || status === "kicked") {
    // Almost always one of two things, and they need opposite fixes: either the
    // bot really was never added, or the stored username points at a *different*
    // channel that happens to exist. Name what `chatId` actually resolved to —
    // a title you don't recognise, or a subscriber count of 0, is the tell.
    const title = chat.result?.title ?? chatId;
    const count = await fetch(`${base}/getChatMemberCount?chat_id=${encodeURIComponent(chatId)}`)
      .then((r) => r.json())
      .then((d) => (d?.ok ? (d.result as number) : undefined))
      .catch(() => undefined);
    const audience = count === undefined ? "" : ` (${count} subscriber${count === 1 ? "" : "s"})`;
    return bad(
      `@${me.result.username} is not in “${title}”${audience} — the channel this destination points at (${chatId}) — so posts are rejected.`,
      `First check “${title}”${audience} is really your channel: open yours in Telegram and compare the t.me link, which is often longer than the name (e.g. t.me/MyChannel_Community, not t.me/MyChannel). If it differs, reconnect with that exact @username. If it matches, add the bot: channel → Administrators → Add Administrator → @${me.result.username} → enable Post Messages.`,
    );
  }
  if (chat.result?.type === "channel" && status === "administrator" && member.result?.can_post_messages === false) {
    return bad("The bot is an admin but lacks the Post Messages permission.", "Enable Post Messages for the bot in the channel's admin settings.");
  }
  return { id: c.id, provider: "telegram", label, ok: true, checked: true, paused: c.paused };
}

async function checkDiscord(c: Connection): Promise<Health> {
  const label = c.label || c.displayName || "Discord";
  const res = await fetch(c.accessToken).then((r) => r.ok).catch(() => false);
  return res
    ? { id: c.id, provider: "discord", label, ok: true, checked: true, paused: c.paused }
    : { id: c.id, provider: "discord", label, ok: false, checked: true, paused: c.paused, detail: "That webhook no longer works.", fix: "Create a new webhook on the channel and reconnect." };
}

async function checkSlack(c: Connection): Promise<Health> {
  const label = c.label || c.displayName || "Slack";
  const d = await fetch("https://slack.com/api/auth.test", { headers: { Authorization: `Bearer ${c.accessToken}` } })
    .then((r) => r.json())
    .catch(() => null);
  return d?.ok
    ? { id: c.id, provider: "slack", label, ok: true, checked: true, paused: c.paused }
    : { id: c.id, provider: "slack", label, ok: false, checked: true, paused: c.paused, detail: d?.error ?? "The token was rejected.", fix: "Reinstall the app and reconnect with a fresh bot token." };
}

async function checkDiscourse(c: Connection): Promise<Health> {
  const label = c.label || c.displayName || "Discourse";
  const bad = (detail: string, fix?: string): Health => ({ id: c.id, provider: "discourse", label, ok: false, detail, fix, checked: true, paused: c.paused });

  let cred: { instance?: string; key?: string; username?: string };
  try {
    cred = JSON.parse(c.accessToken);
  } catch {
    return bad("The stored credentials are malformed.", "Reconnect this forum on the Networks page.");
  }
  if (!cred.instance || !cred.key || !cred.username) {
    return bad("The stored credentials are incomplete.", "Reconnect this forum on the Networks page.");
  }

  // The same call the connect route uses: it proves the forum is reachable, the
  // key/username pair is still accepted, and the category still exists — without
  // writing anything. A category deleted or renamed after connecting is the
  // failure that would otherwise only surface on a post.
  const res = await safeFetch(`${cred.instance}/categories.json`, {
    headers: { "Api-Key": cred.key, "Api-Username": cred.username, Accept: "application/json" },
  }).catch(() => null);

  if (!res) return bad(`Could not reach ${cred.instance}.`, "Check the forum is up and reachable from this server.");
  if (res.status === 403) {
    return bad(
      "The forum rejected the API key or username.",
      `Regenerate the key in Admin → API and confirm the user “${cred.username}” still exists.`,
    );
  }
  if (!res.ok) return bad(`The forum returned HTTP ${res.status}.`, "Check the forum's health, then re-check.");

  const d = (await res.json().catch(() => null)) as { category_list?: { categories?: Cat[] } } | null;
  const flat = flattenCats(d?.category_list?.categories ?? []);
  const wanted = c.externalId ?? "";
  if (!wanted) return bad("No category stored.", "Reconnect and choose a category.");
  const cat = flat.find((x) => String(x.id) === wanted);
  if (!cat) {
    return bad(
      `Category ${wanted} is not on that forum any more (or the API user can no longer see it).`,
      "Reconnect and choose a category that still exists, or restore the API user's access to it.",
    );
  }

  return { id: c.id, provider: "discourse", label, ok: true, checked: true, paused: c.paused };
}

/**
 * Check every connection that has a cheap, reliable probe. Providers without one
 * are reported as unchecked rather than guessed at — claiming a Facebook Page is
 * healthy without asking Facebook would be worse than saying nothing.
 */
/**
 * Pinterest: is the connection still able to post?
 *
 * Two distinct ways it can be dead, and both are invisible until a post fails:
 * the sign-in can lapse, and the GRANT can be too narrow. The second is the one
 * that bit — a token with `pins:write` but not `boards:write` looks completely
 * healthy and is refused by the API at the moment of posting.
 */
async function checkPinterest(c: Connection): Promise<Health> {
  const label = c.label || c.displayName || "Pinterest";
  const bad = (detail: string, fix?: string): Health =>
    ({ id: c.id, provider: "pinterest", label, ok: false, detail, fix, checked: true, paused: c.paused });

  const { token, scopes } = await pinterestAccessToken(c.accessToken);
  if (!token) {
    return bad("The Pinterest sign-in has expired and could not be renewed.", "Reconnect Pinterest on the Networks page.");
  }

  const short = missingScopes(scopes);
  if (short.length) {
    return bad(
      `Connected without the permissions needed to post: missing ${short.join(", ")}.`,
      "Reconnect Pinterest on the Networks page to grant them.",
    );
  }

  // No recorded grant means the connection was made before the app started
  // recording one — and every such connection was made with a scope set that is
  // now known to be too narrow (`boards:write` and `pins:read` were missing).
  // So this is reported rather than waved through: the alternative is a
  // destination that looks fine and fails on a real post.
  if (!scopes) {
    return bad(
      "This connection predates the permission check, and the scopes it was granted are known to be too narrow to post.",
      "Reconnect Pinterest on the Networks page — one click, and the permissions are then recorded and verified.",
    );
  }

  if (!c.externalId) {
    return bad("No board is selected, so there is nowhere to pin to.", "Choose a board on the Networks page.");
  }

  // Cheap, writes nothing, and catches a board deleted after connecting —
  // which would otherwise surface only as a failed post.
  const boards = await pinterestBoards(token);
  if (boards.length === 0) {
    return bad("Pinterest returned no boards for this account.", "Create a board on Pinterest, then re-check.");
  }
  if (!boards.some((b) => b.id === c.externalId)) {
    return bad("The selected board no longer exists on this account.", "Choose a different board on the Networks page.");
  }

  return { id: c.id, provider: "pinterest", label, ok: true, checked: true, paused: c.paused };
}

export async function checkAllConnections(workspaceId: string): Promise<Health[]> {
  const conns = await listConnections(workspaceId);
  const out: Health[] = [];
  for (const c of conns) {
    try {
      if (c.provider === "telegram") out.push(await checkTelegram(c));
      else if (c.provider === "discord") out.push(await checkDiscord(c));
      else if (c.provider === "slack") out.push(await checkSlack(c));
      else if (c.provider === "discourse") out.push(await checkDiscourse(c));
      else if (c.provider === "pinterest") out.push(await checkPinterest(c));
      // A Facebook Group has no API to probe, so there is nothing that could be
      // broken and nothing to check. Reporting it as "unchecked" alongside the
      // networks that merely lack a cheap probe would be misleading — this one
      // is unchecked permanently and by nature.
      else if (c.provider === "facebook_group")
        out.push({
          id: c.id, provider: c.provider, label: c.label || c.displayName || "Facebook Group",
          ok: true, checked: false, paused: c.paused,
          detail: "No API to check — Meta removed the Groups API. Posts here are published by hand.",
        });
      else out.push({ id: c.id, provider: c.provider, label: c.label || c.displayName || c.provider, ok: true, checked: false, paused: c.paused });
    } catch {
      out.push({ id: c.id, provider: c.provider, label: c.label || c.displayName || c.provider, ok: false, checked: true, paused: c.paused, detail: "The check itself failed." });
    }
  }
  return out;
}

/** Just the destinations that would fail if you published to them right now. */
export async function brokenConnections(workspaceId: string): Promise<Health[]> {
  return (await checkAllConnections(workspaceId)).filter((h) => h.checked && !h.ok);
}

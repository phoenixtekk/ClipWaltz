import { lookup } from "dns/promises";
import { createHash } from "crypto";
import { isIP } from "net";
import type { ConnData } from "@/lib/social/connections";
import { fetchUploadLimits } from "@/lib/social/publishing/providers/discourse";
import { groupUrl, parseGroupRef } from "@/lib/social/publishing/providers/facebook-group";
import { TeamsProvider } from "@/lib/social/publishing/providers/teams";
import { emailConfigured } from "@/lib/social/publishing/providers/email";
import type { ProviderId } from "@/lib/social/publishing/types";
import { isTeamsWebhookUrl, isTxtyaWebhookUrl } from "@/lib/social/publishing/webhook-urls";
import { isBlockedAddress, safeFetch, UnsafeUrlError } from "@/lib/social/safe-fetch";

// Paste-credential connects: the networks with no OAuth flow (or where pasting a token is the supported path).
//
// Ported from SP's per-network `src/app/api/<network>/connect/route.ts` handlers. Each connector VALIDATES the
// credential against the network the same way SP did (a read call, never a post — except Teams, whose webhooks are
// POST-only and are verified with a confirmation card, as in SP), and returns the connection data to store. Access
// control, plan limits and persistence happen once, in the caller (src/app/api/social/connections/[provider]).
//
// ClipWaltz additions:
//  • Self-hosted endpoints a user types in (a Discourse forum) are refused when they resolve to a private, loopback or
//    link-local address. SP was a single-owner tool; on a multi-tenant app an arbitrary server-side fetch is an SSRF
//    hole into the LAN (the AI Box, MinIO, the fleet).
//  • Teams' synthesized external id uses the workspace, not the user.

export type ConnectBody = Record<string, unknown>;
export type ConnectResult =
  | { ok: true; data: ConnData; info?: Record<string, unknown>; warning?: string }
  | { ok: false; error: string; status?: number };

const str = (b: ConnectBody, k: string) => (typeof b[k] === "string" ? (b[k] as string) : "").trim();
const labelOf = (b: ConnectBody) => str(b, "label") || null;
const fail = (error: string, status = 400): ConnectResult => ({ ok: false, error, status });

// ── SSRF guard ───────────────────────────────────────────────────────────────
// The block list and the pinned, redirect-checking fetch live in ./safe-fetch.ts. This early check only gives the
// connect form a clear message before any request is made; the real protection is safeFetch on every call.

/** Throws unless every address the URL's host resolves to is public. */
export async function assertPublicHost(url: string): Promise<void> {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new UnsafeUrlError();
  }
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (addrs.length === 0) throw new UnsafeUrlError("That address does not resolve.");
  if (addrs.some((a) => isBlockedAddress(a.address))) throw new UnsafeUrlError();
}

/** A stable, non-reversible id for a webhook whose URL is itself the secret (shown in the UI instead of the URL). */
export function webhookFingerprint(url: string): string {
  return `hook:${createHash("sha256").update(url).digest("hex").slice(0, 16)}`;
}

// ── Connectors ───────────────────────────────────────────────────────────────

const BSKY_PDS = process.env.BLUESKY_PDS || "https://bsky.social";

// { handle, appPassword } — validated by creating a session; the app password is the credential.
async function bluesky(b: ConnectBody): Promise<ConnectResult> {
  const handle = str(b, "handle").replace(/^@/, "");
  const appPassword = str(b, "appPassword");
  const label = labelOf(b);
  if (!handle || !appPassword) return fail("Handle and app password are required.");
  const res = await fetch(`${BSKY_PDS}/xrpc/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: handle, password: appPassword }),
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!res || !res.ok) return fail("Bluesky rejected those credentials. Use an app password (not your main password).");
  const session = (await res.json()) as { did: string; handle: string };
  return {
    ok: true,
    data: {
      accessToken: appPassword, // app passwords are long-lived; re-used per publish
      externalId: session.did,
      label,
      displayName: label || session.handle,
    },
    info: { handle: session.handle },
  };
}

// { token, chatId } — validates the bot token (getMe), that the bot can see the chat (getChat) AND that it is actually
// a member with posting rights (getChatMember): `getChat` succeeds for any PUBLIC channel whether or not the bot was
// ever added, so on its own it proves nothing about being able to post.
async function telegram(b: ConnectBody): Promise<ConnectResult> {
  const token = str(b, "token");
  const chatId = str(b, "chatId");
  const label = labelOf(b);
  if (!token || !chatId) return fail("Bot token and chat id are required.");
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) return fail("Invalid bot token — check it with @BotFather.");
  const base = `https://api.telegram.org/bot${token}`;

  const me = await fetch(`${base}/getMe`).then((r) => r.json()).catch(() => ({}));
  if (!me?.ok) return fail("Invalid bot token — check it with @BotFather.");

  const chat = await fetch(`${base}/getChat?chat_id=${encodeURIComponent(chatId)}`).then((r) => r.json()).catch(() => ({}));
  if (!chat?.ok) {
    return fail("The bot can't see that chat. Add the bot to the channel/group as an admin, then use its @username or numeric id.");
  }
  const c = chat.result as { id?: number; title?: string; username?: string; type?: string };

  // Guard the most common mistake: entering the bot's own @username. A bot can't post to itself.
  if (c.id && me.result?.id && c.id === me.result.id) {
    return fail(
      "That's the bot itself, not a destination. Create a channel (or group), add this bot to it as an admin, then enter the channel's @username or numeric id.",
    );
  }

  const botId = me.result?.id;
  if (botId) {
    const member = await fetch(`${base}/getChatMember?chat_id=${encodeURIComponent(chatId)}&user_id=${botId}`)
      .then((r) => r.json())
      .catch(() => ({}));
    const status = member?.ok ? (member.result?.status as string | undefined) : undefined;
    if (!member?.ok || status === "left" || status === "kicked") {
      return fail(
        `The bot @${me.result?.username ?? "your bot"} is not in “${c.title ?? chatId}”. ` +
          "Open the channel → Administrators → Add Administrator → pick the bot → enable Post Messages, then connect again.",
      );
    }
    // A channel needs the bot to be an admin *with* posting rights.
    if (c.type === "channel" && status === "administrator" && member.result?.can_post_messages === false) {
      return fail(`The bot is an admin of “${c.title ?? chatId}” but lacks the Post Messages permission. Enable it, then connect again.`);
    }
  }

  return {
    ok: true,
    data: {
      accessToken: token,
      externalId: chatId,
      label,
      displayName: c.title || (c.username ? `@${c.username}` : chatId),
      scope: me.result?.username ? `@${me.result.username}` : null,
    },
    info: { chat: label || c.title || (c.username ? `@${c.username}` : chatId) },
  };
}

// { webhookUrl } — validated by GETting the webhook (returns its id/name/channel).
async function discord(b: ConnectBody): Promise<ConnectResult> {
  const webhookUrl = str(b, "webhookUrl");
  const label = labelOf(b);
  if (!/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/.+/.test(webhookUrl)) {
    return fail("That doesn't look like a Discord webhook URL. Copy it from Channel → Integrations → Webhooks.");
  }
  const info = await fetch(webhookUrl).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!info?.id) return fail("Discord rejected that webhook URL — it may be deleted or malformed.");
  const w = info as { id: string; name?: string; channel_id?: string };
  return {
    ok: true,
    data: { accessToken: webhookUrl, externalId: w.id, label, displayName: label || w.name || "Discord webhook", scope: w.channel_id ?? null },
    info: { name: w.name },
  };
}

// { token, channel } — validates the bot token (auth.test) and that the bot is in the channel.
async function slack(b: ConnectBody): Promise<ConnectResult> {
  const token = str(b, "token");
  const channel = str(b, "channel");
  const label = labelOf(b);
  if (!token || !channel) return fail("Bot token and channel id are required.");
  if (!token.startsWith("xoxb-")) return fail("Use a bot token (starts with xoxb-), not a user or app token.");

  const auth = await fetch("https://slack.com/api/auth.test", { method: "POST", headers: { Authorization: `Bearer ${token}` } })
    .then((r) => r.json())
    .catch(() => ({}));
  if (!auth?.ok) return fail(`Slack rejected the token (${auth?.error || "invalid_auth"}).`);

  // Channel lookup: resolves the name AND tells us if the bot is a member.
  let channelName = channel;
  const info = await fetch(`https://slack.com/api/conversations.info?channel=${encodeURIComponent(channel)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
    .then((r) => r.json())
    .catch(() => ({}));
  if (info?.ok) {
    if (info.channel?.name) channelName = `#${info.channel.name}`;
    // Block up front if the bot isn't in the channel — otherwise every post fails.
    if (info.channel?.is_member === false) {
      return fail(`The bot isn't in ${channelName} yet. In Slack, open the channel and run /invite @${auth.user || "YourApp"}, then reconnect.`);
    }
  } else if (info?.error === "channel_not_found") {
    return fail("Channel not found. Use the channel ID (starts with C…) from the channel's About panel, not its name.");
  }
  return {
    ok: true,
    data: {
      accessToken: token,
      externalId: channel,
      label,
      displayName: label || `${auth.team || "Slack"} ${channelName}`.trim(),
      scope: auth.team_id ?? null,
    },
    info: { team: auth.team, channel: channelName },
  };
}

// { apiKey, tags?, mode? } — validated against GET /api/users/me rather than by writing an article: posting to check
// would publish something, and dev.to answers an invalid key on the write endpoint with 429 "Retry later" rather than
// 401, which would report a wrong key as a rate limit.
async function devto(b: ConnectBody): Promise<ConnectResult> {
  const apiKey = str(b, "apiKey");
  const label = labelOf(b);
  if (!apiKey) return fail("An API key is required.");
  // Up to four tags, lower-case alphanumeric — Forem rejects anything else.
  const tags = str(b, "tags")
    .split(",")
    .map((t) => t.trim().toLowerCase().replace(/[^a-z0-9]/g, ""))
    .filter(Boolean)
    .slice(0, 4);
  const mode = str(b, "mode") === "draft" ? "draft" : "published";
  const res = await fetch("https://dev.to/api/users/me", { headers: { "api-key": apiKey }, signal: AbortSignal.timeout(20_000) }).catch(
    () => null,
  );
  if (!res) return fail("Could not reach dev.to.", 502);
  if (res.status === 401) return fail("dev.to rejected that API key. Copy it again from Settings → Extensions → DEV Community API Keys.");
  if (!res.ok) return fail(`dev.to returned HTTP ${res.status} while checking the key.`);
  const me = (await res.json().catch(() => ({}))) as { username?: string };
  return {
    ok: true,
    data: { accessToken: apiKey, externalId: tags.join(","), scope: mode, label, displayName: label || (me.username ? `@${me.username} on dev.to` : "dev.to") },
    info: { username: me.username ?? null, tags, mode },
  };
}

/** "discuss.example.com", "https://discuss.example.com/", "…/c/x" → clean origin. */
function normalizeOrigin(raw: string): string | null {
  const s = raw.trim().replace(/^@/, "");
  if (!s) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!u.hostname.includes(".")) return null;
    return u.origin;
  } catch {
    return null;
  }
}

interface Cat {
  id: number;
  name: string;
  slug: string;
  subcategory_list?: Cat[];
}
/** Flatten the category tree — subcategories are nested and just as postable. */
function flatten(list: Cat[]): Cat[] {
  return list.flatMap((c) => [c, ...flatten(c.subcategory_list ?? [])]);
}

// { instance, apiKey, apiUsername, category } — validated against GET /categories.json with the key attached, which
// proves three things in one call and creates nothing: the instance is reachable, the key + username are accepted
// (a bad pair answers 403 `invalid_access`), and the chosen category exists. `category` may be the slug or the id.
async function discourse(b: ConnectBody): Promise<ConnectResult> {
  const instance = normalizeOrigin(str(b, "instance"));
  const apiKey = str(b, "apiKey");
  const apiUsername = str(b, "apiUsername").replace(/^@/, "");
  const wanted = str(b, "category").toLowerCase();
  const label = labelOf(b);
  if (!instance) return fail("That doesn’t look like a forum address — enter the domain, e.g. discuss.example.com.");
  if (!apiKey) return fail("An API key is required.");
  if (!apiUsername) return fail("An API username is required.");
  if (!wanted) return fail("A category is required.");
  try {
    await assertPublicHost(instance);
  } catch (e) {
    return fail((e as Error).message);
  }

  const res = await safeFetch(`${instance}/categories.json`, {
    headers: { "Api-Key": apiKey, "Api-Username": apiUsername, Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!res) return fail(`Could not reach ${instance}.`, 502);
  if (res.status === 403) {
    return fail(
      "The forum rejected that API key or username. Check the key in Admin → API, and that the username it is scoped to is spelled exactly as on the forum.",
    );
  }
  if (!res.ok) return fail(`${instance} returned HTTP ${res.status} while checking the key. Confirm it is a Discourse forum.`);

  const payload = (await res.json().catch(() => null)) as { category_list?: { categories?: Cat[] } } | null;
  const cats = flatten(payload?.category_list?.categories ?? []);
  if (cats.length === 0) {
    return fail(`${instance} answered, but returned no categories — confirm it is a Discourse forum and that the API user can see at least one category.`);
  }
  const cat =
    cats.find((c) => String(c.id) === wanted) ??
    cats.find((c) => c.slug.toLowerCase() === wanted) ??
    cats.find((c) => c.name.toLowerCase() === wanted);
  if (!cat) return fail(`No category “${str(b, "category")}” on that forum. Available: ${cats.map((c) => c.slug).join(", ")}.`);

  // What this particular forum accepts as an attachment (an instance setting, not a property of Discourse). Null when
  // the key is not an admin key.
  const uploads = await fetchUploadLimits(instance, apiKey, apiUsername);
  return {
    ok: true,
    data: {
      // Self-hosted: the key is meaningless without the server that issued it, so both travel together.
      accessToken: JSON.stringify({ instance, key: apiKey, username: apiUsername, ...(uploads ? { uploads } : {}) }),
      externalId: String(cat.id),
      label,
      displayName: label || `${cat.name} on ${new URL(instance).hostname}`,
    },
    info: { instance, category: { id: cat.id, name: cat.name, slug: cat.slug } },
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// { recipient } — a recipient list as a destination. Sending uses the server's SES config.
async function email(b: ConnectBody): Promise<ConnectResult> {
  const label = labelOf(b);
  const addrs = str(b, "recipient").split(",").map((s) => s.trim()).filter(Boolean);
  if (addrs.length === 0 || !addrs.every((a) => EMAIL_RE.test(a))) return fail("Enter one or more valid email addresses, comma-separated.");
  // Our SES identity sends these. Cap the list so a destination cannot be turned into a bulk-mail cannon.
  if (addrs.length > 25) return fail("An email destination can have at most 25 recipients.");
  return {
    ok: true,
    data: { accessToken: "ses", externalId: addrs.join(","), label, displayName: label || addrs.join(", ") },
    warning: emailConfigured() ? undefined : "Saved, but the server has no SES email config yet — add SES_SMTP_* + EMAIL_FROM to send.",
  };
}

// { group } — no token, no OAuth, no validation call: Meta removed the Groups API in April 2026, so a "connection" is
// the group's address, recorded so the composer can target it and the Post by hand queue can link to it.
async function facebookGroup(b: ConnectBody): Promise<ConnectResult> {
  const ref = parseGroupRef(str(b, "group"));
  const label = labelOf(b);
  if (!ref) return fail("Paste the group's link (facebook.com/groups/…) or its id.");
  if (/\s/.test(ref)) return fail("That doesn’t look like a group link or id.");
  return {
    ok: true,
    data: { accessToken: "", externalId: ref, label, displayName: label || `Group ${ref}` },
    info: { group: ref, url: groupUrl(ref) },
  };
}

// { token } — Medium integration token, validated via GET /v1/me.
async function medium(b: ConnectBody): Promise<ConnectResult> {
  const token = str(b, "token");
  const label = labelOf(b);
  if (!token) return fail("An integration token is required.");
  const res = await fetch("https://api.medium.com/v1/me", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!res || !res.ok) {
    return fail(
      "Medium rejected that token. Generate one at Medium → Settings → Security and apps → Integration tokens (available only to accounts that already have the option).",
    );
  }
  const d = (await res.json().catch(() => ({}))) as { data?: { id?: string; username?: string; name?: string } };
  const me = d.data;
  if (!me?.id) return fail("Couldn't read your Medium account from that token.");
  return {
    ok: true,
    data: { accessToken: token, externalId: me.id, label, displayName: label || me.name || (me.username ? `@${me.username}` : "Medium") },
    info: { name: me.name ?? me.username },
  };
}

const REDDIT_UA = "web:clipwaltz-social-publishing:1.0";

// { clientId, clientSecret, username, password, subreddit? } — a Reddit "script" app, validated via the password grant.
async function reddit(b: ConnectBody): Promise<ConnectResult> {
  const clientId = str(b, "clientId");
  const clientSecret = str(b, "clientSecret");
  const username = str(b, "username");
  const password = str(b, "password");
  const subreddit = str(b, "subreddit").replace(/^\/?r\//, "");
  const label = labelOf(b);
  if (!clientId || !clientSecret || !username || !password) return fail("Client id, client secret, username and password are all required.");
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const tokRes = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "User-Agent": REDDIT_UA, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "password", username, password }),
  }).catch(() => null);
  const tok = (await tokRes?.json().catch(() => ({}))) as { access_token?: string; error?: string } | undefined;
  if (!tok?.access_token) {
    return fail(`Reddit rejected those credentials (${tok?.error || tokRes?.status || "unreachable"}). Use a 'script' app + your username/password.`);
  }
  return {
    ok: true,
    data: {
      accessToken: JSON.stringify({ clientId, clientSecret, username, password }),
      externalId: subreddit,
      label,
      displayName: label || (subreddit ? `r/${subreddit} as u/${username}` : `u/${username} (reading)`),
    },
    info: { subreddit },
  };
}

// { webhookUrl } — Teams webhooks are POST-only (no GET to inspect), so they are verified by posting a small
// confirmation card: if Teams accepts it, the channel really receives it.
async function teams(b: ConnectBody, ctx: { workspaceId: string }): Promise<ConnectResult> {
  const webhookUrl = str(b, "webhookUrl");
  const label = labelOf(b);
  // Accept Workflows (logic.azure.com) and legacy connector (*.webhook.office.com) URLs.
  if (!isTeamsWebhookUrl(webhookUrl)) {
    return fail(
      'That doesn\'t look like a Teams webhook URL. In Teams: channel → ••• → Workflows → "Post to a channel when a webhook request is received" → copy the URL.',
    );
  }
  const card = new TeamsProvider().messageCard("✅ Connected to ClipWaltz. Posts to this channel will appear here.");
  const res = await safeFetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(card),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!res || !res.ok) return fail(`Teams rejected that webhook (${res ? `HTTP ${res.status}` : "unreachable"}). Re-copy the URL from the Workflow.`);
  return {
    ok: true,
    // The webhook has no external id; synthesize one so it reads as configured.
    data: { accessToken: webhookUrl, externalId: `teams:${ctx.workspaceId}:${Date.now()}`, label, displayName: label || "Teams channel" },
  };
}

// { webhookUrl } — a TxtYa group incoming-webhook URL. Shape-checked only (posting would message the group).
async function txtya(b: ConnectBody): Promise<ConnectResult> {
  const webhookUrl = str(b, "webhookUrl");
  const label = labelOf(b);
  if (!isTxtyaWebhookUrl(webhookUrl)) {
    return fail("That doesn't look like a TxtYa webhook URL (https://www.txtya.com/api/hooks/…).");
  }
  return {
    ok: true,
    data: { accessToken: webhookUrl, externalId: webhookFingerprint(webhookUrl), label, displayName: label || "TxtYa group" },
  };
}

const GRAPH = "https://graph.facebook.com";
const fbV = () => process.env.FACEBOOK_API_VERSION || "v21.0";

// { igUserId, token } — an Instagram Business account + the Page access token it rides on.
async function instagram(b: ConnectBody): Promise<ConnectResult> {
  const igUserId = str(b, "igUserId");
  const token = str(b, "token");
  const label = labelOf(b);
  if (!igUserId || !token) return fail("Instagram user ID and a Page access token are required.");
  const res = await fetch(`${GRAPH}/${fbV()}/${encodeURIComponent(igUserId)}?fields=username&access_token=${encodeURIComponent(token)}`)
    .then((r) => r.json())
    .catch(() => ({}));
  if (!res?.username) {
    return fail(res?.error?.message || "Couldn't read that Instagram account with the token. Check the IG user ID and token.");
  }
  return {
    ok: true,
    data: { accessToken: token, externalId: igUserId, label, displayName: label || `@${res.username}` },
    info: { username: res.username },
  };
}

// { clientId, clientSecret, refreshToken } — X OAuth 2.0 user context, validated by refreshing (which ROTATES the
// token, so the new one is stored).
async function x(b: ConnectBody): Promise<ConnectResult> {
  const cid = str(b, "clientId");
  const csec = str(b, "clientSecret");
  const rt = str(b, "refreshToken");
  const label = labelOf(b);
  if (!cid || !csec || !rt) return fail("Client ID, Client Secret and Refresh Token are required.");
  const basic = Buffer.from(`${cid}:${csec}`).toString("base64");
  const tokRes = await fetch("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: rt, client_id: cid }),
  }).catch(() => null);
  const tok = (await tokRes?.json().catch(() => ({}))) as
    | { access_token?: string; refresh_token?: string; scope?: string; error?: string; error_description?: string }
    | undefined;
  if (!tok?.access_token) {
    return fail(`X rejected the refresh token (${tok?.error_description || tok?.error || tokRes?.status}). Re-authorize with tweet.write + offline.access scopes.`);
  }
  if (!(tok.scope || "").includes("tweet.write")) return fail("This token lacks the tweet.write scope — re-authorize the app with tweet.write + offline.access.");
  let handle: string | null = null;
  let xUserId = "x";
  try {
    const me = (await fetch("https://api.twitter.com/2/users/me", { headers: { Authorization: `Bearer ${tok.access_token}` } }).then((r) =>
      r.json(),
    )) as { data?: { id?: string; username?: string } };
    if (me.data?.id) xUserId = me.data.id;
    if (me.data?.username) handle = `@${me.data.username}`;
  } catch {
    /* best effort */
  }
  return {
    ok: true,
    data: { accessToken: JSON.stringify({ cid, csec, rt: tok.refresh_token || rt }), externalId: xUserId, label, displayName: label || handle || "X account" },
    info: { handle },
  };
}

// { clientId, clientSecret, refreshToken } — validated by refreshing to an access token.
async function youtube(b: ConnectBody): Promise<ConnectResult> {
  const clientId = str(b, "clientId");
  const clientSecret = str(b, "clientSecret");
  const refreshToken = str(b, "refreshToken");
  const label = labelOf(b);
  if (!clientId || !clientSecret || !refreshToken) return fail("Client id, client secret and refresh token are required.");
  const tokRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
  }).catch(() => null);
  const tok = (await tokRes?.json().catch(() => ({}))) as { access_token?: string; error_description?: string; error?: string } | undefined;
  if (!tok?.access_token) return fail(`Google rejected the token (${tok?.error_description || tok?.error || tokRes?.status}).`);
  let channelId = "youtube";
  let title: string | null = null;
  try {
    const ch = (await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    }).then((r) => r.json())) as { items?: { id?: string; snippet?: { title?: string } }[] };
    if (ch.items?.[0]) {
      channelId = ch.items[0].id || channelId;
      title = ch.items[0].snippet?.title ?? null;
    }
  } catch {
    /* best effort */
  }
  return {
    ok: true,
    data: { accessToken: JSON.stringify({ clientId, clientSecret, refreshToken }), externalId: channelId, label, displayName: label || title || "YouTube channel" },
    info: { channel: title },
  };
}

// { clientKey, clientSecret, refreshToken } — validated by refreshing.
async function tiktok(b: ConnectBody): Promise<ConnectResult> {
  const clientKey = str(b, "clientKey");
  const clientSecret = str(b, "clientSecret");
  const refreshToken = str(b, "refreshToken");
  const label = labelOf(b);
  if (!clientKey || !clientSecret || !refreshToken) return fail("Client key, client secret and refresh token are required.");
  const tokRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_key: clientKey, client_secret: clientSecret, grant_type: "refresh_token", refresh_token: refreshToken }),
  }).catch(() => null);
  const tok = (await tokRes?.json().catch(() => ({}))) as
    | { access_token?: string; open_id?: string; error?: string; error_description?: string }
    | undefined;
  if (!tok?.access_token) return fail(`TikTok rejected the token (${tok?.error_description || tok?.error || tokRes?.status}).`);
  return {
    ok: true,
    data: { accessToken: JSON.stringify({ clientKey, clientSecret, refreshToken }), externalId: tok.open_id || "tiktok", label, displayName: label || "TikTok" },
  };
}

// A podcast "connection" is a show this app hosts. Shows arrive with the podcast move (P5, decision D4).
async function podcast(): Promise<ConnectResult> {
  return fail("Podcast shows are not available in ClipWaltz yet — they move over with the podcast feed.", 501);
}

type Connector = (b: ConnectBody, ctx: { workspaceId: string }) => Promise<ConnectResult>;

/** Providers connected by pasting credentials. OAuth providers are in src/lib/social/oauth/registry.ts. */
export const CONNECTORS: Partial<Record<ProviderId, Connector>> = {
  bluesky,
  telegram,
  discord,
  slack,
  devto,
  discourse,
  email,
  facebook_group: facebookGroup,
  medium,
  reddit,
  teams,
  txtya,
  instagram,
  x,
  youtube,
  tiktok,
  podcast,
};

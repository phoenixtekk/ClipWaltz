import { randomUUID } from "crypto";
import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { chatContent, sanitizeForSocial } from "@/lib/social/ai";
import { safeFetch, UnsafeUrlError } from "@/lib/social/safe-fetch";

// G7 competitor intelligence — the SAFE part only (plan §6 G7; spike findings in
// docs/PREDIS_PARITY_AND_PUBLISH_MERGE_PLAN.md §6 G7 "Spike findings"):
//   • rss       any public RSS 2.0 / Atom feed (blogs, newsletters, podcasts, shops). Feeds are published for syndication;
//               the host's robots.txt is still honoured for our user agent before every fetch.
//   • bluesky   the public AppView API (public.api.bsky.app app.bsky.feed.getAuthorFeed) — no login, documented API.
//   • mastodon  the instance's public REST API (/api/v1/accounts/lookup + /statuses) — no login, documented API.
// NOT built, and shown as "not available" in the UI: Facebook / Instagram / X / LinkedIn / TikTok profiles (no lawful
// public API without the account owner's login; scraping is excluded — plan risk R7), YouTube (its channel feed is
// disallowed in robots.txt and returned 404 on 2026-11-14; the Data API needs a key — owner action), Meta Ad Library
// (needs an access token from a verified developer identity; non-political ads only for ads delivered in the EU/UK).
// Only public fields are stored, each with where (source) and when (fetched_at) it was read.

export type CompetitorKind = "rss" | "bluesky" | "mastodon";
export const COMPETITOR_KINDS: CompetitorKind[] = ["rss", "bluesky", "mastodon"];
export const POSTS_PER_SOURCE = 20;
export const MAX_SOURCES = 25;
const UA = "ClipWaltzCompetitorReader/1.0 (+https://www.clipwaltz.com/help)";
const UA_TOKEN = "clipwaltzcompetitorreader";
const BSKY = "https://public.api.bsky.app";

export class CompetitorError extends Error {}

export interface CompetitorPost {
  externalId: string;
  url: string | null;
  title: string | null;
  text: string;
  publishedAt: Date | null;
}

const strip = (html: string, max = 2000) => {
  const s = html
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/p>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};
const date = (v: unknown): Date | null => {
  if (typeof v !== "string" || !v.trim()) return null;
  const d = new Date(v.trim());
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Validate and normalise what the user typed for a source. */
export function normalizeRef(kind: CompetitorKind, raw: string): string {
  const v = String(raw ?? "").trim();
  if (!v) throw new CompetitorError("Enter the feed address or account.");
  if (kind === "rss") {
    let u: URL;
    try {
      u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    } catch {
      throw new CompetitorError("That doesn't look like a feed address.");
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new CompetitorError("Use the feed's web address.");
    return u.toString();
  }
  if (kind === "bluesky") {
    const h = v.replace(/^@/, "").replace(/^https:\/\/bsky\.app\/profile\//, "").replace(/\/.*$/, "").toLowerCase();
    if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(h) && !/^did:plc:[a-z0-9]+$/.test(h)) throw new CompetitorError("Enter a Bluesky handle like name.bsky.social.");
    return h;
  }
  const m = /^@?([A-Za-z0-9_]+)@([a-z0-9.-]+\.[a-z]{2,})$/i.exec(v) ?? /^https:\/\/([a-z0-9.-]+\.[a-z]{2,})\/@([A-Za-z0-9_]+)/i.exec(v);
  if (!m) throw new CompetitorError("Enter a Mastodon account like @name@mastodon.social.");
  const [user, host] = v.startsWith("https://") ? [m[2], m[1]] : [m[1], m[2]];
  return `@${user}@${host.toLowerCase()}`;
}

// ─── robots.txt (for feeds on arbitrary hosts) ──────────────────────────────────────────────────────────────

/** Is `path` allowed for our user agent? Longest-match Allow/Disallow over the groups for our UA, else `*`. */
export function robotsAllows(robots: string, path: string): boolean {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let cur: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else if ((key === "allow" || key === "disallow") && cur) {
      lastWasAgent = false;
      if (val) cur.rules.push({ allow: key === "allow", path: val });
    } else {
      lastWasAgent = false;
    }
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && UA_TOKEN.includes(a)));
  const use = mine.length ? mine : groups.filter((g) => g.agents.includes("*"));
  let best: { allow: boolean; len: number } | null = null;
  for (const g of use) {
    for (const r of g.rules) {
      const pat = r.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$");
      if (new RegExp(`^${pat}`).test(path) && (!best || r.path.length > best.len || (r.path.length === best.len && r.allow))) {
        best = { allow: r.allow, len: r.path.length };
      }
    }
  }
  return best ? best.allow : true;
}

async function fetchText(url: string, max = 5 << 20): Promise<{ status: number; text: string; type: string }> {
  let res: Response;
  try {
    res = await safeFetch(url, { headers: { "user-agent": UA, accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, application/json;q=0.9, */*;q=0.5" }, signal: AbortSignal.timeout(20_000) });
  } catch (e) {
    if (e instanceof UnsafeUrlError) throw new CompetitorError("That address points at a private network and can't be used.");
    throw new CompetitorError("The site didn't answer.");
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > max) throw new CompetitorError("That answer is too large.");
  return { status: res.status, text: new TextDecoder().decode(buf), type: res.headers.get("content-type") ?? "" };
}

async function assertRobots(url: string) {
  const u = new URL(url);
  const r = await fetchText(`${u.origin}/robots.txt`, 512 << 10).catch(() => null);
  if (r && r.status === 200 && !robotsAllows(r.text, `${u.pathname}${u.search}`)) {
    throw new CompetitorError("That site's robots.txt asks automated readers not to fetch this address, so ClipWaltz won't.");
  }
}

// ─── Parsers ────────────────────────────────────────────────────────────────────────────────────────────────

const tag = (xml: string, name: string): string | null => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(xml);
  return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim() : null;
};

/** RSS 2.0 <item> or Atom <entry> → posts (newest first, ≤ POSTS_PER_SOURCE). */
export function parseFeed(xml: string): CompetitorPost[] {
  const out: CompetitorPost[] = [];
  const items = xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi) ?? [];
  for (const it of items) {
    const link = tag(it, "link");
    const guid = tag(it, "guid") ?? link ?? tag(it, "title");
    if (!guid) continue;
    out.push({
      externalId: guid.slice(0, 500),
      url: link && /^https?:\/\//.test(link) ? link : null,
      title: tag(it, "title") ? strip(tag(it, "title")!, 300) : null,
      text: strip(tag(it, "content:encoded") ?? tag(it, "description") ?? ""),
      publishedAt: date(tag(it, "pubDate") ?? tag(it, "dc:date")),
    });
  }
  if (!items.length) {
    for (const en of xml.match(/<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/gi) ?? []) {
      const href = /<link\b[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i.exec(en)?.[1] ?? /<link\b[^>]*href=["']([^"']+)["']/i.exec(en)?.[1] ?? null;
      const id = tag(en, "id") ?? href;
      if (!id) continue;
      out.push({
        externalId: id.slice(0, 500),
        url: href && /^https?:\/\//.test(href) ? href : null,
        title: tag(en, "title") ? strip(tag(en, "title")!, 300) : null,
        text: strip(tag(en, "content") ?? tag(en, "summary") ?? ""),
        publishedAt: date(tag(en, "published") ?? tag(en, "updated")),
      });
    }
  }
  return out.sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0)).slice(0, POSTS_PER_SOURCE);
}

type BskyItem = { post?: { uri?: string; author?: { handle?: string }; record?: { text?: string; createdAt?: string }; indexedAt?: string }; reason?: unknown };

export function parseBluesky(feed: { feed?: BskyItem[] }): CompetitorPost[] {
  const out: CompetitorPost[] = [];
  for (const it of feed.feed ?? []) {
    if (it.reason) continue; // reposts are someone else's post
    const p = it.post;
    if (!p?.uri) continue;
    const rkey = p.uri.split("/").pop();
    out.push({
      externalId: p.uri,
      url: p.author?.handle && rkey ? `https://bsky.app/profile/${p.author.handle}/post/${rkey}` : null,
      title: null,
      text: String(p.record?.text ?? "").slice(0, 2000),
      publishedAt: date(p.record?.createdAt) ?? date(p.indexedAt),
    });
  }
  return out.slice(0, POSTS_PER_SOURCE);
}

type MastoStatus = { id?: string; url?: string; uri?: string; content?: string; created_at?: string; spoiler_text?: string };

export function parseMastodon(list: MastoStatus[]): CompetitorPost[] {
  return list
    .filter((s) => s.id)
    .map((s) => ({
      externalId: String(s.uri ?? s.id),
      url: s.url ?? null,
      title: s.spoiler_text ? strip(s.spoiler_text, 300) : null,
      text: strip(s.content ?? ""),
      publishedAt: date(s.created_at),
    }))
    .slice(0, POSTS_PER_SOURCE);
}

export async function fetchPosts(kind: CompetitorKind, ref: string): Promise<CompetitorPost[]> {
  if (kind === "rss") {
    await assertRobots(ref);
    const r = await fetchText(ref);
    if (r.status !== 200) throw new CompetitorError(`The feed answered ${r.status}.`);
    const posts = parseFeed(r.text);
    if (!posts.length && !/<(rss|feed|rdf)/i.test(r.text)) throw new CompetitorError("That address isn't an RSS or Atom feed.");
    return posts;
  }
  if (kind === "bluesky") {
    // Reposts are skipped, so page (cursor) until 20 of their own posts or 4 pages.
    const out: CompetitorPost[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 4 && out.length < POSTS_PER_SOURCE; page++) {
      const q = `actor=${encodeURIComponent(ref)}&limit=50&filter=posts_no_replies${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const res = await fetch(`${BSKY}/xrpc/app.bsky.feed.getAuthorFeed?${q}`, {
        headers: { "user-agent": UA, accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      }).catch(() => null);
      if (!res) throw new CompetitorError("Bluesky didn't answer.");
      if (res.status === 400) throw new CompetitorError("Bluesky doesn't know that account.");
      if (!res.ok) throw new CompetitorError(`Bluesky answered ${res.status}.`);
      const j = (await res.json()) as { feed?: BskyItem[]; cursor?: string };
      out.push(...parseBluesky(j).filter((p) => !out.some((o) => o.externalId === p.externalId)));
      cursor = j.cursor;
      if (!cursor || !j.feed?.length) break;
    }
    return out.sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0)).slice(0, POSTS_PER_SOURCE);
  }
  const [, user, host] = /^@([^@]+)@(.+)$/.exec(ref) ?? [];
  if (!user || !host) throw new CompetitorError("Enter a Mastodon account like @name@mastodon.social.");
  const look = await fetchText(`https://${host}/api/v1/accounts/lookup?acct=${encodeURIComponent(user)}`, 1 << 20);
  if (look.status === 404) throw new CompetitorError("That Mastodon server doesn't know that account.");
  if (look.status !== 200) throw new CompetitorError(`The Mastodon server answered ${look.status}.`);
  const acct = JSON.parse(look.text) as { id?: string };
  if (!acct.id || !/^\d+$/.test(acct.id)) throw new CompetitorError("That Mastodon server sent an answer ClipWaltz couldn't read.");
  const st = await fetchText(`https://${host}/api/v1/accounts/${acct.id}/statuses?limit=${POSTS_PER_SOURCE}&exclude_replies=true&exclude_reblogs=true`, 4 << 20);
  if (st.status !== 200) throw new CompetitorError(`The Mastodon server answered ${st.status}.`);
  return parseMastodon(JSON.parse(st.text) as MastoStatus[]);
}

// ─── DB ─────────────────────────────────────────────────────────────────────────────────────────────────────

export async function addCompetitor(workspaceId: string, userId: string, input: { name: string; kind: string; ref: string }) {
  if (!COMPETITOR_KINDS.includes(input.kind as CompetitorKind)) throw new CompetitorError("That source type isn't available.");
  const kind = input.kind as CompetitorKind;
  const ref = normalizeRef(kind, input.ref);
  const name = (String(input.name ?? "").trim() || ref).slice(0, 80);
  const existing = await db.select({ ref: schema.competitorSources.ref }).from(schema.competitorSources).where(eq(schema.competitorSources.workspaceId, workspaceId));
  if (existing.some((e) => e.ref === ref)) throw new CompetitorError("You're already following that.");
  if (existing.length >= MAX_SOURCES) throw new CompetitorError(`Follow up to ${MAX_SOURCES} sources per workspace.`);
  const id = randomUUID();
  await db.insert(schema.competitorSources).values({ id, workspaceId, createdBy: userId, name, kind, ref });
  const r = await refreshCompetitor(workspaceId, id).catch((e: Error) => ({ error: e.message }));
  return { id, refresh: r };
}

export async function refreshCompetitor(workspaceId: string, id: string) {
  const [s] = await db.select().from(schema.competitorSources).where(and(eq(schema.competitorSources.id, id), eq(schema.competitorSources.workspaceId, workspaceId)));
  if (!s) throw new CompetitorError("That source isn't in this workspace.");
  try {
    const posts = await fetchPosts(s.kind as CompetitorKind, s.ref);
    const now = new Date();
    if (posts.length) {
      await db
        .insert(schema.competitorPosts)
        .values(posts.map((p) => ({ id: randomUUID(), sourceId: s.id, workspaceId, externalId: p.externalId, url: p.url, title: p.title, text: p.text, publishedAt: p.publishedAt, fetchedAt: now })))
        .onConflictDoUpdate({
          target: [schema.competitorPosts.sourceId, schema.competitorPosts.externalId],
          set: { url: sql`excluded.url`, title: sql`excluded.title`, text: sql`excluded.text`, fetchedAt: now },
        });
      // Keep the newest 50 per source.
      const keep = await db.select({ id: schema.competitorPosts.id }).from(schema.competitorPosts).where(eq(schema.competitorPosts.sourceId, s.id))
        .orderBy(desc(schema.competitorPosts.publishedAt)).limit(50);
      if (keep.length === 50) await db.delete(schema.competitorPosts).where(and(eq(schema.competitorPosts.sourceId, s.id), notInArray(schema.competitorPosts.id, keep.map((k) => k.id))));
    }
    await db.update(schema.competitorSources).set({ lastFetchedAt: now, lastError: null }).where(eq(schema.competitorSources.id, s.id));
    return { posts: posts.length };
  } catch (e) {
    const msg = e instanceof CompetitorError ? e.message : "Couldn't read that source right now.";
    if (!(e instanceof CompetitorError)) console.error("[competitors]", s.id, e);
    await db.update(schema.competitorSources).set({ lastError: msg.slice(0, 300), lastFetchedAt: new Date() }).where(eq(schema.competitorSources.id, s.id));
    throw new CompetitorError(msg);
  }
}

export async function removeCompetitor(workspaceId: string, id: string): Promise<boolean> {
  const r = await db.delete(schema.competitorSources).where(and(eq(schema.competitorSources.id, id), eq(schema.competitorSources.workspaceId, workspaceId))).returning({ id: schema.competitorSources.id });
  return r.length > 0;
}

export async function listCompetitors(workspaceId: string) {
  const sources = await db.select().from(schema.competitorSources).where(eq(schema.competitorSources.workspaceId, workspaceId)).orderBy(schema.competitorSources.createdAt);
  const posts = sources.length
    ? await db.select().from(schema.competitorPosts).where(inArray(schema.competitorPosts.sourceId, sources.map((s) => s.id))).orderBy(desc(schema.competitorPosts.publishedAt))
    : [];
  return sources.map((s) => {
    const mine = posts.filter((p) => p.sourceId === s.id);
    const dated = mine.filter((p) => p.publishedAt).map((p) => p.publishedAt!.getTime());
    const span = dated.length > 1 ? (Math.max(...dated) - Math.min(...dated)) / 86_400_000 : 0;
    return {
      ...s,
      posts: mine.slice(0, POSTS_PER_SOURCE),
      perWeek: dated.length > 1 && span > 0 ? Math.round(((dated.length - 1) / span) * 7 * 10) / 10 : null,
    };
  });
}

/** AI Box summary of a source's recent public posts: themes, cadence, hooks — guidance, not a benchmark. 0 credits. */
export async function summarizeCompetitor(workspaceId: string, id: string): Promise<string> {
  const [s] = await db.select().from(schema.competitorSources).where(and(eq(schema.competitorSources.id, id), eq(schema.competitorSources.workspaceId, workspaceId)));
  if (!s) throw new CompetitorError("That source isn't in this workspace.");
  const posts = await db.select().from(schema.competitorPosts).where(eq(schema.competitorPosts.sourceId, s.id)).orderBy(desc(schema.competitorPosts.publishedAt)).limit(POSTS_PER_SOURCE);
  if (posts.length < 3) throw new CompetitorError("Load at least 3 posts first (Refresh).");
  const lines = posts.map((p) => `- ${p.publishedAt?.toISOString().slice(0, 10) ?? "?"}: ${(p.title ? `${p.title} — ` : "")}${p.text.slice(0, 400)}`).join("\n");
  const base = (process.env.OLLAMA_URL || "http://192.168.166.182:11434").replace(/\/$/, "");
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.SOCIAL_AI_MODEL || "qwen3.8:27b",
      stream: false,
      think: false,
      messages: [
        {
          role: "system",
          content:
            "You analyse a brand's PUBLIC social posts for a marketer. In plain text (no Markdown), give: 1) the 3–5 main themes, 2) how often and when they post, 3) the hooks and calls to action that recur, 4) three ideas the marketer could try that are different from these. Be specific and short. Only use what is in the posts; do not invent numbers.",
        },
        { role: "user", content: `Source: ${s.name} (${s.kind})\nRecent posts, newest first:\n${lines}` },
      ],
      options: { num_predict: 2500, num_ctx: 8192, temperature: 0.4 },
    }),
    signal: AbortSignal.timeout(180_000),
  }).catch(() => null);
  if (!res?.ok) throw new CompetitorError("The AI writer is not reachable right now — try again in a minute.");
  const out = sanitizeForSocial(chatContent((await res.json()) as { message?: { content?: string; thinking?: string } }, "Competitor summary")).slice(0, 4000);
  await db.update(schema.competitorSources).set({ summary: out, summaryAt: new Date() }).where(eq(schema.competitorSources.id, s.id));
  return out;
}

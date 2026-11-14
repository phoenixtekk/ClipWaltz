import { lookup as dnsLookup } from "dns/promises";
import { BlockList, isIP, type LookupFunction } from "net";
import { Agent, fetch as undiciFetch } from "undici";

// SSRF-safe fetch for every request whose HOST a user chose (a Discourse forum, a Mastodon instance, a Teams or TxtYa
// webhook). ClipWaltz shares a LAN with the AI Box, MinIO and the fleet, so "fetch whatever URL the customer typed"
// is a pivot into private infrastructure. A resolve-then-fetch check alone is not enough: the fetch resolves the name
// AGAIN (DNS rebinding returns a public address to the check and 127.0.0.1 to the connect), and a public server can
// answer with a 302 to http://169.254.169.254/. So this helper:
//
//  1. accepts http(s) only, with no credentials in the URL;
//  2. resolves the host once and refuses it if ANY address is private / loopback / link-local / CGNAT / ULA /
//     multicast / reserved / cloud metadata (IPv4 and IPv6, including IPv4-mapped and NAT64/6to4 forms);
//  3. connects to exactly the addresses it vetted — an undici Agent whose `connect.lookup` answers from the vetted set
//     and refuses any other name — so the socket cannot be re-pointed between check and connect. TLS still verifies the
//     certificate against the real hostname (SNI/servername come from the URL, not from the lookup);
//  4. follows redirects itself (`redirect: "manual"`), re-running 1–3 on every hop, at most MAX_REDIRECTS; credentials
//     headers are dropped when a hop changes origin.

export const MAX_REDIRECTS = 3;

export class UnsafeUrlError extends Error {
  constructor(message = "That address is not a public server.") {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

const blocked = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT (also Alibaba's 100.100.100.200 metadata)
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, incl. 169.254.169.254 metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16],
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
] as const) {
  blocked.addSubnet(net, bits, "ipv4");
}
for (const [net, bits] of [
  ["::", 96], // unspecified, loopback (::1) and deprecated IPv4-compatible
  ["64:ff9b::", 96], // NAT64 — would reach an embedded IPv4 address
  ["64:ff9b:1::", 48], // local-use NAT64
  ["100::", 64], // discard-only
  ["2001::", 23], // IETF protocol assignments (Teredo, ORCHID, …)
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4 — embeds an IPv4 address
  ["fc00::", 7], // unique local (incl. AWS fd00:ec2::254 metadata)
  ["fe80::", 10], // link-local
  ["fec0::", 10], // site-local (deprecated)
  ["ff00::", 8], // multicast
] as const) {
  blocked.addSubnet(net, bits, "ipv6");
}

/** True for any address a user-chosen URL must never reach. IPv4-mapped IPv6 is checked against the IPv4 rules. */
export function isBlockedAddress(ip: string): boolean {
  const addr = ip.replace(/^\[|\]$/g, "");
  const fam = isIP(addr);
  if (fam === 4) return blocked.check(addr, "ipv4");
  if (fam === 6) {
    if (blocked.check(addr, "ipv6")) return true;
    // BlockList maps ::ffff:a.b.c.d onto the IPv4 rules; check the dotted tail explicitly as well, belt and braces.
    const tail = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    return tail ? blocked.check(tail[1], "ipv4") : false;
  }
  return true; // not an IP at all — never connect to it
}

type Resolved = { address: string; family: 4 | 6 }[];
type Resolver = (host: string) => Promise<Resolved>;

const systemResolver: Resolver = async (host) => {
  const r = await dnsLookup(host, { all: true, verbatim: true });
  return r.map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));
};

/** Validate one URL: scheme, no userinfo, and every resolved address public. Returns the vetted addresses. */
async function vet(url: URL, resolve: Resolver, isBlocked: (ip: string) => boolean): Promise<Resolved> {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new UnsafeUrlError("Only http(s) addresses are allowed.");
  if (url.username || url.password) throw new UnsafeUrlError("Addresses with embedded credentials are not allowed.");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) throw new UnsafeUrlError();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new UnsafeUrlError();
  }
  const fam = isIP(host);
  let addrs: Resolved;
  if (fam) {
    addrs = [{ address: host, family: fam === 6 ? 6 : 4 }];
  } else {
    try {
      addrs = await resolve(host);
    } catch {
      throw new UnsafeUrlError("That address does not resolve.");
    }
  }
  if (addrs.length === 0) throw new UnsafeUrlError("That address does not resolve.");
  if (addrs.some((a) => isBlocked(a.address))) throw new UnsafeUrlError();
  return addrs;
}

/** An undici Agent that can only connect to the addresses vetted for each hostname. */
function pinnedAgent(vetted: Map<string, Resolved>): Agent {
  const lookup: LookupFunction = (hostname, options, callback) => {
    const addrs = vetted.get(hostname.replace(/^\[|\]$/g, "").toLowerCase());
    if (!addrs || addrs.length === 0) {
      (callback as (err: Error) => void)(new UnsafeUrlError("Connection to an unvetted host refused."));
      return;
    }
    const want = typeof options === "object" && options ? options.family : undefined;
    const pick = want === 4 || want === 6 ? addrs.filter((a) => a.family === want) : addrs;
    const list = pick.length ? pick : addrs;
    if (typeof options === "object" && options?.all) {
      (callback as (err: null, a: Resolved) => void)(null, list);
    } else {
      callback(null, list[0].address, list[0].family);
    }
  };
  // Short keep-alive: each safeFetch call owns its Agent, so idle sockets should not linger.
  return new Agent({ connect: { lookup }, keepAliveTimeout: 1_000, keepAliveMaxTimeout: 1_000 });
}

const CREDENTIAL_HEADERS = ["authorization", "api-key", "api-username", "cookie", "proxy-authorization", "x-shopify-access-token", "wix-site-id"];

export interface SafeFetchDeps {
  resolve?: Resolver;
  isBlocked?: (ip: string) => boolean;
}

/**
 * Build a safeFetch. Production code uses the exported `safeFetch` (system DNS, the full block list); the factory exists
 * so the self-test can exercise the redirect and pinning logic against a loopback server with a narrower policy.
 */
export function createSafeFetch(deps: SafeFetchDeps = {}) {
  const resolve = deps.resolve ?? systemResolver;
  const isBlocked = deps.isBlocked ?? isBlockedAddress;

  return async function safeFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
    let url = new URL(String(input));
    let method = (init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers);
    // Serialize the body once with the platform's own encoder: the npm undici fetch does not recognise the global
    // FormData/Blob classes (it would send "[object FormData]"), and a buffered body can be re-sent on a 307/308.
    let body: string | Uint8Array | undefined;
    if (init.body == null) body = undefined;
    else if (typeof init.body === "string") body = init.body;
    else {
      const enc = new Response(init.body);
      const type = enc.headers.get("content-type");
      if (type && (init.body instanceof FormData || !headers.has("content-type"))) headers.set("content-type", type);
      body = new Uint8Array(await enc.arrayBuffer());
    }
    const vetted = new Map<string, Resolved>();
    const agent = pinnedAgent(vetted);

    for (let hop = 0; ; hop++) {
      const addrs = await vet(url, resolve, isBlocked);
      vetted.set(url.hostname.replace(/^\[|\]$/g, "").toLowerCase(), addrs);

      const res = (await undiciFetch(url, {
        method,
        headers,
        body: body as never,
        signal: init.signal ?? undefined,
        redirect: "manual",
        dispatcher: agent,
      })) as unknown as Response;

      const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      if (!location) return res;

      await res.body?.cancel().catch(() => {});
      if (hop >= MAX_REDIRECTS) throw new UnsafeUrlError("Too many redirects.");

      const next = new URL(location, url);
      if (next.origin !== url.origin) for (const h of CREDENTIAL_HEADERS) headers.delete(h);
      // 303 always, and 301/302 for a POST, become a body-less GET (what browsers and undici do).
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) {
        method = "GET";
        body = undefined;
        headers.delete("content-type");
        headers.delete("content-length");
      }
      url = next;
    }
  };
}

/** fetch() for a URL whose host came from a user. Throws UnsafeUrlError for private targets. */
export const safeFetch = createSafeFetch();

/** A short, single-line, markup-free message from an upstream reply, safe to store on a post target. */
export function sanitizeUpstreamMessage(msg: unknown, max = 160): string {
  if (typeof msg !== "string") return "";
  const s = msg
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

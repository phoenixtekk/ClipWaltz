import { createHmac, timingSafeEqual } from "crypto";
import { safeFetch, UnsafeUrlError } from "@/lib/social/safe-fetch";

// G10 store catalogs — fetching and mapping only (no DB; src/lib/commerce/sync.ts stores the result).
//
// What works WITHOUT any partner-app approval (verified against live shops 2026-11-14):
//   • Shopify: every Online Store answers `GET /products.json?limit=250&page=N` (public storefront JSON) and
//     `GET /meta.json` (shop name + currency). Headless (Hydrogen) shops and password-protected shops do not — those
//     need a Shopify app (owner action, see ADMIN_DOCS).
//   • WooCommerce: the Store API `GET /wp-json/wc/store/v1/products?per_page=100&page=N` is public by design (it is what
//     the block-based cart uses). Prices come in minor units with `currency_minor_unit`.
//   • Wix: no public product endpoint. The store owner creates an API key (Wix dashboard → API Keys, Stores read) and
//     pastes it with their site id; we call `POST https://www.wixapis.com/stores/v3/products/query`, falling back to the
//     Catalog V1 `stores/v1/products/query` for older sites. Not tested against a live Wix site (none available).
//
// Every request to a store host goes through safeFetch (SSRF guard: the host is user-supplied). Wix calls go to the
// fixed host www.wixapis.com.

export type Platform = "shopify" | "woocommerce" | "wix";
export const PLATFORMS: Platform[] = ["shopify", "woocommerce", "wix"];

export interface CatalogProduct {
  externalId: string;
  title: string;
  description: string;
  url: string;
  /** As the store states it ("19.99"); never parsed into money. */
  price: string | null;
  currency: string | null;
  brand: string | null;
  images: string[];
  available: boolean | null;
}

export interface StoreInfo {
  name: string | null;
  currency: string | null;
}

export const MAX_SYNC = 250;
const UA = "Mozilla/5.0 (compatible; ClipWaltzCatalog/1.0; +https://www.clipwaltz.com/help)";
const TIMEOUT = 20_000;

export class CatalogError extends Error {}

/** https origin of a store address the user typed ("shop.example.com", "https://shop.example.com/collections/x"). */
export function storeOrigin(raw: string): string {
  let s = String(raw ?? "").trim();
  if (!s) throw new CatalogError("Enter your store's address.");
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new CatalogError("That doesn't look like a web address.");
  }
  if (u.protocol !== "https:") throw new CatalogError("Use the store's https:// address.");
  if (u.username || u.password) throw new CatalogError("Leave the user name and password out of the address.");
  return u.origin;
}

export function stripHtml(html: unknown, max = 1000): string {
  const s = String(html ?? "")
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#8217;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

const httpsImg = (src: unknown): string | null => {
  const s = typeof src === "string" ? src.trim() : "";
  if (!s) return null;
  const abs = s.startsWith("//") ? `https:${s}` : s;
  return /^https:\/\//i.test(abs) ? abs : null;
};

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(fetcher: Fetcher, url: string, init: RequestInit = {}): Promise<unknown> {
  let res: Response;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetcher(url, { ...init, headers: { "user-agent": UA, accept: "application/json", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(TIMEOUT) });
    } catch (e) {
      if (e instanceof UnsafeUrlError) throw new CatalogError("That address points at a private network and can't be used.");
      throw new CatalogError("The store didn't answer. Check the address and try again.");
    }
    // Shops rate-limit storefront JSON per IP (Shopify answers 429 after a burst). Wait as asked, at most twice.
    if (res.status !== 429 || attempt >= 2) break;
    const wait = Math.min(8, Math.max(1, Number(res.headers.get("retry-after")) || 2 * (attempt + 1)));
    await res.body?.cancel().catch(() => {});
    await sleep(wait * 1000);
  }
  if (res.status === 401 || res.status === 403 || res.status === 429) {
    await res.body?.cancel().catch(() => {});
    throw new CatalogError(`The store refused to share its catalog (${res.status}).`);
  }
  if (res.status === 404) {
    await res.body?.cancel().catch(() => {});
    throw new CatalogError("NOT_FOUND");
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new CatalogError(`The store answered ${res.status}.`);
  }
  if (!/json/i.test(res.headers.get("content-type") ?? "")) {
    await res.body?.cancel().catch(() => {});
    throw new CatalogError("NOT_JSON");
  }
  const text = await res.text();
  if (text.length > 20 << 20) throw new CatalogError("The store's catalog answer was too large.");
  try {
    return JSON.parse(text);
  } catch {
    throw new CatalogError("NOT_JSON");
  }
}

// ─── Shopify (public storefront JSON) ───────────────────────────────────────────────────────────────────────

type ShopifyProduct = {
  id: number | string;
  title?: string;
  handle?: string;
  body_html?: string;
  vendor?: string;
  status?: string;
  variants?: { price?: string; available?: boolean; inventory_quantity?: number }[];
  images?: { src?: string }[];
};

export function mapShopify(p: ShopifyProduct, origin: string, currency: string | null): CatalogProduct {
  const prices = (p.variants ?? []).map((v) => v.price).filter((x): x is string => typeof x === "string" && x !== "");
  const lowest = prices.length ? prices.reduce((a, b) => (Number(b) < Number(a) ? b : a)) : null;
  const avail = (p.variants ?? []).some((v) => v.available === true || (typeof v.inventory_quantity === "number" && v.inventory_quantity > 0));
  const known = (p.variants ?? []).some((v) => typeof v.available === "boolean" || typeof v.inventory_quantity === "number");
  return {
    externalId: String(p.id),
    title: String(p.title ?? "").trim().slice(0, 300),
    description: stripHtml(p.body_html),
    url: p.handle ? `${origin}/products/${encodeURIComponent(p.handle)}` : origin,
    price: lowest,
    currency,
    brand: p.vendor ? String(p.vendor).slice(0, 120) : null,
    images: (p.images ?? []).map((i) => httpsImg(i.src)).filter((x): x is string => Boolean(x)).slice(0, 8),
    available: known ? avail : null,
  };
}

async function shopifyInfo(fetcher: Fetcher, origin: string): Promise<StoreInfo> {
  const m = (await getJson(fetcher, `${origin}/meta.json`).catch(() => null)) as { name?: string; currency?: string } | null;
  return { name: m?.name ?? null, currency: typeof m?.currency === "string" ? m.currency : null };
}

async function shopifyProducts(fetcher: Fetcher, origin: string, currency: string | null) {
  const out: CatalogProduct[] = [];
  for (let page = 1; page <= 10 && out.length < MAX_SYNC; page++) {
    const j = (await getJson(fetcher, `${origin}/products.json?limit=250&page=${page}`)) as { products?: ShopifyProduct[] };
    const list = Array.isArray(j?.products) ? j.products : null;
    if (!list) throw new CatalogError("NOT_SHOPIFY");
    out.push(...list.map((p) => mapShopify(p, origin, currency)).filter((p) => p.title));
    if (list.length < 250) return { products: out.slice(0, MAX_SYNC), complete: true };
    await sleep(500);
  }
  return { products: out.slice(0, MAX_SYNC), complete: false };
}

// ─── WooCommerce (Store API) ────────────────────────────────────────────────────────────────────────────────

type WooProduct = {
  id: number | string;
  name?: string;
  permalink?: string;
  description?: string;
  short_description?: string;
  is_in_stock?: boolean;
  is_purchasable?: boolean;
  prices?: { price?: string; currency_code?: string; currency_minor_unit?: number };
  images?: { src?: string }[];
  brands?: { name?: string }[];
};

/** Store API prices are integers in minor units: "1999" with minor unit 2 → "19.99". */
export function wooPrice(raw: unknown, minor: unknown): string | null {
  const s = typeof raw === "string" ? raw.trim() : typeof raw === "number" ? String(raw) : "";
  if (!/^-?\d+$/.test(s)) return null;
  const m = Number.isInteger(minor) ? Number(minor) : 2;
  if (m <= 0) return s;
  const neg = s.startsWith("-");
  const digits = (neg ? s.slice(1) : s).padStart(m + 1, "0");
  return `${neg ? "-" : ""}${digits.slice(0, -m)}.${digits.slice(-m)}`;
}

export function mapWoo(p: WooProduct, origin: string): CatalogProduct {
  return {
    externalId: String(p.id),
    title: stripHtml(p.name, 300),
    description: stripHtml(p.short_description || p.description),
    url: typeof p.permalink === "string" && /^https?:\/\//.test(p.permalink) ? p.permalink : origin,
    price: wooPrice(p.prices?.price, p.prices?.currency_minor_unit),
    currency: p.prices?.currency_code ?? null,
    brand: p.brands?.[0]?.name ? String(p.brands[0].name).slice(0, 120) : null,
    images: (p.images ?? []).map((i) => httpsImg(i.src)).filter((x): x is string => Boolean(x)).slice(0, 8),
    available: typeof p.is_in_stock === "boolean" ? p.is_in_stock : null,
  };
}

async function wooInfo(fetcher: Fetcher, origin: string): Promise<StoreInfo> {
  const site = (await getJson(fetcher, `${origin}/wp-json`).catch(() => null)) as { name?: string } | null;
  return { name: site?.name ? stripHtml(site.name, 120) : null, currency: null };
}

async function wooProducts(fetcher: Fetcher, origin: string) {
  const out: CatalogProduct[] = [];
  for (let page = 1; page <= 10 && out.length < MAX_SYNC; page++) {
    const j = await getJson(fetcher, `${origin}/wp-json/wc/store/v1/products?per_page=100&page=${page}`);
    if (!Array.isArray(j)) throw new CatalogError("NOT_WOO");
    out.push(...(j as WooProduct[]).map((p) => mapWoo(p, origin)).filter((p) => p.title));
    if (j.length < 100) return { products: out.slice(0, MAX_SYNC), complete: true };
    await sleep(500);
  }
  return { products: out.slice(0, MAX_SYNC), complete: false };
}

// ─── Wix (API key) ──────────────────────────────────────────────────────────────────────────────────────────

const WIX = "https://www.wixapis.com";

type Obj = Record<string, unknown>;
const o = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);

/** Catalog V3 product → CatalogProduct. Field names per the V3 Query Products reference; read defensively. */
export function mapWixV3(p: Obj, origin: string): CatalogProduct {
  const url = o(p.url);
  const range = o(p.actualPriceRange);
  const min = o(range.minValue);
  const media = o(p.media);
  const main = o(media.main);
  const items = Array.isArray(media.itemsInfo) ? (media.itemsInfo as unknown[]) : Array.isArray(o(media.itemsInfo).items) ? (o(media.itemsInfo).items as unknown[]) : [];
  const imgs = [s(o(main.image).url) ?? s(main.url), s(o(p.thumbnail).url), ...items.map((i) => s(o(o(i).image).url) ?? s(o(i).url))]
    .map(httpsImg)
    .filter((x): x is string => Boolean(x));
  const inv = o(p.inventory);
  const status = s(inv.availabilityStatus);
  return {
    externalId: String(p.id ?? ""),
    title: String(p.name ?? "").trim().slice(0, 300),
    description: stripHtml(p.plainDescription ?? p.description),
    url: s(url.url) ?? (s(url.relativePath) ? `${origin}${url.relativePath}` : origin),
    price: s(min.amount),
    currency: s(p.currency),
    brand: s(o(p.brand).name),
    images: [...new Set(imgs)].slice(0, 8),
    available: status ? status !== "OUT_OF_STOCK" : null,
  };
}

/** Catalog V1 product → CatalogProduct. */
export function mapWixV1(p: Obj, origin: string): CatalogProduct {
  const page = o(p.productPageUrl);
  const price = o(p.price);
  const main = o(o(p.media).mainMedia);
  const items = Array.isArray(o(p.media).items) ? (o(p.media).items as unknown[]) : [];
  const imgs = [s(o(main.image).url), ...items.map((i) => s(o(o(i).image).url))].map(httpsImg).filter((x): x is string => Boolean(x));
  const stock = o(p.stock);
  return {
    externalId: String(p.id ?? ""),
    title: String(p.name ?? "").trim().slice(0, 300),
    description: stripHtml(p.description),
    url: s(page.base) && s(page.path) ? `${String(page.base).replace(/\/$/, "")}${page.path}` : origin,
    price: s(price.price),
    currency: s(price.currency),
    brand: s(p.brand),
    images: [...new Set(imgs)].slice(0, 8),
    available: typeof stock.inStock === "boolean" ? stock.inStock : null,
  };
}

export interface WixCreds {
  apiKey: string;
  siteId: string;
}

async function wixQuery(fetcher: Fetcher, creds: WixCreds, path: string, body: unknown): Promise<Obj> {
  let res: Response;
  try {
    res = await fetcher(`${WIX}${path}`, {
      method: "POST",
      headers: { authorization: creds.apiKey, "wix-site-id": creds.siteId, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT),
    });
  } catch {
    throw new CatalogError("Wix didn't answer. Try again in a minute.");
  }
  const text = await res.text();
  if (res.status === 401 || res.status === 403) throw new CatalogError("Wix refused the API key. Check the key, its Wix Stores permission and the site id.");
  if (!res.ok) throw new CatalogError(`WIX_${res.status}:${text.slice(0, 200)}`);
  try {
    return o(JSON.parse(text));
  } catch {
    throw new CatalogError("Wix sent an answer ClipWaltz couldn't read.");
  }
}

async function wixProducts(fetcher: Fetcher, creds: WixCreds, origin: string) {
  const out: CatalogProduct[] = [];
  try {
    let cursor: string | undefined;
    for (let i = 0; i < 5 && out.length < MAX_SYNC; i++) {
      const j = await wixQuery(fetcher, creds, "/stores/v3/products/query", {
        query: { cursorPaging: { limit: 100, ...(cursor ? { cursor } : {}) }, filter: { visible: { $eq: true } } },
        fields: ["URL", "CURRENCY", "THUMBNAIL", "MEDIA_ITEMS_INFO", "PLAIN_DESCRIPTION"],
      });
      const list = Array.isArray(j.products) ? (j.products as Obj[]) : [];
      out.push(...list.map((p) => mapWixV3(p, origin)).filter((p) => p.title && p.externalId));
      cursor = s(o(o(j.pagingMetadata).cursors).next) ?? undefined;
      if (!cursor) return { products: out.slice(0, MAX_SYNC), complete: true };
    }
    return { products: out.slice(0, MAX_SYNC), complete: false };
  } catch (e) {
    // Sites still on Catalog V1 reject the V3 call; anything that is not an auth error gets one V1 try.
    if (!(e instanceof CatalogError) || !e.message.startsWith("WIX_")) throw e;
  }
  for (let offset = 0; offset < MAX_SYNC; offset += 100) {
    const j = await wixQuery(fetcher, creds, "/stores/v1/products/query", { query: { paging: { limit: 100, offset } }, includeVariants: false }).catch((e: Error) => {
      if (e.message.startsWith("WIX_")) throw new CatalogError("Wix answered with an error. Check that the site has Wix Stores and the key has the Stores permission.");
      throw e;
    });
    const list = Array.isArray(j.products) ? (j.products as Obj[]) : [];
    out.push(...list.map((p) => mapWixV1(p, origin)).filter((p) => p.title && p.externalId));
    if (list.length < 100) return { products: out.slice(0, MAX_SYNC), complete: true };
  }
  return { products: out.slice(0, MAX_SYNC), complete: false };
}

// ─── Entry points ───────────────────────────────────────────────────────────────────────────────────────────

const friendly = (platform: Platform, e: unknown): never => {
  const m = e instanceof Error ? e.message : "";
  if (m === "NOT_FOUND" || m === "NOT_JSON" || m === "NOT_SHOPIFY" || m === "NOT_WOO") {
    throw new CatalogError(
      platform === "shopify"
        ? "ClipWaltz couldn't read a Shopify catalog at that address. Use the shop's own domain (not a headless or password-protected store)."
        : "ClipWaltz couldn't read a WooCommerce catalog at that address. The store needs WooCommerce with its Store API (WooCommerce 6.4 or later).",
    );
  }
  throw e;
};

/** Check the store answers and read its name + currency. */
export async function probeStore(platform: Platform, origin: string, creds: WixCreds | null, fetcher: Fetcher = safeFetch): Promise<StoreInfo & { sample: number }> {
  try {
    if (platform === "shopify") {
      const info = await shopifyInfo(fetcher, origin);
      const j = (await getJson(fetcher, `${origin}/products.json?limit=1`)) as { products?: unknown[] };
      if (!Array.isArray(j?.products)) throw new CatalogError("NOT_SHOPIFY");
      return { ...info, sample: j.products.length };
    }
    if (platform === "woocommerce") {
      const info = await wooInfo(fetcher, origin);
      const j = await getJson(fetcher, `${origin}/wp-json/wc/store/v1/products?per_page=1`);
      if (!Array.isArray(j)) throw new CatalogError("NOT_WOO");
      const first = j[0] as WooProduct | undefined;
      return { ...info, currency: first?.prices?.currency_code ?? null, sample: j.length };
    }
    if (!creds?.apiKey || !creds.siteId) throw new CatalogError("Paste the Wix API key and the site id.");
    const j = await wixQuery(fetch, creds, "/stores/v3/products/query", { query: { cursorPaging: { limit: 1 } } }).catch(async (e: Error) => {
      if (!e.message.startsWith("WIX_")) throw e;
      return wixQuery(fetch, creds, "/stores/v1/products/query", { query: { paging: { limit: 1 } } });
    });
    return { name: null, currency: null, sample: Array.isArray(j.products) ? j.products.length : 0 };
  } catch (e) {
    return friendly(platform, e);
  }
}

/** Read up to MAX_SYNC products. `complete` = the whole catalog was read (safe to delete products no longer listed). */
export async function fetchCatalog(
  platform: Platform,
  origin: string,
  opts: { currency: string | null; creds: WixCreds | null },
  fetcher: Fetcher = safeFetch,
): Promise<{ products: CatalogProduct[]; complete: boolean }> {
  try {
    if (platform === "shopify") return await shopifyProducts(fetcher, origin, opts.currency);
    if (platform === "woocommerce") return await wooProducts(fetcher, origin);
    if (!opts.creds) throw new CatalogError("This Wix store has no API key saved. Reconnect it.");
    return await wixProducts(fetch, opts.creds, origin);
  } catch (e) {
    return friendly(platform, e);
  }
}

// ─── Webhooks ───────────────────────────────────────────────────────────────────────────────────────────────

/** Shopify (X-Shopify-Hmac-Sha256) and WooCommerce (X-WC-Webhook-Signature): base64 HMAC-SHA256 of the raw body. */
export function verifyWebhookSignature(rawBody: Uint8Array | string, secret: string, header: string | null): boolean {
  if (!header || !secret) return false;
  const expected = createHmac("sha256", secret).update(typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : Buffer.from(rawBody)).digest();
  let got: Buffer;
  try {
    got = Buffer.from(header.trim(), "base64");
  } catch {
    return false;
  }
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** Map a webhook payload (Shopify Admin product / WooCommerce REST v3 product) to a CatalogProduct. */
export function mapWebhookProduct(platform: Platform, body: Obj, origin: string, currency: string | null): CatalogProduct | null {
  if (platform === "shopify") {
    const p = mapShopify(body as unknown as ShopifyProduct, origin, currency);
    if (body.status && body.status !== "active") return null; // drafts / archived are not shown
    return p.title ? p : null;
  }
  if (platform === "woocommerce") {
    const imgs = (Array.isArray(body.images) ? (body.images as Obj[]) : []).map((i) => httpsImg(i.src)).filter((x): x is string => Boolean(x));
    const status = s(body.status);
    if (status && status !== "publish") return null;
    const p: CatalogProduct = {
      externalId: String(body.id ?? ""),
      title: stripHtml(body.name, 300),
      description: stripHtml(body.short_description || body.description),
      url: s(body.permalink) ?? origin,
      price: s(body.price),
      currency,
      brand: null,
      images: imgs.slice(0, 8),
      available: s(body.stock_status) ? body.stock_status !== "outofstock" : null,
    };
    return p.title && p.externalId ? p : null;
  }
  return null;
}

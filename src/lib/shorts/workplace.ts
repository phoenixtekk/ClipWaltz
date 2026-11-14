// ─── The Workplace catalogue as a source of TRUE technical detail ────────────
//
// Shorts are written FROM a Phoenixtekk Workplace solution rather than from the
// model's memory, and that choice is the whole design.
//
// A 45-second tip about Intune lives or dies on one blade path, one CSP, one
// error code. A model asked to invent those will produce something that sounds
// exactly right and is wrong, and a technical audience spots it instantly —
// that credibility does not come back, and it is the one failure mode where
// posting nothing is better than posting. Every Workplace product carries a few
// thousand characters of prose somebody actually wrote and checked, so the
// model's job is reduced from "know Intune" to "compress this passage", which
// is a thing it is reliable at.
//
// It also means every short has somewhere to send the viewer.
//
// Source: https://workplace.phoenixtekk.com/api/products (public, read-only).
// A product page is `https://workplace.phoenixtekk.com/<url_key>` — NOT
// `/products/<url_key>`, which 404s.

// Same env var as `@/lib/workplace`, deliberately: an operator pointing the
// store somewhere else must not have to discover a second setting.
//
// That module is a keyword SEARCH (`?query=…`, a few matches for a prompt) used
// by the AI composer. This one ENUMERATES the catalogue and keeps the full
// prose, because a short is written from one solution end to end rather than
// matched against many. Different jobs, one store.
const BASE = (process.env.WORKPLACE_STORE_URL || "https://workplace.phoenixtekk.com").replace(/\/$/, "");

export interface WorkplaceSolution {
  id: number;
  sku: string;
  name: string;
  /** Plain prose, HTML stripped — what the script is written from. */
  body: string;
  url: string;
  imageUrl: string | null;
}

interface RawProduct {
  id: number;
  sku: string;
  name: string;
  description?: string;
  url_key: string;
  base_image?: { medium_image_url?: string; large_image_url?: string; original_image_url?: string };
}

/** Markup → prose. The descriptions are editor HTML, not plain text. */
function strip(html: string): string {
  return html
    // Block boundaries have to become whitespace or words weld together
    // ("passwordlessPasswords are the single most-attacked...").
    .replace(/<\/(p|div|h[1-6]|li|tr|section)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&rsquo;/gi, "'")
    .replace(/&mdash;/gi, "—")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function toSolution(p: RawProduct): WorkplaceSolution {
  const img = p.base_image;
  return {
    id: p.id,
    sku: p.sku,
    // The feed encodes an em dash as a mojibake sequence in some rows.
    name: p.name.replace(/�/g, "—").trim(),
    body: strip(p.description ?? ""),
    url: `${BASE}/${p.url_key}`,
    imageUrl: img?.large_image_url ?? img?.medium_image_url ?? img?.original_image_url ?? null,
  };
}

// The catalogue changes rarely and a rule may generate several shorts in a
// sweep, so it is held briefly rather than re-fetched per short.
let cache: { at: number; items: WorkplaceSolution[] } | null = null;
const TTL_MS = 10 * 60 * 1000;

/**
 * Every solution worth writing a short about.
 *
 * Products with little or no description are dropped rather than passed on: a
 * short built from two sentences of marketing has nothing concrete in it, which
 * defeats the point of sourcing from the catalogue at all.
 */
export async function listSolutions(opts: { maxPages?: number; force?: boolean } = {}): Promise<WorkplaceSolution[]> {
  if (!opts.force && cache && Date.now() - cache.at < TTL_MS) return cache.items;

  const out: WorkplaceSolution[] = [];
  const maxPages = opts.maxPages ?? 6;
  for (let page = 1; page <= maxPages; page++) {
    const res = await fetch(`${BASE}/api/products?page=${page}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    }).catch(() => null);
    if (!res?.ok) break;
    const d = (await res.json().catch(() => null)) as { data?: RawProduct[]; meta?: { last_page?: number } } | null;
    const rows = d?.data ?? [];
    if (rows.length === 0) break;
    out.push(...rows.map(toSolution));
    if (d?.meta?.last_page && page >= d.meta.last_page) break;
  }

  const usable = out.filter((s) => s.body.length >= 400);
  // Never cache an empty answer — a transient outage would then be repeated for
  // ten minutes and every short in that window would silently fall back.
  if (usable.length > 0) cache = { at: Date.now(), items: usable };
  return usable;
}

/** One solution by SKU or id, for a rule pinned to a specific product. */
export async function findSolution(ref: string): Promise<WorkplaceSolution | null> {
  const all = await listSolutions();
  const r = ref.trim().toLowerCase();
  return all.find((s) => s.sku.toLowerCase() === r || String(s.id) === r) ?? null;
}

// G11 Ads-manager export (plan §6 G11, phase 1): a set of Waltz Image designs → one ZIP with
//   meta/ads_manager_import.csv + meta/images/*.png   (Meta Ads Manager → Import ads in bulk)
//   google/pmax_asset_group.csv + google/images/*.png (Google Ads Editor → Account → Import → From file)
//   README.txt (import steps, what was checked, what was left out)
// ClipWaltz never talks to an ad account: nothing is created, spent or changed — the user imports the files.
//
// Column sources (checked 2026-11-14):
//   • Google: header names from Google Ads Editor Help "CSV file columns" (support.google.com/google-ads/editor/answer/57747):
//     Campaign, Campaign type, Final URL, Business name, Headline 1–15, Long headline, Description 1–15, Image 1–15,
//     Logo 1–5, Call to action 1–15. That page does NOT list an "Asset group" column (it lists "Ad group"), so the
//     asset-group column is written as "Asset group" and must be mapped in Editor's import preview if it is not
//     recognised. Limits from "Performance Max campaigns specs" (support.google.com/google-ads/answer/17091269):
//     headlines ≤ 30 (3–15, one ≤ 15), long headlines ≤ 90 (1–5), descriptions ≤ 90 (2–5), business name ≤ 25,
//     images 1.91:1 (≥ 600×314) and 1:1 (≥ 300×300) required, 4:5 optional, ≤ 5 MB, JPG/PNG.
//   • Meta: Meta's own bulk-import template could not be read (its help pages refused automated access). The headers
//     below follow the column names Ads Manager uses in its export (Campaign Name, Ad Set Name, Ad Name, Title = headline,
//     Body = primary text, Link Description, Link, Call to Action, Image File Name) — UNVERIFIED against a template
//     downloaded from the owner's account. README tells the user to compare with Ads Manager → Export → blank template.
//     Everything is written PAUSED so an import can never start spending.

export type ExportCreative = {
  /** File name inside images/ (unique, matches the CSV rows). */
  file: string;
  format: string; // 1:1 | 4:5 | 9:16 | 1.91:1 | 2:3
  width: number;
  height: number;
  headline: string;
  body: string;
};

export type ExportInput = {
  campaign: string;
  landingUrl: string;
  primaryText: string;
  businessName: string;
  /** Meta call-to-action type (SHOP_NOW, LEARN_MORE, …). */
  cta: string;
  creatives: ExportCreative[];
};

export const META_CTAS = ["SHOP_NOW", "LEARN_MORE", "SIGN_UP", "ORDER_NOW", "BOOK_NOW", "GET_OFFER", "CONTACT_US", "DOWNLOAD", "SUBSCRIBE"] as const;

export const META_COLUMNS = [
  "Campaign Name", "Campaign Status", "Campaign Objective", "Ad Set Name", "Ad Set Run Status", "Ad Name", "Ad Status",
  "Title", "Body", "Link Description", "Link", "Call to Action", "Image File Name",
] as const;

const G_HEADLINES = 5;
const G_DESCRIPTIONS = 4;
const G_IMAGES = 15;
export const GOOGLE_COLUMNS = [
  "Campaign", "Campaign type", "Asset group", "Final URL", "Business name",
  ...Array.from({ length: G_HEADLINES }, (_, i) => `Headline ${i + 1}`),
  "Long headline",
  ...Array.from({ length: G_DESCRIPTIONS }, (_, i) => `Description ${i + 1}`),
  ...Array.from({ length: G_IMAGES }, (_, i) => `Image ${i + 1}`),
] as const;

/** Formats Google Performance Max accepts as marketing images. */
const GOOGLE_RATIOS = new Set(["1.91:1", "1:1", "4:5"]);
const GOOGLE_MIN: Record<string, [number, number]> = { "1.91:1": [600, 314], "1:1": [300, 300], "4:5": [480, 600] };

export const slug = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 60) || "clipwaltz";

/** The landing URL with utm_* set (existing utm_* replaced, other parameters kept). */
export function withUtm(url: string, source: string, medium: string, campaign: string, content: string): string {
  const u = new URL(url);
  for (const k of [...u.searchParams.keys()]) if (k.startsWith("utm_")) u.searchParams.delete(k);
  u.searchParams.set("utm_source", source);
  u.searchParams.set("utm_medium", medium);
  u.searchParams.set("utm_campaign", slug(campaign));
  u.searchParams.set("utm_content", slug(content));
  return u.toString();
}

/** RFC 4180 CSV: quote every field, double inner quotes, CRLF line ends; formula-looking cells are prefixed with '. */
export function csv(rows: (readonly string[])[]): string {
  const cell = (v: string) => {
    let s = String(v ?? "").replace(/\r?\n/g, " ");
    if (/^[=+\-@\t]/.test(s)) s = `'${s}`; // spreadsheet formula injection guard
    return `"${s.replace(/"/g, '""')}"`;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

const cut = (s: string, max: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const w = t.slice(0, max + 1).replace(/\s+\S*$/, "");
  return (w.length >= max * 0.6 ? w : t.slice(0, max)).slice(0, max);
};

export function validateInput(input: ExportInput): string | null {
  if (!input.campaign.trim()) return "Name the campaign.";
  try {
    const u = new URL(input.landingUrl);
    if (u.protocol !== "https:" && u.protocol !== "http:") return "The landing page must be a web address.";
  } catch {
    return "The landing page must be a full web address (https://…).";
  }
  if (!input.creatives.length) return "Pick at least one design.";
  if (input.creatives.length > 50) return "Export up to 50 images at a time.";
  if (!(META_CTAS as readonly string[]).includes(input.cta)) return "Pick a button.";
  return null;
}

export function buildMetaCsv(input: ExportInput): { csv: string; rows: string[][] } {
  const adSet = `${input.campaign} - ad set`.slice(0, 100);
  const rows = input.creatives.map((c) => [
    input.campaign.slice(0, 100),
    "PAUSED",
    "Outcome Traffic",
    adSet,
    "PAUSED",
    c.file.replace(/\.[a-z]+$/i, "").slice(0, 100),
    "PAUSED",
    cut(c.headline || input.campaign, 255),
    cut(input.primaryText || c.body || c.headline, 2000),
    cut(c.body, 255),
    withUtm(input.landingUrl, "facebook", "paid_social", input.campaign, c.file.replace(/\.[a-z]+$/i, "")),
    input.cta,
    c.file,
  ]);
  return { csv: csv([META_COLUMNS, ...rows]), rows };
}

export function buildGoogleCsv(input: ExportInput): { csv: string; row: string[]; warnings: string[]; images: ExportCreative[] } {
  const warnings: string[] = [];
  const images = input.creatives.filter((c) => {
    if (!GOOGLE_RATIOS.has(c.format)) return false;
    const [w, h] = GOOGLE_MIN[c.format];
    return c.width >= w && c.height >= h;
  });
  const left = input.creatives.length - images.length;
  if (left) warnings.push(`${left} image(s) left out of the Google file: Performance Max takes 1.91:1, 1:1 and 4:5 images only (9:16 and 2:3 are not marketing-image sizes).`);
  if (!images.some((c) => c.format === "1.91:1")) warnings.push("Google needs at least one landscape 1.91:1 image — add a “Link / ad card” design.");
  if (!images.some((c) => c.format === "1:1")) warnings.push("Google needs at least one square 1:1 image — add a “Square post” design.");
  if (images.length > G_IMAGES) warnings.push(`Only the first ${G_IMAGES} images are listed (Google takes up to 20 per ratio; this file lists ${G_IMAGES}).`);

  const heads = [...new Set(input.creatives.map((c) => cut(c.headline, 30)).filter(Boolean))];
  if (!heads.some((h) => h.length <= 15)) {
    const short = cut(input.businessName || input.campaign, 15);
    if (short) heads.unshift(short);
  }
  const headlines = [...new Set(heads)].slice(0, G_HEADLINES);
  if (headlines.length < 3) warnings.push(`Google needs 3–15 headlines (≤ 30 characters); the designs gave ${headlines.length}. Add more in Google Ads Editor.`);
  const longHeadline = cut(input.primaryText || input.creatives[0]?.headline || input.campaign, 90);
  const descs = [...new Set([input.primaryText, ...input.creatives.map((c) => c.body)].map((d) => cut(d ?? "", 90)).filter(Boolean))].slice(0, G_DESCRIPTIONS);
  if (descs.length < 2) warnings.push(`Google needs 2–5 descriptions (≤ 90 characters); there ${descs.length === 1 ? "is 1" : `are ${descs.length}`}. Add more in Google Ads Editor.`);
  const business = cut(input.businessName, 25);
  if (!business) warnings.push("Google needs a business name (≤ 25 characters).");
  warnings.push("Google also needs a square logo (1:1, ≥ 128×128) — add it in Google Ads Editor; this file has none.");

  const pad = (a: string[], n: number) => [...a, ...Array(Math.max(0, n - a.length)).fill("")].slice(0, n);
  const row = [
    input.campaign.slice(0, 100),
    "Performance Max",
    `${input.campaign} - assets`.slice(0, 100),
    withUtm(input.landingUrl, "google", "cpc", input.campaign, "pmax"),
    business,
    ...pad(headlines, G_HEADLINES),
    longHeadline,
    ...pad(descs, G_DESCRIPTIONS),
    ...pad(images.slice(0, G_IMAGES).map((c) => c.file), G_IMAGES),
  ];
  return { csv: csv([GOOGLE_COLUMNS, row]), row, warnings, images: images.slice(0, G_IMAGES) };
}

export function readme(input: ExportInput, googleWarnings: string[]): string {
  return [
    `ClipWaltz ads export — ${input.campaign}`,
    `Made ${new Date().toISOString()}. ClipWaltz did not connect to any ad account; nothing was created or spent.`,
    "",
    "META (Facebook / Instagram) — meta/ads_manager_import.csv + meta/images/",
    "1. Ads Manager → Ads tab → Upload images: add every file in meta/images/ (the names must stay exactly as they are).",
    "2. Ads Manager → the Import/Export menu → Import ads in bulk → choose meta/ads_manager_import.csv.",
    "3. Review the preview. Every campaign, ad set and ad is PAUSED. Set the audience, budget and placements on the ad set,",
    "   check each ad's preview, then turn it on yourself.",
    "Note: the column names follow Ads Manager's export. If the import complains about a column, export a blank template",
    "(Import/Export → Export → Download a template) and copy these values into its matching columns. Objective is",
    "\"Outcome Traffic\" — change it in the file or after import if you want another objective.",
    "",
    "GOOGLE (Performance Max) — google/pmax_asset_group.csv + google/images/",
    "1. Google Ads Editor → Account → Import → From file → choose google/pmax_asset_group.csv.",
    "2. In the preview, check the columns were matched (map “Asset group” by hand if Editor doesn't recognise it).",
    "3. Add the images from google/images/ to the asset group, add a square logo, review, then Post.",
    "Every link carries utm_source / utm_medium / utm_campaign / utm_content.",
    ...(googleWarnings.length ? ["", "Before Google accepts the asset group:", ...googleWarnings.map((w) => `- ${w}`)] : []),
    "",
  ].join("\r\n");
}

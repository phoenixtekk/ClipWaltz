import JSZip from "jszip";
import { getAuthUserId } from "@/lib/auth";
import { fileStem, loadDesign, normalizeData, isDesignKind, renderDesign } from "@/lib/image-ad/designs";
import type { CarouselData, ImageAdData, MemeData } from "@/lib/image-ad/types";
import {
  buildGoogleCsv, buildMetaCsv, readme, slug, validateInput, type ExportCreative, type ExportInput,
} from "@/lib/image-ad/ads-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /api/images/ads-export { designIds[], campaign, landingUrl, primaryText?, businessName?, cta }
// → ZIP with the Meta Ads Manager bulk-import CSV + images and the Google Ads Editor Performance Max CSV + images
// (G11, src/lib/image-ad/ads-export.ts). Viewer+ on every design (each is checked). No ad-account calls.
export async function POST(req: Request) {
  const userId = await getAuthUserId();
  if (!userId) return Response.json({ error: "Sign in" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const ids = Array.isArray(b.designIds) ? [...new Set(b.designIds.map(String))].slice(0, 30) : [];
  const creatives: ExportCreative[] = [];
  const files: { name: string; png: Buffer }[] = [];
  const used = new Set<string>();
  for (const id of ids) {
    const d = await loadDesign(userId, id, "viewer");
    if (!d) return Response.json({ error: "One of those designs is not available to you." }, { status: 404 });
    const kind = isDesignKind(d.row.kind) ? d.row.kind : "image";
    const data = normalizeData(kind, d.row.data);
    const outs = await renderDesign(d.row);
    for (const o of outs) {
      let headline = "";
      let body = "";
      if (kind === "carousel") {
        const s = (data as CarouselData).slides[o.index];
        headline = s?.headline ?? "";
        body = s?.body ?? "";
      } else if (kind === "meme") {
        const m = data as MemeData;
        headline = [m.top, m.bottom].filter(Boolean).join(" ");
        body = m.caption;
      } else {
        const a = data as ImageAdData;
        headline = a.headline;
        body = a.subhead;
      }
      let name = `${slug(fileStem(d.row))}-${d.row.format.replace(/[:.]/g, "x")}${outs.length > 1 ? `-${o.index + 1}` : ""}`;
      while (used.has(name)) name = `${name}-2`;
      used.add(name);
      const file = `${name}.png`;
      creatives.push({ file, format: d.row.format, width: o.width, height: o.height, headline: headline || d.row.title, body });
      files.push({ name: file, png: o.png });
    }
  }
  const input: ExportInput = {
    campaign: String(b.campaign ?? "").trim().slice(0, 100),
    landingUrl: String(b.landingUrl ?? "").trim(),
    primaryText: String(b.primaryText ?? "").trim().slice(0, 2000),
    businessName: String(b.businessName ?? "").trim().slice(0, 60),
    cta: String(b.cta ?? "LEARN_MORE"),
    creatives,
  };
  const bad = validateInput(input);
  if (bad) return Response.json({ error: bad }, { status: 400 });

  const meta = buildMetaCsv(input);
  const google = buildGoogleCsv(input);
  const zip = new JSZip();
  zip.file("README.txt", readme(input, google.warnings));
  zip.file("meta/ads_manager_import.csv", meta.csv);
  zip.file("google/pmax_asset_group.csv", google.csv);
  for (const f of files) {
    zip.file(`meta/images/${f.name}`, f.png);
    if (google.images.some((c) => c.file === f.name)) zip.file(`google/images/${f.name}`, f.png);
  }
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "STORE" });
  const stem = slug(input.campaign);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${stem}-ads-export.zip"`,
      "cache-control": "private, no-store",
      "x-google-warnings": String(google.warnings.length),
    },
  });
}

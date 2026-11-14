import { handleStoreWebhook, isPlatform } from "@/lib/commerce/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/commerce/<shopify|woocommerce>/webhook/<connectionId> — product create / update / delete from the store.
// Public path (src/proxy.ts); every request must carry a valid HMAC-SHA256 signature of the raw body made with the
// connection's webhook secret (bad or missing → 401). See src/lib/commerce/sync.ts handleStoreWebhook.
export async function POST(req: Request, { params }: { params: Promise<{ platform: string; id: string }> }) {
  const { platform, id } = await params;
  if (!isPlatform(platform) || platform === "wix" || !/^[a-f0-9-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const raw = new Uint8Array(await req.arrayBuffer());
  if (raw.byteLength > 2 << 20) return new Response("Too large", { status: 413 });
  try {
    const status = await handleStoreWebhook(platform, id, raw, req.headers);
    return new Response(status === 200 ? "ok" : status === 401 ? "Bad signature" : "Not found", { status });
  } catch (e) {
    console.error("[commerce] webhook", platform, id, e);
    return new Response("Error", { status: 500 });
  }
}

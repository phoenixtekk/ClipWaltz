import { openApiSpec } from "@/lib/api/openapi";
import { appUrl } from "@/lib/social/app-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/v1/openapi.json — public OpenAPI 3.1 description of the ClipWaltz API (G12). No key needed.
export function GET() {
  return Response.json(openApiSpec(appUrl()), { headers: { "cache-control": "public, max-age=300", "access-control-allow-origin": "*" } });
}

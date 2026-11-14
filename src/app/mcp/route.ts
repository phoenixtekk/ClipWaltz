import { mcpPost } from "@/lib/api/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// G13 remote MCP endpoint (Streamable HTTP, stateless). Authenticated by a workspace API key — see src/lib/api/mcp.ts.
export async function POST(req: Request) {
  return mcpPost(req);
}

// No server-initiated SSE stream on this endpoint (the spec allows 405 for GET).
export function GET() {
  return new Response(JSON.stringify({ error: "This MCP server does not offer an SSE stream. POST JSON-RPC messages here." }), {
    status: 405,
    headers: { allow: "POST", "content-type": "application/json" },
  });
}

export function DELETE() {
  return new Response(null, { status: 405, headers: { allow: "POST" } });
}

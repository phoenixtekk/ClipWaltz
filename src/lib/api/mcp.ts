import "server-only";
import { ApiError, finishRequest, authenticateApi, type ApiContext } from "@/lib/api-keys";
import {
  API_VERSION, apiCreateImage, apiCreatePost, apiGenerateCopy, apiGetImage, apiGetPost, apiListChannels, apiListPosts, apiSchedulePost,
} from "@/lib/api/v1";
import { appUrl } from "@/lib/social/app-url";

// G13 — remote MCP server (Streamable HTTP transport, stateless, JSON responses) at /mcp. Same API keys, scopes, Pro
// gate and rate limits as /api/v1 (src/lib/api-keys.ts); the tools call the same functions as the REST routes
// (src/lib/api/v1.ts), so a key without `publish` cannot create or schedule a post here either.
//
// Transport (MCP spec 2025-06-18, "Streamable HTTP"): every client message is one HTTP POST. A request gets one
// `application/json` JSON-RPC response; a notification or response gets 202 with no body. GET → 405 (no server-initiated
// stream). No Mcp-Session-Id: the server is stateless, every POST is authenticated on its own.

export const SUPPORTED_PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const LATEST = "2025-06-18";

type Json = Record<string, unknown>;
interface RpcMsg {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Json;
}

const str = { type: "string" } as const;
const channels = { type: "array", items: str, description: "Channel keys from list_channels (provider#connectionId)." } as const;

export const TOOLS = [
  {
    name: "list_channels",
    title: "List channels",
    description: "List the social channels connected to this ClipWaltz workspace. Use the returned `key` values when creating posts.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: "create_post",
    title: "Create or schedule a post",
    description:
      "Create a social post in ClipWaltz. mode: draft (default, nothing is published), queue (Auto Post queue), schedule (needs scheduled_at, ISO 8601), or publish (now). Workspaces that require approval send it to an approver instead.",
    inputSchema: {
      type: "object",
      required: ["text", "channels"],
      properties: {
        text: { type: "string", description: "The post text." },
        channels,
        link: { type: "string", description: "Optional link (https://...)." },
        media_ids: { type: "array", items: str, description: "Media ids uploaded through the REST API (POST /api/v1/media)." },
        mode: { type: "string", enum: ["draft", "queue", "schedule", "publish"] },
        scheduled_at: { type: "string", description: "ISO 8601 date-time, for mode=schedule." },
        require_approval: { type: "boolean" },
      },
    },
    annotations: { destructiveHint: false, openWorldHint: true },
  },
  {
    name: "schedule_post",
    title: "Schedule a post",
    description: "Schedule (or move) an existing post that has not started publishing.",
    inputSchema: { type: "object", required: ["post_id", "scheduled_at"], properties: { post_id: str, scheduled_at: { type: "string", description: "ISO 8601 date-time." } } },
    annotations: { openWorldHint: true },
  },
  {
    name: "get_post_status",
    title: "Get post status",
    description: "A post's status, approval state and delivery result per channel.",
    inputSchema: { type: "object", required: ["post_id"], properties: { post_id: str } },
    annotations: { readOnlyHint: true },
  },
  {
    name: "list_posts",
    title: "List posts",
    description: "The workspace's most recent posts.",
    inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 100 } } },
    annotations: { readOnlyHint: true },
  },
  {
    name: "generate_image",
    title: "Generate an AI picture",
    description:
      "Start an AI picture (costs 2 ClipWaltz credits, refunded if it fails). Returns an image id; poll get_image_status. The picture also appears in Waltz Image.",
    inputSchema: {
      type: "object",
      required: ["brief"],
      properties: {
        brief: { type: "string", description: "What the picture should show." },
        format: { type: "string", enum: ["1:1", "4:5", "9:16", "1.91:1", "2:3"] },
        style: { type: "string", enum: ["photographic", "editorial", "render3d", "flat_vector", "cinematic", "minimal", "watercolor"] },
      },
    },
    annotations: { openWorldHint: false },
  },
  {
    name: "get_image_status",
    title: "Get picture status",
    description: "Status of an AI picture (pending | ready | failed) and its download URL when ready (fetch it with the same API key).",
    inputSchema: { type: "object", required: ["image_id"], properties: { image_id: str } },
    annotations: { readOnlyHint: true },
  },
  {
    name: "write_post_copy",
    title: "Write post copy",
    description: "AI caption + hashtags written for each chosen channel (0 credits).",
    inputSchema: { type: "object", required: ["brief", "channels"], properties: { brief: str, channels, link: str } },
    annotations: { readOnlyHint: true },
  },
] as const;

class RpcError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

async function callTool(ctx: ApiContext, name: string, a: Json): Promise<unknown> {
  switch (name) {
    case "list_channels":
      return apiListChannels(ctx);
    case "create_post":
      return apiCreatePost(ctx, a);
    case "schedule_post":
      return apiSchedulePost(ctx, String(a.post_id ?? ""), a.scheduled_at);
    case "get_post_status":
      return apiGetPost(ctx, String(a.post_id ?? ""));
    case "list_posts":
      return apiListPosts(ctx, Number(a.limit ?? 20));
    case "generate_image":
      return apiCreateImage(ctx, a);
    case "get_image_status": {
      const v = await apiGetImage(ctx, String(a.image_id ?? ""));
      return { ...v, file_url: v.file_url ? `${appUrl()}${v.file_url}` : null };
    }
    case "write_post_copy":
      return apiGenerateCopy(ctx, a);
    default:
      throw new RpcError(-32602, `Unknown tool: ${name}`);
  }
}

const reply = (id: RpcMsg["id"], result: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result });
const rpcError = (id: RpcMsg["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

async function handle(ctx: ApiContext, msg: RpcMsg): Promise<unknown> {
  const p = (msg.params ?? {}) as Json;
  switch (msg.method) {
    case "initialize": {
      const asked = typeof p.protocolVersion === "string" ? p.protocolVersion : LATEST;
      return reply(msg.id, {
        protocolVersion: SUPPORTED_PROTOCOLS.includes(asked) ? asked : LATEST,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "clipwaltz", title: "ClipWaltz", version: API_VERSION },
        instructions:
          "ClipWaltz social publishing and AI pictures for one workspace. Call list_channels first to get channel keys. create_post defaults to a draft; only use mode=publish when the user clearly asked to post now.",
      });
    }
    case "ping":
      return reply(msg.id, {});
    case "tools/list":
      return reply(msg.id, { tools: TOOLS });
    case "tools/call": {
      const name = String(p.name ?? "");
      const args = (p.arguments && typeof p.arguments === "object" ? p.arguments : {}) as Json;
      if (!TOOLS.some((t) => t.name === name)) throw new RpcError(-32602, `Unknown tool: ${name}`);
      try {
        const out = (await callTool(ctx, name, args)) as Json;
        return reply(msg.id, { content: [{ type: "text", text: JSON.stringify(out, null, 2) }], structuredContent: out, isError: false });
      } catch (e) {
        // A refused tool call is a tool result the model can read (MCP: tool errors are reported with isError: true).
        if (e instanceof ApiError && e.status !== 401 && e.status !== 429) {
          return reply(msg.id, { content: [{ type: "text", text: `${e.code}: ${e.message}` }], isError: true });
        }
        throw e;
      }
    }
    default:
      throw new RpcError(-32601, `Method not found: ${msg.method}`);
  }
}

function allowedOrigin(req: Request): boolean {
  const o = req.headers.get("origin");
  if (!o) return true; // non-browser MCP clients send none
  try {
    return new URL(o).origin === new URL(appUrl()).origin;
  } catch {
    return false;
  }
}

const jsonRes = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });

export async function mcpPost(req: Request): Promise<Response> {
  if (!allowedOrigin(req)) return jsonRes(rpcError(null, -32600, "Origin not allowed."), 403);
  const pv = req.headers.get("mcp-protocol-version");
  if (pv && !SUPPORTED_PROTOCOLS.includes(pv)) return jsonRes(rpcError(null, -32600, `Unsupported MCP-Protocol-Version: ${pv}`), 400);
  let ctx: ApiContext;
  try {
    ctx = await authenticateApi(req, "/mcp");
  } catch (e) {
    if (e instanceof ApiError) {
      const extra: Record<string, string> = e.status === 401 ? { "www-authenticate": 'Bearer realm="clipwaltz", error="invalid_token"' } : {};
      return jsonRes(rpcError(null, -32001, e.message), e.status, { ...e.headers, ...extra });
    }
    throw e;
  }
  let msg: RpcMsg;
  try {
    msg = JSON.parse(await req.text());
  } catch {
    await finishRequest(ctx, 400);
    return jsonRes(rpcError(null, -32700, "Parse error"), 400);
  }
  if (Array.isArray(msg) || !msg || typeof msg !== "object") {
    await finishRequest(ctx, 400);
    return jsonRes(rpcError(null, -32600, "Send one JSON-RPC message per request."), 400);
  }
  // Notifications (no id) and client responses (no method) → 202, no body.
  if (msg.id === undefined || !msg.method) {
    await finishRequest(ctx, 202);
    return new Response(null, { status: 202 });
  }
  try {
    const out = await handle(ctx, msg);
    await finishRequest(ctx, 200);
    return jsonRes(out);
  } catch (e) {
    if (e instanceof RpcError) {
      await finishRequest(ctx, 200);
      return jsonRes(rpcError(msg.id, e.code, e.message));
    }
    if (e instanceof ApiError) {
      await finishRequest(ctx, e.status);
      return jsonRes(rpcError(msg.id, -32001, e.message), e.status, e.headers);
    }
    console.error("[mcp]", e);
    await finishRequest(ctx, 500);
    return jsonRes(rpcError(msg.id, -32603, "Internal error"), 500);
  }
}

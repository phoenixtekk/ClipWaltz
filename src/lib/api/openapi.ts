// G12: the OpenAPI 3.1 description of /api/v1, served at /api/v1/openapi.json and linked from the Help Center.
// Keep it in step with src/lib/api/v1.ts (the route handlers are thin wrappers over those functions).

const err = { $ref: "#/components/responses/Error" };
const std = { "401": err, "403": err, "429": err };
const idPath = { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } };
const idem = { name: "Idempotency-Key", in: "header", required: false, schema: { type: "string", maxLength: 200 }, description: "Repeat-safe: the same key + body returns the first response (24 h)." };
const json = (ref: string) => ({ content: { "application/json": { schema: { $ref: `#/components/schemas/${ref}` } } } });

export function openApiSpec(baseUrl: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "ClipWaltz API",
      version: "1.0.0",
      description:
        "Create, schedule and publish social posts, upload media, and generate AI pictures and post copy in one ClipWaltz workspace. " +
        "Pro plan only. Authenticate with a workspace API key: `Authorization: Bearer cwk_…` (Account → API keys). " +
        "Rate limits: 60 requests a minute and 1,000 an hour per key (429 with Retry-After). Credits are charged exactly as in the app. " +
        "The same tools are available to AI assistants over MCP at /mcp.",
    },
    servers: [{ url: `${baseUrl}/api/v1` }],
    security: [{ apiKey: [] }],
    components: {
      securitySchemes: { apiKey: { type: "http", scheme: "bearer", description: "A workspace API key (cwk_…)." } },
      responses: {
        Error: {
          description: "Error",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        },
      },
      schemas: {
        Error: {
          type: "object",
          properties: { error: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } }, required: ["code", "message"] } },
        },
        Channel: {
          type: "object",
          properties: { key: { type: "string", description: "provider#connectionId — pass in `channels`" }, provider: { type: "string" }, label: { type: "string" }, paused: { type: "boolean" } },
        },
        Post: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            text: { type: "string" },
            link: { type: ["string", "null"] },
            status: { type: "string", enum: ["draft", "queued", "scheduled", "publishing", "published", "partial", "failed", "handoff", "rendering"] },
            approval: { type: "string", enum: ["none", "pending", "approved", "rejected"] },
            channels: { type: "array", items: { type: "string" } },
            scheduled_at: { type: ["string", "null"], format: "date-time" },
            published_at: { type: ["string", "null"], format: "date-time" },
            created_at: { type: "string", format: "date-time" },
            targets: {
              type: "array",
              items: { type: "object", properties: { channel: { type: "string" }, label: { type: ["string", "null"] }, status: { type: "string" }, url: { type: ["string", "null"] }, error: { type: ["string", "null"] }, updated_at: { type: "string", format: "date-time" } } },
            },
          },
        },
        NewPost: {
          type: "object",
          required: ["text", "channels"],
          properties: {
            text: { type: "string" },
            link: { type: "string", format: "uri" },
            channels: { type: "array", items: { type: "string" }, description: "Channel keys from GET /connections" },
            media_ids: { type: "array", items: { type: "string", format: "uuid" } },
            mode: { type: "string", enum: ["draft", "queue", "schedule", "publish"], default: "draft" },
            scheduled_at: { type: "string", format: "date-time", description: "Required for mode=schedule" },
            require_approval: { type: "boolean", description: "Send it to an approver first. Workspaces that require approval always do." },
          },
        },
        Image: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            status: { type: "string", enum: ["pending", "ready", "failed"] },
            format: { type: "string" },
            error: { type: ["string", "null"] },
            file_url: { type: ["string", "null"] },
            width: { type: ["integer", "null"] },
            height: { type: ["integer", "null"] },
          },
        },
      },
    },
    paths: {
      "/me": { get: { operationId: "getMe", summary: "The key's workspace and permissions", responses: { "200": { description: "OK" }, ...std } } },
      "/connections": {
        get: { operationId: "listConnections", summary: "Connected channels (scope: read)", responses: { "200": { description: "OK", content: { "application/json": { schema: { type: "object", properties: { channels: { type: "array", items: { $ref: "#/components/schemas/Channel" } } } } } } }, ...std } },
      },
      "/posts": {
        get: {
          operationId: "listPosts",
          summary: "Recent posts (scope: read)",
          parameters: [{ name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } }],
          responses: { "200": { description: "OK" }, ...std },
        },
        post: {
          operationId: "createPost",
          summary: "Create a draft, queue, schedule or publish a post (scope: publish)",
          parameters: [idem],
          requestBody: { required: true, ...json("NewPost") },
          responses: { "201": { description: "Created", ...json("Post") }, "400": err, "409": err, "422": err, ...std },
        },
      },
      "/posts/{id}": { get: { operationId: "getPost", summary: "A post with per-channel status (scope: read)", parameters: [idPath], responses: { "200": { description: "OK", ...json("Post") }, "404": err, ...std } } },
      "/posts/{id}/schedule": {
        post: {
          operationId: "schedulePost",
          summary: "Schedule or move a post (scope: publish)",
          parameters: [idPath],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["scheduled_at"], properties: { scheduled_at: { type: "string", format: "date-time" } } } } } },
          responses: { "200": { description: "OK", ...json("Post") }, "400": err, "404": err, "409": err, ...std },
        },
      },
      "/media": {
        get: { operationId: "listMedia", summary: "Uploaded post media (scope: read)", responses: { "200": { description: "OK" }, ...std } },
        post: {
          operationId: "uploadMedia",
          summary: "Upload an image or video for a post, ≤ 200 MB (scope: publish)",
          requestBody: { required: true, content: { "multipart/form-data": { schema: { type: "object", required: ["file"], properties: { file: { type: "string", format: "binary" } } } } } },
          responses: { "201": { description: "Created" }, "400": err, ...std },
        },
      },
      "/images": {
        post: {
          operationId: "createImage",
          summary: "Generate an AI picture — 2 credits, refunded on failure (scope: generate)",
          parameters: [idem],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["brief"],
                  properties: {
                    brief: { type: "string" },
                    format: { type: "string", enum: ["1:1", "4:5", "9:16", "1.91:1", "2:3"], default: "1:1" },
                    style: { type: "string", enum: ["photographic", "editorial", "render3d", "flat_vector", "cinematic", "minimal", "watercolor"], default: "photographic" },
                  },
                },
              },
            },
          },
          responses: { "202": { description: "Accepted — poll GET /images/{id}", ...json("Image") }, "400": err, "402": err, "503": err, ...std },
        },
      },
      "/images/{id}": { get: { operationId: "getImage", summary: "Picture status (scope: read)", parameters: [idPath], responses: { "200": { description: "OK", ...json("Image") }, "404": err, ...std } } },
      "/images/{id}/file": {
        get: { operationId: "getImageFile", summary: "The finished PNG (scope: read)", parameters: [idPath], responses: { "200": { description: "PNG", content: { "image/png": {} } }, "404": err, "409": err, ...std } },
      },
      "/generate/copy": {
        post: {
          operationId: "generateCopy",
          summary: "AI caption + hashtags per channel, 0 credits (scope: generate)",
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["brief", "channels"], properties: { brief: { type: "string" }, channels: { type: "array", items: { type: "string" } }, link: { type: "string" } } } } } },
          responses: { "200": { description: "OK" }, "400": err, "503": err, ...std },
        },
      },
    },
  };
}

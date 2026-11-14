import { LegalDoc } from "@/components/legal-doc";
import { appUrl } from "@/lib/social/app-url";

export const metadata = { title: "API and MCP guide", description: "Use the ClipWaltz API and MCP server from your own tools and AI assistants." };
export const dynamic = "force-dynamic";

const pre = "overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100";

// G12 / G13 developer guide (public, under /help). The machine-readable spec is /api/v1/openapi.json.
export default function ApiGuidePage() {
  const base = appUrl();
  return (
    <LegalDoc title="API and MCP guide" updated="For Pro workspaces — automate posts and pictures from your own tools and AI assistants." legal={false}>
      <h2>What you can do</h2>
      <ul>
        <li>List your connected channels, posts and media.</li>
        <li>Create a post as a draft, add it to the queue, schedule it, or publish it now (workspaces that require approval send it to an approver).</li>
        <li>Upload an image or video for a post.</li>
        <li>Generate an AI picture (2 credits, refunded if it fails) and AI post copy with hashtags for each channel (free).</li>
      </ul>
      <p>
        The full reference is the OpenAPI file: <a href="/api/v1/openapi.json">{`${base}/api/v1/openapi.json`}</a> — import it into Postman, Insomnia or
        any OpenAPI tool.
      </p>

      <h2>1. Create a key</h2>
      <p>
        Account menu → <strong>API keys</strong> (owners and admins, Pro plan). Pick what the key may do: <strong>Read</strong>, <strong>Generate</strong>,{" "}
        <strong>Publish</strong>. The key is shown once — copy it then. It acts as you: what it creates is yours, and AI pictures use your credits.
        Revoke a key there at any time; it stops working at once.
      </p>

      <h2>2. Call the API</h2>
      <p>Send the key as a bearer token:</p>
      <pre className={pre}>{`curl ${base}/api/v1/connections \\
  -H "Authorization: Bearer cwk_your_key"`}</pre>
      <p>Draft a post (nothing is published):</p>
      <pre className={pre}>{`curl -X POST ${base}/api/v1/posts \\
  -H "Authorization: Bearer cwk_your_key" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: 6f1c-launch-post" \\
  -d '{"text":"We just launched!","channels":["bluesky#<id>"],"mode":"draft"}'`}</pre>
      <p>Schedule it: send <code>{`"mode":"schedule","scheduled_at":"2026-12-01T15:00:00Z"`}</code>, or call <code>POST /api/v1/posts/&lt;id&gt;/schedule</code>.</p>
      <p>Make an AI picture and fetch it when it&apos;s ready:</p>
      <pre className={pre}>{`curl -X POST ${base}/api/v1/images -H "Authorization: Bearer cwk_your_key" \\
  -H "Content-Type: application/json" -d '{"brief":"a cozy coffee shop at sunrise","format":"1:1"}'
curl ${base}/api/v1/images/<id> -H "Authorization: Bearer cwk_your_key"
curl ${base}/api/v1/images/<id>/file -H "Authorization: Bearer cwk_your_key" -o picture.png`}</pre>

      <h2>Rules</h2>
      <ul>
        <li><strong>Pro only.</strong> If the workspace owner leaves Pro, keys answer 403 until they are back on Pro.</li>
        <li><strong>Limits:</strong> 60 requests a minute and 1,000 an hour per key. Over the limit you get 429 with a Retry-After header.</li>
        <li><strong>Idempotency-Key:</strong> send one on POST /posts and POST /images; repeating the same request with the same key returns the first answer instead of creating a second post or charging twice (kept 24 hours).</li>
        <li><strong>Errors</strong> look like <code>{`{"error":{"code":"insufficient_scope","message":"…"}}`}</code>: 401 bad or revoked key, 403 missing permission or plan, 404 not in this workspace, 402 not enough credits, 429 rate limit.</li>
        <li>A key only ever sees its own workspace.</li>
      </ul>

      <h2>3. Connect an AI assistant (MCP)</h2>
      <p>
        ClipWaltz is also a remote MCP server at <code>{`${base}/mcp`}</code> (Streamable HTTP). It uses the same keys and permissions. Tools: list_channels,
        create_post, schedule_post, get_post_status, list_posts, generate_image, get_image_status, write_post_copy.
      </p>
      <p>Claude Code:</p>
      <pre className={pre}>{`claude mcp add --transport http clipwaltz ${base}/mcp \\
  --header "Authorization: Bearer cwk_your_key"`}</pre>
      <p>Clients that take a JSON config:</p>
      <pre className={pre}>{JSON.stringify({ mcpServers: { clipwaltz: { type: "http", url: `${base}/mcp`, headers: { Authorization: "Bearer cwk_your_key" } } } }, null, 2)}</pre>
      <p>
        Give the assistant a key with only the permissions it needs — a <strong>Read</strong>-only key can look but never post. create_post makes a draft unless
        you ask for it to be published.
      </p>
    </LegalDoc>
  );
}

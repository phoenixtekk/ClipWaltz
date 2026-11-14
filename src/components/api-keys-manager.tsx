"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, KeyRound, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { unwrap } from "@/lib/action-result";
import { createWorkspaceApiKey, revokeWorkspaceApiKey } from "@/lib/api-key-actions";

type KeyRow = { id: string; name: string; prefix: string; scopes: string[]; revoked: boolean; lastUsedAt: string | null; createdAt: string };

const SCOPES = [
  { key: "read", label: "Read", desc: "List channels, posts, media and pictures" },
  { key: "generate", label: "Generate", desc: "AI pictures (2 credits each) and post copy (free)" },
  { key: "publish", label: "Publish", desc: "Create, schedule and publish posts; upload media" },
];

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "Never");

export function ApiKeysManager({ canManage, hasApi, keys, baseUrl }: { canManage: boolean; hasApi: boolean; keys: KeyRow[]; baseUrl: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["read"]);
  const [secret, setSecret] = useState<string | null>(null);

  if (!canManage) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Owners and admins only</CardTitle>
          <CardDescription>Ask an owner or admin of this workspace to create an API key.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  function create(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      try {
        const k = unwrap(await createWorkspaceApiKey(name, scopes));
        setSecret(k.secret);
        setName("");
        router.refresh();
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  function revoke(id: string) {
    if (!confirm("Revoke this key? Anything using it stops working at once.")) return;
    start(async () => {
      try {
        unwrap(await revokeWorkspaceApiKey(id));
        toast.success("Key revoked.");
        router.refresh();
      } catch (err) {
        toast.error((err as Error).message);
      }
    });
  }

  const copy = (t: string) => navigator.clipboard.writeText(t).then(() => toast.success("Copied."), () => toast.error("Couldn't copy."));
  const mcpJson = JSON.stringify({ mcpServers: { clipwaltz: { type: "http", url: `${baseUrl}/mcp`, headers: { Authorization: "Bearer cwk_…" } } } }, null, 2);

  return (
    <div className="space-y-6">
      {!hasApi ? (
        <Card>
          <CardHeader>
            <CardTitle>The API is part of Pro</CardTitle>
            <CardDescription>
              The workspace owner needs the Pro plan to create keys. Existing keys stop working while the owner is not on Pro and work again after an upgrade.{" "}
              <a className="underline" href="/account/billing">See plans</a>
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><KeyRound className="size-4" /> Create a key</CardTitle>
            <CardDescription>The key acts as you: what it creates is yours, and AI pictures use your credits.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={create} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="key-name">Name</Label>
                <Input id="key-name" value={name} maxLength={60} placeholder="e.g. My scheduler script" onChange={(e) => setName(e.target.value)} />
              </div>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Permissions</legend>
                {SCOPES.map((s) => (
                  <Label key={s.key} className="flex items-start gap-2 font-normal">
                    <Checkbox
                      aria-label={s.label}
                      checked={scopes.includes(s.key)}
                      onCheckedChange={(v) => setScopes(v ? [...new Set([...scopes, s.key])] : scopes.filter((x) => x !== s.key))}
                    />
                    <span><span className="font-medium">{s.label}</span> <span className="text-muted-foreground">— {s.desc}</span></span>
                  </Label>
                ))}
              </fieldset>
              <Button type="submit" disabled={busy || !name.trim() || !scopes.length}>
                {busy ? <Loader2 className="animate-spin" /> : <KeyRound />} Create key
              </Button>
            </form>
            {secret ? (
              <div role="status" className="mt-4 space-y-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3">
                <p className="text-sm font-medium">Copy your key now — it won&apos;t be shown again.</p>
                <div className="flex gap-2">
                  <Input readOnly value={secret} aria-label="New API key" className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
                  <Button type="button" variant="outline" onClick={() => copy(secret)}><Copy /> Copy</Button>
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={() => setSecret(null)}>I&apos;ve saved it</Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Keys</CardTitle>
          <CardDescription>Only the first characters are kept in readable form, so a lost key can&apos;t be recovered — revoke it and make a new one.</CardDescription>
        </CardHeader>
        <CardContent>
          {keys.length === 0 ? (
            <p className="text-sm text-muted-foreground">No keys yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {keys.map((k) => (
                <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">
                      {k.name} <code className="text-xs text-muted-foreground">{k.prefix}…</code>{" "}
                      {k.revoked ? <Badge variant="outline">Revoked</Badge> : null}
                    </p>
                    <p className="flex flex-wrap gap-1 text-xs text-muted-foreground">
                      {k.scopes.map((s) => <Badge key={s} variant="secondary">{s}</Badge>)}
                      <span>Created {when(k.createdAt)} · Last used {when(k.lastUsedAt)}</span>
                    </p>
                  </div>
                  {!k.revoked ? (
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => revoke(k.id)}><Trash2 /> Revoke</Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Use it</CardTitle>
          <CardDescription>REST: <code>{baseUrl}/api/v1</code> (spec: <a className="underline" href="/api/v1/openapi.json">openapi.json</a>). MCP for AI assistants: <code>{baseUrl}/mcp</code>.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm">Claude Code:</p>
          <pre className="overflow-x-auto rounded-md bg-muted p-2 text-xs">{`claude mcp add --transport http clipwaltz ${baseUrl}/mcp --header "Authorization: Bearer cwk_…"`}</pre>
          <p className="text-sm">Other MCP clients (JSON config):</p>
          <pre className="overflow-x-auto rounded-md bg-muted p-2 text-xs">{mcpJson}</pre>
        </CardContent>
      </Card>
    </div>
  );
}

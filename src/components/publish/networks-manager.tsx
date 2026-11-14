"use client";
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, AlertTriangle, CheckCircle2, Loader2, Pause, Play, Plug, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { unwrap } from "@/lib/action-result";
import {
  checkChannelHealth, choosePinterestBoard, disconnectChannel, listPinterestBoards, setChannelBrief, setChannelPaused,
} from "@/lib/social/ui-actions";
import { providerName, type ChannelAllowance } from "@/lib/social/ui-types";

export interface ChannelRow {
  id: string;
  provider: string;
  name: string;
  paused: boolean;
  needsBoard: boolean;
  aiContext: string;
  expiresAt: string | null;
}

type Field = { key: string; label: string; type?: "password" | "url" | "text" | "email"; placeholder?: string; help?: string };
type Network = { id: string; blurb: string; oauth?: boolean; fields?: Field[]; adminOnly?: boolean; instance?: boolean };

const LABEL: Field = { key: "label", label: "Name in ClipWaltz (optional)", placeholder: "e.g. Brand account" };

// Paste-credential fields match src/lib/social/credentials.ts; OAuth networks use /api/social/oauth/<id>/start.
const NETWORKS: Network[] = [
  { id: "facebook", blurb: "Pages you manage (and their linked Instagram accounts).", oauth: true },
  { id: "instagram", blurb: "Business account — easiest through Facebook; or paste a token.", fields: [
    { key: "igUserId", label: "Instagram business account id" }, { key: "token", label: "Access token", type: "password" }, LABEL] },
  { id: "threads", blurb: "Your Threads profile.", oauth: true },
  { id: "linkedin", blurb: "Company Page (needs LinkedIn's approval for the app).", oauth: true },
  { id: "youtube", blurb: "Uploads videos (Shorts for vertical video).", oauth: true, fields: [
    { key: "clientId", label: "OAuth client id" }, { key: "clientSecret", label: "Client secret", type: "password" },
    { key: "refreshToken", label: "Refresh token", type: "password" }, LABEL] },
  { id: "tiktok", blurb: "Videos go to your TikTok inbox/drafts until the app is audited.", oauth: true, fields: [
    { key: "clientKey", label: "Client key" }, { key: "clientSecret", label: "Client secret", type: "password" },
    { key: "refreshToken", label: "Refresh token", type: "password" }, LABEL] },
  { id: "x", blurb: "Posts to X (Twitter).", oauth: true, fields: [
    { key: "clientId", label: "OAuth 2.0 client id" }, { key: "clientSecret", label: "Client secret", type: "password" },
    { key: "refreshToken", label: "Refresh token", type: "password" }, LABEL] },
  { id: "pinterest", blurb: "Pins an image to one of your boards.", oauth: true },
  { id: "tumblr", blurb: "Your Tumblr blog.", oauth: true },
  { id: "mastodon", blurb: "Any Mastodon server.", oauth: true, instance: true },
  { id: "bluesky", blurb: "Use an app password, not your login password.", fields: [
    { key: "handle", label: "Handle", placeholder: "you.bsky.social" }, { key: "appPassword", label: "App password", type: "password" }, LABEL] },
  { id: "telegram", blurb: "A channel or group your bot is an admin of.", fields: [
    { key: "token", label: "Bot token", type: "password" }, { key: "chatId", label: "Channel or chat", placeholder: "@yourchannel or -100…" }, LABEL] },
  { id: "discord", blurb: "A channel webhook.", fields: [{ key: "webhookUrl", label: "Webhook URL", type: "url" }, LABEL] },
  { id: "slack", blurb: "A bot token and the channel to post in.", fields: [
    { key: "token", label: "Bot token (xoxb-…)", type: "password" }, { key: "channel", label: "Channel", placeholder: "#marketing" }, LABEL] },
  { id: "teams", blurb: "A Teams channel workflow webhook.", fields: [{ key: "webhookUrl", label: "Webhook URL", type: "url" }, LABEL] },
  { id: "reddit", blurb: "A script app and the subreddit to post in.", fields: [
    { key: "clientId", label: "Client id" }, { key: "clientSecret", label: "Client secret", type: "password" },
    { key: "username", label: "Username" }, { key: "password", label: "Password", type: "password" },
    { key: "subreddit", label: "Subreddit", placeholder: "r/yoursubreddit" }, LABEL] },
  { id: "medium", blurb: "An integration token.", fields: [{ key: "token", label: "Integration token", type: "password" }, LABEL] },
  { id: "devto", blurb: "Article drafts or posts on DEV.", fields: [
    { key: "apiKey", label: "API key", type: "password" }, { key: "tags", label: "Tags (comma-separated)" },
    { key: "mode", label: "Publish as (draft or published)", placeholder: "draft" }, LABEL] },
  { id: "discourse", blurb: "A topic in a forum category.", fields: [
    { key: "instance", label: "Forum address", type: "url", placeholder: "https://forum.example.com" },
    { key: "apiKey", label: "API key", type: "password" }, { key: "apiUsername", label: "API username" },
    { key: "category", label: "Category slug" }, LABEL] },
  { id: "facebook_group", blurb: "No API exists for groups any more — posts wait in “Post by hand”.", fields: [
    { key: "group", label: "Group address", type: "url", placeholder: "https://www.facebook.com/groups/…" }, LABEL] },
  { id: "txtya", blurb: "A TxtYa webhook.", fields: [{ key: "webhookUrl", label: "Webhook URL", type: "url" }, LABEL] },
  { id: "email", blurb: "Sends the post by email through ClipWaltz's mail service. Administrators only.", adminOnly: true, fields: [
    { key: "recipient", label: "Recipients (comma-separated, max 25)", type: "email" }, LABEL] },
];

const RESULTS: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: "Connected." },
  choose_board: { ok: true, text: "Connected — now choose the board your Pins go to." },
  limit: { ok: false, text: "Your plan has no room for another channel. Disconnect one or upgrade." },
  forbidden: { ok: false, text: "Only workspace owners and admins can connect channels." },
  not_configured: { ok: false, text: "That network isn't set up on ClipWaltz yet." },
  cancelled: { ok: false, text: "The connection was cancelled on the network's side." },
  pinterest_scopes: { ok: false, text: "Pinterest didn't grant every permission ClipWaltz needs. Connect again and allow them all." },
  error: { ok: false, text: "Connecting didn't finish. Try again; if it keeps failing, send us feedback." },
};

/** Connect, pause, check and disconnect the workspace's social channels. */
export function NetworksManager({
  channels,
  allowance,
  oauthReady,
  canManage,
  isSiteAdmin,
  result,
  boardFor,
}: {
  channels: ChannelRow[];
  allowance: ChannelAllowance;
  oauthReady: Record<string, boolean>;
  canManage: boolean;
  isSiteAdmin: boolean;
  result: { provider: string | null; code: string | null };
  boardFor: string | null;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [connecting, setConnecting] = useState<Network | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [instance, setInstance] = useState("");
  const [brief, setBrief] = useState<ChannelRow | null>(null);
  const [briefText, setBriefText] = useState("");
  const [removing, setRemoving] = useState<ChannelRow | null>(null);
  const [boardConn, setBoardConn] = useState<string | null>(boardFor);
  const [boards, setBoards] = useState<{ id: string; name: string }[] | null>(null);
  const [board, setBoard] = useState<string | null>(null);
  const [health, setHealth] = useState<Record<string, { ok: boolean; detail?: string; fix?: string; checked: boolean }> | null>(null);

  const full = allowance.used >= allowance.limit;
  const pct = allowance.limit ? Math.min(100, Math.round((allowance.used / allowance.limit) * 100)) : 100;
  const res = result.code ? RESULTS[result.code] ?? { ok: false, text: `Connecting didn't finish (${result.code.replace(/_/g, " ")}).` } : null;

  useEffect(() => {
    if (!boardConn) return;
    let live = true;
    listPinterestBoards(boardConn)
      .then((r) => {
        if (!live) return;
        if (r.ok) setBoards(r.data);
        else {
          toast.error(r.error);
          setBoardConn(null);
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [boardConn]);

  function run(fn: () => Promise<unknown>, ok?: string) {
    start(async () => {
      try {
        await fn();
        if (ok) toast.success(ok);
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  function connectPasted() {
    if (!connecting) return;
    const n = connecting;
    run(async () => {
      const r = await fetch(`/api/social/connections/${n.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string; warning?: string };
      if (!r.ok) throw new Error(j.error || `Could not connect (${r.status}).`);
      setConnecting(null);
      setForm({});
      if (j.warning) toast.warning(j.warning);
    }, `${providerName(n.id)} connected.`);
  }

  function oauthHref(n: Network) {
    const q = n.instance ? `?instance=${encodeURIComponent(instance.trim())}` : "";
    return `/api/social/oauth/${n.id}/start${q}`;
  }

  const visible = NETWORKS.filter((n) => !n.adminOnly || isSiteAdmin);

  return (
    <div className="space-y-6">
      {res ? (
        <Alert variant={res.ok ? "default" : "destructive"}>
          {res.ok ? <CheckCircle2 /> : <AlertTriangle />}
          <AlertTitle>{result.provider ? providerName(result.provider) : "Connection"}</AlertTitle>
          <AlertDescription>{res.text}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Channels on your plan</CardTitle>
          <CardDescription>
            {allowance.limit === 0
              ? "Connecting social channels is part of the Plus and Pro plans."
              : `${allowance.used} of ${allowance.limit} channels used on the ${allowance.tier === "pro" ? "Pro" : "Plus"} plan.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Progress value={pct} aria-label="Channels used" />
          {full ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-muted-foreground">
                {allowance.limit === 0 ? "Upgrade to Plus (10 channels) or Pro (25 channels) to connect networks." : allowance.tier === "plus" ? "Pro raises the limit to 25 channels." : "Disconnect a channel to add another."}
              </p>
              {allowance.tier !== "pro" ? <Link href="/account/billing" className={buttonVariants({ size: "sm" })}>Upgrade</Link> : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>Connected channels</CardTitle>
            <CardDescription>Paused channels are kept but never posted to.</CardDescription>
          </div>
          {channels.length ? (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const h = unwrap(await checkChannelHealth());
                  setHealth(Object.fromEntries(h.map((x) => [x.id, x])));
                }, "Checked.")
              }
            >
              {busy ? <Loader2 className="animate-spin" /> : <Activity />} Check they still work
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {channels.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing connected yet. Pick a network below.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Channel</TableHead>
                  <TableHead>Network</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {channels.map((c) => {
                  const h = health?.[c.id];
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="max-w-56 truncate font-medium">{c.name}</TableCell>
                      <TableCell>{providerName(c.provider)}</TableCell>
                      <TableCell className="space-y-1 whitespace-normal">
                        {c.paused ? <Badge variant="outline">Paused</Badge> : c.needsBoard ? <Badge variant="destructive">Choose a board</Badge> : <Badge>Active</Badge>}
                        {h ? (
                          h.ok ? (
                            <p className="text-xs text-emerald-700 dark:text-emerald-400">{h.checked ? "Working" : "No quick check for this network"}</p>
                          ) : (
                            <p className="text-xs text-destructive">{h.detail}{h.fix ? ` — ${h.fix}` : ""}</p>
                          )
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          {c.provider === "pinterest" && canManage ? (
                            <Button size="xs" variant="outline" onClick={() => { setBoards(null); setBoard(null); setBoardConn(c.id); }}>Board</Button>
                          ) : null}
                          {canManage ? (
                            <>
                              <Button size="icon-sm" variant="ghost" aria-label={`AI brief for ${c.name}`} title="AI brief" onClick={() => { setBrief(c); setBriefText(c.aiContext); }}>
                                <Sparkles />
                              </Button>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                aria-label={c.paused ? `Resume ${c.name}` : `Pause ${c.name}`}
                                title={c.paused ? "Resume" : "Pause"}
                                disabled={busy}
                                onClick={() => run(async () => unwrap(await setChannelPaused(c.id, !c.paused)), c.paused ? "Resumed." : "Paused.")}
                              >
                                {c.paused ? <Play /> : <Pause />}
                              </Button>
                              <Button size="icon-sm" variant="ghost" aria-label={`Disconnect ${c.name}`} title="Disconnect" onClick={() => setRemoving(c)}>
                                <Trash2 />
                              </Button>
                            </>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Add a network</h2>
          <p className="text-sm text-muted-foreground">
            Not sure what to paste? The <Link className="underline underline-offset-2" href="/setup-guide">setup guide</Link> walks through each network.
            {canManage ? "" : " Only workspace owners and admins can connect channels."}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((n) => {
            const ready = n.oauth && oauthReady[n.id];
            const disabled = !canManage || full;
            return (
              <Card key={n.id} size="sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    {providerName(n.id)}
                    {n.adminOnly ? <Badge variant="outline">Admin</Badge> : null}
                  </CardTitle>
                  <CardDescription>{n.blurb}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  {n.oauth ? (
                    n.instance ? (
                      <Button size="sm" disabled={disabled || !ready} onClick={() => { setConnecting(n); setForm({}); }}>
                        <Plug /> Connect
                      </Button>
                    ) : ready && !disabled ? (
                      <a href={oauthHref(n)} className={buttonVariants({ size: "sm" })}><Plug /> Connect</a>
                    ) : (
                      <Button size="sm" disabled title={ready ? undefined : "Not set up on ClipWaltz yet"}><Plug /> Connect</Button>
                    )
                  ) : null}
                  {n.fields ? (
                    <Button size="sm" variant={n.oauth ? "outline" : "default"} disabled={disabled} onClick={() => { setConnecting(n); setForm({}); }}>
                      {n.oauth ? "Paste credentials" : <><Plug /> Connect</>}
                    </Button>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {/* Paste-credential / Mastodon instance dialog */}
      <Dialog open={connecting !== null} onOpenChange={(o) => (o ? null : setConnecting(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect {connecting ? providerName(connecting.id) : ""}</DialogTitle>
            <DialogDescription>
              {connecting?.instance
                ? "Enter your Mastodon server, then approve ClipWaltz there."
                : "Credentials are checked with the network, then stored encrypted. They are never shown again."}
            </DialogDescription>
          </DialogHeader>
          {connecting?.instance ? (
            <div className="space-y-1.5">
              <Label htmlFor="mastodon-instance">Server</Label>
              <Input id="mastodon-instance" placeholder="mastodon.social" value={instance} onChange={(e) => setInstance(e.target.value)} />
            </div>
          ) : (
            <form
              id="connect-form"
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                connectPasted();
              }}
            >
              {connecting?.fields?.map((f) => (
                <div key={f.key} className="space-y-1.5">
                  <Label htmlFor={`f-${f.key}`}>{f.label}</Label>
                  <Input
                    id={`f-${f.key}`}
                    type={f.type === "password" ? "password" : f.type === "url" ? "url" : "text"}
                    autoComplete="off"
                    placeholder={f.placeholder}
                    value={form[f.key] ?? ""}
                    onChange={(e) => setForm((v) => ({ ...v, [f.key]: e.target.value }))}
                  />
                </div>
              ))}
            </form>
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            {connecting?.instance ? (
              instance.trim() ? (
                <a href={oauthHref(connecting)} className={buttonVariants()}>Continue</a>
              ) : (
                <Button disabled>Continue</Button>
              )
            ) : (
              <Button type="submit" form="connect-form" disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : null} Connect
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI brief */}
      <Dialog open={brief !== null} onOpenChange={(o) => (o ? null : setBrief(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>AI brief for {brief?.name}</DialogTitle>
            <DialogDescription>Voice, audience and rules the AI follows when it writes for this channel (Auto Post).</DialogDescription>
          </DialogHeader>
          <Textarea value={briefText} onChange={(e) => setBriefText(e.target.value)} className="min-h-32" maxLength={4000} />
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button
              disabled={busy}
              onClick={() => {
                const c = brief;
                setBrief(null);
                if (c) run(async () => unwrap(await setChannelBrief(c.id, briefText)), "Brief saved.");
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Disconnect */}
      <Dialog open={removing !== null} onOpenChange={(o) => (o ? null : setRemoving(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect {removing?.name}?</DialogTitle>
            <DialogDescription>
              Its saved login is deleted. Scheduled posts and Auto Post rules that use it skip it until you connect it again.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                const c = removing;
                setRemoving(null);
                if (c) run(async () => unwrap(await disconnectChannel(c.id)), "Disconnected.");
              }}
            >
              Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pinterest board picker */}
      <Dialog open={boardConn !== null} onOpenChange={(o) => (o ? null : setBoardConn(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Choose a Pinterest board</DialogTitle>
            <DialogDescription>Every Pin from ClipWaltz goes to this board. You can change it any time.</DialogDescription>
          </DialogHeader>
          {boards === null ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading your boards…</p>
          ) : boards.length === 0 ? (
            <p className="text-sm text-muted-foreground">No boards found. Create one on Pinterest, then try again.</p>
          ) : (
            <Select value={board} onValueChange={(v) => setBoard(v as string | null)} items={boards.map((b) => ({ value: b.id, label: b.name }))}>
              <SelectTrigger className="w-full"><SelectValue placeholder="Pick a board" /></SelectTrigger>
              <SelectContent>
                {boards.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button
              disabled={busy || !board}
              onClick={() => {
                const id = boardConn;
                setBoardConn(null);
                if (id && board) run(async () => unwrap(await choosePinterestBoard(id, board)), "Board saved.");
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

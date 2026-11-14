import { NetworksManager, type ChannelRow } from "@/components/publish/networks-manager";
import { isAdminEmail } from "@/lib/admin";
import { roleAtLeast } from "@/lib/workspace";
import { listConnections } from "@/lib/social/connections";
import { channelAllowance } from "@/lib/social/limits";
import { OAUTH_PROVIDERS, oauthFlow } from "@/lib/social/oauth/registry";
import { publishPage } from "@/lib/social/page-context";
import { DEFAULT_LABEL } from "@/lib/social/destinations";

export const metadata = { title: "Networks · Publish" };

export default async function NetworksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sc = await publishPage();
  if (!sc) return null;
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : null);
  const [conns, allowance] = await Promise.all([listConnections(sc.workspaceId), channelAllowance(sc.workspaceId)]);

  // Credentials stay on the server: only what the table shows is passed down.
  const channels: ChannelRow[] = conns.map((c) => ({
    id: c.id,
    provider: c.provider,
    name: c.label || c.displayName || DEFAULT_LABEL[c.provider] || c.provider,
    paused: c.paused,
    needsBoard: c.provider === "pinterest" && !c.externalId,
    aiContext: c.aiContext ?? "",
    expiresAt: c.expiresAt?.toISOString() ?? null,
  }));
  const oauthReady = Object.fromEntries(OAUTH_PROVIDERS.map((p) => [p, Boolean(oauthFlow(p)?.configured())]));
  const boardFor = one("result") === "choose_board" ? one("connection") : null;

  return (
    <NetworksManager
      channels={channels}
      allowance={allowance}
      oauthReady={oauthReady}
      canManage={roleAtLeast(sc.role, "admin")}
      isSiteAdmin={isAdminEmail(sc.email)}
      result={{ provider: one("provider"), code: one("result") }}
      boardFor={boardFor && channels.some((c) => c.id === boardFor) ? boardFor : null}
    />
  );
}

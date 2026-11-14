import type { PublishProvider, PublishRequest, PublishResult } from "../types";
import { markdownLink } from "../link-format";
import { isTeamsWebhookUrl } from "../webhook-urls";
import { safeFetch } from "@/lib/social/safe-fetch";

// Microsoft Teams adapter. Posts to a channel via an incoming webhook URL — either
// a Power Automate "Workflow" webhook (the current path) or a legacy Office 365
// connector webhook (retiring May 2026). Both accept a MessageCard JSON payload.
// The connection's accessToken is the webhook URL. Text/link only — webhooks take
// a JSON card, not file uploads, and Teams can't fetch our owner-scoped media.
//
// Docs: https://learn.microsoft.com/microsoftteams/platform/webhooks-and-connectors

const THEME = "6264A7"; // Teams purple.

export class TeamsProvider implements PublishProvider {
  readonly id = "teams" as const;

  isConfigured(): boolean {
    // Connection-based only (webhook URL stored via the Networks page).
    return false;
  }

  async publish(req: PublishRequest): Promise<PublishResult> {
    const webhookUrl = req.credentials?.teams?.accessToken;
    if (!webhookUrl) return this.fail("Microsoft Teams not connected — add a channel webhook on the Networks page.");

    // Re-checked at send time too: a row stored before the strict check (or edited in the DB) must not become a
    // server-side request to an arbitrary host.
    if (!isTeamsWebhookUrl(webhookUrl)) return this.fail("The stored Teams webhook URL is not a Teams webhook — reconnect on the Networks page.");

    const card = this.messageCard(req.text, req.link);
    try {
      const res = await safeFetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(card),
        signal: AbortSignal.timeout(20_000),
      });
      await res.body?.cancel().catch(() => {});
      // Legacy connectors return "1"; Workflows return 200/202 (often empty body). The reply body is never stored.
      if (!res.ok) return this.fail(`Teams webhook returned HTTP ${res.status}.`, res.status);
      return { provider: this.id, ok: true, statusCode: res.status };
    } catch (err) {
      return this.fail(err instanceof Error ? err.message : "Network error calling the Teams webhook.");
    }
  }

  /** Build a MessageCard (accepted by both Workflows and legacy connector webhooks). */
  messageCard(text: string, link?: string): Record<string, unknown> {
    const card: Record<string, unknown> = {
      "@type": "MessageCard",
      "@context": "https://schema.org/extensions",
      summary: (text.split("\n")[0] || "New post").slice(0, 120),
      themeColor: THEME,
      // MessageCard text renders markdown; the OpenUri action below still
      // carries the full tracked URL.
      text: link ? `${text}\n\n${markdownLink(link)}` : text,
    };
    if (link) {
      card.potentialAction = [
        { "@type": "OpenUri", name: "Open link", targets: [{ os: "default", uri: link }] },
      ];
    }
    return card;
  }

  private fail(error: string, statusCode?: number): PublishResult {
    return { provider: this.id, ok: false, error, statusCode };
  }
}

import nodemailer from "nodemailer";
import type { PublishProvider, PublishRequest, PublishResult } from "../types";
import { htmlLink } from "../link-format";

// Email adapter — sends the post as an email via Amazon SES SMTP (per standing
// rule). The connection's externalId holds the recipient address(es); SES SMTP
// credentials come from env. Media attaches to the message.
//
// Env: SES_SMTP_HOST, SES_SMTP_PORT (587), SES_SMTP_USER, SES_SMTP_PASS, EMAIL_FROM

function sesConfigured(): boolean {
  return Boolean(process.env.SES_SMTP_HOST && process.env.SES_SMTP_USER && process.env.SES_SMTP_PASS && process.env.EMAIL_FROM);
}

export function emailConfigured(): boolean {
  return sesConfigured();
}

export class EmailProvider implements PublishProvider {
  readonly id = "email" as const;

  isConfigured(): boolean {
    // Selectable only when SES is configured AND a recipient connection exists;
    // the recipient part is checked in destination resolution.
    return false;
  }

  async publish(req: PublishRequest): Promise<PublishResult> {
    const to = req.credentials?.email?.externalId;
    if (!to) return this.fail("No recipient set — add an Email destination in Networks.");
    if (!sesConfigured()) {
      return this.fail("Email isn't configured on the server (SES_SMTP_* / EMAIL_FROM env are missing).");
    }

    const from = process.env.EMAIL_FROM!;
    const firstLine = (req.text.split("\n").find((l) => l.trim()) || "New post").trim();
    const subject = firstLine.length > 120 ? firstLine.slice(0, 117) + "…" : firstLine;
    const body = req.link ? `${req.text}\n\n${req.link}` : req.text;

    const attachments = (req.media ?? []).map((m) => ({
      filename: m.filename || `attachment-${m.id}`,
      content: m.data,
      contentType: m.mime,
    }));

    try {
      const transporter = nodemailer.createTransport({
        host: process.env.SES_SMTP_HOST,
        port: Number(process.env.SES_SMTP_PORT || 587),
        secure: false, // STARTTLS on 587
        auth: { user: process.env.SES_SMTP_USER, pass: process.env.SES_SMTP_PASS },
      });

      const info = await transporter.sendMail({
        from,
        to, // comma-separated list is accepted
        subject,
        text: body,
        // The plain-text part keeps the full URL (no markup to render it);
        // the HTML part shows the domain and hides the tracking tail.
        html: `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;white-space:pre-wrap;font-size:15px;line-height:1.55">${
          req.link
            ? escapeHtml(req.text) + "<br><br>" + htmlLink(req.link, escapeHtml)
            : escapeHtml(body)
        }</div>`,
        attachments,
      });

      return { provider: this.id, ok: true, postId: info.messageId, statusCode: 200 };
    } catch (err) {
      return this.fail(err instanceof Error ? err.message : "SES send failed.");
    }
  }

  private fail(error: string): PublishResult {
    return { provider: this.id, ok: false, error };
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1">$1</a>');
}

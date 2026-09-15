import nodemailer, { type Transporter } from "nodemailer";

type Mail = { to: string; subject: string; html: string; text?: string };

// Standing rule: transactional email goes through Amazon SES (SMTP + nodemailer,
// STARTTLS on 587). If SES env isn't set, log to the console so auth flows never
// hard-fail in dev.
let _tx: Transporter | null = null;

function transport(): Transporter | null {
  if (_tx) return _tx;
  const host = process.env.SES_SMTP_HOST;
  const user = process.env.SES_SMTP_USER;
  const pass = process.env.SES_SMTP_PASS;
  if (!host || !user || !pass) return null;
  _tx = nodemailer.createTransport({
    host,
    port: Number(process.env.SES_SMTP_PORT ?? 587),
    secure: false, // STARTTLS
    requireTLS: true,
    auth: { user, pass },
  });
  return _tx;
}

export async function sendEmail(mail: Mail): Promise<void> {
  const from = process.env.EMAIL_FROM || "ClipWaltz <noreply@clipwaltz.com>";
  const tx = transport();
  if (!tx) {
    console.log(
      `[email:dev] (SES not configured) to=${mail.to} subject="${mail.subject}"\n${mail.text ?? mail.html}`,
    );
    return;
  }
  try {
    await tx.sendMail({ from, to: mail.to, subject: mail.subject, html: mail.html, text: mail.text });
  } catch (err) {
    console.error("[email] send error", err);
  }
}

export function simpleEmail(
  heading: string,
  body: string,
  cta: { label: string; url: string },
): string {
  return `<div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:480px;margin:auto">
  <h2>${heading}</h2>
  <p style="color:#555">${body}</p>
  <p><a href="${cta.url}" style="display:inline-block;background:#cf5330;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">${cta.label}</a></p>
  <p style="color:#999;font-size:12px">If you didn't request this, you can ignore this email.</p>
</div>`;
}

import type { EmailCategory } from "@/lib/email/categories";

/**
 * A notification, as an email. The subject is the notification's title and the
 * body its caption, so the bell and the inbox always say the same thing, and
 * there is one place to word it.
 *
 * Plain inline-styled tables, light background: what renders the same in Gmail,
 * Outlook and a phone's mail app. No images, so nothing to block and nothing
 * that tracks an open.
 */

export interface NotificationEmailInput {
  title: string;
  caption: string;
  /** Absolute link to where the notification leads. */
  href: string;
  category: EmailCategory;
  /** Absolute link to the email switches in Settings. */
  settingsUrl: string;
  /** Absolute link that turns this category off. Null for account emails. */
  unsubscribeUrl: string | null;
  /** Running on the Stellar Testnet, where the XLM and USDC are test tokens. */
  practice: boolean;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const CTA: Record<EmailCategory, string> = {
  votes: "Vote now",
  refunds: "Get it back",
  updates: "See the vault",
  reviews: "Review it",
  account: "Open BLKFNDR",
};

const WHY: Record<EmailCategory, string> = {
  votes: "You're getting this because you hold a stake in this vault.",
  refunds: "You're getting this because you hold a stake in this vault.",
  updates: "You're getting this because you hold a stake in this vault or run it.",
  reviews: "You're getting this because you're an admin on BLKFNDR.",
  account: "You're getting this about your own BLKFNDR account.",
};

const PROMISE = "We only email about vaults you're part of and your own account. Never marketing.";

const PRACTICE =
  "Testnet: BLKFNDR runs on the Stellar Testnet, so the XLM and USDC here are test tokens with no real value.";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderNotificationEmail(input: NotificationEmailInput): RenderedEmail {
  const subject = input.title.replace(/[.\s]+$/, "").replace(/\s+/g, " ").slice(0, 200);
  const cta = CTA[input.category];
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const e = escapeHtml;

  const footerLinks = [
    `<a href="${e(input.settingsUrl)}" style="color:#52525b;text-decoration:underline;">Email settings</a>`,
    input.unsubscribeUrl
      ? `<a href="${e(input.unsubscribeUrl)}" style="color:#52525b;text-decoration:underline;">Stop these emails</a>`
      : null,
  ]
    .filter(Boolean)
    .join(" &middot; ");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${e(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${e(input.caption)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f5;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
<tr><td style="padding:0 4px 16px;font-family:${font};font-size:13px;font-weight:700;letter-spacing:0.12em;color:#18181b;">BLKFNDR</td></tr>
<tr><td style="background:#ffffff;border:1px solid #e4e4e7;border-radius:12px;padding:28px 28px 24px;font-family:${font};">
<h1 style="margin:0 0 12px;font-size:20px;line-height:1.35;font-weight:700;color:#18181b;">${e(subject)}</h1>
<p style="margin:0 0 24px;font-size:15px;line-height:1.55;color:#3f3f46;">${e(input.caption)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="border-radius:8px;background:#18181b;">
<a href="${e(input.href)}" style="display:inline-block;padding:12px 20px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${e(cta)}</a>
</td></tr></table>
<p style="margin:20px 0 0;font-size:12px;line-height:1.5;color:#71717a;">Or open this link: <a href="${e(input.href)}" style="color:#52525b;word-break:break-all;">${e(input.href)}</a></p>
${
  input.practice
    ? `<p style="margin:20px 0 0;padding:10px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;font-size:12px;line-height:1.5;color:#78350f;">${e(PRACTICE)}</p>`
    : ""
}
</td></tr>
<tr><td style="padding:16px 4px 0;font-family:${font};font-size:12px;line-height:1.6;color:#71717a;">
${e(WHY[input.category])} ${e(PROMISE)}<br>
${footerLinks}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    subject,
    "",
    input.caption,
    "",
    `${cta}: ${input.href}`,
    ...(input.practice ? ["", PRACTICE] : []),
    "",
    "--",
    `${WHY[input.category]} ${PROMISE}`,
    `Email settings: ${input.settingsUrl}`,
    ...(input.unsubscribeUrl ? [`Stop these emails: ${input.unsubscribeUrl}`] : []),
  ].join("\n");

  return { subject, html, text };
}

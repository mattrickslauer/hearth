/**
 * The shared ZeptoMail SMTP transport.
 *
 * Two callers send mail for different reasons and must not import each other:
 *   • auth.ts    — sign-in OTP codes
 *   • notify.ts  — a fired watch reaching the account's notification email
 *
 * With no ZEPTOMAIL_SMTP_PASS set, `smtp()` returns null and every caller falls back to
 * logging locally + reporting delivered:false — so the flow is testable end-to-end without
 * creds, and nothing is ever reported as delivered when it wasn't.
 *
 * ZeptoMail's SMTP password IS the "send mail token", so the same secret would also work
 * against the HTTP API (Authorization: Zoho-enczapikey <pass>) if a deploy target ever
 * blocks outbound SMTP.
 */

import nodemailer, { type Transporter } from 'nodemailer';

let transporter: Transporter | null = null;

/** The shared transport, or null when no send token is configured (dev/console mode). */
export function smtp(): Transporter | null {
  const pass = process.env.ZEPTOMAIL_SMTP_PASS;
  if (!pass) return null;
  if (!transporter) {
    const port = Number(process.env.ZEPTOMAIL_SMTP_PORT || 465);
    transporter = nodemailer.createTransport({
      host: process.env.ZEPTOMAIL_SMTP_HOST || 'smtp.zeptomail.com',
      port,
      secure: port === 465, // 465 = implicit TLS; 587 = STARTTLS
      auth: { user: process.env.ZEPTOMAIL_SMTP_USER || 'emailapikey', pass },
    });
  }
  return transporter;
}

/** The configured sender identity. */
export function mailFrom(): { address: string; name: string } {
  return {
    address: process.env.ZEPTOMAIL_FROM || 'hearth@agfarms.dev',
    name: process.env.ZEPTOMAIL_FROM_NAME || 'Hearth',
  };
}

/** Validate the SMTP connection/login without sending (nodemailer verify). */
export async function verifyMailer(): Promise<{ ok: boolean; note: string }> {
  const tx = smtp();
  if (!tx) return { ok: false, note: 'no ZEPTOMAIL_SMTP_PASS set (console-fallback mode)' };
  await tx.verify();
  return { ok: true, note: `SMTP ready via ${process.env.ZEPTOMAIL_SMTP_HOST || 'smtp.zeptomail.com'}` };
}

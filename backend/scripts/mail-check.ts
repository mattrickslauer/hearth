/**
 * Live ZeptoMail SMTP check: verify the connection/login, then send one real OTP
 * email. Target address comes from argv[2] (default team@agfarms.dev). No secrets
 * are printed.
 */

import '../src/env.ts';
import { verifyMailer, sendOtpEmail } from '../src/auth.ts';

const to = process.argv[2] || 'team@agfarms.dev';
console.log(`from: ${process.env.ZEPTOMAIL_FROM}  host: ${process.env.ZEPTOMAIL_SMTP_HOST}:${process.env.ZEPTOMAIL_SMTP_PORT}\n`);

const v = await verifyMailer();
console.log(`verify: ok=${v.ok}  ${v.note}`);
if (!v.ok) process.exit(1);

const r = await sendOtpEmail(to, '123456');
console.log(`send to ${to}: delivered=${r.delivered}${r.note ? '  (' + r.note + ')' : ''}`);

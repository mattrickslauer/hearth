/**
 * Passwordless email-OTP auth for Hearth.
 *
 *   POST /auth/request-otp { email }          → emails a 6-digit code (ZeptoMail)
 *   POST /auth/verify-otp  { email, code }     → creates/returns the account + a session token
 *   GET  /auth/me          (Bearer token)      → the current account
 *
 * OTP codes live in a SHORT-LIVED store (TTL ~10 min): in-memory for dev, Tablestore
 * for prod (a NoSQL table with per-row TTL — no cleanup job needed). Codes are stored
 * hashed; verification is attempt-limited and constant-time.
 *
 * Nothing here hardcodes a secret — the ZeptoMail token + sender + session secret come
 * from env, so this runs today (console fallback) and goes live when the key is set.
 */

import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import nodemailer, { type Transporter } from 'nodemailer';

const OTP_TTL_MS = 10 * 60_000; // 10 minutes
const MAX_ATTEMPTS = 5;
const SESSION_TTL_MS = 30 * 24 * 60_000; // 30 days

/* ------------------------------------------------------------------ OTP store */

interface OtpRecord {
  codeHash: string;
  expiresAt: number;
  attempts: number;
}

export interface OtpStore {
  put(email: string, rec: OtpRecord): Promise<void>;
  get(email: string): Promise<OtpRecord | null>;
  bumpAttempts(email: string): Promise<number>;
  del(email: string): Promise<void>;
}

/** Dev / stateless store — a Map with lazy TTL expiry. */
export class MemoryOtpStore implements OtpStore {
  private m = new Map<string, OtpRecord>();
  async put(email: string, rec: OtpRecord) {
    this.m.set(email, rec);
  }
  async get(email: string) {
    const r = this.m.get(email);
    if (!r) return null;
    if (Date.now() > r.expiresAt) {
      this.m.delete(email);
      return null;
    }
    return r;
  }
  async bumpAttempts(email: string) {
    const r = this.m.get(email);
    if (!r) return MAX_ATTEMPTS;
    r.attempts += 1;
    return r.attempts;
  }
  async del(email: string) {
    this.m.delete(email);
  }
}

/**
 * Tablestore OTP store — a `auth_otp` table keyed by email, with a TTL so codes
 * self-expire (the "short-lived NoSQL setup"). Wired once an Alibaba Tablestore
 * instance exists (endpoint + instance name + ALI keys). Until then, memory is used.
 *
 * Table: PK [ email:STRING ]; attrs [ codeHash:STRING, expiresAt:INTEGER, attempts:INTEGER ].
 * Set the table's time-to-live to ~1 day (a floor; we also enforce OTP_TTL_MS in code).
 */
export async function createTablestoreOtpStore(): Promise<OtpStore> {
  throw new Error(
    'Tablestore OTP store not provisioned. Create a Tablestore instance (TABLESTORE_ENDPOINT/INSTANCE + ALI_ keys) ' +
      'and implement createTablestoreOtpStore(); until then HEARTH_OTP_STORE defaults to memory.',
  );
}

export async function makeOtpStore(): Promise<OtpStore> {
  if (process.env.HEARTH_OTP_STORE === 'tablestore') return createTablestoreOtpStore();
  return new MemoryOtpStore();
}

/* --------------------------------------------------------------- account store */

export interface Account {
  id: string;
  email: string;
  createdAt: number;
  lastLoginAt: number;
}

export interface AccountStore {
  upsertByEmail(email: string): Promise<Account>;
  getById(id: string): Promise<Account | null>;
}

let acctSeq = 0;
export class MemoryAccountStore implements AccountStore {
  private byEmail = new Map<string, Account>();
  private byId = new Map<string, Account>();
  async upsertByEmail(email: string): Promise<Account> {
    const now = Date.now();
    const existing = this.byEmail.get(email);
    if (existing) {
      existing.lastLoginAt = now;
      return existing;
    }
    const acct: Account = { id: `acct-${now.toString(36)}-${(acctSeq += 1)}`, email, createdAt: now, lastLoginAt: now };
    this.byEmail.set(email, acct);
    this.byId.set(acct.id, acct);
    return acct;
  }
  async getById(id: string): Promise<Account | null> {
    return this.byId.get(id) ?? null;
  }
}

/* ---------------------------------------------------------------- code + hash */

const sessionSecret = () => process.env.AUTH_SESSION_SECRET || 'hearth-dev-secret-change-me';

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  // deliberately permissive but structural
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

function hashCode(email: string, code: string): string {
  return createHmac('sha256', sessionSecret()).update(`${email}:${code}`).digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/* ------------------------------------------------------------------- sessions */

interface SessionPayload {
  sub: string; // account id
  email: string;
  iat: number;
  exp: number;
}

function b64url(s: string): string {
  return Buffer.from(s).toString('base64url');
}

export function issueSession(acct: Account): string {
  const payload: SessionPayload = { sub: acct.id, email: acct.email, iat: Date.now(), exp: Date.now() + SESSION_TTL_MS };
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', sessionSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifySession(token: string | undefined): SessionPayload | null {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', sessionSecret()).update(body).digest('base64url');
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------- email (Zepto) */

/**
 * Send the OTP via ZeptoMail over SMTP (smtp.zeptomail.com). With no SMTP password
 * set it logs the code to the server console (dev) and reports delivered:false, so
 * the flow is testable end-to-end without creds. Set ZEPTOMAIL_SMTP_PASS to go live.
 *
 * ZeptoMail's SMTP password IS the "send mail token", so the same secret would also
 * work against the HTTP API (Authorization: Zoho-enczapikey <pass>) if a deploy
 * target ever blocks outbound SMTP.
 */
let transporter: Transporter | null = null;
function smtp(): Transporter | null {
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

export async function sendOtpEmail(email: string, code: string): Promise<{ delivered: boolean; note?: string }> {
  const from = process.env.ZEPTOMAIL_FROM || 'hearth@agfarms.dev';
  const fromName = process.env.ZEPTOMAIL_FROM_NAME || 'Hearth';
  const tx = smtp();

  if (!tx) {
    console.log(`[auth] DEV: OTP for ${email} = ${code} (set ZEPTOMAIL_SMTP_PASS to actually email)`);
    return { delivered: false, note: 'no ZEPTOMAIL_SMTP_PASS — code logged to server console (dev mode)' };
  }

  await tx.sendMail({
    from: { address: from, name: fromName },
    to: email,
    subject: 'Your Hearth sign-in code',
    text: `Your Hearth sign-in code is ${code}. It expires in 10 minutes.`,
    html: `<div style="font-family:system-ui,sans-serif"><p>Your Hearth sign-in code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p><p style="color:#888">Expires in 10 minutes. If you didn't request this, ignore it.</p></div>`,
  });
  return { delivered: true };
}

/** Validate the SMTP connection/login without sending (nodemailer verify). */
export async function verifyMailer(): Promise<{ ok: boolean; note: string }> {
  const tx = smtp();
  if (!tx) return { ok: false, note: 'no ZEPTOMAIL_SMTP_PASS set (console-fallback mode)' };
  await tx.verify();
  return { ok: true, note: `SMTP ready via ${process.env.ZEPTOMAIL_SMTP_HOST || 'smtp.zeptomail.com'}` };
}

/* ---------------------------------------------------------------- the service */

export interface AuthDeps {
  otp: OtpStore;
  accounts: AccountStore;
}

/** Request an OTP. Always returns ok (don't leak whether an email is registered). */
export async function requestOtp(deps: AuthDeps, rawEmail: unknown): Promise<{ ok: boolean; delivered: boolean; note?: string }> {
  const email = normalizeEmail(rawEmail);
  if (!email) return { ok: false, delivered: false, note: 'invalid email' };
  const code = generateCode();
  await deps.otp.put(email, { codeHash: hashCode(email, code), expiresAt: Date.now() + OTP_TTL_MS, attempts: 0 });
  const sent = await sendOtpEmail(email, code);
  return { ok: true, ...sent };
}

/** Verify an OTP → create/return the account + a session token. */
export async function verifyOtp(
  deps: AuthDeps,
  rawEmail: unknown,
  rawCode: unknown,
): Promise<{ ok: boolean; token?: string; account?: Account; error?: string }> {
  const email = normalizeEmail(rawEmail);
  const code = typeof rawCode === 'string' ? rawCode.trim() : '';
  if (!email || !/^\d{6}$/.test(code)) return { ok: false, error: 'invalid email or code' };

  const rec = await deps.otp.get(email);
  if (!rec) return { ok: false, error: 'code expired or not found — request a new one' };
  if (rec.attempts >= MAX_ATTEMPTS) {
    await deps.otp.del(email);
    return { ok: false, error: 'too many attempts — request a new code' };
  }
  if (!safeEqualHex(rec.codeHash, hashCode(email, code))) {
    const n = await deps.otp.bumpAttempts(email);
    return { ok: false, error: `incorrect code (${MAX_ATTEMPTS - n} attempts left)` };
  }
  await deps.otp.del(email); // one-time use
  const account = await deps.accounts.upsertByEmail(email);
  return { ok: true, token: issueSession(account), account };
}

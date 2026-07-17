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
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { mailFrom, smtp } from './mailer';
import { RateLimiter } from './ratelimit';
import { ensureTable, getTablestore, tsDeleteRow, tsGetRow, tsPutRow, tsUpdatePut } from './tablestore';

// The SMTP transport moved to ./mailer so notify.ts can send mail without importing auth.
// Re-exported here because scripts/mail-check.ts (and any older caller) imports it from auth.
export { verifyMailer } from './mailer';

const OTP_TTL_MS = 10 * 60_000; // 10 minutes
const MAX_ATTEMPTS = 5;
// 7 days (JWT exp, in seconds per RFC 7519). This is a low-risk cap only: because sessions are
// stateless JWTs there is no revocation before exp, so a shorter TTL bounds the blast radius of a
// leaked token. The real fix is a refresh-token + httpOnly-cookie flow (short-lived access token,
// server-side revocable refresh) — out of scope here; see the session security note below.
const SESSION_TTL_SEC = 7 * 24 * 60 * 60;

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
const OTP_TABLE = 'auth_otp';

/** Tablestore-backed OTP store — one shared table so codes survive restarts and are
 *  visible across FC instances (request-otp and verify-otp may hit different ones). */
class TablestoreOtpStore implements OtpStore {
  async put(email: string, rec: OtpRecord): Promise<void> {
    await ensureAuthTables();
    await tsPutRow(OTP_TABLE, { email }, { codeHash: rec.codeHash, expiresAt: rec.expiresAt, attempts: rec.attempts });
  }
  async get(email: string): Promise<OtpRecord | null> {
    await ensureAuthTables();
    const row = await tsGetRow(OTP_TABLE, { email });
    if (!row) return null;
    const rec: OtpRecord = {
      codeHash: String(row.codeHash),
      expiresAt: Number(row.expiresAt),
      attempts: Number(row.attempts),
    };
    // Lazy expiry (mirrors MemoryOtpStore); the table's TTL is the backstop cleanup.
    if (Date.now() > rec.expiresAt) {
      await tsDeleteRow(OTP_TABLE, { email });
      return null;
    }
    return rec;
  }
  async bumpAttempts(email: string): Promise<number> {
    const row = await tsGetRow(OTP_TABLE, { email });
    if (!row) return MAX_ATTEMPTS;
    const attempts = Number(row.attempts) + 1;
    await tsUpdatePut(OTP_TABLE, { email }, { attempts });
    return attempts;
  }
  async del(email: string): Promise<void> {
    await tsDeleteRow(OTP_TABLE, { email });
  }
}

export async function createTablestoreOtpStore(): Promise<OtpStore> {
  // Build the client eagerly so a misconfigured deploy fails loud at boot, not on
  // the first OTP request.
  await getTablestore();
  return new TablestoreOtpStore();
}

export async function makeOtpStore(): Promise<OtpStore> {
  const mode = process.env.HEARTH_OTP_STORE || process.env.HEARTH_STORE;
  if (mode === 'tablestore') return createTablestoreOtpStore();
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

/**
 * File-backed account store — persists accounts to a JSON file so they survive a
 * backend restart (local dev). Atomic temp-write + rename on every change. Same FC
 * caveat as FileStore: use Tablestore/a hosted DB for production durability.
 */
export class FileAccountStore implements AccountStore {
  private byEmail = new Map<string, Account>();
  private byId = new Map<string, Account>();
  private constructor(private readonly file: string) {}

  static open(file: string): FileAccountStore {
    const s = new FileAccountStore(file);
    if (existsSync(file)) {
      try {
        for (const a of JSON.parse(readFileSync(file, 'utf8')) as Account[]) {
          s.byEmail.set(a.email, a);
          s.byId.set(a.id, a);
        }
      } catch {
        /* corrupt/empty file → start fresh */
      }
    }
    return s;
  }

  private persist(): void {
    const dir = dirname(this.file);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify([...this.byId.values()]));
    renameSync(tmp, this.file);
  }

  async upsertByEmail(email: string): Promise<Account> {
    const now = Date.now();
    const existing = this.byEmail.get(email);
    if (existing) {
      existing.lastLoginAt = now;
      this.persist();
      return existing;
    }
    const acct: Account = { id: `acct-${now.toString(36)}-${(acctSeq += 1)}`, email, createdAt: now, lastLoginAt: now };
    this.byEmail.set(email, acct);
    this.byId.set(acct.id, acct);
    this.persist();
    return acct;
  }
  async getById(id: string): Promise<Account | null> {
    return this.byId.get(id) ?? null;
  }
}

const ACCOUNTS_TABLE = 'accounts'; // PK [id:STRING] → email, createdAt, lastLoginAt
const ACCOUNT_EMAIL_TABLE = 'account_email'; // PK [email:STRING] → id  (email→id lookup)

// Auto-create the three auth tables on first Tablestore use (idempotent), so flipping
// HEARTH_ACCOUNT_STORE/HEARTH_OTP_STORE to `tablestore` can't fail on a missing table.
let authTablesReady: Promise<void> | null = null;
function ensureAuthTables(): Promise<void> {
  if (!authTablesReady) {
    authTablesReady = Promise.all([
      ensureTable(ACCOUNTS_TABLE, ['id']),
      ensureTable(ACCOUNT_EMAIL_TABLE, ['email']),
      ensureTable(OTP_TABLE, ['email']),
    ]).then(() => undefined);
    // If creation rejects, clear the cache so the next call retries rather than
    // replaying a poisoned rejected promise for the life of the instance.
    void authTablesReady.catch(() => {
      authTablesReady = null;
    });
  }
  return authTablesReady;
}

/**
 * Tablestore-backed account store — the production home for signups. Two tables so
 * both access patterns are single-row gets (no scans): `accounts` keyed by id (the
 * hot path — GET /auth/me on every authed request) and `account_email` keyed by
 * email (login lookup). A brand-new email logging in twice concurrently across FC
 * instances could create two `accounts` rows; last write to `account_email` wins and
 * the loser is an unreferenced orphan (harmless). Ids carry random entropy so they
 * don't collide across instances even within the same millisecond.
 */
export class TablestoreAccountStore implements AccountStore {
  async upsertByEmail(email: string): Promise<Account> {
    await ensureAuthTables();
    const now = Date.now();
    const idx = await tsGetRow(ACCOUNT_EMAIL_TABLE, { email });
    if (idx?.id) {
      const id = String(idx.id);
      const row = await tsGetRow(ACCOUNTS_TABLE, { id });
      if (row) {
        await tsUpdatePut(ACCOUNTS_TABLE, { id }, { lastLoginAt: now });
        return { id, email, createdAt: Number(row.createdAt), lastLoginAt: now };
      }
      // Index points at a missing account row → fall through and recreate.
    }
    const id = `acct-${now.toString(36)}-${randomInt(0x1000000).toString(36)}`;
    await tsPutRow(ACCOUNTS_TABLE, { id }, { email, createdAt: now, lastLoginAt: now });
    await tsPutRow(ACCOUNT_EMAIL_TABLE, { email }, { id });
    return { id, email, createdAt: now, lastLoginAt: now };
  }
  async getById(id: string): Promise<Account | null> {
    await ensureAuthTables();
    const row = await tsGetRow(ACCOUNTS_TABLE, { id });
    if (!row) return null;
    return { id, email: String(row.email), createdAt: Number(row.createdAt), lastLoginAt: Number(row.lastLoginAt) };
  }
}

/** Pick the account store from env: tablestore → prod durability, file → persisted
 *  local dev, else in-memory (lost on restart). */
export function makeAccountStore(): AccountStore {
  const mode = process.env.HEARTH_ACCOUNT_STORE || process.env.HEARTH_STORE;
  if (mode === 'tablestore') return new TablestoreAccountStore();
  if (mode === 'file') {
    const dir = process.env.HEARTH_DATA_DIR || join(process.cwd(), '.data');
    return FileAccountStore.open(join(dir, 'accounts.json'));
  }
  return new MemoryAccountStore();
}

/* ---------------------------------------------------------------- code + hash */

/**
 * The HMAC key for session tokens (and OTP hashing). There is NO fallback default:
 * an unset or weak secret would let anyone forge session tokens for any account, so
 * we fail loud instead. The same secret is used in dev and prod — set it once in a
 * gitignored .env (loaded by src/env.ts locally) and reference it in the deploy env
 * (see s.yaml / backend/README.md).
 */
function sessionSecret(): string {
  const s = process.env.AUTH_SESSION_SECRET;
  if (typeof s !== 'string' || s.length < 16) {
    throw new Error(
      'AUTH_SESSION_SECRET is required (>=16 chars). Set it in backend/.env for local dev ' +
        'and in the deploy env before deploying — see backend/README.md.',
    );
  }
  return s;
}

/** Fail fast at startup if the session secret is missing/weak, rather than on first login. */
export function assertAuthConfig(): void {
  sessionSecret(); // throws when AUTH_SESSION_SECRET is unset or too short
}

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

/**
 * Session tokens are stateless HS256 JWTs (RFC 7519): base64url(header).base64url(payload).sig.
 *
 * Security properties enforced on verify:
 *   - We ALWAYS verify with HS256 keyed by AUTH_SESSION_SECRET; we never let the
 *     token's own header pick the algorithm. Plus we assert header.alg === 'HS256',
 *     so `alg:none` and RS/HS confusion forgeries are rejected.
 *   - The signature is checked (constant-time) BEFORE any claim is trusted.
 *   - iss/aud are pinned, exp is enforced, sub must be a non-empty string.
 *
 * Stateless ⇒ no revocation before exp; keep the TTL bounded and rotate the secret
 * to invalidate everything at once. The client also self-expires on exp (see the app).
 */
const JWT_ISS = 'hearth';
const JWT_AUD = 'hearth-app';
const JWT_AUD_HUB = 'hearth-hub'; // audience for hub (edge-agent) tokens — a distinct identity
const JWT_AUD_WS = 'hearth-ws'; // audience for realtime WebSocket register tickets
const JWT_HEADER = { alg: 'HS256', typ: 'JWT' } as const;
const HUB_TOKEN_TTL_SEC = 180 * 24 * 60 * 60; // 180 days; revocation is via the hub-record check on heartbeat
const WS_TICKET_TTL_SEC = 90; // realtime tickets are single-use-ish and short — just long enough to connect + register

declare const accountIdBrand: unique symbol;
/**
 * An account id that came from a VERIFIED token — the tenant boundary, in the type system.
 *
 * It is a plain string at runtime, but nothing outside this module can produce one: there is no
 * exported mint, so the only sources are verifySession / verifyHubToken below. Storage keyed by
 * tenant asks for this type rather than `string` (see oss.ts framesFor), which is what makes
 * "read another account's data" unwriteable rather than merely discouraged — a caller-supplied
 * `args.input`, a hub id, or a swapped argument is a `string` and will not compile.
 *
 * It widens to string implicitly, so everything downstream that takes a `string` keeps working;
 * only the reverse is blocked, and only where the brand is demanded.
 */
export type AccountId = string & { readonly [accountIdBrand]: 'AccountId' };

interface SessionPayload {
  sub: AccountId; // account id
  email: string;
  iat: number; // issued-at (seconds since epoch)
  exp: number; // expiry (seconds since epoch)
}

export interface HubTokenPayload {
  sub: string; // hub id
  acc: AccountId; // account id the hub is bound to
  iat: number;
  exp: number;
}

function b64urlJson(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function signHs256(signingInput: string): string {
  return createHmac('sha256', sessionSecret()).update(signingInput).digest('base64url');
}

/** Sign an arbitrary claim set as an HS256 JWT with our pinned header. */
function issueJwt(claims: Record<string, unknown>): string {
  const header = b64urlJson(JWT_HEADER);
  const payload = b64urlJson({ iss: JWT_ISS, ...claims });
  const signingInput = `${header}.${payload}`;
  return `${signingInput}.${signHs256(signingInput)}`;
}

/**
 * Verify a token's signature + header + iss/aud/exp, returning the raw claims on
 * success. Shared by session and hub verification so both get identical hardening:
 * integrity checked (constant-time) BEFORE claims, algorithm pinned, exp enforced.
 */
function verifyJwt(token: string | undefined, aud: string): Record<string, unknown> | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sig] = parts;

  // 1) integrity first — constant-time HMAC over header.payload, always HS256.
  const expected = signHs256(`${headerB64}.${payloadB64}`);
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null;
  }

  try {
    // 2) pin the algorithm (defence-in-depth against alg:none / alg confusion).
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (header.alg !== JWT_HEADER.alg || header.typ !== JWT_HEADER.typ) return null;

    // 3) issuer / audience / expiry.
    const p = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (p.iss !== JWT_ISS || p.aud !== aud) return null;
    if (typeof p.exp !== 'number' || Math.floor(Date.now() / 1000) >= p.exp) return null;
    return p;
  } catch {
    return null;
  }
}

export function issueSession(acct: Account): string {
  const now = Math.floor(Date.now() / 1000);
  return issueJwt({ sub: acct.id, email: acct.email, aud: JWT_AUD, iat: now, exp: now + SESSION_TTL_SEC });
}

export function verifySession(token: string | undefined): SessionPayload | null {
  const p = verifyJwt(token, JWT_AUD);
  if (!p) return null;
  if (typeof p.sub !== 'string' || !p.sub) return null;
  return {
    // One of only two places an AccountId is minted, and it is downstream of a verified signature.
    sub: p.sub as AccountId,
    email: typeof p.email === 'string' ? p.email : '',
    iat: typeof p.iat === 'number' ? p.iat : 0,
    exp: p.exp as number,
  };
}

/** A long-lived credential a paired hub presents on every heartbeat / uplink. */
export function issueHubToken(hubId: string, accountId: string): string {
  const now = Math.floor(Date.now() / 1000);
  return issueJwt({ sub: hubId, acc: accountId, aud: JWT_AUD_HUB, iat: now, exp: now + HUB_TOKEN_TTL_SEC });
}

export function verifyHubToken(token: string | undefined): HubTokenPayload | null {
  const p = verifyJwt(token, JWT_AUD_HUB);
  if (!p) return null;
  if (typeof p.sub !== 'string' || !p.sub) return null;
  if (typeof p.acc !== 'string' || !p.acc) return null;
  // The other mint point. `sub` is the HUB id and stays a plain string on purpose — passing it
  // where an account is expected is exactly the confusion the brand exists to reject.
  return { sub: p.sub, acc: p.acc as AccountId, iat: typeof p.iat === 'number' ? p.iat : 0, exp: p.exp as number };
}

/** Keyed HMAC-SHA256 (hex) over an arbitrary string — used to store enrollment-token hashes. */
export function hmacHex(input: string): string {
  return createHmac('sha256', sessionSecret()).update(input).digest('hex');
}

/**
 * Signing key for realtime WebSocket tickets. Distinct from the session secret so the relay
 * (which verifies these tickets) holds only a scoped, relay-specific key rather than the key
 * that signs user sessions — a compromised relay can't mint a session.
 *
 * ONE name, no fallback. This used to fall back to sessionSecret(), and relay.mjs mirrored the
 * fallback, so the same secret answered to both RELAY_TICKET_SECRET and AUTH_SESSION_SECRET.
 * With one side's explicit var set and the other's not, each picked a different key and every
 * handshake 401'd with nothing in the logs explaining it. Realtime is gated on relayConfig(),
 * which requires this var, so an unset key means realtime is reported off rather than issuing
 * tickets nothing can verify.
 */
function wsTicketSecret(): string {
  const s = process.env.RELAY_TICKET_SECRET;
  if (!s) throw new Error('RELAY_TICKET_SECRET is required to issue realtime tickets');
  return s;
}

/**
 * A short-lived (90s) ticket the browser presents to the relay when opening its WebSocket
 * (as the `?ticket=` query param). The relay verifies it with the same RELAY_TICKET_SECRET
 * and joins the socket to `sub`'s channel — so no long-lived credential ever reaches the
 * browser. Bound to a specific hub for clarity/auditing.
 */
export function issueWsTicket(accountId: string, hubId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64urlJson(JWT_HEADER);
  const payload = b64urlJson({ iss: JWT_ISS, sub: accountId, hub: hubId, aud: JWT_AUD_WS, iat: now, exp: now + WS_TICKET_TTL_SEC });
  const signingInput = `${header}.${payload}`;
  const sig = createHmac('sha256', wsTicketSecret()).update(signingInput).digest('base64url');
  return `${signingInput}.${sig}`;
}

/* --------------------------------------------------------------- email (Zepto) */

/**
 * Send the OTP via ZeptoMail over SMTP (see ./mailer). With no SMTP password set it logs
 * the code to the server console (dev) and reports delivered:false, so the flow is testable
 * end-to-end without creds. Set ZEPTOMAIL_SMTP_PASS to go live.
 */
export async function sendOtpEmail(email: string, code: string): Promise<{ delivered: boolean; note?: string }> {
  const tx = smtp();

  if (!tx) {
    console.log(`[auth] DEV: OTP for ${email} = ${code} (set ZEPTOMAIL_SMTP_PASS to actually email)`);
    return { delivered: false, note: 'no ZEPTOMAIL_SMTP_PASS — code logged to server console (dev mode)' };
  }

  await tx.sendMail({
    from: mailFrom(),
    to: email,
    subject: 'Your Hearth sign-in code',
    text: `Your Hearth sign-in code is ${code}. It expires in 10 minutes.`,
    html: `<div style="font-family:system-ui,sans-serif"><p>Your Hearth sign-in code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p><p style="color:#888">Expires in 10 minutes. If you didn't request this, ignore it.</p></div>`,
  });
  return { delivered: true };
}

/* --------------------------------------------------------------- rate limiting */

// A given email may be sent at most 5 codes / 15 min; a given client IP at most 30 / 15 min.
const emailOtpLimiter = new RateLimiter(5, 15 * 60_000);
const ipOtpLimiter = new RateLimiter(30, 15 * 60_000);

/* ---------------------------------------------------------------- the service */

export interface AuthDeps {
  otp: OtpStore;
  accounts: AccountStore;
}

/**
 * Request an OTP. Always returns ok (don't leak whether an email is registered).
 * Rate-limited per email and per client IP; over the limit we silently skip the
 * send and return the same positive shape (no oracle) rather than emailing.
 */
export async function requestOtp(
  deps: AuthDeps,
  rawEmail: unknown,
  opts: { ip?: string } = {},
): Promise<{ ok: boolean; delivered: boolean; note?: string }> {
  const email = normalizeEmail(rawEmail);
  if (!email) return { ok: false, delivered: false, note: 'invalid email' };
  if (opts.ip && !ipOtpLimiter.allow(opts.ip)) return { ok: true, delivered: false };
  if (!emailOtpLimiter.allow(email)) return { ok: true, delivered: false };
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

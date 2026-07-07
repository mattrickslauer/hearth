/**
 * Hub pairing — binding a physical edge hub (a Raspberry Pi) to an account.
 *
 * Flow (device-initiated claim code — see docs/00-capabilities.md C11):
 *   1. POST /hub/enroll   { enrollToken }  → hub self-registers, unclaimed. We mint a
 *                                            short single-use CLAIM CODE and return it;
 *                                            the hub prints it to its console.
 *   2. POST /hub/claim    { claimCode }     (user session) → binds the hub to the account.
 *   3. POST /hub/poll     { hubId, enrollToken } → once claimed, returns a long-lived
 *                                            HUB TOKEN. The hub stores it and stops polling.
 *   4. POST /hub/heartbeat (hub token)      → liveness; also the revocation checkpoint
 *                                            (a hub deleted/unpaired since is rejected here).
 *
 * Security model: the claim code is short and rate-limited, but on its own it only lets a
 * caller BIND a hub to their OWN account — it never yields the hub token. Only the holder
 * of the secret `enrollToken` (baked onto the hub) can redeem the token via /hub/poll. So a
 * guessed claim code is low-value, and the TTL + single-use + rate limit make it impractical.
 *
 * Persistence: the hub registry is GLOBAL (claim-code lookup happens before we know the
 * account), so it's a single store — memory for dev, one JSON file (.data/hubs.json) with
 * HEARTH_STORE=file, mirroring the account store. Tablestore is the production target.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomBytes, randomInt } from 'node:crypto';
import { dirname, join } from 'node:path';

import { hmacHex, issueHubToken, verifyHubToken } from './auth';
import { HOME_TABLE, ensureHomeTable, tsDeleteRow, tsGetRange, tsGetRow, tsPutRow } from './tablestore';

/** A hub is "online" if we've heard a heartbeat within this window (heartbeat cadence ~30s). */
export const HUB_ONLINE_WINDOW_MS = 90_000;
const CLAIM_CODE_TTL_MS = 15 * 60_000; // 15 minutes
/** Unambiguous alphabet for claim codes — no O/0, I/1, etc. */
const CLAIM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface Hub {
  id: string;
  accountId: string | null; // null until claimed
  name: string;
  enrollTokenHash: string; // HMAC of the device's secret enrollment token
  claimCode: string | null; // present while unclaimed; cleared on claim
  claimExpiresAt: number | null;
  status: 'unclaimed' | 'claimed';
  createdAt: number;
  lastSeenAt: number | null;
  fw?: string;
}

/** Account-facing view of a hub — never leaks the enroll hash or claim code. */
export interface HubView {
  id: string;
  name: string;
  status: Hub['status'];
  online: boolean;
  lastSeenAt: number | null;
  createdAt: number;
  fw?: string;
}

export function hubView(h: Hub, now: number): HubView {
  return {
    id: h.id,
    name: h.name,
    status: h.status,
    online: h.lastSeenAt != null && now - h.lastSeenAt <= HUB_ONLINE_WINDOW_MS,
    lastSeenAt: h.lastSeenAt,
    createdAt: h.createdAt,
    fw: h.fw,
  };
}

export interface HubStore {
  create(hub: Hub): Promise<void>;
  getById(id: string): Promise<Hub | null>;
  getByClaimCode(code: string): Promise<Hub | null>;
  listByAccount(accountId: string): Promise<Hub[]>;
  save(hub: Hub): Promise<void>;
  remove(id: string): Promise<void>;
  /** Drop unclaimed hubs whose claim code has expired. Returns how many were removed. */
  purgeExpiredUnclaimed(now: number): Promise<number>;
}

class MemoryHubStore implements HubStore {
  protected byId = new Map<string, Hub>();

  async create(hub: Hub) {
    this.byId.set(hub.id, hub);
    this.persist();
  }
  async getById(id: string) {
    return this.byId.get(id) ?? null;
  }
  async getByClaimCode(code: string) {
    const now = Date.now();
    for (const h of this.byId.values()) {
      if (h.claimCode && h.claimCode === code && (h.claimExpiresAt ?? 0) > now) return h;
    }
    return null;
  }
  async listByAccount(accountId: string) {
    return [...this.byId.values()].filter((h) => h.accountId === accountId);
  }
  async save(hub: Hub) {
    this.byId.set(hub.id, hub);
    this.persist();
  }
  async remove(id: string) {
    this.byId.delete(id);
    this.persist();
  }
  async purgeExpiredUnclaimed(now: number): Promise<number> {
    let removed = 0;
    for (const [id, h] of this.byId) {
      if (h.status === 'unclaimed' && (h.claimExpiresAt ?? 0) <= now) {
        this.byId.delete(id);
        removed += 1;
      }
    }
    if (removed) this.persist();
    return removed;
  }

  protected persist(): void {}
}

/** File-backed registry — atomic temp-write + rename on every mutation (local dev). */
class FileHubStore extends MemoryHubStore {
  private constructor(private readonly file: string) {
    super();
  }

  static open(file: string): FileHubStore {
    const s = new FileHubStore(file);
    if (existsSync(file)) {
      try {
        for (const h of JSON.parse(readFileSync(file, 'utf8')) as Hub[]) s.byId.set(h.id, h);
      } catch {
        /* corrupt/empty → start fresh */
      }
    }
    return s;
  }

  protected persist(): void {
    const dir = dirname(this.file);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify([...this.byId.values()]));
    renameSync(tmp, this.file);
  }
}

/**
 * Tablestore-backed hub registry — the production home for pairings, so a backend redeploy
 * (which wipes in-memory state) no longer unpairs every hub. The registry is GLOBAL (claim
 * lookup happens before we know the account), so every hub is a row in a reserved partition
 * of the shared table: PK (account="_hubs", sk="h#<hubId>"), the whole Hub JSON in `data`.
 *
 * getById is a single-row get (the hot path — every heartbeat/sync re-checks the record).
 * getByClaimCode and listByAccount scan the (tiny) `_hubs` partition; a handful of hubs makes
 * a full partition sweep cheaper than maintaining secondary-index rows and their consistency.
 */
const HUBS_PARTITION = '_hubs';
const hubSk = (id: string) => `h#${id}`;

class TablestoreHubStore implements HubStore {
  private async all(): Promise<Hub[]> {
    const rows = await tsGetRange(HOME_TABLE, { account: HUBS_PARTITION, sk: 'h#' }, { account: HUBS_PARTITION, sk: 'h$' });
    const out: Hub[] = [];
    for (const r of rows) {
      if (typeof r.attrs.data === 'string') {
        try {
          out.push(JSON.parse(r.attrs.data) as Hub);
        } catch {
          /* skip a corrupt row */
        }
      }
    }
    return out;
  }
  async create(hub: Hub): Promise<void> {
    await ensureHomeTable();
    await tsPutRow(HOME_TABLE, { account: HUBS_PARTITION, sk: hubSk(hub.id) }, { data: JSON.stringify(hub) });
  }
  async getById(id: string): Promise<Hub | null> {
    const row = await tsGetRow(HOME_TABLE, { account: HUBS_PARTITION, sk: hubSk(id) });
    if (!row || typeof row.data !== 'string') return null;
    try {
      return JSON.parse(row.data) as Hub;
    } catch {
      return null;
    }
  }
  async getByClaimCode(code: string): Promise<Hub | null> {
    const now = Date.now();
    for (const h of await this.all()) {
      if (h.claimCode && h.claimCode === code && (h.claimExpiresAt ?? 0) > now) return h;
    }
    return null;
  }
  async listByAccount(accountId: string): Promise<Hub[]> {
    return (await this.all()).filter((h) => h.accountId === accountId);
  }
  async save(hub: Hub): Promise<void> {
    await tsPutRow(HOME_TABLE, { account: HUBS_PARTITION, sk: hubSk(hub.id) }, { data: JSON.stringify(hub) });
  }
  async remove(id: string): Promise<void> {
    await tsDeleteRow(HOME_TABLE, { account: HUBS_PARTITION, sk: hubSk(id) });
  }
  async purgeExpiredUnclaimed(now: number): Promise<number> {
    let removed = 0;
    for (const h of await this.all()) {
      if (h.status === 'unclaimed' && (h.claimExpiresAt ?? 0) <= now) {
        await tsDeleteRow(HOME_TABLE, { account: HUBS_PARTITION, sk: hubSk(h.id) });
        removed += 1;
      }
    }
    return removed;
  }
}

let hubStore: HubStore | null = null;
export function getHubStore(): HubStore {
  if (!hubStore) {
    const mode = process.env.HEARTH_ACCOUNT_STORE || process.env.HEARTH_STORE;
    if (mode === 'tablestore') {
      hubStore = new TablestoreHubStore();
    } else if (mode === 'file') {
      const dir = process.env.HEARTH_DATA_DIR || join(process.cwd(), '.data');
      hubStore = FileHubStore.open(join(dir, 'hubs.json'));
    } else {
      hubStore = new MemoryHubStore();
    }
  }
  return hubStore;
}

/* ----------------------------------------------------------------- rate limiting */

class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private max: number, private windowMs: number) {}
  allow(key: string): boolean {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const arr = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    // Evict only fully-expired keys — a wholesale clear() could be forced (spoof many
    // distinct IPs) to reset everyone's enroll/claim limit at once.
    if (this.hits.size > 50_000) this.sweep(cutoff);
    if (arr.length >= this.max) {
      this.hits.set(key, arr);
      return false;
    }
    arr.push(now);
    this.hits.set(key, arr);
    return true;
  }

  private sweep(cutoff: number): void {
    for (const [k, times] of this.hits) {
      if (times.length === 0 || times[times.length - 1] <= cutoff) this.hits.delete(k);
    }
  }
}

// Blunt enroll spam per IP, and claim-code guessing per account.
const enrollLimiter = new RateLimiter(20, 15 * 60_000);
const claimLimiter = new RateLimiter(10, 15 * 60_000);

// Opportunistic GC so never-claimed hubs (each /hub/enroll persists one) don't
// accumulate forever. Throttled so a burst of enrolls triggers at most one sweep/min.
let lastPurgeAt = 0;
const PURGE_INTERVAL_MS = 60_000;

/* ---------------------------------------------------------------------- helpers */

let hubSeq = 0;
function newHubId(): string {
  return `hub-${Date.now().toString(36)}-${(hubSeq += 1)}`;
}

function newClaimCode(): string {
  let out = '';
  for (let i = 0; i < 8; i++) out += CLAIM_ALPHABET[randomInt(0, CLAIM_ALPHABET.length)];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

function normalizeClaimCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const c = raw.trim().toUpperCase().replace(/[\s-]/g, '');
  if (!/^[A-Z0-9]{8}$/.test(c)) return null;
  return `${c.slice(0, 4)}-${c.slice(4)}`;
}

/* ------------------------------------------------------------------ the service */

export interface EnrollResult {
  ok: boolean;
  hubId?: string;
  claimCode?: string;
  claimExpiresAt?: number;
  pollAfterMs?: number;
  error?: string;
}

/**
 * A hub self-registers with a device-generated secret `enrollToken` (32+ random bytes it
 * keeps forever). We store only its HMAC. Returns a fresh claim code for the user to enter.
 */
export async function enrollHub(
  body: Record<string, unknown>,
  opts: { ip?: string } = {},
): Promise<EnrollResult> {
  if (opts.ip && !enrollLimiter.allow(opts.ip)) return { ok: false, error: 'rate limited — try again shortly' };
  const enrollToken = typeof body.enrollToken === 'string' ? body.enrollToken.trim() : '';
  if (enrollToken.length < 16) return { ok: false, error: 'enrollToken required (>=16 chars)' };

  const now = Date.now();
  if (now - lastPurgeAt > PURGE_INTERVAL_MS) {
    lastPurgeAt = now;
    void getHubStore()
      .purgeExpiredUnclaimed(now)
      .catch(() => {});
  }
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 60) : 'Hearth hub';
  const hub: Hub = {
    id: newHubId(),
    accountId: null,
    name,
    enrollTokenHash: hmacHex(enrollToken),
    claimCode: newClaimCode(),
    claimExpiresAt: now + CLAIM_CODE_TTL_MS,
    status: 'unclaimed',
    createdAt: now,
    lastSeenAt: now,
    fw: typeof body.fw === 'string' ? body.fw.slice(0, 40) : undefined,
  };
  await getHubStore().create(hub);
  return { ok: true, hubId: hub.id, claimCode: hub.claimCode!, claimExpiresAt: hub.claimExpiresAt!, pollAfterMs: 3000 };
}

export interface PollResult {
  ok: boolean;
  status?: Hub['status'];
  hubToken?: string;
  accountId?: string;
  name?: string;
  error?: string;
}

/**
 * The hub polls with (hubId, enrollToken). While unclaimed we say so; once a user has
 * claimed it we hand back a long-lived hub token. The enrollToken proves it's the same
 * device that enrolled — this is the only path that yields a token.
 */
export async function pollHub(body: Record<string, unknown>): Promise<PollResult> {
  const hubId = typeof body.hubId === 'string' ? body.hubId : '';
  const enrollToken = typeof body.enrollToken === 'string' ? body.enrollToken.trim() : '';
  const hub = hubId ? await getHubStore().getById(hubId) : null;
  if (!hub || !enrollToken || hub.enrollTokenHash !== hmacHex(enrollToken)) {
    return { ok: false, error: 'unknown hub or bad enrollment token' };
  }
  hub.lastSeenAt = Date.now();
  await getHubStore().save(hub);
  if (hub.status === 'claimed' && hub.accountId) {
    return { ok: true, status: 'claimed', hubToken: issueHubToken(hub.id, hub.accountId), accountId: hub.accountId, name: hub.name };
  }
  return { ok: true, status: 'unclaimed' };
}

export interface ClaimResult {
  ok: boolean;
  hub?: HubView;
  error?: string;
}

/** A signed-in user redeems a claim code, binding the hub to their account. */
export async function claimHub(accountId: string, rawCode: unknown, opts: { ip?: string } = {}): Promise<ClaimResult> {
  if (!claimLimiter.allow(accountId) || (opts.ip && !claimLimiter.allow(opts.ip))) {
    return { ok: false, error: 'too many attempts — wait a bit and try again' };
  }
  const code = normalizeClaimCode(rawCode);
  if (!code) return { ok: false, error: 'enter the 8-character code shown on your hub' };

  const store = getHubStore();
  const hub = await store.getByClaimCode(code);
  if (!hub) return { ok: false, error: 'code not found or expired — check your hub and try again' };
  if (hub.status === 'claimed') return { ok: false, error: 'this hub is already connected' };

  hub.accountId = accountId;
  hub.status = 'claimed';
  hub.claimCode = null;
  hub.claimExpiresAt = null;
  await store.save(hub);
  return { ok: true, hub: hubView(hub, Date.now()) };
}

export interface HeartbeatResult {
  ok: boolean;
  error?: string;
}

/**
 * A paired hub reports liveness with its hub token. We re-check the record still exists and
 * still belongs to the token's account — so unpairing (which deletes the record) revokes the
 * stateless token on the very next heartbeat.
 */
export async function heartbeatHub(hubToken: string | undefined, body: Record<string, unknown>): Promise<HeartbeatResult> {
  const claims = verifyHubToken(hubToken);
  if (!claims) return { ok: false, error: 'invalid hub token' };
  const hub = await getHubStore().getById(claims.sub);
  if (!hub || hub.accountId !== claims.acc || hub.status !== 'claimed') {
    return { ok: false, error: 'hub no longer paired' };
  }
  hub.lastSeenAt = Date.now();
  if (typeof body.fw === 'string') hub.fw = body.fw.slice(0, 40);
  await getHubStore().save(hub);
  return { ok: true };
}

/** List an account's hubs (account-facing view). */
export async function listHubs(accountId: string): Promise<HubView[]> {
  const now = Date.now();
  const hubs = await getHubStore().listByAccount(accountId);
  return hubs.sort((a, b) => b.createdAt - a.createdAt).map((h) => hubView(h, now));
}

/** Unpair (delete) a hub the account owns. Returns false if it isn't theirs / doesn't exist. */
export async function unpairHub(accountId: string, hubId: string): Promise<boolean> {
  const hub = await getHubStore().getById(hubId);
  if (!hub || hub.accountId !== accountId) return false;
  await getHubStore().remove(hubId);
  return true;
}

/** Generate a strong enrollment token — exported so a device client can mint one. */
export function newEnrollToken(): string {
  return randomBytes(32).toString('hex');
}

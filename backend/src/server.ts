/**
 * Hearth cloud HTTP server — the Home MCP surface + Qwen orchestration.
 *
 * Runs identically on a laptop (`npm run dev`) and on Alibaba Function Compute
 * (custom runtime, web-server mode: FC forwards HTTP to the port we listen on).
 *
 * Routes:
 *   GET  /health         liveness + which brain/store are active
 *   GET  /mcp/tools       function-calling catalog (transport-agnostic MCP tools)
 *   POST /mcp/call        { tool, args } → dispatch a tool
 *   POST /qwen            { task:"author"|"judge", ... } — parity with the app's route
 */

import './env'; // load .env (dev) before anything reads process.env
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { hasKey, author, judge, type JudgeInput } from './qwen';
import { makeStore, type HomeStore } from './store';
import { TOOL_BY_NAME, toolSchemas, type ToolCtx } from './tools';
import {
  makeAccountStore,
  makeOtpStore,
  requestOtp,
  verifyOtp,
  verifySession,
  verifyHubToken,
  issueWsTicket,
  assertAuthConfig,
  type AuthDeps,
} from './auth';
import { enrollHub, pollHub, claimHub, heartbeatHub, listHubs, unpairHub, getHubStore, hubView } from './hubs';
import { hubWatches, syncHubDevices } from './hub-devices';
import { relayConfig, relayEnabled, publishToRelay } from './relay';
import { putFrame, ossProvisioned } from './oss';

// One home per account (keyed by the session subject). The world MODEL is
// static; what's per-account is the authored watches, events, and readings.
// Bounded LRU: a long-lived FC instance would otherwise cache one store per distinct
// account forever. Re-inserting on access keeps the Map in LRU order; we evict the
// oldest past the cap. Durable stores (file/Tablestore) just re-open on next access.
const STORE_CACHE_MAX = Number(process.env.STORE_CACHE_MAX ?? 500);
const stores = new Map<string, Promise<HomeStore>>();
const getStoreFor = (accountId: string): Promise<HomeStore> => {
  const existing = stores.get(accountId);
  if (existing) {
    stores.delete(accountId);
    stores.set(accountId, existing);
    return existing;
  }
  const s = makeStore(accountId);
  stores.set(accountId, s);
  if (stores.size > STORE_CACHE_MAX) {
    const oldest = stores.keys().next().value;
    if (oldest !== undefined) stores.delete(oldest);
  }
  return s;
};

let authPromise: Promise<AuthDeps> | null = null;
const accounts = makeAccountStore();
const getAuth = (): Promise<AuthDeps> => (authPromise ??= makeOtpStore().then((otp) => ({ otp, accounts })));

// CORS: set CORS_ORIGINS (comma-separated) to reflect only known app origins instead
// of the wildcard. Unset keeps '*' for backward compatibility with existing deploys.
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function corsHeaders(req: IncomingMessage): Record<string, string> {
  if (!ALLOWED_ORIGINS.length) return { 'access-control-allow-origin': '*' };
  const origin = req.headers['origin'];
  const allowed = typeof origin === 'string' && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return { 'access-control-allow-origin': allowed, vary: 'Origin' };
}

function send(res: ServerResponse, status: number, body: unknown, req?: IncomingMessage) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    ...(req ? corsHeaders(req) : { 'access-control-allow-origin': ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS[0] : '*' }),
  });
  res.end(json);
}

function bearer(req: IncomingMessage): string | undefined {
  const auth = req.headers['authorization'];
  return typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : undefined;
}

// Sensible bounds for a node's sample cadence: fast enough to feel live, not so fast it
// floods the LAN/hub, and capped at a minute so a "slow" node still checks in reasonably.
const CADENCE_MIN_MS = 500;
const CADENCE_MAX_MS = 60_000;
const clampCadence = (ms: number): number => Math.min(CADENCE_MAX_MS, Math.max(CADENCE_MIN_MS, ms));

/** Verify the session; on failure send 401 and return null so the caller returns early. */
function requireSession(req: IncomingMessage, res: ServerResponse) {
  const session = verifySession(bearer(req));
  if (!session) {
    send(res, 401, { error: 'authentication required' });
    return null;
  }
  return session;
}

/** Best-effort client IP (behind the FC HTTP trigger, x-forwarded-for carries it). */
function clientIp(req: IncomingMessage): string | undefined {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff) return xff.split(',')[0].trim();
  return req.socket?.remoteAddress ?? undefined;
}

/**
 * Push a hub's just-synced readings to every browser the account has connected to the relay.
 * Best-effort. Awaited by the caller BEFORE responding, because on Function Compute
 * post-response async work may not run (the instance can freeze after the response).
 */
async function pushReadingsToAccount(accountId: string, body: Record<string, unknown>): Promise<void> {
  if (!relayEnabled()) return;
  const nodes = Array.isArray(body.nodes) ? body.nodes : [];
  const payload = nodes
    .map((n) => (n && typeof n === 'object' ? (n as Record<string, unknown>) : {}))
    .filter((n) => typeof n.id === 'string')
    .map((n) => ({ id: n.id as string, readings: (n.lastReading as Record<string, unknown>) ?? {} }));
  if (!payload.length) return;
  const message = JSON.stringify({ type: 'readings', at: Date.now(), nodes: payload });
  await publishToRelay(accountId, message);
}

// Cap every request body so an unauthenticated POST (e.g. /hub/enroll, /auth/*)
// can't stream an unbounded payload and OOM the Function Compute instance. 1 MiB
// leaves room for a downscaled reference photo / frame (base64 through /mcp/call)
// while still bounding memory well under the 512 MB instance.
const MAX_BODY_BYTES = 1024 * 1024;
const tooLarge = () => Object.assign(new Error('request body too large'), { statusCode: 413 });

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw tooLarge();
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const c of req) {
    total += (c as Buffer).length;
    if (total > MAX_BODY_BYTES) {
      req.destroy();
      throw tooLarge();
    }
    chunks.push(c as Buffer);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('invalid JSON body');
  }
}

export async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;
  const method = req.method ?? 'GET';

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      ...corsHeaders(req),
      'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
      'access-control-allow-headers': 'content-type, authorization',
    });
    res.end();
    return;
  }

  try {
    if (path === '/health' || path === '/') {
      return send(res, 200, {
        ok: true,
        service: 'hearth-cloud',
        brain: hasKey() ? 'qwen' : 'mock',
        store: process.env.HEARTH_STORE === 'tablestore' ? 'tablestore' : 'memory',
        tools: TOOL_BY_NAME.size,
      });
    }

    if (path === '/mcp/tools' && method === 'GET') {
      if (!requireSession(req, res)) return;
      return send(res, 200, { tools: toolSchemas() });
    }

    if (path === '/mcp/call' && method === 'POST') {
      const session = requireSession(req, res);
      if (!session) return;
      const body = await readBody(req);
      const name = String(body.tool ?? '');
      const tool = TOOL_BY_NAME.get(name);
      if (!tool) return send(res, 404, { error: `unknown tool: ${name}` });
      const ctx: ToolCtx = { store: await getStoreFor(session.sub) };
      const result = await tool.handler((body.args as Record<string, unknown>) ?? {}, ctx);
      return send(res, 200, { tool: name, result });
    }

    if (path === '/auth/request-otp' && method === 'POST') {
      const body = await readBody(req);
      const result = await requestOtp(await getAuth(), body.email, { ip: clientIp(req) });
      return send(res, result.ok ? 200 : 400, result);
    }

    if (path === '/auth/verify-otp' && method === 'POST') {
      const body = await readBody(req);
      const result = await verifyOtp(await getAuth(), body.email, body.code);
      return send(res, result.ok ? 200 : 401, result);
    }

    if (path === '/auth/me' && method === 'GET') {
      const session = requireSession(req, res);
      if (!session) return;
      const account = await accounts.getById(session.sub);
      return send(res, 200, { account: account ?? { id: session.sub, email: session.email } });
    }

    /* --- hub pairing (edge agent) --- */

    // Device-facing: no user session. The enrollToken (device secret) is the credential.
    if (path === '/hub/enroll' && method === 'POST') {
      const result = await enrollHub(await readBody(req), { ip: clientIp(req) });
      return send(res, result.ok ? 200 : 429, result);
    }

    if (path === '/hub/poll' && method === 'POST') {
      const result = await pollHub(await readBody(req));
      return send(res, result.ok ? 200 : 401, result);
    }

    if (path === '/hub/heartbeat' && method === 'POST') {
      const result = await heartbeatHub(bearer(req), await readBody(req));
      return send(res, result.ok ? 200 : 401, result);
    }

    // A paired hub pushes its live device registry (real ESP32 nodes + readings).
    // Same auth + revocation checkpoint as heartbeat: a token, re-verified against
    // the hub record so an unpaired hub is rejected.
    if (path === '/hub/devices' && method === 'POST') {
      const claims = verifyHubToken(bearer(req));
      if (!claims) return send(res, 401, { error: 'invalid hub token' });
      const hub = await getHubStore().getById(claims.sub);
      if (!hub || hub.accountId !== claims.acc || hub.status !== 'claimed') {
        return send(res, 403, { error: 'hub no longer paired' });
      }
      const body = await readBody(req);
      const store = await getStoreFor(claims.acc);
      const result = await syncHubDevices(store, { hubId: hub.id, hubName: hub.name, fw: hub.fw }, body);
      hub.lastSeenAt = Date.now(); // a device sync also proves liveness
      await getHubStore().save(hub);
      // Fan the fresh readings out to this account's live browsers over the gateway.
      // Awaited (not fire-and-forget) so it actually runs before FC may freeze the instance.
      await pushReadingsToAccount(claims.acc, body);
      // Downlink: hand the hub the account's desired per-sensor cadences AND desired actuator
      // states. The hub relays each to its node on the node's next ingest POST — the only
      // downlink path. `desired` is the "desired" half of the device shadow the node converges to.
      // `watches` rides the same downlink: the hub adopts the account's authored local watches
      // on every sync, so "describe it in the app" reaches real hardware with no copy-paste.
      return send(res, 200, {
        ...result,
        cadences: await store.getCadences(),
        desired: await store.getDesired(),
        watches: await hubWatches(store),
      });
    }

    // A paired hub pushes its latest camera frame (a data: URI) for one vision input. The bytes
    // land in OSS as that input's `latest.jpg`; get_snapshot then presigns them for the dashboard
    // and the Qwen-VL judge — so frames reach the cloud like any reading, no LAN reach-in needed.
    // Same token + revocation checkpoint as /hub/devices, plus an ownership guard so a hub can
    // only overwrite frames for a node it actually reports.
    if (path === '/hub/frame' && method === 'POST') {
      const claims = verifyHubToken(bearer(req));
      if (!claims) return send(res, 401, { error: 'invalid hub token' });
      const hub = await getHubStore().getById(claims.sub);
      if (!hub || hub.accountId !== claims.acc || hub.status !== 'claimed') {
        return send(res, 403, { error: 'hub no longer paired' });
      }
      const body = await readBody(req);
      const input = typeof body.input === 'string' ? body.input : '';
      const image = typeof body.image === 'string' ? body.image : '';
      if (!input || !image) return send(res, 400, { error: 'input and image (data: URI) required' });
      if (!ossProvisioned()) return send(res, 200, { ok: true, provisioned: false, note: 'OSS not configured; frame not stored.' });
      const store = await getStoreFor(claims.acc);
      const owns = (await store.listHubDevices()).some((s) => s.nodes.some((n) => input.startsWith(`${n.id}.`)));
      if (!owns) return send(res, 404, { error: 'unknown input' });
      const key = await putFrame(input, image).catch(() => null);
      hub.lastSeenAt = Date.now();
      await getHubStore().save(hub);
      return send(res, key ? 200 : 400, key ? { ok: true, provisioned: true, input, key } : { error: 'image must be a data: URI' });
    }

    /* --- per-sensor sample cadence (frontend → backend → hub → node downlink) --- */

    // Read the account's desired per-sensor cadences (input id "<node>.<key>" → ms).
    if (path === '/inputs/cadence' && method === 'GET') {
      const session = requireSession(req, res);
      if (!session) return;
      const store = await getStoreFor(session.sub);
      return send(res, 200, { cadences: await store.getCadences() });
    }

    // Set one sensor's desired sample cadence. Takes effect within ~1 hub sync + 1 node cycle.
    if (path === '/inputs/cadence' && method === 'POST') {
      const session = requireSession(req, res);
      if (!session) return;
      const body = await readBody(req);
      const input = typeof body.input === 'string' ? body.input : '';
      if (!input) return send(res, 400, { error: 'input required' });
      const store = await getStoreFor(session.sub);
      // Only accept cadence for a sensor this account actually owns (via a paired hub).
      const owns = (await store.listHubDevices()).some((s) =>
        s.nodes.some((n) => n.sensors.some((se) => `${n.id}.${se.key}` === input)),
      );
      if (!owns) return send(res, 404, { error: 'unknown input' });
      const raw = Number(body.intervalMs);
      if (!Number.isFinite(raw)) return send(res, 400, { error: 'intervalMs must be a number' });
      const intervalMs = Math.round(clampCadence(raw));
      await store.setCadence(input, intervalMs);
      return send(res, 200, { ok: true, input, intervalMs });
    }

    /* --- actuator desired state (frontend/Qwen → backend → hub → node downlink) --- */

    // Read the account's desired actuator states (input id "<node>.<key>" → on/off).
    if (path === '/inputs/desired' && method === 'GET') {
      const session = requireSession(req, res);
      if (!session) return;
      const store = await getStoreFor(session.sub);
      return send(res, 200, { desired: await store.getDesired() });
    }

    // Command one actuator on/off. Takes effect within ~1 hub sync + 1 node cycle. The same
    // device-shadow write the `actuate` MCP tool makes, exposed to the dashboard directly.
    if (path === '/inputs/desired' && method === 'POST') {
      const session = requireSession(req, res);
      if (!session) return;
      const body = await readBody(req);
      const input = typeof body.input === 'string' ? body.input : '';
      if (!input) return send(res, 400, { error: 'input required' });
      const store = await getStoreFor(session.sub);
      // Only accept a command for an ACTUATOR this account actually owns (via a paired hub).
      const owns = (await store.listHubDevices()).some((s) =>
        s.nodes.some((n) => (n.actuators ?? []).some((ac) => `${n.id}.${ac.key}` === input)),
      );
      if (!owns) return send(res, 404, { error: 'unknown actuator' });
      const on = body.on === true || body.on === 'on' || body.on === 1;
      await store.setDesired(input, on);
      return send(res, 200, { ok: true, input, on });
    }

    /* --- realtime (cloud-brokered WebSocket via the relay) --- */

    // Browser asks "how do I open a live socket to my hub?" — autodiscovery + a scoped,
    // short-lived ticket. No client config: the session JWT tells us the account, we find
    // its hub, and hand back the relay wss URL + a ticket the relay verifies on connect.
    if (path === '/live/ticket' && method === 'GET') {
      const session = requireSession(req, res);
      if (!session) return;
      const cfg = relayConfig();
      if (!cfg) return send(res, 200, { enabled: false });
      const hubs = await getHubStore().listByAccount(session.sub);
      const now = Date.now();
      // Prefer an online hub; otherwise report the most recent so the UI can say "offline".
      const views = hubs.map((h) => hubView(h, now)).sort((a, b) => Number(b.online) - Number(a.online) || b.createdAt - a.createdAt);
      const hub = views[0];
      if (!hub) return send(res, 200, { enabled: true, hub: null });
      return send(res, 200, {
        enabled: true,
        hubId: hub.id,
        online: hub.online,
        wsUrl: cfg.wsUrl,
        ticket: issueWsTicket(session.sub, hub.id),
      });
    }

    // User-facing: require a signed-in session.
    if (path === '/hub/claim' && method === 'POST') {
      const session = requireSession(req, res);
      if (!session) return;
      const body = await readBody(req);
      const result = await claimHub(session.sub, body.claimCode, { ip: clientIp(req) });
      return send(res, result.ok ? 200 : 400, result);
    }

    if (path === '/hubs' && method === 'GET') {
      const session = requireSession(req, res);
      if (!session) return;
      return send(res, 200, { hubs: await listHubs(session.sub) });
    }

    if (path.startsWith('/hubs/') && method === 'DELETE') {
      const session = requireSession(req, res);
      if (!session) return;
      const id = decodeURIComponent(path.slice('/hubs/'.length));
      const ok = await unpairHub(session.sub, id);
      return send(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'hub not found' });
    }

    if (path === '/qwen' && method === 'POST') {
      if (!requireSession(req, res)) return;
      const body = await readBody(req);
      if (body.task === 'author' && typeof body.wish === 'string') {
        const { question, engine } = await author(body.wish);
        return send(res, 200, { question, engine });
      }
      if (body.task === 'judge') {
        const { judgment, engine } = await judge(body as unknown as JudgeInput);
        return send(res, 200, { judgment, engine });
      }
      return send(res, 400, { error: 'unknown task' });
    }

    return send(res, 404, { error: `not found: ${method} ${path}` });
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode ?? 500;
    return send(res, status, { error: (e as Error).message });
  }
}

/** FC custom-runtime + local both boot the same server. */
export function start(): void {
  assertAuthConfig(); // fail loud at boot if AUTH_SESSION_SECRET is missing/weak
  const port = Number(process.env.FC_SERVER_PORT ?? process.env.PORT ?? 9000);
  // FC custom-runtime requires binding 0.0.0.0 (not localhost) or requests time out.
  createServer(handle).listen(port, '0.0.0.0', () => {
    console.log(`[hearth-cloud] listening on 0.0.0.0:${port}  brain=${hasKey() ? 'qwen' : 'mock'}  store=${process.env.HEARTH_STORE ?? 'memory'}`);
  });
}

// Boot when run directly (tsx src/server.ts, or `node server.js` on FC).
start();

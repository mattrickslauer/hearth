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
  verifyWsTicket,
  assertAuthConfig,
  type AuthDeps,
} from './auth';
import { enrollHub, pollHub, claimHub, heartbeatHub, listHubs, unpairHub, getHubStore, hubView } from './hubs';
import { syncHubDevices } from './hub-devices';
import { gatewayConfig, gatewayEnabled, notifyDevice } from './gateway';
import { getConnectionStore, removeConnection } from './connections';

// One home per account (keyed by the session subject). The world MODEL is
// static; what's per-account is the authored watches, events, and readings.
const stores = new Map<string, Promise<HomeStore>>();
const getStoreFor = (accountId: string): Promise<HomeStore> => {
  let s = stores.get(accountId);
  if (!s) {
    s = makeStore(accountId);
    stores.set(accountId, s);
  }
  return s;
};

let authPromise: Promise<AuthDeps> | null = null;
const accounts = makeAccountStore();
const getAuth = (): Promise<AuthDeps> => (authPromise ??= makeOtpStore().then((otp) => ({ otp, accounts })));

function send(res: ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(json);
}

function bearer(req: IncomingMessage): string | undefined {
  const auth = req.headers['authorization'];
  return typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : undefined;
}

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

/** Single-value header accessor (Node lowercases keys; arrays collapse to the first). */
function header(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Push a hub's just-synced readings to every browser the account has connected through the
 * API Gateway. Best-effort and self-healing: a deviceId the gateway reports as gone (notify
 * fails) is dropped from the registry. Awaited by the caller BEFORE responding, because on
 * Function Compute post-response async work may not run (the instance can freeze).
 */
async function pushReadingsToAccount(accountId: string, body: Record<string, unknown>): Promise<void> {
  if (!gatewayEnabled()) return;
  const nodes = Array.isArray(body.nodes) ? body.nodes : [];
  const payload = nodes
    .map((n) => (n && typeof n === 'object' ? (n as Record<string, unknown>) : {}))
    .filter((n) => typeof n.id === 'string')
    .map((n) => ({ id: n.id as string, readings: (n.lastReading as Record<string, unknown>) ?? {} }));
  if (!payload.length) return;

  const store = await getConnectionStore();
  const devices = await store.listDevices(accountId);
  if (!devices.length) return;

  const message = JSON.stringify({ type: 'readings', at: Date.now(), nodes: payload });
  await Promise.all(
    devices.map(async (deviceId) => {
      const ok = await notifyDevice(deviceId, message);
      if (!ok) await removeConnection(accountId, deviceId); // gateway says it's gone → forget it
    }),
  );
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
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
      'access-control-allow-origin': '*',
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
      return send(res, 200, result);
    }

    /* --- realtime (cloud-brokered WebSocket via API Gateway) --- */

    // Browser asks "how do I open a live socket to my hub?" — autodiscovery + a scoped,
    // short-lived ticket. No client config: the session JWT tells us the account, we find
    // its hub, and hand back the gateway wss URL + AppKey + ticket. AppSecret stays server-side.
    if (path === '/live/ticket' && method === 'GET') {
      const session = requireSession(req, res);
      if (!session) return;
      const cfg = gatewayConfig();
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
        appKey: cfg.appKey,
        ticket: issueWsTicket(session.sub, hub.id),
      });
    }

    // Gateway → backend on a browser REGISTER. The gateway adds x-ca-deviceid; the browser
    // passes our ticket as the register `password`. Verify it, record the connection, and
    // return 200 (any non-200 makes the gateway reject the client's registration).
    if (path === '/live/register' && method === 'POST') {
      const deviceId = header(req, 'x-ca-deviceid');
      const body = await readBody(req).catch(() => ({}) as Record<string, unknown>);
      const ticketRaw = body.password ?? body.ticket ?? url.searchParams.get('password') ?? url.searchParams.get('ticket');
      const ticket = verifyWsTicket(typeof ticketRaw === 'string' ? ticketRaw : undefined);
      if (!deviceId || !ticket) return send(res, 403, { error: 'invalid ticket or device' });
      const store = await getConnectionStore();
      await store.register(deviceId, ticket.sub, ticket.hub);
      return send(res, 200, { ok: true });
    }

    // Gateway → backend on disconnect. The browser re-sends its (cached) ticket so we know
    // which account partition to delete from; absent that we let the TTL backstop reap it.
    if (path === '/live/unregister' && method === 'POST') {
      const deviceId = header(req, 'x-ca-deviceid');
      const body = await readBody(req).catch(() => ({}) as Record<string, unknown>);
      const ticketRaw = body.password ?? body.ticket ?? url.searchParams.get('password') ?? url.searchParams.get('ticket');
      const ticket = verifyWsTicket(typeof ticketRaw === 'string' ? ticketRaw : undefined);
      if (deviceId && ticket) await removeConnection(ticket.sub, deviceId);
      return send(res, 200, { ok: true });
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
    return send(res, 500, { error: (e as Error).message });
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

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
  assertAuthConfig,
  type AuthDeps,
} from './auth';

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
      'access-control-allow-methods': 'GET,POST,OPTIONS',
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

#!/usr/bin/env node
/**
 * Hearth realtime relay — the cloud data plane for live sensor readings.
 *
 * Function Compute is serverless and can't hold a long-lived socket, so this always-on
 * relay does. Browsers connect here over wss (TLS terminated by the front nginx at
 * hub-ws.agfarms.dev) with a short-lived ticket the backend minted; the backend pushes an
 * account's readings here via POST /publish, and we fan them out to that account's browsers.
 *
 *   browser ──wss /live?ticket=<jwt>──▶ relay        (ticket → accountId, socket joins account)
 *   FC ──POST /publish {accountId,message}──▶ relay ──▶ every socket for that account
 *
 * Auth: the ticket is the SAME HS256 JWT the backend issues (auth.ts issueWsTicket, audience
 * "hearth-ws"), verified here with the shared AUTH_SESSION_SECRET. /publish is guarded by a
 * shared RELAY_PUBLISH_SECRET. No inbound trust beyond those two secrets.
 *
 * Zero dependencies — Node stdlib only. Env:
 *   PORT                  listen port (default 8790; bind 0.0.0.0 inside its container)
 *   AUTH_SESSION_SECRET   HS256 key to verify tickets (same value as the backend)
 *   RELAY_PUBLISH_SECRET  bearer secret the backend presents on POST /publish
 */

import http from 'node:http';
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

const PORT = Number(process.env.PORT || 8790);
// The key that signs/verifies browser tickets — set identically on the backend deploy env.
// Falls back to AUTH_SESSION_SECRET when RELAY_TICKET_SECRET is unset (backend's own fallback).
const TICKET_SECRET = process.env.RELAY_TICKET_SECRET || process.env.AUTH_SESSION_SECRET || '';
const PUBLISH_SECRET = process.env.RELAY_PUBLISH_SECRET || '';
const JWT_ISS = 'hearth';
const JWT_AUD_WS = 'hearth-ws';

if (!TICKET_SECRET || !PUBLISH_SECRET) {
  console.error('[relay] refusing to start: RELAY_TICKET_SECRET (or AUTH_SESSION_SECRET) and RELAY_PUBLISH_SECRET are required');
  process.exit(1);
}

/* ------------------------------------------------------------------ ticket verify */

const b64urlToBuf = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const constEq = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Verify the backend's HS256 ticket. Returns { accountId, hubId } or null. */
function verifyTicket(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  const expected = createHmac('sha256', TICKET_SECRET).update(`${h}.${p}`).digest('base64url');
  if (!constEq(sig, expected)) return null;
  try {
    const header = JSON.parse(b64urlToBuf(h).toString('utf8'));
    if (header.alg !== 'HS256' || header.typ !== 'JWT') return null;
    const claims = JSON.parse(b64urlToBuf(p).toString('utf8'));
    if (claims.iss !== JWT_ISS || claims.aud !== JWT_AUD_WS) return null;
    if (typeof claims.exp !== 'number' || Math.floor(Date.now() / 1000) >= claims.exp) return null;
    if (typeof claims.sub !== 'string' || !claims.sub) return null;
    return { accountId: claims.sub, hubId: typeof claims.hub === 'string' ? claims.hub : '' };
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- websocket framing */
// (same minimal RFC 6455 framing the hub uses in hub/ws.mjs — server→client text frames,
//  plus ping/pong + close handling for inbound control frames.)

const OP_TEXT = 0x1;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
function accept(key) {
  return createHash('sha1').update(key + WS_GUID).digest('base64');
}

function encodeFrame(payload, opcode = OP_TEXT) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));
  const len = data.length;
  let header;
  if (len < 126) header = Buffer.from([0x80 | opcode, len]);
  else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, data]);
}

function decodeFrames(buf) {
  const frames = [];
  let offset = 0;
  while (offset + 2 <= buf.length) {
    const b1 = buf[offset + 1];
    const opcode = buf[offset] & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let p = offset + 2;
    if (len === 126) {
      if (p + 2 > buf.length) break;
      len = buf.readUInt16BE(p);
      p += 2;
    } else if (len === 127) {
      if (p + 8 > buf.length) break;
      len = Number(buf.readBigUInt64BE(p));
      p += 8;
    }
    let mask;
    if (masked) {
      if (p + 4 > buf.length) break;
      mask = buf.subarray(p, p + 4);
      p += 4;
    }
    if (p + len > buf.length) break;
    let payload = buf.subarray(p, p + len);
    if (masked) {
      const out = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i & 3];
      payload = out;
    }
    frames.push({ opcode, payload });
    offset = p + len;
  }
  return { frames, rest: buf.subarray(offset) };
}

/* ----------------------------------------------------------------- connection state */

// accountId → Set<socket>. Each socket also carries ._accountId for cleanup.
const byAccount = new Map();
let totalSockets = 0;

function join(accountId, socket) {
  let set = byAccount.get(accountId);
  if (!set) byAccount.set(accountId, (set = new Set()));
  set.add(socket);
  socket._accountId = accountId;
  totalSockets++;
}
function leave(socket) {
  const set = byAccount.get(socket._accountId);
  if (set) {
    if (set.delete(socket)) totalSockets--;
    if (!set.size) byAccount.delete(socket._accountId);
  }
}
function publish(accountId, message) {
  const set = byAccount.get(accountId);
  if (!set || !set.size) return 0;
  const frame = encodeFrame(message, OP_TEXT);
  let n = 0;
  for (const s of set) {
    try {
      s.write(frame);
      n++;
    } catch {
      /* drop handler cleans up */
    }
  }
  return n;
}

/* --------------------------------------------------------------------- http + ws */

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

const bearer = (req) => {
  const a = req.headers['authorization'];
  return typeof a === 'string' && a.startsWith('Bearer ') ? a.slice(7) : '';
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, sockets: totalSockets, accounts: byAccount.size }));
    return;
  }
  // Backend → relay push. Bearer must equal the shared publish secret (constant-time).
  if (req.method === 'POST' && url.pathname === '/publish') {
    const tok = bearer(req);
    if (!tok || !constEq(tok, PUBLISH_SECRET)) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    const body = await readBody(req);
    const accountId = body && typeof body.accountId === 'string' ? body.accountId : '';
    const message = body && typeof body.message === 'string' ? body.message : '';
    if (!accountId || !message) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'accountId and message required' }));
      return;
    }
    const delivered = publish(accountId, message);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, delivered }));
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

// Browser WebSocket: wss://hub-ws.agfarms.dev/live?ticket=<jwt>
server.on('upgrade', (req, socket) => {
  const url = new URL(req.url || '/', 'http://localhost');
  const key = req.headers['sec-websocket-key'];
  if (url.pathname !== '/live' || !key) {
    socket.destroy();
    return;
  }
  const ticket = verifyTicket(url.searchParams.get('ticket'));
  if (!ticket) {
    // Reject the handshake cleanly so the browser sees a failed connection (not a hang).
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept(key)}\r\n\r\n`,
  );
  socket.setNoDelay(true);
  join(ticket.accountId, socket);
  try {
    socket.write(encodeFrame(JSON.stringify({ type: 'hello', hubId: ticket.hubId, at: Date.now() }), OP_TEXT));
  } catch {
    /* ignore */
  }

  let buf = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    const { frames, rest } = decodeFrames(buf);
    buf = rest;
    for (const f of frames) {
      if (f.opcode === OP_CLOSE) {
        try {
          socket.write(encodeFrame(f.payload, OP_CLOSE));
        } catch {
          /* ignore */
        }
        socket.end();
      } else if (f.opcode === OP_PING) {
        try {
          socket.write(encodeFrame(f.payload, OP_PONG));
        } catch {
          /* ignore */
        }
      }
      // client text frames are ignored — this channel is server → client
    }
  });
  const drop = () => leave(socket);
  socket.on('close', drop);
  socket.on('error', drop);
});

// Keepalive ping so idle proxies don't sever connections and dead sockets surface.
const pinger = setInterval(() => {
  for (const set of byAccount.values()) {
    for (const s of set) {
      try {
        s.write(encodeFrame('', OP_PING));
      } catch {
        leave(s);
      }
    }
  }
}, 30_000);
if (pinger.unref) pinger.unref();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[relay] listening on :${PORT}  (GET /health, POST /publish, WS /live)`);
});

const shutdown = () => {
  clearInterval(pinger);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// End-to-end test of relay.mjs: mint a ticket, connect a browser-like WS client, publish
// via the backend endpoint, assert fan-out + auth rejections. Node 20 (hand-rolled WS client).
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { decodeFrames } from '../hub/ws-frame.mjs';

const PORT = 8791;
const SECRET = 'test-session-secret-1234567890';
const PUB = 'test-publish-secret';
const RELAY = join(dirname(fileURLToPath(import.meta.url)), 'relay.mjs');

let relay;
const done = (code) => { if (relay) relay.kill('SIGKILL'); process.exit(code); };
const fail = (m) => { console.error('FAIL:', m); done(1); };
const pass = (m) => console.log('  ✓', m);

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function ticket(sub, { aud = 'hearth-ws', iss = 'hearth', exp = Math.floor(Date.now() / 1000) + 60, secret = SECRET } = {}) {
  const h = b64url({ alg: 'HS256', typ: 'JWT' });
  const p = b64url({ iss, aud, sub, hub: 'hub-1', iat: Math.floor(Date.now() / 1000), exp });
  const sig = createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${sig}`;
}

// Decode via the SAME module the relay encodes with, so this test exercises the shipped
// wire format instead of a lookalike. (It previously had its own copy, which had already
// drifted — no MAX_FRAME_BYTES guard.)
function decodeServerFrames(buf) {
  const { frames, rest } = decodeFrames(buf);
  return { frames: frames.map((f) => ({ opcode: f.opcode, text: f.payload.toString('utf8') })), rest };
}

const messages = [];
function connectWs(tkt) {
  return new Promise((resolve, reject) => {
    const key = randomBytes(16).toString('base64');
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: `/live?ticket=${encodeURIComponent(tkt)}`,
      headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13' },
    });
    req.on('upgrade', (res, socket) => {
      let buf = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        const { frames, rest } = decodeServerFrames(buf);
        buf = rest;
        for (const f of frames) if (f.opcode === 0x1) { try { messages.push(JSON.parse(f.text)); } catch { /* */ } }
      });
      resolve(socket);
    });
    req.on('response', (res) => reject(new Error(`handshake rejected: ${res.statusCode}`))); // non-101
    req.on('error', reject);
    req.end();
  });
}

const publish = (body, secret = PUB) => new Promise((resolve) => {
  const data = JSON.stringify(body);
  const r = http.request({ host: '127.0.0.1', port: PORT, path: '/publish', method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), authorization: `Bearer ${secret}` } },
    (res) => { let s = ''; res.on('data', (d) => (s += d)); res.on('end', () => resolve({ status: res.statusCode, body: s })); });
  r.on('error', () => resolve({ status: 0, body: '' }));
  r.end(data);
});

const waitFor = (pred, ms, label) => new Promise((resolve, reject) => {
  const t0 = Date.now();
  const iv = setInterval(() => {
    if (pred()) { clearInterval(iv); resolve(); }
    else if (Date.now() - t0 > ms) { clearInterval(iv); reject(new Error(`timeout: ${label}`)); }
  }, 40);
});
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // Pin RELAY_TICKET_SECRET explicitly, don't just set the AUTH_SESSION_SECRET fallback:
  // relay.mjs prefers RELAY_TICKET_SECRET, so a developer with the real .env sourced would
  // otherwise have their ambient value win and every ticket here would 401.
  relay = spawn('node', [RELAY], {
    env: { ...process.env, PORT: String(PORT), RELAY_TICKET_SECRET: SECRET, AUTH_SESSION_SECRET: SECRET, RELAY_PUBLISH_SECRET: PUB },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let ready = false;
  relay.stdout.on('data', (d) => { if (String(d).includes('listening')) ready = true; });
  relay.stderr.on('data', (d) => process.stderr.write(`[relay] ${d}`));
  relay.on('exit', (c) => { if (c) fail(`relay exited ${c}`); });
  await waitFor(() => ready, 5000, 'relay start').catch(fail);
  pass('relay started');

  // valid ticket connects and gets a hello
  const sock = await connectWs(ticket('acctA')).catch((e) => fail(`valid connect: ${e.message}`));
  await waitFor(() => messages.some((m) => m.type === 'hello'), 2000, 'hello frame').catch(fail);
  pass('valid ticket → 101 + hello');

  // publish to acctA reaches the socket
  messages.length = 0;
  const pr = await publish({ accountId: 'acctA', message: JSON.stringify({ type: 'readings', nodes: [{ id: 'n1', readings: { temp: 42 } }] }) });
  if (pr.status !== 200 || !/"delivered":1/.test(pr.body)) fail(`publish status ${pr.status} body ${pr.body}`);
  pass('publish returns delivered:1');
  await waitFor(() => messages.some((m) => m.type === 'readings' && m.nodes?.[0]?.readings?.temp === 42), 2000, 'readings delivered').catch(fail);
  pass('readings fan out to the account socket');

  // publish to a different account does NOT reach acctA
  messages.length = 0;
  const pr2 = await publish({ accountId: 'acctB', message: JSON.stringify({ type: 'readings', nodes: [] }) });
  if (!/"delivered":0/.test(pr2.body)) fail(`cross-account leak: ${pr2.body}`);
  await delay(200);
  if (messages.length) fail('acctA received a message meant for acctB');
  pass('cross-account isolation (delivered:0, nothing leaked)');

  // bad publish secret → 401
  const pr3 = await publish({ accountId: 'acctA', message: 'x' }, 'wrong-secret');
  if (pr3.status !== 401) fail(`bad publish secret got ${pr3.status}`);
  pass('bad publish secret → 401');

  // bad ticket (wrong secret) → handshake rejected
  let rejected = false;
  await connectWs(ticket('acctA', { secret: 'attacker' })).catch(() => { rejected = true; });
  if (!rejected) fail('forged ticket was accepted');
  pass('forged ticket → handshake rejected');

  // expired ticket → rejected
  let expRejected = false;
  await connectWs(ticket('acctA', { exp: Math.floor(Date.now() / 1000) - 10 })).catch(() => { expRejected = true; });
  if (!expRejected) fail('expired ticket was accepted');
  pass('expired ticket → handshake rejected');

  sock.destroy();
  console.log('\nALL PASS');
  done(0);
}

main().catch((e) => fail(e.stack || e.message));

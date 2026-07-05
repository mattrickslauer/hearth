/**
 * Unit checks for the cloud-brokered realtime plumbing that CAN be verified without a live
 * API Gateway: the request signer (exact string-to-sign format + signature), resource
 * building, the connection registry, and the notify call's wire shape (via a stubbed fetch).
 *
 * End-to-end (browser ↔ gateway ↔ FC ↔ hub) still needs a provisioned gateway — see
 * docs/realtime-apigateway.md. Run: npm run -s live-check   (or: npx tsx scripts/live-check.ts)
 */
import { createHash, createHmac } from 'node:crypto';

import { signGatewayRequest, buildResource, notifyDevice } from '../src/gateway';
import { getConnectionStore, removeConnection } from '../src/connections';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`);
  }
}
const eq = (name: string, got: unknown, want: unknown) =>
  check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}  want ${JSON.stringify(want)}`);

// ── 1. signer: exact string-to-sign + signature, cross-checked independently ──────────
{
  const appKey = 'APPKEY123';
  const appSecret = 'SECRET456';
  const body = '{"type":"readings","n":1}';
  const now = 1700000000000;
  const nonce = 'nonce-fixed-uuid';
  const signed = signGatewayRequest({
    method: 'POST',
    host: 'grp.ap-southeast-1.alicloudapi.com',
    pathname: '/live/notify',
    appKey,
    appSecret,
    headers: { 'x-ca-deviceid': 'DEVICE@APPKEY123' },
    body,
    now,
    nonce,
  });

  // Independently reconstruct the documented string-to-sign.
  const contentMd5 = createHash('md5').update(body, 'utf8').digest('base64');
  const signedHeaderBlock = [
    `x-ca-deviceid:DEVICE@APPKEY123`,
    `x-ca-key:${appKey}`,
    `x-ca-nonce:${nonce}`,
    `x-ca-stage:RELEASE`,
    `x-ca-timestamp:${now}`,
  ].join('\n');
  const expectedSts =
    'POST\n' +
    'application/json\n' +
    `${contentMd5}\n` +
    'application/json; charset=utf-8\n' +
    '\n' + // empty Date line
    signedHeaderBlock +
    '\n' +
    '/live/notify';
  const expectedSig = createHmac('sha256', Buffer.from(appSecret, 'utf8')).update(expectedSts, 'utf8').digest('base64');

  eq('string-to-sign matches documented format exactly', signed.stringToSign, expectedSts);
  eq('x-ca-signature-headers is sorted x-ca-* keys', signed.headers['x-ca-signature-headers'], 'x-ca-deviceid,x-ca-key,x-ca-nonce,x-ca-stage,x-ca-timestamp');
  eq('content-md5 computed for JSON body', signed.headers['content-md5'], contentMd5);
  eq('signature = base64(hmacSHA256(secret, sts))', signed.headers['x-ca-signature'], expectedSig);
  eq('url = https host + path', signed.url, 'https://grp.ap-southeast-1.alicloudapi.com/live/notify');
  check('deviceid header preserved', signed.headers['x-ca-deviceid'] === 'DEVICE@APPKEY123');
}

// ── 2. buildResource: path + ascending-sorted params, bare key for empty value ────────
{
  eq('no params → path only', buildResource('/p'), '/p');
  eq('params sorted ascending', buildResource('/p', { b: '2', a: '1' }), '/p?a=1&b=2');
  eq('empty value → bare key', buildResource('/p', { x: '' }), '/p?x');
}

// ── 3. connection registry (memory): scoping, removal, listing ────────────────────────
async function connectionTests() {
  const store = await getConnectionStore(); // memory (HEARTH_STORE unset)
  await store.register('devA1@k', 'acctA', 'hubA');
  await store.register('devA2@k', 'acctA', 'hubA');
  await store.register('devB1@k', 'acctB', 'hubB');
  eq('lists only account A devices', (await store.listDevices('acctA')).sort(), ['devA1@k', 'devA2@k']);
  eq('lists only account B devices', await store.listDevices('acctB'), ['devB1@k']);
  await removeConnection('acctA', 'devA1@k');
  eq('removal drops just that device', await store.listDevices('acctA'), ['devA2@k']);
  eq('unknown account → empty', await store.listDevices('nope'), []);
}

// ── 4. notifyDevice wire shape via a stubbed fetch ────────────────────────────────────
async function notifyTests() {
  process.env.APIGW_APP_KEY = 'APPKEY123';
  process.env.APIGW_APP_SECRET = 'SECRET456';
  process.env.APIGW_NOTIFY_URL = 'https://grp.ap-southeast-1.alicloudapi.com/live/notify';
  process.env.APIGW_WS_URL = 'wss://grp.example.com:8443';

  interface Captured {
    url: string;
    headers: Record<string, string>;
    body: string;
  }
  const realFetch = globalThis.fetch;
  const captured: Captured[] = [];
  globalThis.fetch = (async (url: string, init: { headers: Record<string, string>; body: string }) => {
    captured.push({ url: String(url), headers: init.headers, body: init.body });
    return { ok: true, headers: { get: () => null } } as unknown as Response;
  }) as typeof fetch;

  try {
    const ok = await notifyDevice('DEVICE@APPKEY123', '{"hi":1}');
    const got = captured[0];
    check('notifyDevice resolves true on 2xx', ok);
    check('POSTs to the notify URL', got?.url === 'https://grp.ap-southeast-1.alicloudapi.com/live/notify');
    check('targets the device via x-ca-deviceid', got?.headers['x-ca-deviceid'] === 'DEVICE@APPKEY123');
    check('request is signed (x-ca-signature present)', !!got?.headers['x-ca-signature']);
    check('body forwarded verbatim', got?.body === '{"hi":1}');
  } finally {
    globalThis.fetch = realFetch;
  }
}

async function main() {
  console.log('signer + resource:');
  // (section 1 & 2 already ran synchronously above)
  console.log('connections:');
  await connectionTests();
  console.log('notify:');
  await notifyTests();

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();

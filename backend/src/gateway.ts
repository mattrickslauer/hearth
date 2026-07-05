/**
 * Alibaba Cloud API Gateway — WebSocket "two-way communication" glue (server side).
 *
 * The browser holds the WebSocket to API Gateway (the gateway terminates it — Function
 * Compute cannot hold a long-lived socket). To push a message to a specific connected
 * browser, the backend calls the gateway's NOTIFY api as an ordinary App-signed HTTP
 * request with an `x-ca-deviceid` header naming the target connection; the gateway
 * delivers it to that client as an `NF#<body>` frame.
 *
 * This module is the request signer (App Key/Secret HMAC-SHA256, per Alibaba's digest
 * auth) + the notify call. The AppSecret lives ONLY here, server-side — the browser
 * authenticates its register with a short-lived Hearth ticket instead (see auth.ts
 * issueWsTicket / server.ts /live/register), so no gateway secret ever ships to a client.
 *
 * Everything is gated on the APIGW_* env being present: with it unset, realtime is simply
 * off and the rest of the backend is unaffected.
 *
 * Signing algorithm transcribed from Alibaba's official Node SDK (aliyun-api-gateway,
 * lib/client.js) and SignUtil.java. See docs/realtime-apigateway.md for provisioning.
 */

import { createHash, createHmac, randomUUID } from 'node:crypto';

export interface GatewayConfig {
  appKey: string;
  appSecret: string;
  notifyUrl: string; // full https URL: group host + NOTIFY api path
  wsUrl: string; // wss URL the browser connects to (group's WebSocket-channel domain)
}

/** Read the gateway config from env, or null when realtime isn't provisioned. */
export function gatewayConfig(): GatewayConfig | null {
  const appKey = process.env.APIGW_APP_KEY;
  const appSecret = process.env.APIGW_APP_SECRET;
  const notifyUrl = process.env.APIGW_NOTIFY_URL;
  const wsUrl = process.env.APIGW_WS_URL;
  if (!appKey || !appSecret || !notifyUrl || !wsUrl) return null;
  return { appKey, appSecret, notifyUrl, wsUrl };
}

export function gatewayEnabled(): boolean {
  return gatewayConfig() !== null;
}

const md5Base64 = (body: string) => createHash('md5').update(body, 'utf8').digest('base64');
const hmacBase64 = (secret: string, str: string) =>
  createHmac('sha256', Buffer.from(secret, 'utf8')).update(str, 'utf8').digest('base64');

/** path + ascending-sorted query params (empty value → bare key), or just path when none. */
export function buildResource(pathname: string, params: Record<string, string> = {}): string {
  const keys = Object.keys(params).sort();
  if (!keys.length) return pathname;
  const list = keys.map((k) => (params[k] !== undefined && params[k] !== null && `${params[k]}` ? `${k}=${params[k]}` : `${k}`));
  return `${pathname}?${list.join('&')}`;
}

export interface SignedRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
  stringToSign: string; // exposed for tests + diffing against the gateway's x-ca-error-message
}

/**
 * Build an App-signed API Gateway request. Exported for unit testing against the exact
 * documented string-to-sign format. `now`/`nonce` are injectable for deterministic tests.
 */
export function signGatewayRequest(opts: {
  method: string;
  host: string;
  pathname: string;
  appKey: string;
  appSecret: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  body?: string;
  stage?: string;
  now?: number;
  nonce?: string;
}): SignedRequest {
  const method = opts.method.toUpperCase();
  const body = opts.body ?? '';
  const h: Record<string, string> = {
    'x-ca-timestamp': String(opts.now ?? Date.now()),
    'x-ca-key': opts.appKey,
    'x-ca-nonce': opts.nonce ?? randomUUID(),
    'x-ca-stage': opts.stage ?? 'RELEASE',
    accept: 'application/json',
    'content-type': 'application/json; charset=utf-8',
    ...(opts.headers ?? {}),
  };

  const ct = h['content-type'] || '';
  const isForm = ct.startsWith('application/x-www-form-urlencoded');
  if (method !== 'GET' && !isForm && body) h['content-md5'] = md5Base64(body);

  // Headers that participate in the signature: every x-ca-* key (sorted), excluding the
  // signature headers themselves (added after). Emit "key:value\n" lines.
  const signKeys = Object.keys(h)
    .filter((k) => k.toLowerCase().startsWith('x-ca-'))
    .sort();
  h['x-ca-signature-headers'] = signKeys.join(',');
  const signedHeaderBlock = signKeys.map((k) => `${k}:${h[k]}`).join('\n');

  const resource = buildResource(opts.pathname, opts.query ?? {});
  const lf = '\n';
  const stringToSign =
    method +
    lf +
    (h['accept'] || '') +
    lf +
    (h['content-md5'] || '') +
    lf +
    (h['content-type'] || '') +
    lf +
    (h['date'] || '') +
    lf +
    (signedHeaderBlock ? signedHeaderBlock + lf : '') +
    resource;

  h['x-ca-signature'] = hmacBase64(opts.appSecret, stringToSign);
  return { url: `https://${opts.host}${resource}`, headers: h, body, stringToSign };
}

/**
 * Push a message to one connected browser via the gateway NOTIFY api. Best-effort:
 * resolves false on any failure (unconfigured, network, non-2xx) rather than throwing,
 * so a dead/expired connection never breaks the hub sync that triggered the push.
 */
export async function notifyDevice(deviceId: string, message: string, cfg = gatewayConfig()): Promise<boolean> {
  if (!cfg) return false;
  let host: string;
  let pathname: string;
  try {
    const u = new URL(cfg.notifyUrl);
    host = u.host;
    pathname = u.pathname;
  } catch {
    return false;
  }
  const signed = signGatewayRequest({
    method: 'POST',
    host,
    pathname,
    appKey: cfg.appKey,
    appSecret: cfg.appSecret,
    headers: { 'x-ca-deviceid': deviceId },
    body: message,
  });
  try {
    const res = await fetch(signed.url, { method: 'POST', headers: signed.headers, body: signed.body });
    if (!res.ok) {
      // The gateway echoes its own string-to-sign in x-ca-error-message on a signature
      // mismatch — surface it to logs to make provisioning/signing bugs debuggable.
      const err = res.headers.get('x-ca-error-message');
      if (err) console.log(`[live] notify ${deviceId} rejected ${res.status}: ${err}`);
      return false;
    }
    return true;
  } catch (e) {
    console.log(`[live] notify ${deviceId} failed: ${(e as Error).message}`);
    return false;
  }
}

/** Fan a message out to many devices; returns how many the gateway accepted. */
export async function notifyDevices(deviceIds: string[], message: string): Promise<number> {
  const cfg = gatewayConfig();
  if (!cfg || !deviceIds.length) return 0;
  const results = await Promise.all(deviceIds.map((id) => notifyDevice(id, message, cfg)));
  return results.filter(Boolean).length;
}

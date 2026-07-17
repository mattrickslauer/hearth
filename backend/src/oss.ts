/**
 * Alibaba OSS adapter — durable storage for the images Qwen-VL reads (household
 * reference photos and camera frames). Qwen-VL accepts image URLs, so we upload
 * bytes to OSS and hand it a short-lived presigned GET URL instead of shipping
 * base64 around.
 *
 * ali-oss is kept EXTERNAL and dynamically imported (esbuild can't safely bundle
 * its sloppy CJS — same reason as tablestore), so importing this module is cheap;
 * the client is built lazily on first use. When OSS_BUCKET isn't set,
 * ossProvisioned() is false and callers keep their inline/base64 path — nothing
 * breaks without the bucket.
 *
 * Stored form is an `oss://<key>` handle; resolveImage() turns it into a presigned
 * URL on read (a local signing op — no network), so we never persist an expiring URL.
 */

import type { AccountId } from './auth';
import type { HomeStore } from './store';

const OSS_SCHEME = 'oss://';

export const ossProvisioned = (): boolean =>
  !!process.env.OSS_BUCKET && !!process.env.ALI_ACCESS_KEY_ID && !!process.env.ALI_ACCESS_KEY_SECRET;

export const isOssRef = (image: string): boolean => image.startsWith(OSS_SCHEME);

type OSSClient = {
  put(key: string, buf: Buffer, opts?: { mime?: string; meta?: Record<string, string> }): Promise<unknown>;
  head(key: string): Promise<{ meta?: Record<string, string> | null; res?: { headers?: Record<string, string> } }>;
  signatureUrl(key: string, opts?: { expires?: number }): string;
};

let clientPromise: Promise<OSSClient> | null = null;
async function client(): Promise<OSSClient> {
  if (!ossProvisioned()) throw new Error('OSS not provisioned (OSS_BUCKET + ALI keys required)');
  if (!clientPromise) {
    const built = import('ali-oss').then((m) => {
      const OSS = ((m as { default?: unknown }).default ?? m) as new (o: object) => OSSClient;
      return new OSS({
        region: process.env.OSS_REGION || 'oss-ap-southeast-1',
        accessKeyId: process.env.ALI_ACCESS_KEY_ID,
        accessKeySecret: process.env.ALI_ACCESS_KEY_SECRET,
        bucket: process.env.OSS_BUCKET,
        secure: true,
      });
    });
    clientPromise = built;
    // A rejected dynamic import (SDK missing) must not be cached forever: clear it on failure so
    // the next call retries instead of replaying the same rejected promise.
    void built.catch(() => {
      if (clientPromise === built) clientPromise = null;
    });
  }
  return clientPromise;
}

const MIME_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** Parse a `data:<mime>;base64,<...>` URI into bytes + content type; null if not a data URI. */
export function decodeDataUri(uri: string): { buffer: Buffer; contentType: string; ext: string } | null {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(uri);
  if (!m) return null;
  const contentType = m[1] || 'application/octet-stream';
  const buffer = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]));
  return { buffer, contentType, ext: MIME_EXT[contentType] ?? 'bin' };
}

/**
 * Upload a data-URI image under `<prefix>/<id>.<ext>` and return an `oss://<key>`
 * handle to store. If `uri` isn't a data URI (already a URL) returns null — the
 * caller keeps the value as-is. Throws only on a real upload failure.
 */
export async function putImage(prefix: string, id: string, uri: string): Promise<string | null> {
  const decoded = decodeDataUri(uri);
  if (!decoded) return null;
  const key = `${prefix}/${id}.${decoded.ext}`;
  const c = await client();
  await c.put(key, decoded.buffer, { mime: decoded.contentType });
  return `${OSS_SCHEME}${key}`;
}

const safeSeg = (s: string): string => s.replace(/[^\w.-]/g, '_');

/**
 * The stable OSS key holding the latest frame for one account's input.
 *
 * NOT exported, and that is the point. This key used to be `frames/<input>/latest.jpg` — no
 * account, no hub — and since every hub camera called itself `hub-cam`, every account's camera
 * resolved to one object: hubs overwrote each other's frames and dashboards read whichever landed
 * last, across tenants. Exporting the key builder invites that back, because naming another
 * account's object stays one plausible argument away. `framesFor()` below is the only door, so a
 * caller can only ever address the account it was scoped to.
 */
const frameKey = (accountId: AccountId, input: string): string => `frames/${safeSeg(accountId)}/${safeSeg(input)}/latest.jpg`;

/** Raised when a caller names an input its account doesn't have. Callers map this to 404. */
export class UnknownInputError extends Error {
  constructor(readonly input: string) {
    super(`unknown input ${input}`);
    this.name = 'UnknownInputError';
  }
}

/** A frame that exists, with the age that says whether it still means anything. */
export interface StoredFrame {
  capturedAt: number;
  /** Presigned GET. Only ever handed out for a frame we've confirmed is really there. */
  url: string;
}

/**
 * Camera-frame storage for ONE account — the only way to reach a frame.
 *
 * Two invariants that used to be the caller's job, and were therefore skipped:
 *
 *   Tenant   — the key is built from the `accountId` bound here, which the type system only lets
 *              you obtain from a verified token (auth.ts AccountId). There is no argument that
 *              redirects a read at someone else's frame.
 *   Ownership— every method checks the account actually declares the input first. `get_snapshot`
 *              and `put_snapshot` were the only tools that never touched the account-scoped store
 *              and took an input id straight from the caller with no check at all; a new frame
 *              tool now cannot repeat that, because there is no unchecked path to call.
 *
 * `store` is the account's own HomeStore — holding one already means the caller passed auth.
 */
export function framesFor(store: HomeStore, accountId: AccountId) {
  const assertOwned = async (input: string): Promise<void> => {
    if (!(await store.ownsInput(input))) throw new UnknownInputError(input);
  };

  return {
    /**
     * Store a frame as this input's latest. `capturedAt` is stamped as object metadata: the key is
     * a fixed `latest.jpg`, so without it the bytes carry no age and a week-old frame is
     * indistinguishable from a live one. Returns the `oss://` handle, or null if `uri` isn't a
     * data URI.
     */
    async write(input: string, uri: string, capturedAt: number): Promise<string | null> {
      await assertOwned(input);
      const decoded = decodeDataUri(uri);
      if (!decoded) return null;
      const key = frameKey(accountId, input);
      const c = await client();
      await c.put(key, decoded.buffer, { mime: decoded.contentType, meta: { capturedat: String(capturedAt) } });
      return `${OSS_SCHEME}${key}`;
    },

    /**
     * This input's latest frame, or null when there isn't one.
     *
     * Heads before it signs, deliberately. Presigning succeeds for a key holding nothing, so
     * signing blind is what let a camera that had never pushed a frame render as "live" over a
     * 404 — a URL is only returned for an object confirmed present, and it always arrives with
     * the capture time needed to judge it.
     */
    async read(input: string, expires = 600): Promise<StoredFrame | null> {
      await assertOwned(input);
      const c = await client();
      try {
        const r = await c.head(frameKey(accountId, input));
        const stamped = Number(r.meta?.capturedat);
        const lastModified = Date.parse(r.res?.headers?.['last-modified'] ?? '');
        const capturedAt = Number.isFinite(stamped) && stamped > 0 ? stamped : Number.isFinite(lastModified) ? lastModified : 0;
        return { capturedAt, url: c.signatureUrl(frameKey(accountId, input), { expires }) };
      } catch {
        return null; // 404 (no frame yet) or a transient OSS error — both mean "nothing to show".
      }
    },
  };
}

/** Presign a raw key for GET (local signing, no network). */
export async function presignKey(key: string, expires = 3600): Promise<string> {
  const c = await client();
  return c.signatureUrl(key, { expires });
}

/** Resolve a stored image field to a fetchable URL: `oss://` → presigned GET; anything else as-is. */
export async function resolveImage(image: string, expires = 3600): Promise<string> {
  if (!isOssRef(image)) return image;
  return presignKey(image.slice(OSS_SCHEME.length), expires);
}

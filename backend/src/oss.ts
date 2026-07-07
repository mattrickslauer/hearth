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

const OSS_SCHEME = 'oss://';

export const ossProvisioned = (): boolean =>
  !!process.env.OSS_BUCKET && !!process.env.ALI_ACCESS_KEY_ID && !!process.env.ALI_ACCESS_KEY_SECRET;

export const isOssRef = (image: string): boolean => image.startsWith(OSS_SCHEME);

type OSSClient = {
  put(key: string, buf: Buffer, opts?: { mime?: string }): Promise<unknown>;
  signatureUrl(key: string, opts?: { expires?: number }): string;
};

let clientPromise: Promise<OSSClient> | null = null;
async function client(): Promise<OSSClient> {
  if (!ossProvisioned()) throw new Error('OSS not provisioned (OSS_BUCKET + ALI keys required)');
  if (!clientPromise) {
    clientPromise = import('ali-oss').then((m) => {
      const OSS = ((m as { default?: unknown }).default ?? m) as new (o: object) => OSSClient;
      return new OSS({
        region: process.env.OSS_REGION || 'oss-ap-southeast-1',
        accessKeyId: process.env.ALI_ACCESS_KEY_ID,
        accessKeySecret: process.env.ALI_ACCESS_KEY_SECRET,
        bucket: process.env.OSS_BUCKET,
        secure: true,
      });
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

/** Upload a camera frame to the fixed latest-frame key for an input; returns the `oss://` handle. */
export async function putFrame(input: string, uri: string): Promise<string | null> {
  const decoded = decodeDataUri(uri);
  if (!decoded) return null;
  const key = frameKey(input);
  const c = await client();
  await c.put(key, decoded.buffer, { mime: decoded.contentType });
  return `${OSS_SCHEME}${key}`;
}

/** The stable OSS key holding the latest frame for an input (overwritten each snapshot). */
export const frameKey = (input: string): string => `frames/${input.replace(/[^\w.-]/g, '_')}/latest.jpg`;

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

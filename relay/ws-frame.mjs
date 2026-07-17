/**
 * VENDORED COPY of hub/ws-frame.mjs — the hub's RFC 6455 frame codec, kept here so the relay
 * imports only from within its own package (its package.json ships relay/ alone; reaching into
 * ../hub was a fragile cross-package import). The hub agent owns hub/ws-frame.mjs; keep this file
 * byte-for-byte in sync with it when the wire format changes.
 *
 * ---------------------------------------------------------------------------------------------
 *
 * RFC 6455 framing — the one implementation, shared by every WebSocket endpoint we run.
 *
 * Two servers speak WebSocket here and they used to carry byte-identical copies of this
 * code: the hub's LAN broadcast channel (hub/ws.mjs) and the cloud relay (relay/relay.mjs),
 * plus a third partial decoder in relay/test-relay.mjs. Three copies meant every hardening
 * fix — frame-size caps, backpressure — had to be applied three times in lockstep, and the
 * test copy had already drifted (it was missing the MAX_FRAME_BYTES guard, so the tests
 * exercised a decoder we don't ship). This module is the single source of truth.
 *
 * Scope is deliberately just the wire format: handshake key, frame encode/decode, and the
 * safety limits. Connection management stays with each server, because they genuinely
 * differ — the hub broadcasts to every LAN listener, the relay fans out per account.
 *
 * Zero dependencies (Node stdlib only), which is what lets the hub stay near-dependency-free
 * and the relay stay a single `node relay.mjs`.
 */

import { createHash } from 'node:crypto';

export const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
export const OP_TEXT = 0x1;
export const OP_CLOSE = 0x8;
export const OP_PING = 0x9;
export const OP_PONG = 0xa;

/** Largest client frame we'll accept. Without this cap a client can declare a multi-GB
 *  frame length and we'd buffer it all before rejecting → OOM. */
export const MAX_FRAME_BYTES = 1024 * 1024;

/** A stalled reader whose kernel send buffer grows past this is a slow consumer we
 *  disconnect, rather than let Node's write queue grow unbounded (a memory leak). */
export const MAX_BUFFERED = 4 * 1024 * 1024;

/** The Sec-WebSocket-Accept value for a client's Sec-WebSocket-Key. */
export function acceptKey(key) {
  return createHash('sha1')
    .update(key + GUID)
    .digest('base64');
}

/** Encode one unmasked server → client frame. FIN is always set (no fragmentation). */
export function encodeFrame(payload, opcode = OP_TEXT) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));
  const len = data.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
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

/**
 * Pull every complete frame out of an accumulating buffer, unmasking where the sender
 * masked (browser → server frames always are; server → client frames never are, so this
 * decodes both directions). Returns the leftover bytes for the next chunk.
 *
 * `overflow` is set when a peer declares a frame larger than MAX_FRAME_BYTES — the caller
 * must destroy the socket rather than keep accumulating.
 *
 * @returns {{ frames: {opcode:number, payload:Buffer}[], rest: Buffer, overflow?: boolean }}
 */
export function decodeFrames(buf) {
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
    if (len > MAX_FRAME_BYTES) return { frames, rest: buf.subarray(offset), overflow: true };
    let maskKey;
    if (masked) {
      if (p + 4 > buf.length) break;
      maskKey = buf.subarray(p, p + 4);
      p += 4;
    }
    if (p + len > buf.length) break; // frame not fully arrived yet
    let payload = buf.subarray(p, p + len);
    if (masked) {
      const out = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) out[i] = payload[i] ^ maskKey[i & 3];
      payload = out;
    }
    frames.push({ opcode, payload });
    offset = p + len;
  }
  return { frames, rest: buf.subarray(offset) };
}

/**
 * Minimal broadcast WebSocket server — zero dependencies, Node stdlib only.
 *
 * The hub already runs an HTTP server on the LAN for node ingest; this bolts a
 * server → client WebSocket channel onto the same port so a browser on the same
 * network (the dashboard) gets sensor readings the instant a node reports them —
 * no cloud round-trip, works fully off-grid. It is deliberately one-directional:
 * the hub pushes JSON frames out; inbound client frames are only handled enough to
 * keep the socket healthy (ping → pong) and clean (close). We hand-roll the RFC 6455
 * framing rather than pull in `ws`, to keep the hub's near-zero-dependency footprint.
 */

import { createHash } from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const OP_TEXT = 0x1;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;
// A stalled reader whose kernel send buffer grows past this is a slow consumer we
// disconnect, rather than let Node's write queue grow unbounded (a memory leak).
const MAX_BUFFERED = 4 * 1024 * 1024;

function acceptKey(key) {
  return createHash('sha1').update(key + GUID).digest('base64');
}

// Encode one unmasked server → client frame. FIN is always set (no fragmentation).
function encodeFrame(payload, opcode = OP_TEXT) {
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

// Largest client frame we'll accept. Without this cap a client can declare a
// multi-GB frame length and we'd buffer it all before rejecting → OOM.
const MAX_FRAME_BYTES = 1024 * 1024;

// Pull every complete frame out of an accumulating buffer, unmasking client payloads
// (browser → server frames are always masked). Returns leftover bytes for the next chunk.
// `overflow` is set when a client declares a frame larger than MAX_FRAME_BYTES — the
// caller must destroy the socket rather than keep accumulating.
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

/**
 * Attach a broadcast WebSocket endpoint to an existing http.Server.
 *
 * @param {import('node:http').Server} server
 * @param {{ path?: string, onConnect?: (send: (msg: unknown) => void) => void,
 *           authorize?: (req: import('node:http').IncomingMessage) => boolean }} opts
 *   onConnect fires per new client with a `send` fn — use it to push an initial snapshot.
 *   authorize (optional) gates each upgrade; return false to reject before the handshake.
 * @returns {{ broadcast: (msg: unknown) => void, close: () => void, get size(): number }}
 */
export function attachWebSocket(server, { path = '/live', onConnect, authorize } = {}) {
  const clients = new Set();

  server.on('upgrade', (req, socket) => {
    const url = (req.url || '').split('?')[0];
    const key = req.headers['sec-websocket-key'];
    if (url !== path || !key || (authorize && !authorize(req))) {
      socket.destroy();
      return;
    }
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`,
    );
    socket.setNoDelay(true);
    clients.add(socket);

    const send = (msg) => {
      try {
        socket.write(encodeFrame(typeof msg === 'string' ? msg : JSON.stringify(msg), OP_TEXT));
      } catch {
        /* dead socket — drop handler below cleans it up */
      }
    };

    let buf = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const { frames, rest, overflow } = decodeFrames(buf);
      if (overflow) {
        socket.destroy();
        return;
      }
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
        // Client text/binary frames are ignored — this channel is server → client only.
      }
    });

    const drop = () => clients.delete(socket);
    socket.on('close', drop);
    socket.on('error', drop);

    if (onConnect) {
      try {
        onConnect(send);
      } catch {
        /* a throwing snapshot must not kill the connection */
      }
    }
  });

  // Keepalive ping so idle NATs/proxies don't sever the link and dead sockets surface.
  const pinger = setInterval(() => {
    for (const socket of clients) {
      try {
        socket.write(encodeFrame('', OP_PING));
      } catch {
        clients.delete(socket);
      }
    }
  }, 30_000);
  if (pinger.unref) pinger.unref();

  const broadcast = (msg) => {
    if (clients.size === 0) return;
    const frame = encodeFrame(typeof msg === 'string' ? msg : JSON.stringify(msg), OP_TEXT);
    for (const socket of clients) {
      try {
        socket.write(frame);
        if (socket.writableLength > MAX_BUFFERED) {
          clients.delete(socket);
          socket.destroy(); // slow consumer — cut it instead of buffering forever
        }
      } catch {
        clients.delete(socket);
      }
    }
  };

  const close = () => {
    clearInterval(pinger);
    for (const socket of clients) {
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
    }
    clients.clear();
  };

  return {
    broadcast,
    close,
    get size() {
      return clients.size;
    },
  };
}

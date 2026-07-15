/**
 * Minimal broadcast WebSocket server — zero dependencies, Node stdlib only.
 *
 * The hub already runs an HTTP server on the LAN for node ingest; this bolts a
 * server → client WebSocket channel onto the same port so a browser on the same
 * network (the dashboard) gets sensor readings the instant a node reports them —
 * no cloud round-trip, works fully off-grid. It is deliberately one-directional:
 * the hub pushes JSON frames out; inbound client frames are only handled enough to
 * keep the socket healthy (ping → pong) and clean (close). The RFC 6455 wire format
 * lives in ./ws-frame.mjs — shared with the cloud relay, so there is one framing
 * implementation rather than a copy per server.
 */

import { acceptKey, decodeFrames, encodeFrame, MAX_BUFFERED, OP_CLOSE, OP_PING, OP_PONG, OP_TEXT } from './ws-frame.mjs';

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

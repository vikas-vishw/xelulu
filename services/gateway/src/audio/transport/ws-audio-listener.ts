// The Audio_Server transport (design D6, D7, D8, Req 9.1–9.3, 9.6, 21.2): node:http plus `ws` in
// noServer mode, perMessageDeflate off, maxPayload 65,536 bytes. A plain HTTP request is answered
// 426. An upgrade is accepted on any path only with `Authorization: Bearer <non-empty token>`
// whose token names a device; anything else gets `401 Unauthorized` with `Connection: close`, the
// socket is destroyed and onAuthFailed is called. Each message reaches the core as an AudioInbound:
// a binary frame carries its byte length and its bytes, which the core hands to the turn's
// Stt_Session inside this handler; nothing here keeps, copies or writes them (Req 14.2). A
// message over maxPayload becomes `too_large` (D7). A socket closed by the core is terminated
// 1,000 ms later if it is still open (Req 9.8). Nothing here logs.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";

import { WebSocket, WebSocketServer, type RawData } from "ws";

import type { AudioInbound, AudioListen, AudioSocket } from "../audio-transport.js";

/** Every WebSocket message is capped here, text or binary (D7, G53). */
export const AUDIO_MAX_PAYLOAD_BYTES = 65_536;
/** A socket still open this long after the core closed it is terminated (Req 9.8). */
export const TERMINATE_AFTER_MS = 1_000;

const BEARER_PREFIX = "Bearer ";
const UNAUTHORIZED_RESPONSE =
  "HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n";

/** True for exactly `Bearer <non-empty token>`. */
export function isBearerHeader(header: string | undefined): header is string {
  return (
    header !== undefined && header.startsWith(BEARER_PREFIX) && header.length > BEARER_PREFIX.length
  );
}

function byteLengthOf(data: RawData): number {
  if (Array.isArray(data)) return data.reduce((n, chunk) => n + chunk.byteLength, 0);
  return data.byteLength;
}

function textOf(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return data.toString("utf8");
}

/** The message's bytes as one view. `ws` hands us a Buffer, which already is a Uint8Array. */
function bytesOf(data: RawData): Uint8Array {
  if (Array.isArray(data)) return Buffer.concat(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return data;
}

/** Converts one message; a binary frame's bytes are passed straight through (Req 14.2). */
function toInbound(data: RawData, isBinary: boolean): AudioInbound {
  const byteLength = byteLengthOf(data);
  return isBinary
    ? { kind: "binary", bytes: bytesOf(data), byteLength }
    : { kind: "text", text: textOf(data), byteLength };
}

function adapt(ws: WebSocket): AudioSocket {
  const handlers: ((message: AudioInbound) => void)[] = [];
  let closedSeen = false;
  let terminateTimer: ReturnType<typeof setTimeout> | null = null;

  const deliver = (message: AudioInbound): void => {
    for (const fn of handlers) fn(message);
  };

  ws.on("message", (data: RawData, isBinary: boolean) => {
    deliver(toInbound(data, isBinary));
  });
  ws.on("error", (err: Error & { code?: unknown }) => {
    // Only the library's error code is read, never its message (D7).
    if (err.code === "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH") deliver({ kind: "too_large" });
  });
  ws.on("close", () => {
    if (terminateTimer !== null) clearTimeout(terminateTimer);
    terminateTimer = null;
    if (closedSeen) return;
    closedSeen = true;
    deliver({ kind: "closed" });
  });

  return {
    sendText(text) {
      if (ws.readyState === WebSocket.OPEN) ws.send(text);
    },
    sendBinary(frame) {
      if (ws.readyState === WebSocket.OPEN) ws.send(frame, { binary: true });
    },
    close(code) {
      if (ws.readyState === WebSocket.CLOSED) return;
      ws.close(code);
      if (terminateTimer === null) {
        terminateTimer = setTimeout(() => {
          terminateTimer = null;
          if (ws.readyState !== WebSocket.CLOSED) ws.terminate();
        }, TERMINATE_AFTER_MS);
      }
    },
    onInbound(fn) {
      handlers.push(fn);
    },
  };
}

function refuseUpgrade(socket: Duplex): void {
  socket.once("finish", () => socket.destroy());
  socket.end(UNAUTHORIZED_RESPONSE);
}

/** Plain HTTP on the audio port: 426, nothing else. */
function upgradeRequired(_req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(426, { Connection: "close", "Content-Length": "0" });
  res.end();
}

export const listenWsAudio: AudioListen = (opts) =>
  new Promise((resolve, reject) => {
    const server = createServer(upgradeRequired);
    const wss = new WebSocketServer({
      noServer: true,
      perMessageDeflate: false,
      maxPayload: AUDIO_MAX_PAYLOAD_BYTES,
    });
    // The server-level error never carries anything we log.
    wss.on("error", () => undefined);

    server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      socket.on("error", () => undefined);
      const header = req.headers.authorization;
      const deviceId = isBearerHeader(header) ? opts.authenticate(header) : null;
      if (deviceId === null) {
        refuseUpgrade(socket);
        opts.onAuthFailed();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        opts.onTurn(deviceId, adapt(ws));
      });
    });
    server.on("clientError", (_err, socket: Duplex) => {
      socket.destroy();
    });

    const onListenError = (): void => {
      server.close();
      reject(new Error());
    };
    server.once("error", onListenError);
    server.listen(opts.port, opts.host, () => {
      server.off("error", onListenError);
      server.on("error", () => undefined);
      const port = (server.address() as AddressInfo).port;
      resolve({
        port,
        close: () =>
          new Promise<void>((done) => {
            for (const ws of wss.clients) ws.terminate();
            wss.close();
            server.close(() => done());
            server.closeAllConnections();
          }),
      });
    });
  });

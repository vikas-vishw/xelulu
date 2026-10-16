// The audio turn client's transport (design "Audio turn client", Req 1.6, 1.9, 18.1, 18.3, 18.6,
// 21.2): one `ws` client socket per turn to `AUDIO_WSS_URL`, with `Authorization: Bearer <token>`,
// perMessageDeflate off, maxPayload 65,536 bytes and a 5 s handshake timeout. An upgrade answered
// with anything but 101 rejects with `upgrade_refused`; every other failure before the socket
// opens rejects with `connect_failed`. No other detail is given and nothing here logs.
//
// A reply frame reaches the core as the event "binary" only: its bytes are dropped in the message
// handler, so no reference to them outlives it. Text messages go up as text.
//
// TLS: Node's defaults over node:tls, so the certificate chain and host name are always verified
// for `wss`. The only trust option is extra trust anchors (`ca`), passed by a test, never from the
// Config; nothing here can turn verification off. A failed handshake ends the attempt before the
// upgrade request is sent, so the token never leaves the process (Req 1.9).
import { WebSocket, type RawData } from "ws";

import type {
  AudioOpenFailure,
  ClientAudioInbound,
  ClientAudioSocket,
  OpenAudioSocket,
} from "../audio-transport.js";

/** Every WebSocket message is capped here, text or binary (D7). */
export const AUDIO_CLIENT_MAX_PAYLOAD_BYTES = 65_536;
/** The opening handshake must finish within this time. */
export const AUDIO_CLIENT_HANDSHAKE_TIMEOUT_MS = 5_000;
/** A socket still open this long after `close()` is terminated. */
export const AUDIO_CLIENT_TERMINATE_AFTER_MS = 1_000;

const BEARER_PREFIX = "Bearer ";

/** Extra trust anchors (PEM). Adds trust; never weakens verification. Not a Config field. */
export type AudioTrust = Readonly<{ ca?: string }>;

function textOf(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return data.toString("utf8");
}

function adapt(ws: WebSocket): ClientAudioSocket {
  const handlers: ((message: ClientAudioInbound) => void)[] = [];
  let closedSeen = false;
  let terminateTimer: ReturnType<typeof setTimeout> | null = null;

  const deliver = (message: ClientAudioInbound): void => {
    for (const fn of handlers) fn(message);
  };

  ws.on("message", (data: RawData, isBinary: boolean) => {
    // A binary frame's bytes are dropped here: only the event goes up (Req 18.3, 21.2).
    deliver(isBinary ? { kind: "binary" } : { kind: "text", text: textOf(data) });
  });
  // An error is always followed by `close`; its value is never read.
  ws.on("error", () => undefined);
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
    close() {
      if (ws.readyState === WebSocket.CLOSED) return;
      ws.close(1000);
      if (terminateTimer === null) {
        terminateTimer = setTimeout(() => {
          terminateTimer = null;
          if (ws.readyState !== WebSocket.CLOSED) ws.terminate();
        }, AUDIO_CLIENT_TERMINATE_AFTER_MS);
        terminateTimer.unref();
      }
    },
    onInbound(fn) {
      handlers.push(fn);
    },
  };
}

/** An OpenAudioSocket over `ws`. `trust` is a test hook for extra trust anchors only. */
export function createWsAudioClient(trust: AudioTrust = {}): OpenAudioSocket {
  return (url, token) =>
    new Promise<ClientAudioSocket>((resolve, reject) => {
      let settled = false;
      const fail = (reason: AudioOpenFailure): void => {
        if (settled) return;
        settled = true;
        reject(reason);
      };

      let ws: WebSocket;
      try {
        ws = new WebSocket(url, {
          headers: { Authorization: BEARER_PREFIX + token },
          perMessageDeflate: false,
          maxPayload: AUDIO_CLIENT_MAX_PAYLOAD_BYTES,
          handshakeTimeout: AUDIO_CLIENT_HANDSHAKE_TIMEOUT_MS,
          ...(trust.ca === undefined ? {} : { ca: trust.ca }),
        });
      } catch {
        // An address `ws` refuses outright; its message is never read.
        fail("connect_failed");
        return;
      }

      ws.on("unexpected-response", (_req, res) => {
        fail("upgrade_refused");
        res.resume();
        ws.terminate();
      });
      ws.on("error", () => fail("connect_failed"));
      ws.on("close", () => fail("connect_failed"));
      ws.once("open", () => {
        if (settled) {
          ws.terminate();
          return;
        }
        settled = true;
        ws.removeAllListeners("error");
        ws.removeAllListeners("close");
        resolve(adapt(ws));
      });
    });
}

/** The process's audio client: Node's TLS defaults, no extra trust anchors. */
export const openWsAudio: OpenAudioSocket = createWsAudioClient();

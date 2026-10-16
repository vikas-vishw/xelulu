// The Operator_Surface transport (Req 13.7, 13.10, D10; Phase 1.3 Req 3.1): node:http on the host
// it is given, 127.0.0.1 unless the gateway is in Local_Mode with the Listen_All_Argument, which
// gives 0.0.0.0. The Host and Origin checks are unchanged either way. For each request it runs the header checks first (no body byte is read for a refused request),
// then reads the body with an 8 KiB cap: on a `Content-Length` over the cap, or once the running
// count passes it, it stops reading, answers 413 with `Connection: close` and destroys the socket
// after the response; the listener keeps serving later requests. A request for the
// Operator_Stream path (Phase 1.3 Req 1.1) then goes to openStream with a sink over the response:
// the first write sends 200 and the stream headers, pending() is the unflushed byte count, and
// the response's `close` event closes the stream (Req 1.8, 1.9); a refusal is sent like any
// other response. Everything else is the pure route handler's. Nothing here logs or echoes a
// request value.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import {
  BODY_TOO_LARGE_RESPONSE,
  OPERATOR_BODY_LIMIT_BYTES,
  OPERATOR_RESPONSE_HEADERS,
  OPERATOR_STREAM_HEADERS,
  OPERATOR_STREAM_PATH,
  type HttpRequestIn,
  type HttpResponseOut,
  type OperatorListen,
} from "../operator-routes.js";
import type { StreamSink } from "../operator-stream.js";
import type { GuardHead } from "../request-guard.js";

type OpenStream = (request: HttpRequestIn, sink: StreamSink) => HttpResponseOut | null;

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/** Path and query from the request target; the query object has no prototype. */
function splitTarget(target: string): { path: string; query: Record<string, string> } {
  const q = target.indexOf("?");
  const path = q === -1 ? target : target.slice(0, q);
  const query: Record<string, string> = Object.create(null) as Record<string, string>;
  if (q !== -1) {
    for (const [key, value] of new URLSearchParams(target.slice(q + 1))) {
      if (!Object.hasOwn(query, key)) query[key] = value;
    }
  }
  return { path, query };
}

function send(res: ServerResponse, out: HttpResponseOut, closeAfter = false): void {
  const json = JSON.stringify(out.body);
  res.writeHead(out.status, {
    ...OPERATOR_RESPONSE_HEADERS,
    "Content-Length": String(Buffer.byteLength(json)),
    ...(closeAfter ? { Connection: "close" } : {}),
  });
  res.end(json);
}

/** 413, then the socket is destroyed once the response is written. */
function sendTooLarge(req: IncomingMessage, res: ServerResponse): void {
  req.removeAllListeners("data");
  req.pause();
  res.once("finish", () => req.socket.destroy());
  send(res, BODY_TOO_LARGE_RESPONSE, true);
}

/** Hands the response to openStream as a StreamSink, or sends its refusal. */
function serveStream(res: ServerResponse, request: HttpRequestIn, openStream: OpenStream): void {
  // The client may have gone while the request was read: nothing to open then.
  if (res.destroyed) return;

  let responseClosed = false;
  const onClose: (() => void)[] = [];
  res.once("close", () => {
    responseClosed = true;
    for (const fn of onClose.splice(0)) fn();
  });

  const sink: StreamSink = {
    write(chunk) {
      if (responseClosed || res.writableEnded) return;
      if (!res.headersSent) res.writeHead(200, OPERATOR_STREAM_HEADERS);
      res.write(chunk);
    },
    pending: () => res.writableLength,
    end() {
      if (!res.writableEnded) res.end();
    },
    onClose(fn) {
      if (responseClosed) fn();
      else onClose.push(fn);
    },
  };

  const refusal = openStream(request, sink);
  if (refusal === null) return;
  // A refusal comes before any write; if one was written anyway, the stream just ends.
  if (res.headersSent) sink.end();
  else send(res, refusal);
}

export const listenOperatorHttp: OperatorListen = (opts) =>
  new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const { path, query } = splitTarget(req.url ?? "/");
      const head: GuardHead = {
        method: req.method ?? "",
        path,
        host: header(req, "host"),
        origin: header(req, "origin"),
        contentType: header(req, "content-type"),
      };
      const refused = opts.preflight(head);
      if (refused !== null) {
        send(res, refused, true);
        return;
      }

      const declared = header(req, "content-length");
      if (declared !== undefined && Number(declared) > OPERATOR_BODY_LIMIT_BYTES) {
        sendTooLarge(req, res);
        return;
      }

      const chunks: Buffer[] = [];
      let total = 0;
      let refusedBody = false;
      req.on("data", (chunk: Buffer) => {
        if (refusedBody) return;
        total += chunk.byteLength;
        if (total > OPERATOR_BODY_LIMIT_BYTES) {
          refusedBody = true;
          chunks.length = 0;
          sendTooLarge(req, res);
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => {
        if (refusedBody) return;
        const body = Buffer.concat(chunks).toString("utf8");
        const request: HttpRequestIn = { ...head, query, body };
        if (path === OPERATOR_STREAM_PATH) {
          serveStream(res, request, opts.openStream.bind(opts));
          return;
        }
        send(res, opts.handle(request));
      });
      req.on("error", () => undefined);
    });
    server.on("clientError", (_err, socket) => {
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
            server.close(() => done());
            server.closeAllConnections();
          }),
      });
    });
  });

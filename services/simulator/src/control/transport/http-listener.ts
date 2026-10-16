// The Control_Surface transport (Req 20.1, 20.6, 20.7, D10; Phase 1.3 Req 3.2): node:http on the
// host the simulator picks (127.0.0.1 only, in every mode, except 0.0.0.0 in Local_Mode with the
// Listen_All_Argument). For each request it runs the header checks first (no body byte is read for a
// refused request), then reads the body with a 16 KiB cap: on a `Content-Length` over the cap, or
// once the running count passes it, it stops reading, answers 413 with `Connection: close` and
// destroys the socket after the response; the listener keeps serving later requests. Everything
// else is the pure route handler's, which builds complete responses (status, headers and body).
// Nothing here logs or echoes a request value.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import {
  CONTROL_BODY_LIMIT_BYTES,
  type ControlListen,
  type ControlResponseOut,
} from "../control-routes.js";
import type { GuardHead } from "../request-guard.js";

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

function send(res: ServerResponse, out: ControlResponseOut, closeAfter = false): void {
  res.writeHead(out.status, {
    ...out.headers,
    "Content-Length": String(Buffer.byteLength(out.body)),
    ...(closeAfter ? { Connection: "close" } : {}),
  });
  res.end(out.body);
}

/** 413, then the socket is destroyed once the response is written. */
function sendTooLarge(req: IncomingMessage, res: ServerResponse, out: ControlResponseOut): void {
  req.removeAllListeners("data");
  req.pause();
  res.once("finish", () => req.socket.destroy());
  send(res, out, true);
}

export const listenControlHttp: ControlListen = (opts) =>
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
      if (declared !== undefined && Number(declared) > CONTROL_BODY_LIMIT_BYTES) {
        sendTooLarge(req, res, opts.bodyTooLarge());
        return;
      }

      const chunks: Buffer[] = [];
      let total = 0;
      let refusedBody = false;
      req.on("data", (chunk: Buffer) => {
        if (refusedBody) return;
        total += chunk.byteLength;
        if (total > CONTROL_BODY_LIMIT_BYTES) {
          refusedBody = true;
          chunks.length = 0;
          sendTooLarge(req, res, opts.bodyTooLarge());
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => {
        if (refusedBody) return;
        const body = Buffer.concat(chunks).toString("utf8");
        send(res, opts.handle({ ...head, query, body }));
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

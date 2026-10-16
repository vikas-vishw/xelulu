// The simulator CLI's HTTP client (Req 20.4): calls only 127.0.0.1 at the Config's
// SIMULATOR_PANEL_PORT, with a 5 s budget for the whole exchange. Any failure (refused, reset,
// timeout) is one plain rejection with no detail. It sends no `Origin`. Used by cli.ts only.
import { request } from "node:http";

export const CONTROL_CLIENT_TIMEOUT_MS = 5_000;
const LOOPBACK = "127.0.0.1";

export type ControlClientRequest = Readonly<{
  port: number;
  method: "GET" | "POST";
  /** Path starting with `/`. */
  path: string;
  /** JSON text for POST. */
  body?: string;
  timeoutMs?: number;
}>;

export type ControlClientResponse = Readonly<{ status: number; body: string }>;

export function callControl(req: ControlClientRequest): Promise<ControlClientResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const headers: Record<string, string> = { Host: `${LOOPBACK}:${req.port}` };
    if (req.body !== undefined) {
      headers["Content-Type"] = "application/json; charset=utf-8";
      headers["Content-Length"] = String(Buffer.byteLength(req.body));
    }

    const outgoing = request(
      { host: LOOPBACK, port: req.port, method: req.method, path: req.path, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          settle(() => resolve({ status: res.statusCode ?? 0, body }));
        });
        res.on("error", () => settle(() => reject(new Error())));
      },
    );
    const timer = setTimeout(() => {
      settle(() => reject(new Error()));
      outgoing.destroy();
    }, req.timeoutMs ?? CONTROL_CLIENT_TIMEOUT_MS);
    outgoing.on("error", () => settle(() => reject(new Error())));
    outgoing.end(req.body);
  });
}

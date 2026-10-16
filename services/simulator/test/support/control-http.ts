// Test helper (not a test): raw loopback HTTP requests to the Control_Surface with full control of
// the method, path, headers and body (the CLI's client always sends a correct Host), and a runner
// for the built simulator CLI (`dist/cli.js`) as a child process. Copied from the gateway's test
// support (services and their tests never import each other). The CLI runner is asynchronous on
// purpose: the simulator under test runs in this process and must keep answering while the CLI
// waits.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { request, type IncomingHttpHeaders } from "node:http";
import { fileURLToPath } from "node:url";

export const SIMULATOR_DIR = fileURLToPath(new URL("../..", import.meta.url));
export const CLI_PATH = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));
export const INDEX_PATH = fileURLToPath(new URL("../../dist/index.js", import.meta.url));

export type RawResponse = Readonly<{ status: number; headers: IncomingHttpHeaders; body: string }>;

export type RawRequest = Readonly<{
  method?: string;
  path?: string;
  /** Added to (or, when undefined, removed from) the default Host and Content-Type headers. */
  headers?: Readonly<Record<string, string | undefined>>;
  /** One string is sent with a Content-Length; an array is sent chunked, one write per item. */
  body?: string | readonly string[];
}>;

export function rawRequest(port: number, req: RawRequest = {}): Promise<RawResponse> {
  const method = req.method ?? "GET";
  const headers: Record<string, string> = { Host: `127.0.0.1:${port}` };
  if (typeof req.body === "string") {
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = String(Buffer.byteLength(req.body));
  } else if (req.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  for (const [k, v] of Object.entries(req.headers ?? {})) {
    for (const existing of Object.keys(headers)) {
      if (existing.toLowerCase() === k.toLowerCase()) delete headers[existing];
    }
    if (v !== undefined) headers[k] = v;
  }

  return new Promise((resolve, reject) => {
    let answered = false;
    const outgoing = request(
      { host: "127.0.0.1", port, method, path: req.path ?? "/api/state", headers, agent: false },
      (res) => {
        answered = true;
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
        res.on("error", () => undefined);
      },
    );
    outgoing.on("error", (err) => {
      if (!answered) reject(err);
    });
    if (Array.isArray(req.body)) {
      for (const chunk of req.body) outgoing.write(chunk);
      outgoing.end();
    } else {
      outgoing.end(req.body);
    }
  });
}

export type CliResult = Readonly<{
  code: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}>;

/** Fails with a clear message when the simulator has not been built. */
export function requireBuilt(path: string = CLI_PATH): void {
  if (!existsSync(path)) {
    throw new Error("dist/ is missing: run `corepack pnpm build` first");
  }
}

/** Runs `node <script> <args>` with `env` in the simulator folder, asynchronously. */
export function runNode(
  script: string,
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  timeoutMs = 15_000,
): Promise<CliResult> {
  requireBuilt(script);
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: SIMULATOR_DIR,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (s: string) => (stdout += s));
    child.stderr.on("data", (s: string) => (stderr += s));
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, durationMs: performance.now() - started });
    });
  });
}

/** Runs `node dist/cli.js <args>` with `env`, asynchronously. */
export function runCli(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  timeoutMs = 15_000,
): Promise<CliResult> {
  return runNode(CLI_PATH, args, env, timeoutMs);
}

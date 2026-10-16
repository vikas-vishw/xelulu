// Operator CLI (Req 13.2, 13.6, 13.9), built to dist/cli.js:
//   node dist/cli.js devices
//   node dist/cli.js log [--after <seq>]
//   node dist/cli.js send <device_id> <action> <data-json>
//   node dist/cli.js conversation
//   node dist/cli.js brain
//   node dist/cli.js transcripts delete-all
// It reads the Config through env.ts, calls only 127.0.0.1 at the Config's operator port, and
// prints the response body as one JSON line on stdout. Exit codes:
//   0 success response · 1 error response · 2 usage error · 3 surface not reachable within 5 s
//   4 not in Local_Mode · 5 config error
// Every stderr line is fixed text or key names; no env value, request value or token is printed.
process.removeAllListeners("warning");

import { writeConfigError } from "./config-error-writer.js";
import { readGatewayConfig } from "./env.js";
import { callOperator, type OperatorClientRequest } from "./operator/transport/http-client.js";

export const CLI_EXIT = Object.freeze({
  ok: 0,
  errorResponse: 1,
  usage: 2,
  unreachable: 3,
  notLocal: 4,
  config: 5,
});

const USAGE_LINE =
  "usage: cli.js devices | log [--after <seq>] | send <device_id> <action> <data-json>" +
  " | conversation | brain | transcripts delete-all\n";
const UNREACHABLE_LINE = "operator surface not reachable\n";
const NOT_LOCAL_LINE = "operator surface is local-only\n";

type Call = Omit<OperatorClientRequest, "port">;

/** The request for the arguments, or null for a usage error. Never echoes an argument. */
function parseArgs(args: readonly string[]): Call | null {
  const [command, ...rest] = args;
  switch (command) {
    case "devices":
      return rest.length === 0 ? { method: "GET", path: "/v1/devices" } : null;
    case "log": {
      if (rest.length === 0) return { method: "GET", path: "/v1/log" };
      const [flag, seq] = rest;
      if (rest.length !== 2 || flag !== "--after" || seq === undefined || !/^[0-9]+$/.test(seq)) {
        return null;
      }
      return { method: "GET", path: `/v1/log?after=${seq}` };
    }
    case "send": {
      const [deviceId, action, dataJson] = rest;
      if (rest.length !== 3 || deviceId === undefined || action === undefined) return null;
      let data: unknown;
      try {
        data = JSON.parse(dataJson ?? "");
      } catch {
        return null;
      }
      return {
        method: "POST",
        path: "/v1/commands",
        body: JSON.stringify({ device_id: deviceId, action, data }),
      };
    }
    case "conversation":
      return rest.length === 0 ? { method: "GET", path: "/v1/conversation" } : null;
    case "brain":
      return rest.length === 0 ? { method: "GET", path: "/v1/brain" } : null;
    case "transcripts": {
      // The route reads no body field, so an empty object is the whole request (Req 15.6).
      const [operation] = rest;
      if (rest.length !== 1 || operation !== "delete-all") return null;
      return { method: "POST", path: "/v1/transcripts/delete-all", body: "{}" };
    }
    default:
      return null;
  }
}

function writeErr(line: string): void {
  process.stderr.write(line);
}

async function main(args: readonly string[]): Promise<number> {
  const call = parseArgs(args);
  if (call === null) {
    writeErr(USAGE_LINE);
    return CLI_EXIT.usage;
  }

  const config = readGatewayConfig();
  if (!config.ok) {
    writeConfigError(config.offendingKeys);
    return CLI_EXIT.config;
  }
  if (!config.config.localMode) {
    writeErr(NOT_LOCAL_LINE);
    return CLI_EXIT.notLocal;
  }

  let status: number;
  let parsed: unknown;
  try {
    const response = await callOperator({ ...call, port: config.config.operatorPort });
    status = response.status;
    parsed = JSON.parse(response.body);
  } catch {
    // Refused, reset, timed out, or not our surface's JSON.
    writeErr(UNREACHABLE_LINE);
    return CLI_EXIT.unreachable;
  }

  process.stdout.write(JSON.stringify(parsed) + "\n");
  const ok =
    status === 200 &&
    parsed !== null &&
    typeof parsed === "object" &&
    (parsed as { ok?: unknown }).ok === true;
  return ok ? CLI_EXIT.ok : CLI_EXIT.errorResponse;
}

void main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  () => {
    writeErr(UNREACHABLE_LINE);
    process.exitCode = CLI_EXIT.unreachable;
  },
);

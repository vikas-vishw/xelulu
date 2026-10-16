// Simulator CLI (Req 20.2, 20.4, 20.5), built to dist/cli.js:
//   node dist/cli.js state
//   node dist/cli.js event <kind> [<data-json>]
//   node dist/cli.js audio-turn
//   node dist/cli.js online | offline
//   node dist/cli.js duplicate-replay on|off
//   node dist/cli.js ack-policy set <all|action> <reject|fail|accept_only|silent> [<reason>]
//   node dist/cli.js ack-policy clear <all|action>
//   node dist/cli.js battery <pct> <true|false>
// It reads the Config through env.ts and calls only 127.0.0.1 at SIMULATOR_PANEL_PORT, in every
// mode. Exit codes:
//   0 success, the response JSON on stdout · 1 error response, its JSON on stderr
//   2 usage error · 3 no answer within 5 s · 5 config error
// The Control_Surface's responses carry no env value except DEVICE_ID; every other stderr line
// is fixed text or key names. No argument, env value or token is echoed.
process.removeAllListeners("warning");

import { writeConfigError } from "./config-error-writer.js";
import { callControl, type ControlClientRequest } from "./control/transport/http-client.js";
import { readSimulatorConfig } from "./env.js";

export const CLI_EXIT = Object.freeze({
  ok: 0,
  errorResponse: 1,
  usage: 2,
  unreachable: 3,
  config: 5,
});

const USAGE_LINE =
  "usage: cli.js state | event <kind> [<data-json>] | audio-turn | online | offline" +
  " | duplicate-replay on|off | ack-policy set <scope> <mode> [<reason>]" +
  " | ack-policy clear <scope> | battery <pct> <true|false>\n";
const UNREACHABLE_LINE = "control surface not reachable\n";

type Call = Omit<ControlClientRequest, "port">;

const NUMBER = /^-?[0-9]+(?:\.[0-9]+)?$/;

function post(operation: string, body: unknown): Call {
  return { method: "POST", path: "/api/" + operation, body: JSON.stringify(body) };
}

function parseFlag(value: string | undefined, on: string, off: string): boolean | null {
  if (value === on) return true;
  if (value === off) return false;
  return null;
}

function parseAckPolicy(rest: readonly string[]): Call | null {
  const [op, scope, mode, reason] = rest;
  if (op === "clear") {
    return rest.length === 2 && scope !== undefined ? post("ack-policy/clear", { scope }) : null;
  }
  if (op !== "set" || scope === undefined || mode === undefined) return null;
  if (rest.length === 3) return post("ack-policy", { scope, override: { mode } });
  if (rest.length === 4) return post("ack-policy", { scope, override: { mode, reason } });
  return null;
}

/** The request for the arguments, or null for a usage error. */
function parseArgs(args: readonly string[]): Call | null {
  const [command, ...rest] = args;
  switch (command) {
    case "state":
      return rest.length === 0 ? { method: "GET", path: "/api/state" } : null;
    case "event": {
      const [kind, dataJson] = rest;
      if (kind === undefined || rest.length > 2) return null;
      if (dataJson === undefined) return post("events", { event: kind });
      let data: unknown;
      try {
        data = JSON.parse(dataJson);
      } catch {
        return null;
      }
      return post("events", { event: kind, data });
    }
    case "audio-turn":
      return rest.length === 0 ? post("audio-turn", {}) : null;
    case "online":
    case "offline":
      return rest.length === 0 ? post("connection", { online: command === "online" }) : null;
    case "duplicate-replay": {
      const enabled = parseFlag(rest[0], "on", "off");
      return rest.length === 1 && enabled !== null ? post("duplicate-replay", { enabled }) : null;
    }
    case "ack-policy":
      return parseAckPolicy(rest);
    case "battery": {
      const [pct, chargingArg] = rest;
      const charging = parseFlag(chargingArg, "true", "false");
      if (rest.length !== 2 || pct === undefined || !NUMBER.test(pct) || charging === null) {
        return null;
      }
      return post("battery", { battery_pct: Number(pct), charging });
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

  const config = readSimulatorConfig();
  if (!config.ok) {
    writeConfigError(config.offendingKeys);
    return CLI_EXIT.config;
  }

  let status: number;
  let parsed: unknown;
  try {
    const response = await callControl({ ...call, port: config.config.panelPort });
    status = response.status;
    parsed = JSON.parse(response.body);
  } catch {
    // Refused, reset, timed out, or not our surface's JSON.
    writeErr(UNREACHABLE_LINE);
    return CLI_EXIT.unreachable;
  }

  const ok =
    status === 200 &&
    parsed !== null &&
    typeof parsed === "object" &&
    (parsed as { ok?: unknown }).ok === true;
  const line = JSON.stringify(parsed) + "\n";
  if (ok) {
    process.stdout.write(line);
    return CLI_EXIT.ok;
  }
  writeErr(line);
  return CLI_EXIT.errorResponse;
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

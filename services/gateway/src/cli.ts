// Operator CLI (Req 13.2, 13.6, 13.9), built to dist/cli.js:
//   node dist/cli.js devices
//   node dist/cli.js log [--after <seq>]
//   node dist/cli.js send <device_id> <action> <data-json>
//   node dist/cli.js conversation
//   node dist/cli.js brain
//   node dist/cli.js transcripts delete-all
// Phase 4 adds one operation per Operator_Content_Route — twelve of them (Req 16.11) — so every
// read and every write is reachable from `docker compose exec` with no browser:
//   content [--id <content_id>] · grandma · routines · reports
//   content-create <draft-json> · content-update <content_id> <patch-json>
//   content-status <content_id> <draft|active>
//   grandma-consent <purpose> <version> <verification_method>
//   grandma-recording <consent_record_id> <kind> <title> <lang> <duration_s>
//   grandma-schedule <asset_id> <HH:MM> <true|false> · grandma-call <device_id> <op>
//   routine-run <device_id> <routine_id>
// A write answers 403 `content_admin_disabled` unless the gateway runs with --content-admin.
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
  " | conversation | brain | transcripts delete-all | content [--id <content_id>]" +
  " | grandma | routines | reports | content-create <draft-json>" +
  " | content-update <content_id> <patch-json> | content-status <content_id> <status>" +
  " | grandma-consent <purpose> <version> <method>" +
  " | grandma-recording <consent_id> <kind> <title> <lang> <duration_s>" +
  " | grandma-schedule <asset_id> <HH:MM> <true|false> | grandma-call <device_id> <op>" +
  " | routine-run <device_id> <routine_id>\n";
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
      return parseContentArgs(command, rest);
  }
}

/** The twelve Operator_Content_Routes (Req 16.11), or null for a usage error. */
function parseContentArgs(command: string | undefined, rest: readonly string[]): Call | null {
  switch (command) {
    case "content": {
      if (rest.length === 0) return { method: "GET", path: "/v1/content" };
      const [flag, id] = rest;
      if (rest.length !== 2 || flag !== "--id" || id === undefined || id === "") return null;
      return { method: "GET", path: `/v1/content?id=${encodeURIComponent(id)}` };
    }
    case "grandma":
      return rest.length === 0 ? { method: "GET", path: "/v1/grandma" } : null;
    case "routines":
      return rest.length === 0 ? { method: "GET", path: "/v1/routines" } : null;
    case "reports":
      return rest.length === 0 ? { method: "GET", path: "/v1/reports" } : null;
    case "content-create": {
      // The draft is submitted as JSON; the route and the store own every field rule.
      const draft = jsonArg(rest, 1);
      return draft === null ? null : { method: "POST", path: "/v1/content/create", body: draft };
    }
    case "content-update": {
      const [contentId] = rest;
      const patch = jsonArg(rest, 2);
      if (patch === null || contentId === undefined || contentId === "") return null;
      return {
        method: "POST",
        path: "/v1/content/update",
        body: JSON.stringify({ content_id: contentId, patch: JSON.parse(patch) as unknown }),
      };
    }
    case "content-status":
      return body(rest, 2, ([contentId, status]) => ({ content_id: contentId, status }), {
        method: "POST",
        path: "/v1/content/status",
      });
    case "grandma-consent":
      return body(
        rest,
        3,
        ([purpose, version, method]) => ({
          purpose,
          version,
          verification_method: method,
        }),
        { method: "POST", path: "/v1/grandma/consent" },
      );
    case "grandma-recording": {
      const duration = rest[4];
      if (duration === undefined || !/^[0-9]+$/.test(duration)) return null;
      return body(
        rest,
        5,
        ([consentId, kind, title, lang]) => ({
          consent_record_id: consentId,
          kind,
          title,
          lang,
          duration_s: Number(duration),
        }),
        { method: "POST", path: "/v1/grandma/recording" },
      );
    }
    case "grandma-schedule": {
      const enabled = rest[2];
      if (enabled !== "true" && enabled !== "false") return null;
      return body(
        rest,
        3,
        ([assetId, at]) => ({ asset_id: assetId, at, enabled: enabled === "true" }),
        {
          method: "POST",
          path: "/v1/grandma/schedule",
        },
      );
    }
    case "grandma-call":
      return body(rest, 2, ([deviceId, op]) => ({ device_id: deviceId, op }), {
        method: "POST",
        path: "/v1/grandma/call",
      });
    case "routine-run":
      return body(
        rest,
        2,
        ([deviceId, routineId]) => ({ device_id: deviceId, routine: routineId }),
        {
          method: "POST",
          path: "/v1/routines/run",
        },
      );
    default:
      return null;
  }
}

/** The single JSON argument at position `count - 1`, parsed to check it, or null. */
function jsonArg(rest: readonly string[], count: number): string | null {
  if (rest.length !== count) return null;
  const raw = rest[count - 1];
  if (raw === undefined) return null;
  try {
    JSON.parse(raw);
  } catch {
    return null;
  }
  return raw;
}

/**
 * A POST whose body is built from exactly `count` non-empty string arguments. One helper for the
 * six fixed-shape writes, so no handler repeats the arity and emptiness checks.
 */
function body(
  rest: readonly string[],
  count: number,
  build: (args: readonly string[]) => Record<string, unknown>,
  call: Omit<Call, "body">,
): Call | null {
  if (rest.length !== count) return null;
  if (rest.some((arg) => arg === "")) return null;
  return { ...call, body: JSON.stringify(build(rest)) };
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

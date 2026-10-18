// The console's transport for the Device_Control_Route (Phase 6 C10, C11; Req 4.5, 5.7).
//
// Same-origin, JSON in and out, no credentials, and it NEVER throws: a page render can never be
// taken down by a network error or a response shape nobody expected. It mirrors
// `content/content-client.ts`, including THE PROXY RULE — a response that is not this surface's
// JSON means the console is not running in device-control mode, which reads as the typed refusal
// `proxy_disabled` rather than as a silent success.
//
// There is exactly one request path here, and it is the only one in this module. The Gateway
// refuses it with 403 `device_control_disabled` unless it runs in Local_Mode with the
// Device_Control_Argument, so an operator who has not opted in gets a refusal, not a command on
// the wire.
import { PROXY_DISABLED, UNREACHABLE, type FetchLike } from "../content/content-client";

/** The one Device_Control_Route path. */
export const DEVICE_CONTROL_PATH = "/v1/device-control";

/**
 * What a send answered: the `cmd_id` the Gateway minted, or a refusal as the route's error code
 * plus the Policy_Refusal when the Device_Action_Gate was the one that refused. Closed values and
 * ids; the route echoes no submitted value, so neither does this.
 */
export type ControlResult =
  | Readonly<{ ok: true; cmd_id: string }>
  | Readonly<{ ok: false; code: string; refusal: string | null }>;

export interface ControlClient {
  /** Sends one allow-listed command. Movement is refused by the gate, never by this module. */
  send(
    deviceId: string,
    action: string,
    data: Readonly<Record<string, unknown>>,
  ): Promise<ControlResult>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function refuse(code: string): ControlResult {
  return { ok: false, code, refusal: null };
}

export function createControlClient(fetchImpl?: FetchLike): ControlClient {
  const doFetch: FetchLike =
    fetchImpl ?? ((input, init) => fetch(input, init === undefined ? {} : init));

  return {
    async send(deviceId, action, data) {
      let response: Response;
      try {
        response = await doFetch(DEVICE_CONTROL_PATH, {
          method: "POST",
          credentials: "omit",
          headers: { "Content-Type": "application/json" },
          // Exactly the three keys the route accepts; any fourth is 400 `invalid_fields`.
          body: JSON.stringify({ device_id: deviceId, action, data }),
        });
      } catch {
        return refuse(UNREACHABLE);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(await response.text());
      } catch {
        // Not JSON: the dev server answered instead of the Operator_Surface.
        return refuse(PROXY_DISABLED);
      }
      if (!isRecord(parsed) || typeof parsed["ok"] !== "boolean") return refuse(PROXY_DISABLED);

      if (parsed["ok"] === true) {
        const cmdId = parsed["cmd_id"];
        if (typeof cmdId !== "string" || cmdId === "") return refuse(PROXY_DISABLED);
        return { ok: true, cmd_id: cmdId };
      }

      const error = isRecord(parsed["error"]) ? parsed["error"] : {};
      const code = typeof error["code"] === "string" ? error["code"] : PROXY_DISABLED;
      const refusal = typeof parsed["refusal"] === "string" ? parsed["refusal"] : null;
      return { ok: false, code, refusal };
    },
  };
}

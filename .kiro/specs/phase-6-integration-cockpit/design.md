# Design Document: Phase 6 Integration Cockpit

## Overview

Five additions, each behind a seam that already exists:

1. **Document C** — a markdown contract doc describing what Wave 1 builds. No code depends on it.
2. **Gateway `devices/`** — two pure modules (Pairing_Code derivation, Device_Session state machine), fed from the existing inbound handlers. Neither opens a socket.
3. **Shared `gateway-log/stream.ts`** — `DeviceSummary` gains four fields; `DEVICE_SESSION_STATES` is added. Stream-only: not Document B, not a Log_Entry.
4. **Gateway `operator/`** — one route, `POST /v1/device-control`, delegating to the Phase 3 Device_Action_Gate behind `--device-control`.
5. **Admin console** — three pages plus four pure modules, fed by the existing Operator_Stream and, for driven rows only, the new route.

Pairing is recognition of the `hello` that already exists; the session is a projection of messages the Gateway already parses. Choices C1–C17 and the FLAGs are in `requirements.md`.

Flow: simulator → MQTT (`hello`/`status`/`event`/`ack`) → inbound pipeline → `device-session.ts` + `pairing-code.ts` → `device-summary.ts` → Operator_Stream → the three pages. One way back: the Device Control page and the matrix's driven rows POST to `/v1/device-control` at the console's own origin → the Device_Action_Gate → MQTT `cmd`.

## Document C (Wave 1)

`docs/C-pairing-and-device-session.md`, frozen. Sections: status and scope; Part 1 (BLE / Wi-Fi provisioning, reserved); Part 2 — MQTT pairing (connect over MQTTS, subscribe to the `cmd` topic, publish `hello`; a failed match is a refused device, not a retry loop); Part 2 — Pairing_Code; Part 2 — Device_Session (the table below); Part 2 — acks; conformance (a pointer to the Intern_Guide's checklist, so there is one list, not two). Requirement 1 states what each section must say.

| From | Input (Document B message) | To |
|---|---|---|
| any | `hello` accepted on `status` | `connected` |
| any | `hello` with a failed auth match | `error` |
| `connected`/`idle`/`in_turn`/`error` | `status` Heartbeat accepted | `idle` |
| `connected`/`idle` | audio turn opened (`audio_start`) | `in_turn` |
| `in_turn` | `audio_end`, turn aborted, or `interrupt` event | `idle` |
| any | `error` event, or a rejected message on any topic | `error` |
| any | 45 s with no Heartbeat (existing presence rule) | `offline` |
| `offline` | `hello` accepted | `connected` |
| `unpaired` | anything else | `unpaired` |

## Gateway: pairing and session

`services/gateway/src/devices/pairing-code.ts`

```ts
export const PAIRING_CODE_ALPHABET = "0123456789BCDFGHJKLMNPQRSTVWXYZ"; // no vowels
export const PAIRING_CODE_LENGTH = 6;
export function pairingCode(deviceId: string, fwVer: string): string;
```

FNV-1a 32-bit over `deviceId + "\0" + fwVer`, folded into six alphabet indices. Pure, total, two arguments, no secret in scope. A hash, not a cipher: it hides nothing and is not meant to. `device_id` is already on the stream and `fw_ver` is non-secret, so the code reveals nothing new — it is a confirmation the operator can read aloud.

`services/gateway/src/devices/device-session.ts`

```ts
export type DeviceSessionInput =
  | { kind: "hello"; accepted: boolean } | { kind: "heartbeat" }
  | { kind: "turn_open" } | { kind: "turn_closed" }
  | { kind: "device_error" } | { kind: "message_rejected" } | { kind: "silence" };

/** Pure, total: every (state, input) pair answers with a state (Req 2.4, Property 2). */
export function nextSession(s: DeviceSessionState, i: DeviceSessionInput): DeviceSessionState;

export interface DeviceSessions {
  state(id: string): DeviceSessionState;
  fwVer(id: string): string | null;
  pairingCode(id: string): string | null;
  lastAck(id: string): DeviceLastAck | null;
  apply(id: string, input: DeviceSessionInput): void;
  recordHello(id: string, fwVer: string): void;
  recordAck(id: string, ack: DeviceLastAck): void;
}
```

Wired in `gateway.ts` at points that already exist: the hello handler (`recordHello` + `apply`), the status handler (`heartbeat`), the audio turn's open and terminal paths, the `error` event and `message_rejected` paths, the presence timer's offline transition (`silence`), the ack tracker's result (`recordAck`). No new handler, no new subscription — each call sits beside a `GatewayLog` call already there.

**Session state is not logged.** It is derivable from entries the log already holds, so a new kind would be duplication and `GATEWAY_LOG_VERSION` stays 3. Req 2.7 permits an additive bump if implementation finds a real gap; the design does not expect one.

`packages/shared/src/gateway-log/stream.ts` (additive):

```ts
export const DEVICE_SESSION_STATES = Object.freeze([
  "unpaired", "connected", "idle", "in_turn", "error", "offline",
] as const);
export type DeviceSessionState = (typeof DEVICE_SESSION_STATES)[number];
export type DeviceLastAck = Readonly<{
  action: CmdAction; outcome: AckResultOutcome; reason: "" | AckReason | null; cmd_id: string;
}>;
// DeviceSummary gains exactly: session, pairing_code, fw_ver, last_ack — after the Phase 1.3 seven.
```

`buildDeviceSummaries` gains a `sessions: Pick<DeviceSessions, "state" | "fwVer" | "pairingCode" | "lastAck">` source and four explicit fields. `snapshot.ts` and `GET /v1/devices` are untouched.

## Gateway: the Device_Control_Route (Wave 4)

`listen-host.ts` gains `DEVICE_CONTROL_ARGUMENT = "--device-control"` and `deviceControlEnabled(localMode, argv)` — `localMode && argv.includes(...)`, the shape of its two predecessors.

`device-action.ts` gains one method and keeps one gate:

```ts
export type DeviceActionSend =
  | { readonly ok: true; readonly cmd_id: string }
  | { readonly ok: false; readonly refusal: PolicyRefusal }
  | { readonly ok: false; readonly error: CommandError };
// DeviceActions: request() (now calls send), send(), policyRefusal() — unchanged otherwise.
```

`send` runs `policyRefusal` first, then `sendCommand` once; it registers no ack callback and never retries. `request` maps `send`'s answer onto the existing `ToolResult`, so the tool router is unchanged and policy is checked in exactly one place.

In `operator-routes.ts`: `OPERATOR_ROUTES` gains `"/v1/device-control": ["POST"]`; `OperatorErrorCode` gains exactly `device_control_disabled` (403, the flag refusal) and `action_refused` (403, carrying the refusal as a sibling of `error`: `{ ok: false, error: { code: "action_refused" }, refusal: "quiet_hours" }` — the Phase 4 pattern for a refusal that *means* something); `OperatorRouteDeps` gains `deviceControl: () => boolean` and `sendDeviceAction`. Handler order: flag check (before any body byte) → JSON parse → `isPlainObject` → the three-field check on the `COMMAND_FIELDS` pattern → `sendDeviceAction`, with a `CommandError` mapped through the existing `COMMAND_ERROR_STATUS`. `/v1/commands` is not touched. Compose: the gateway service's `command` gains `--device-control` after `--content-admin`, and `compose-static.test.ts`'s expected array gains the same string.

## Admin console (Waves 2–4)

```
apps/admin/src/
  routing/use-hash-page.ts     (changed: + "devices" | "matrix" | "control")
  pages/devices-page.tsx  pages/matrix-page.tsx  pages/control-page.tsx
  devices/zone-activity.ts     (pure: entries -> per-zone last seen)
  matrix/test-matrix.ts        (pure: contract lists -> rows)
  matrix/matrix-state.ts       (pure reducer: rows + entries + requests -> statuses)
  control/control-client.ts    (the one fetch call site for /v1/device-control)
```

**`matrix/test-matrix.ts` — the contract is the matrix.**

```ts
export type MatrixDirection = "driven" | "observed";
export type MatrixRow = Readonly<{
  id: string;             // `cmd:say`, `event:touch`, `zone:belly`, `fixed:audio_turn`
  direction: MatrixDirection;
  group: "cmd" | "event" | "zone" | "fixed";
  member: string | null;  // the contract member, or null for a fixed row
  expectRefusal: boolean; // driven rows: whether the gate is expected to refuse (e.g. move)
}>;
export const FIXED_ROWS = Object.freeze(["audio_turn", "safety_refusal"] as const);
/** Lists are arguments so a test can substitute them (Property 4, Req 4.3). */
export function buildMatrix(lists?: Partial<MatrixLists>): readonly MatrixRow[];
```

Default lists are `CMD_ACTIONS`, `EVENT_KINDS` and `TOUCH_ZONES` from `@xelulu/shared`. Because `apps/` may not import from `services/`, the console derives the allow-list the way the gate does: an exhaustive `Record<CmdAction, boolean>`, so a new action stops the console compiling until someone decides whether an operator may fire it. A type-driven decision table, not a re-listed wire value, so `wire_value_list` stays satisfied with nothing relaxed.

**`matrix/matrix-state.ts` — how a row goes green.** A pure reducer over `(rows, entries, requests)`:

- *Observed* rows match on entry shape: `event:<kind>` on an `event_accepted` with that `event`; `zone:<zone>` on an `event_accepted` touch with that `zone`; `fixed:audio_turn` on `audio_turn` entries completing one `turn_id` (`started` … `reply_ended`); `fixed:safety_refusal` on an `ack_result` with outcome `rejected` and a non-empty `reason`. Evidence is `{ seq, kind, fields }` — closed enums only.
- *Driven* rows match the `ack_result` whose `cmd_id` equals the one the route returned: `done`/`accepted` → `pass`; `rejected`/`failed`/`timed_out` → `fail` with the `reason`; a route refusal → `pass` when `expectRefusal`, else `fail`, with the `PolicyRefusal` as evidence.
- No match leaves the row `pending`. The reducer never guesses.

The page renders observed rows with no run control at all, plus a line saying they originate at the device — fire them from the Simulator panel at `SIMULATOR_PANEL_PORT` during bring-up, or touch the robot later. C9 made visible: the console cannot and must not reach another origin.

**`control/control-client.ts`** mirrors `content/content-client.ts`: own origin, JSON in and out, and the same shape-based `proxy_disabled` refusal when an unproxied POST comes back as the SPA's HTML (what happens outside the device-control dev mode). Minimal `data` per action is a frozen table in the control page, built from the contract's `KNOWN_*` and `LED_*` lists.

**Proxy.** `DEVICE_CONTROL_MODE = "device-control"` plus one proxy key for `/v1/device-control`, forwarded only in that mode, exactly as the write keys are in content-admin mode. Root `package.json` gains `dev:admin:device` (`vite --mode device-control`). Every existing key and mode is unchanged.

## Documents and Repo_Checks

`docs/intern-integration-guide.md` (Wave 5) holds exactly what Requirement 6 lists, in that order, with the conformance checklist built from Document B's message tables and Document C's session table.

- **New:** `tooling/test/matrix-derivation.test.ts` — the matrix module imports the three contract lists, and no file under `apps/admin/src` holds a literal array or union of two or more members of any contract list. It reuses `findContractMisuse` from `tooling/checks/contract-use.ts`, so the detector exists in one place.
- **Changed additively:** `compose-static.test.ts`, `readme.test.ts`, `packages/shared/test/exports.test.ts`.
- **Untouched:** every other Repo_Check, the panel check and fixture, `url-scan`, `secret-scan`, `audio-retention`, `gateway-boundaries`, `service-sources`, `no-direct-send`.

## Named properties

- **Property 1 — Pairing_Code is a pure derivation.** For any `device_id`/`fw_ver`, `pairingCode` returns 6 characters from the alphabet; equal inputs give equal codes; only a changed input can change the code.
- **Property 2 — Device_Session totality.** For every state and every `DeviceSessionInput`, `nextSession` returns a member of `DEVICE_SESSION_STATES`; for any input sequence the state stays a member.
- **Property 3 — The gate decides every send.** For any device, action and policy, `send` puts a command on the wire if and only if `policyRefusal` is null, and returns a `cmd_id` exactly then.
- **Property 4 — The matrix is the contract.** For any substituted lists, `buildMatrix`'s row ids are exactly `cmd:<a>`, `event:<k>` and `zone:<z>` per member plus the two fixed rows — no more, no fewer.
- **Property 5 — Evidence carries no text.** For any entry sequence, every Row_Evidence value is a number, a boolean, an id, or a member of a closed list from `@xelulu/shared`.

Test files are listed per task in `tasks.md`.

## Risks carried forward

- **C17 (surfaced, not acted on):** a physical device on the LAN cannot reach loopback-published surfaces, and Phase 6 changes no bind host.
- **safety.md §9 is untouched and still blocks real providers:** no guard is touched and no provider wired, so none of F1–F6 moves.
- **Quiet hours silence the Device Control page too.** The gate refuses all five actions then, so a night bring-up gets refusals — the existing deliberate behaviour (safety.md §9 item 4). The page shows the `quiet_hours` refusal plainly rather than working around it.

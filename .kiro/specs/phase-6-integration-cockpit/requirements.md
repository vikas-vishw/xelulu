# Requirements Document

## Introduction

Phase 6 builds the **Integration Cockpit**: everything a hardware engineer needs to connect a physical ESP32-S3 and test every feature from the developer console, with no code. It adds one frozen contract doc (Document C), three console pages (Devices, Test Matrix, Device Control), one policy-gated Gateway route, and one no-code guide. The Simulator stands in as the device for **all** verification; nothing waits on the intern.

Document B v2 (`proto_ver` 2) does not change: no wire message, field, enum value or transport is added. Every surface rides the four existing MQTT topics, the existing per-turn audio WebSocket and the existing loopback Operator_Surface.

**Out of scope:** BLE / Wi-Fi provisioning (C2); real STT/LLM/TTS; movement from the console; auth on any local surface; hosted deployment; the parent app; any change to `.env.example`, the panel fixture (23 keys), or an existing Gateway_Log kind or field.

## Choices made (FLAG = needs Omar's nod; approving this spec approves it as written)

- **C1. Document C is markdown**, `docs/C-pairing-and-device-session.md`: B arrived as a `.docx`, C is ours, so a diffable tracked file wins.
- **C2. Two parts.** Part 1 (BLE / Wi-Fi provisioning) is reserved — device-local, before any MQTT connection — which keeps tech.md's "Pairing is defined in Document C" true without inventing a radio protocol. Part 2 (MQTT pairing and session) is fully specified.
- **C3. Pairing uses `hello` as it stands.** The Gateway already matches the `device_id` and `auth` it carries against its Registry, so pairing is recognition, not a new handshake.
- **C4. FLAG: the Pairing_Code is derived, never transmitted.** 6 characters from `device_id` and `fw_ver` only (FNV-1a, Crockford base32 minus vowels so no code reads as a word). A confirmation the operator compares with what firmware logs, not a credential; it never reads `auth`, `DEVICE_TOKEN` or any env value. Flagged because a code on the wire would need a `proto_ver` bump, and this avoids one.
- **C5. The Device_Session is Gateway-owned, derived from existing messages:** `unpaired` → `connected` (hello) → `idle` (Heartbeat) ⇄ `in_turn` (audio turn) → `error` (auth failure, rejected message, `error` event) → `offline` (the existing 45 s rule). The console displays it and never computes it, so console and firmware cannot disagree about what the Gateway saw.
- **C6. Device_Summary grows additively:** `session`, `pairing_code`, `fw_ver`, `last_ack` in `gateway-log/stream.ts`, a stream-only type covered by neither `proto_ver` nor `GATEWAY_LOG_VERSION`. `GET /v1/devices` and `DeviceSnapshot` stay as they are, for the CLI and the Phase 1.2 tests. Session state is not logged: it is derivable from entries the log already carries, so `GATEWAY_LOG_VERSION` stays 3.
- **C7. Touch-zone activity is derived in the console:** `event_accepted` entries already carry `zone` and `gesture`, so the Gateway gains nothing for it.
- **C8. The Test_Matrix is derived from the contract at runtime** by iterating `CMD_ACTIONS`, `EVENT_KINDS` and `TOUCH_ZONES` from `@xelulu/shared`, plus two fixed rows naming no wire value, so a new Document B action becomes a row with no code change.
- **C9. Directionality decides how a row runs — the central rule.** Cloud→device rows (per `CMD_ACTIONS` member) are **driven**: the console POSTs them through the Wave 4 route. Device→cloud rows (`EVENT_KINDS`, the 7 zones, the audio turn, the safety refusal) are **observed**: the console watches the Operator_Stream and greens the row when a matching entry arrives. It must not and cannot cause them — it sends no request to any origin but its own, and these originate at the device. The operator fires them from the Simulator panel during bring-up; the hardware engineer touches the real robot later.
- **C10. A new route, not `/v1/commands`.** `POST /v1/device-control` delegates to the Phase 3 Device_Action_Gate (allow-list say, animate, gesture, led, play; quiet hours, play limit, movement toggle; `move` refused). `/v1/commands` is untouched: the Compose_Acceptance_Check sends `config` through it and `config` is not allow-listed, so gating it would break a green criterion.
- **C11. Its own off-by-default argument,** `--device-control`, Local_Mode only, following `--operator-transcripts` and `--content-admin`. Not the content flag: editing content and firing commands are different powers.
- **C12. One gate, one send.** `DeviceActions` gains `send()` returning `{ ok: true, cmd_id }` or a `PolicyRefusal`, and `request()` is refactored to call it, so there is one path to the wire and one place policy is checked.
- **C13. The matrix lives in console memory only** — session state, no file, no Gateway state, no database. A fresh page is a fresh run, the honest default for a bring-up checklist.
- **C14. Evidence is ids, enums, counts and times:** `cmd_id` plus the ack outcome/reason for a driven row, the entry's `seq`, kind and closed-enum fields for an observed one. No text, ever.
- **C15. No new dependency, including no browser automation.** Browser verification is a written walkthrough plus screenshots, as in Phases 1.3 and 4.
- **C16. The Intern_Guide cross-references, never duplicates:** it points at the README for stack commands and owns only the new material.
- **C17. FLAG (surface, do not act): a real device needs LAN-reachable endpoints.** Compose publishes the local surfaces on host loopback only, so a physical ESP32-S3 on the LAN cannot reach them, and Phase 6 changes no bind host. The guide states what is true — the endpoints come from `MQTT_BROKER_URL` and `AUDIO_WSS_URL`, firmware must be pointed at the host LAN IP — and records that widening a bind host is Omar's decision, because it widens the blast radius beyond loopback.

## Glossary

- **Document C**: `docs/C-pairing-and-device-session.md`, additive to Document B.
- **Pairing_Code**: the 6-character code derived from `device_id` and `fw_ver` (C4).
- **Device_Session**: the Gateway-owned lifecycle of C5; its value is a `DeviceSessionState`.
- **Device_Summary**: the per-device record on the `devices` stream event (Phase 1.3 C3), extended by C6.
- **Test_Matrix / Matrix_Row / Row_Evidence**: the contract-derived checklist, one row of it (`driven` or `observed`), and what turned a row green.
- **Device_Control_Route / Device_Control_Argument**: `POST /v1/device-control` and `--device-control`.
- **Device_Action_Gate**: `createDeviceActions` in `services/gateway/src/brain/tools/device-action.ts`.
- **Intern_Guide**: `docs/intern-integration-guide.md`.
- **Operator_Stream / Operator_Surface / Control_Surface / Local_Mode / Repo_Check / Panel_Key**: as Phases 1.2–1.3 define them.

## Requirements

### Requirement 1: Document C (Wave 1)

**User Story:** As the hardware engineer, I want one short document telling me how my firmware announces itself and what the console will say about it.

1. THE repository SHALL contain `docs/C-pairing-and-device-session.md`, marked frozen, additive to Document B v2, introducing no new topic, message, field or transport, with a Part 1 heading stating that BLE / Wi-Fi provisioning is reserved, device-local and before any MQTT connection.
2. THE Part 2 SHALL specify pairing as `hello` on `xelulu/{device_id}/status` carrying `device_id`, `fw_ver`, `auth` and `proto`, matched against the cloud-issued `device_id` and token, with the existing `auth` log outcome as the result.
3. THE Part 2 SHALL specify the Pairing_Code as derived in the cloud from `device_id` and `fw_ver`, shown in the console, never sent on the wire and never derived from a secret.
4. THE Part 2 SHALL give the C5 states and transitions, naming the Document B message that causes each, and SHALL restate the 15 s Heartbeat and 45 s offline rules as the existing rules they are.
5. THE Document C SHALL state that every ack `status` and `reason` is final and never retried around, and THE `docs/README.md` SHALL gain a Document C table row and a precedence entry below Document B.

### Requirement 2: Pairing and session in the Gateway (Wave 1)

**User Story:** As the implementation engineer, I want the lifecycle and the pairing confirmation computed in one tested place.

1. THE Gateway SHALL derive a 6-character Pairing_Code from `device_id` and `fw_ver` as a pure total function, equal inputs always giving the same code, taking only those two arguments, with no `auth`, `DEVICE_TOKEN`, `MQTT_PASSWORD` or other env value reachable from it.
2. THE Gateway SHALL hold one Device_Session per Registered_Device, starting `unpaired`, applying exactly the C5 transitions, each driven by an already-handled Document B message or the existing presence timer.
3. THE Device_Session SHALL be total: every state accepts every input and answers with a state.
4. WHEN a device goes `offline` and later sends an accepted `hello`, THE Device_Session SHALL return to `connected` with its Pairing_Code unchanged.
5. THE Gateway SHALL put `session`, `pairing_code`, `fw_ver` and `last_ack` on every Device_Summary, with `fw_ver` and `pairing_code` null before the first accepted `hello` and `last_ack` null before the first ack.
6. THE `GET /v1/devices` response, `DeviceSnapshot`, every Log_Entry type and every existing log kind and field SHALL stay unchanged, any Phase 6 log addition being additive with `GATEWAY_LOG_VERSION` bumped by 1; and THE Shared_Package SHALL export `DEVICE_SESSION_STATES`, `DeviceSessionState`, `DeviceLastAck` and the extended `DeviceSummary` from `gateway-log/`, with `packages/shared/test/exports.test.ts` rising by exactly the names added.

### Requirement 3: Devices tab (Wave 2)

**User Story:** As the hardware engineer, I want to see my device appear, prove it is alive, and go quiet when I unplug it.

1. THE Admin_Console SHALL offer a Devices page at its own hash route, in the nav, built from the Operator_Stream and nothing else.
2. THE Devices page SHALL show per Device_Summary: `device_id`, Pairing_Code, session state, presence, `fw_ver`, battery and charging, last Heartbeat time, event counts, and the last ack's action, outcome and `reason`.
3. THE Devices page SHALL show the 7 `TOUCH_ZONES` members, each with the time of the most recent `event_accepted` touch entry it holds for that zone, or a dash.
4. WHEN a device's session state or presence changes on the stream, THE Devices page SHALL show the new value without a reload; WHEN it goes `offline`, THE page SHALL show it offline and clear its in-turn indication, keeping the row so the operator sees what was last seen.
5. THE Devices page SHALL show no token, env value, Panel_Key name or text from any turn, SHALL use a semantic table with a heading or caption, SHALL convey every state as text and never by colour alone, and SHALL add no animation or transition.

### Requirement 4: Test Matrix (Wave 3)

**User Story:** As the hardware engineer, I want a checklist covering every Document B feature that goes green as I prove each one.

1. THE Admin_Console SHALL offer a Test Matrix page whose rows are built at runtime from `CMD_ACTIONS`, `EVENT_KINDS` and `TOUCH_ZONES` imported from `@xelulu/shared`, plus exactly two fixed rows, `audio_turn` and `safety_refusal`.
2. THE Test_Matrix SHALL hold one `driven` row per `CMD_ACTIONS` member and one `observed` row per `EVENT_KINDS` and per `TOUCH_ZONES` member, and no hand-written list of wire values SHALL appear in the console source.
3. WHEN a Document B list gains a member, THE Test_Matrix SHALL gain its row with no console source change; a unit test SHALL prove this with substituted lists.
4. THE Test_Matrix SHALL mark each row `pending`, `running`, `pass` or `fail`, with Row_Evidence on every non-pending row.
5. WHEN the operator runs a `driven` row, THE Admin_Console SHALL POST it to the Device_Control_Route, mark it `pass` when the matching `ack_result` arrives with outcome `done` or `accepted`, and otherwise mark it `fail` with the refusal or ack `reason` as evidence.
6. THE Admin_Console SHALL present a `driven` row for an action outside the allow-list as expected-to-refuse, passing on the route's refusal rather than reading as a broken row.
7. THE Admin_Console SHALL NOT attempt to cause any `observed` row: it SHALL send no request for one and SHALL state on the page that the operator fires it from the Simulator panel during bring-up, or touches the robot afterwards.
8. WHEN a Log_Entry matching an `observed` row arrives, THE Admin_Console SHALL mark that row `pass` with the entry's `seq`, kind and closed-enum fields as evidence; THE `audio_turn` row SHALL match the `audio_turn` entries of one complete turn through the mock brain, and THE `safety_refusal` row SHALL match an `ack_result` with outcome `rejected` and an ack `reason` — the device's on-device refusal reaching the cloud.
9. THE Test Matrix page SHALL show a run total (rows, passed, failed, pending) and let the operator reset a row or all rows to `pending`, and THE Row_Evidence SHALL carry ids, closed enums, counts and times only, never text from any turn.

### Requirement 5: Device Control tab and route (Wave 4)

**User Story:** As the hardware engineer, I want to fire the safe commands by hand and see exactly what the device answered.

1. THE Operator_Surface SHALL answer `POST /v1/device-control` with a body of exactly `device_id`, `action` and `data`, refusing any other key with 400 `invalid_fields` and echoing no value, through the unchanged request guard.
2. IF the Gateway is not in Local_Mode, or was not started with the Device_Control_Argument, THEN THE Operator_Surface SHALL refuse the route with 403 `device_control_disabled` before parsing any body byte.
3. THE Device_Control_Route SHALL send only through the Device_Action_Gate, answer `{ ok: true, cmd_id }` on a send, and answer 403 carrying the `PolicyRefusal` as a closed enum when the gate refuses.
4. THE Device_Control_Route SHALL refuse every action outside `DEVICE_ACTION_ALLOWED`, `move` included, as `action_not_allowed`, and SHALL put nothing on the wire for a refused request.
5. WHILE quiet hours are in force, a play limit is reached, or the movement toggle is off for a movement action, THE Device_Control_Route SHALL refuse with `quiet_hours`, `play_limit` or `movement_off` and send nothing.
6. THE Device_Control_Route SHALL register no ack callback and perform no retry — an ack `reason` is final — and THE `POST /v1/commands` route, its body rules, its error codes and its CLI SHALL stay unchanged.
7. THE Admin_Console SHALL offer a Device Control page with one control per `DEVICE_ACTION_ALLOWED` member (derived, not hand-listed) and a minimal valid `data` per action, showing per request the `cmd_id` and then the ack's action, outcome and `reason` from the stream, stating when the route is disabled, and offering no control for `move` or any other non-allow-listed action.
8. THE dev-server proxy SHALL forward `/v1/device-control` only in the device-control dev mode, following the existing key pattern, and SHALL keep forwarding every current key in every current mode.

### Requirement 6: Intern Integration Guide (Wave 5)

**User Story:** As the hardware engineer who never edits the app, I want one page taking me from a clean checkout to a green matrix.

1. THE repository SHALL contain `docs/intern-integration-guide.md`, written for a hardware engineer, with no code to write and no file to edit, giving the stack commands and cross-referencing the README's local-run section rather than restating it.
2. THE Intern_Guide SHALL say how to find the host LAN IP on Windows, macOS and Linux, SHALL name `MQTT_BROKER_URL`, `AUDIO_WSS_URL`, `DEVICE_ID` and `DEVICE_TOKEN` as the Panel_Keys carrying the firmware's endpoints and identity, and SHALL state that no new key is needed and that local Compose defaults work with no `.env`.
3. THE Intern_Guide SHALL record the C17 FLAG plainly: loopback publishing means a physical device on the LAN cannot reach the local surfaces until Omar rules on widening a bind host, and the Simulator is the stand-in until then.
4. THE Intern_Guide SHALL walk pairing through the Devices tab, including comparing the Pairing_Code with what firmware logs, and what each session state means.
5. THE Intern_Guide SHALL walk the Test Matrix feature by feature, saying per row whether the operator drives it from the console or fires it on the device, and SHALL state that observed rows cannot be driven from the console.
6. THE Intern_Guide SHALL contain a firmware-to-Document-B conformance checklist naming every message firmware must send (`hello`, `status`, each `event` kind), every message it must accept (each `cmd` action, the audio turn frames), every `ack` it must return with its `status` and `reason` values, and the envelope rules (`proto_ver`, `ts`, `cmd_id`, `event_id`, QoS, 15 s Heartbeat, 45 s offline, `proto_ver` mismatch), drawn from Documents B and C; SHALL state that no raw child audio is stored anywhere and that the brain runs on mock providers; and THE `README.md` SHALL link the guide in one line.

### Requirement 7: Invariants that must still hold

**User Story:** As Omar, I want Phase 6 to add a cockpit without widening anything.

1. THE `gateway-contract/` tree SHALL be unchanged — no message, field, enum value, schema or fixture added, renamed or removed — and `PROTO_VER` SHALL stay 2.
2. IF any requirement appears to need a new wire message, field or topic, THEN the implementation SHALL stop and surface it as a blocking FLAG rather than adding it.
3. THE `services/gateway/src/brain/` tree SHALL hold no network import, no `fetch` and no HTTP; the Gateway's only network code SHALL stay under `operator/transport/`, `audio/transport/` and `mqtt/transport/`.
4. THE repository SHALL gain no dependency or devDependency in any manifest, and no browser-automation package.
5. THE Admin_Console SHALL send no request to any origin but its own, and SHALL stay loopback-only, Local_Mode-only and off-by-default behind the unchanged guard (403 foreign `Host`, 403 any `Origin`, 405 wrong method, 404 unknown route).
6. THE voice brain SHALL stay on the mock providers; no Adapter_Scaffold SHALL be configured or wired.
7. THE Gateway_Log SHALL carry ids, closed enums, counts and times only; no Log_Entry SHALL gain a text field; and the store-level Active content gate, the Input_Guard and the Output_Guard SHALL stay unbypassable.
8. THE Device_Action_Gate's allow-list SHALL stay the five conversational actions, with movement excluded from every console path.
9. THE `.env.example` and `tooling/fixtures/approved-panel.txt` SHALL stay unchanged at 23 Panel_Keys. IF a new env key seems needed, THEN it SHALL be surfaced as a FLAG, not added.
10. NO Repo_Check assertion SHALL be deleted or weakened, the contract-use check (`wire_value_list` included) SHALL stay as it is, the code SHALL be TypeScript strict with kebab-case files, PascalCase types and snake_case wire and log fields, and the parent app SHALL stay unchanged.

### Requirement 8: Tests and verification

**User Story:** As the implementation engineer, I want the new logic property-tested and the visual parts walked in a browser.

1. THE gateway tests SHALL include **Property 1** (Pairing_Code is a pure derivation) and **Property 2** (Device_Session totality).
2. THE gateway tests SHALL include **Property 3** (the gate decides every send) plus examples proving `move` is refused as `action_not_allowed` with nothing on the wire, and a `say` inside quiet hours is refused as `quiet_hours` with nothing on the wire.
3. THE gateway tests SHALL show 403 `device_control_disabled` without the argument and outside Local_Mode, the `invalid_fields` body rules, and `POST /v1/commands` behaving exactly as before.
4. THE console tests SHALL include **Property 4** (the matrix is the contract), **Property 5** (evidence carries no text), and proof that a substituted extra action produces exactly one extra row.
5. THE console tests SHALL include smoke and key-interaction tests with the existing React Testing Library setup in `apps/admin/test/*.test.tsx` and a fake EventSource: the Devices row with its session, pairing and zone cells; an observed row greening on a matching entry and offering no run control; a driven row greening on its ack and failing on a refusal; the Device Control page showing a `cmd_id` then its ack.
6. THE tooling tests SHALL include a Repo_Check proving the Test_Matrix is generated from the contract and not hand-listed, and the Compose static Repo_Check SHALL accept the gateway command with the Device_Control_Argument added while keeping every other assertion.
7. WHEN `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm lint`, `pnpm format:check` and `pnpm test` run, each SHALL succeed, and `node tooling/compose/compose-acceptance.ts` SHALL still print its PASSED line with every existing criterion.
8. THE phase SHALL end with a live run recorded in the final report: stack up, Simulator paired, the whole Test_Matrix green, each allow-listed command fired with its ack shown, `move` refused, and Document C's session states observed in order. Screenshots or a written walkthrough stand in for the browser, since no browser-automation dependency is added.

Note: the accessibility criteria cover the basics only. Full WCAG validation needs manual testing with assistive technologies and an expert review.

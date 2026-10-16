# Requirements Document

## Introduction

Phase 1.2 turns the two Phase 0 stubs into working services that speak Document B v2 (`proto_ver` 2) over a real broker:

- `services/gateway` connects to EMQX over MQTT, validates every inbound message with the Phase 1 contract, tracks presence, dedupes events, matches acks to commands, runs the per-turn audio WebSocket server with a fake say reply, and publishes an in-process Gateway_Log stream.
- `services/simulator` is a fake robot. It connects as a device, sends hello and heartbeats, fires events on command, obeys every command action with a contract-valid ack, plays a fake audio turn, and queues and replays events across an offline toggle. A small local Control_Surface drives it.

Every wire type, schema, topic helper and parser comes from `@xelulu/shared` (`packages/shared/src/gateway-contract`, the Phase 1 public exports). Neither service defines a wire shape of its own. Wire behaviour follows Document B v2 and Omar's Phase 1 rulings 1–6 exactly, with no improvements.

This phase has no brain (no STT, LLM or TTS), no Supabase reads or writes, and no real audio codec. Provider seams exist as stubs only.

### Out of scope

- STT, LLM, TTS, guardrails, persona and memory (the voice-loop phase). Provider interfaces exist as stubs that are not called.
- Supabase (Auth, Postgres, Realtime, Storage, Edge Functions). No `supabase-js` dependency is added.
- The admin console UI and its transport to the gateway (Phase 1.3). This phase defines the Gateway_Log shape and an in-process subscription only.
- Opus encoding and decoding. Audio frames in this phase are synthetic placeholders.
- Pairing and provisioning (Document C), including minting device tokens with `DEVICE_PROVISION_SECRET`.
- A persistent device registry, persistent dedupe store and persistent command history (later Supabase specs).
- Hosted deployment (Fly.io), TLS termination for the hosted audio endpoint, and broker ACLs or per-device broker credentials.
- Fetching OTA manifests or images. The simulator never fetches `manifest_url`.
- Pushing an initial `config` command after hello (see OP-G1).
- Firmware.

### Choices made

Each choice below was made without asking. The requirements reflect them. Items marked FLAG need Omar's explicit approval; approving this spec approves them as written.

- **G1. Libraries.** MQTT.js (`mqtt`, 5.x, MIT) for the MQTT client in both services, as tech.md names. `ws` (8.x, MIT) for the gateway's WebSocket server and the simulator's WebSocket client, with `@types/ws` as a dev dependency. Each is exact-pinned and the exact versions are recorded in the design. No other runtime dependency is added to either service. The minimal web panel is plain HTML served by `node:http`, with no framework.
- **G2. Env access.** Each service reads environment variables in exactly one module, `src/env.ts`, with static names only, and only names declared in `.env.example`. Every other module receives a typed, frozen config object. The Phase 0 env-read check is updated to allow exactly this (Requirement 22).
- **G3. Keys used.** Gateway: `APP_ENV`, `MQTT_BROKER_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD`, `AUDIO_WSS_URL`, `DEVICE_ID`, `DEVICE_TOKEN`, `GATEWAY_OPERATOR_PORT`. Simulator: `APP_ENV`, `MQTT_BROKER_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD`, `AUDIO_WSS_URL`, `DEVICE_ID`, `DEVICE_TOKEN`, `SIMULATOR_PANEL_PORT`. Neither service reads the Supabase keys, provider keys, `DEVICE_PROVISION_SECRET` or `OTA_MANIFEST_BASE_URL` in this phase.
- **G4. FLAG: two new panel keys.** The local control surfaces need a port each, and nothing may be hard-coded. This spec adds two keys to `.env.example`, in a new section at the end of the file, so no existing key is removed or reordered: `GATEWAY_OPERATOR_PORT` (`[cloud]`, local only) and `SIMULATOR_PANEL_PORT` (`[device]`, local only). The approved-panel fixture and the Phase 0 panel check are updated to match (Requirement 22).
- **G5. FLAG: gateway reads `DEVICE_ID` and `DEVICE_TOKEN`.** `.env.example` labels both `[device]`. With no Supabase yet, the gateway uses them as a one-device prototype registry: the only Registered_Device is `DEVICE_ID`, and its token is `DEVICE_TOKEN`. A later registry spec replaces this with Supabase. The side legend in `.env.example` is not changed; the README notes the prototype use.
- **G6. FLAG: transport security.** safety.md §7 requires TLS on every hop. Local_Mode is `APP_ENV=local`. In Local_Mode both services also accept plain `mqtt://` and `ws://` (the local Compose network on the developer's machine). In every other case, including `APP_ENV` unset, both require `mqtts://` and `wss://` and refuse to start otherwise. TLS certificate verification is always on and has no off switch. The gateway's WebSocket listener is plain `ws` in this phase; outside Local_Mode, TLS for the audio hop must be terminated in front of it by the hosting platform (deployment spec). `MQTT_USERNAME` and `MQTT_PASSWORD` may be empty only in Local_Mode.
- **G7. Audio listen address.** The gateway listens on the port of `AUDIO_WSS_URL` (or the scheme default, 80 for `ws` and 443 for `wss`). It binds `127.0.0.1` when the URL host is `localhost`, `127.0.0.1` or `[::1]`, and all interfaces otherwise (needed so the simulator container can reach it inside the Compose network; Compose publishes no gateway port). A separate hosted listen port is a deployment-spec item.
- **G8. FLAG: audio WebSocket auth.** Document B says "Device authenticates on connect" but defines no field for the audio socket, and adding a JSON field would change the wire format. The device sends `Authorization: Bearer <DEVICE_TOKEN>` on the WebSocket upgrade request (the ElatoAI pattern), and the gateway finds the device by token. This is an HTTP header, not a Document B message. The header is final for Phases 1.2–5; the intern confirms at Phase 6 (hardware bring-up) that the firmware can send it, and a mismatch found then is handled with a gateway and simulator change, not a wire change (OP-G2, G52).
- **G9. Device identity on MQTT.** The gateway subscribes per Registered_Device to exactly `xelulu/{device_id}/status`, `/event` and `/ack`, built with `buildTopic`. It uses no wildcard subscription. The `device_id` in a topic is checked with `parseTopic`, and a hello whose `device_id` differs from its topic's `device_id` is rejected. The gateway compares hello `auth` with the device's token in constant time. A Registered_Device that sends a hello with the wrong `auth` is marked `auth_failed`, and its status, event and ack messages are dropped until a hello with the right `auth` arrives. Before any hello (for example after a gateway restart), messages from a Registered_Device are accepted, because Document B has no way to ask for a new hello. Broker-level auth is the production guard (out of scope).
- **G10. QoS and sessions.** Commands are published at QoS 1. Hello, events and acks are published at QoS 1. Status is published at QoS 0. Nothing is retained. Both services connect with MQTT 5, a clean start and no persistent session, so the Offline_Queue lives in the simulator, not in the broker. The simulator's MQTT client id is its `device_id`; the gateway's client id is unique per process.
- **G11. OP8 applied.** The simulator subscribes to `xelulu/{device_id}/cmd` only (Document B §7.2), not to `/ack`. This reading is final for Phases 1.2–5; the intern confirms it against the firmware at Phase 6 (G52).
- **G12. Presence.** Only a valid hello or status from a Registered_Device that is not `auth_failed` counts as a heartbeat. A device is `online` from its first heartbeat and `offline` once 45 s pass with no heartbeat (`now − last_heartbeat ≥ 45,000 ms`). The next heartbeat makes it `online` again. Events and acks do not change presence. A gateway restart starts every device as `unknown`.
- **G13. Dedupe.** Events are deduped on the pair (`device_id`, `event_id`). The store is in memory, keeps each pair for 7 days after first acceptance, and keeps at most 10,000 pairs per device, evicting the oldest first. The gateway never rejects or reorders an event because of its `ts`. An event with `time_uncertain: true` is logged with ordering `approximate`. A new event whose `ts` is earlier than the latest `ts` already accepted for that device is accepted and flagged `back_dated`. A gateway restart forgets the store, so a replay that crosses a restart can be counted twice; the database spec fixes this with a unique key (risk, not a requirement).
- **G14. Ack tracking.** Pending commands are keyed on (`device_id`, `cmd_id`). `accepted` is an intermediate state. `done`, `rejected` and `failed` are terminal, and the first terminal ack fixes the outcome. A command with no ack within 10 s times out as `no_ack`; a command acked `accepted` with no terminal ack within 60 s of publish times out as `no_completion`. The gateway does not re-publish a timed-out command and never retries around `rejected` or `failed`. Ack `reason` values are final (safety.md §5). Repeat acks are logged as `duplicate`, acks after a timeout as `late`, and acks with no pending command as `unmatched`.
- **G15. Command sources.** In this phase, commands come from two places only: the gateway's fake audio reply (`say`, and `stop_audio` on barge-in), and the Operator_Surface. The gateway sends no command on its own initiative, sends no `move` unless an operator asks, and sends no command to a device whose presence is not `online`. Commands to an offline device are refused, not queued. Quiet hours, play limits and the movement toggle have no settings source until Supabase; the gateway sends no automatic physical command meanwhile.
- **G16. Command ids.** The gateway generates each `cmd_id` as a random, URL-safe string of at least 16 characters. The simulator generates `event_id` and `turn_id` the same way, with `ev_` and `t_` prefixes.
- **G17. Fake audio, never echo.** The gateway does not echo the child's frames back, because an echo would hold and replay child audio. Inbound binary frames are counted and dropped as soon as they are received. The fake reply is synthetic: 50 Synthetic_Frames, one every 20 ms (1,000 ms of audio). The simulator's upstream audio is also synthetic: 50 Synthetic_Frames, one every 20 ms. A Synthetic_Frame is a deterministic byte pattern of 40 bytes (about 16 kbps at 20 ms), not decodable speech and not taken from any microphone or file. Real Opus arrives with the voice-loop phase.
- **G18. Turn flow.** Device: open socket, `audio_start`, binary frames, `audio_end`. Gateway, after a valid `audio_end`: publish a `say` command (`expression` `happy`, `lang` `en-IN`, `voice` `xelulu`, `duration_hint_ms` 1000) on `/cmd`, then send the 50 reply frames as binary messages on the socket, then send `audio_end` with the same `turn_id`, then close the socket normally. The gateway sends no downstream `audio_start`, because Document B shows none (OP-G3). One socket carries one turn.
- **G19. Audio limits.** `audio_start` must arrive within 5 s of the upgrade. A text message over 4 KiB, a binary frame over 1,500 bytes, or any message over 65,536 bytes (G53) ends the turn. An upload ends at 3,000 frames (60 s). A turn with no message for 10 s while uploading ends. A new socket for a device that already has an open turn replaces the old one, which is aborted.
- **G20. Barge-in.** While the gateway is sending reply frames for a device's open turn, a valid, non-duplicate `interrupt` event from that device makes the gateway stop sending frames, send `audio_end` for that turn, and then publish `stop_audio` (Document B §3.5). No WebSocket cancel frame exists.
- **G21. Logging and R2.** Every log line is a Gateway_Log entry or a simulator log entry, written as one JSON line on stdout. Entries carry identifiers (`device_id`, `event_id`, `cmd_id`, `turn_id`), discriminators, Closed_Enum values, booleans, counts and status telemetry numbers (`battery_pct`, `charging`, `mode`). They never carry `auth`, tokens, passwords, `fw_ver`, Open_Vocabulary values, error `code` or `detail`, `card_id`, `active_child_id`, `manifest_url`, `quiet_hours`, audio bytes or any value from an invalid message. For an invalid message the entry carries each issue's `path` and `kind` only (ruling R2): an unknown key name in a path is truncated to its first 32 characters, and any character outside printable ASCII in a path segment is replaced with `?` (to stop log injection). At most 20 issues are logged per message.
- **G22. Gateway_Log home.** The admin console (1.3) must read the Gateway_Log, and apps may not import from services, so the Gateway_Log types live in `packages/shared/src/gateway-log/` as TypeScript types and frozen constants with no Zod schema yet. This is not part of the frozen contract and needs no `proto_ver` bump. The Phase 1 export test's expected list grows by the new names, and structure.md gains one line for the folder (FLAG: steering change).
- **G23. Gateway_Log delivery.** The gateway keeps the last 1,000 entries in memory. A subscriber can read that backlog and then receives every later entry in order. A subscriber that throws is removed and does not affect other subscribers or the gateway. Nothing is persisted.
- **G24. Operator_Surface.** An unauthenticated, local-only HTTP JSON surface on `127.0.0.1:GATEWAY_OPERATOR_PORT`. It starts only in Local_Mode. It can send a command to a device, read the device snapshot and read recent Gateway_Log entries. A small operator CLI in the gateway package calls it, so Compose can drive it with `docker compose exec gateway …`. Phase 1.3 may replace it. FLAG: unauthenticated, mitigated by loopback binding and Local_Mode only.
- **G25. Simulator Control_Surface.** A minimal web panel and JSON API on `127.0.0.1:SIMULATOR_PANEL_PORT`, plus a CLI in the simulator package that calls the API, so Compose can drive it with `docker compose exec simulator …`. The panel lives in `services/simulator/panel/` as structure.md shows. It is unauthenticated and loopback-only (FLAG). It loads no external resources, uses semantic HTML controls with labels, and has no animation or flashing.
- **G26. Simulator start state.** `battery_pct` 100, `charging` false, `mode` `idle`, `wifi_rssi` −50, `fault` [], `active_child_id` null, `temp_c` 30, volume 50, `fw_ver` `sim-0.1.0`. The first status is sent within 1 s after hello, then every 15 s.
- **G27. Simulator command handling.** The simulator applies each command trivially: `set_mode` sets its mode; `volume` and `config` update the stored settings (`config.active_child_id` shows in status); every other action is logged by action and `cmd_id` only. The default Ack_Policy is `accepted` then `done`. For `say` while a turn is open, `done` is sent after the gateway's `audio_end` for that turn. For `stop_audio`, playback stops before `done`. For `ota`, the simulator acks without fetching anything.
- **G28. Ack_Policy overrides.** Set per action, or for all actions, until cleared: `reject` with a reason from the Ack_Reason list (required); `fail` with a reason that is `""` or from the list; `accept_only` (never terminal, to test `no_completion`); `silent` (no ack, to test `no_ack`). Every ack is built with `serialiseAckMessage`, so ruling 5 holds by construction, and the Control_Surface refuses a `reject` override without a reason.
- **G29. Command idempotency.** The simulator remembers the last 1,000 `cmd_id`s and the acks it sent for each. A repeated `cmd_id` is not applied again; its recorded acks are re-sent.
- **G30. Invalid commands.** The simulator drops a command that fails `parseCmdMessage`, logs the issue paths and kinds, and sends no ack. Document B does not say how a robot "reports" a `proto_ver` mismatch (OP-G4), so the simulator only logs it.
- **G31. Offline toggle.** Going offline ends the MQTT connection and stops heartbeats and audio turns. Events fired while offline join the Offline_Queue (at most 500; when full, the oldest is dropped and logged). Going online reconnects, sends hello, then publishes the queue in order with the same `event_id`, `event` and `data` and the original `ts`, and with `time_uncertain: true` (Omar's request; Document B §8 allows it), then resumes heartbeats. A `duplicate_replay` option also re-publishes the last 5 events sent before going offline, with the same `event_id` and `time_uncertain: true`, to simulate at-least-once redelivery. This is how the dedupe proof works.
- **G32. Reconnect.** Both services reconnect to the broker after a drop, with a delay starting at 1 s and doubling up to 30 s, and the gateway re-subscribes after each reconnect. The simulator's offline toggle disables reconnect until it is toggled back.
- **G33. Inbound size limit.** The gateway drops any MQTT payload over 8 KiB without parsing it and logs `payload_too_large`.
- **G34. Provider seams.** `SttProvider`, `LlmProvider` and `TtsProvider` interfaces sit in `services/gateway/src/brain/` with no implementation beyond a stub that is not wired into the audio path. The audio path calls a `TurnResponder` interface whose only implementation in this phase is the fake reply.
- **G35. Test strategy.**
  - Pure logic (log redaction, presence, dedupe, ack tracking, Ack_Policy, Offline_Queue, config parsing) has Vitest unit tests and fast-check property tests with at least 100 runs each.
  - Time is injected through a clock, and Vitest fake timers drive the 45 s, 15 s, 10 s and 60 s rules, so no test waits in real time.
  - Each service has an in-process integration test with an in-memory broker double in its own `test/` folder, and a peer built from `@xelulu/shared` codecs (the gateway is tested against a fake device; the simulator against a fake gateway). Services never import each other, and no test imports the other service.
  - Audio tests run a real `ws` server and client on `127.0.0.1` with an OS-assigned port.
  - `pnpm test` needs no Docker and no network beyond loopback, so it runs on all three CI operating systems.
  - The end-to-end run (real EMQX, both service containers) is the Compose_Acceptance_Check in the CI `compose` job on Linux. In-repo tests do not use an in-process MQTT 5 broker, because the common Node brokers do not fully support MQTT 5.
- **G36. Compose.** The gateway and simulator become long-running. They gain `depends_on` on a healthy `emqx` (and the simulator on `gateway`). The Phase 0 static Compose rules stay: no published ports and no `environment` entries on either service. The CI `compose` job writes a temporary local `.env` at run time (Local_Mode, Compose service host names, a random per-run `DEVICE_TOKEN`) in a way that keeps the secret and URL scans green, and deletes it afterwards.

#### Further choices (from refinement)

- **G37. FLAG: no unverified `device_id` in logs.** When a received topic does not parse (`invalid_topic`) or names a device that is not registered (`unknown_device`), the `message_rejected` Log_Entry carries `device_id` null and no part of the topic string, because an unverified id never goes into a log. Conservative choice.
- **G38. Gateway-only issue kinds.** Besides the Contract_Module's issue kinds, a Safe_Issue may carry one of five Gateway_Issue_Kinds: `invalid_topic`, `unknown_device`, `payload_too_large` and `auth_failed` (each one issue with an empty path) and `device_id_mismatch` (one issue with path `["device_id"]`). These are Gateway_Log values, not wire values, and do not change the contract.
- **G39. Command refusals.** A command request is refused, never queued, with the first Command_Error that applies, checked in this order: `unknown_device`, `device_offline`, `broker_disconnected`, `invalid_command` (with Safe_Issues). A refused command is not published after a later reconnect, and a refused barge-in `stop_audio` is neither retried nor queued.
- **G40. Audio_Turn stages and abort causes.** An Audio_Turn moves through the stages `awaiting_start`, `uploading` and `replying`. Every abort carries exactly one Abort_Cause from a fixed list. The Gateway sends no `audio_end` on an aborted turn, and makes no TurnResponder call for a turn whose upload had not ended.
- **G41. FLAG: device traffic during the reply.** While a turn is in the `replying` stage, binary frames and text messages from the device within the size limits are ignored rather than aborting the turn, so barge-in stays on the MQTT `interrupt` path (Document B §3.5). Only an oversized frame or text message aborts the reply. Conservative choice.
- **G42. Reply does not wait for the say ack.** The Fake_Reply starts sending frames once the `say` command is published, without waiting for any ack, because the Simulator sends `done` for that `say` only after the reply's `audio_end` (G27).
- **G43. Gateway_Log version.** Every Log_Entry carries `log_ver`, equal to the Shared_Package constant `GATEWAY_LOG_VERSION`. It is 1 in this phase and goes up by 1 whenever a kind or a field is added, removed or changed, so the admin console (1.3) can detect a shape change. It is not `proto_ver` and is not part of the contract.
- **G44. Command history sizes.** The Gateway keeps the 1,000 most recently published commands per device in memory, oldest evicted first. The Operator_Surface's devices response reports the last 100 of them. The Simulator's Control_Surface shows the last 50 commands it received. The Simulator's idempotency memory stays at 1,000 `cmd_id`s (G29).
- **G45. FLAG: provider data-retention declaration.** Each provider interface requires an implementation to declare, as read-only values, whether the vendor keeps request data and whether it may train on it (safety.md §1). Every stub in this phase declares no retention and no training, and throws if called.
- **G46. FLAG: local surfaces and browser requests.** G25 is kept: the Simulator's Control_Surface runs whether or not the Simulator is in Local_Mode, because it drives only the fake robot; loopback binding is the mitigation. Both local surfaces refuse a request with a foreign `Origin`, a `Host` other than `127.0.0.1` or `localhost` at their port, or a state change sent as GET or without a JSON content type, to block cross-origin and DNS-rebinding requests from a browser. Request bodies are capped at 8 KiB (Operator_Surface) and 16 KiB (Control_Surface).
- **G47. FLAG: Ack_Policy precedence.** A per-action override takes precedence over an all-actions override. The Ack_Policy in force when a command is received fixes that command's acks. `fail`, `accept_only` and `silent` still apply the command under G27; only `reject` applies nothing.
- **G48. FLAG: Simulator event defaults.** A Control_Surface event request may omit `data` fields; the Simulator fills only the omitted ones with fixed defaults (Requirement 16.7). The cry default of 6 s sits above the C01 5 s threshold. Omar listed touch, wake, cry, motion, nfc and button; `interrupt` (needed for barge-in) and `error` are included for completeness.
- **G49. Timing edge cases.** Timers due at or before a message's arrival fire before that message is processed, so a Heartbeat exactly 45,000 ms after the previous one gives `offline` and then `online`. A device never moves from `unknown` to `offline`. `back_dated` compares with the highest `ts` accepted for the device since the Gateway started, unaffected by Dedupe_Store eviction. An ack that arrives exactly at a timeout is late.
- **G50. Simulator replay after a drop.** An unplanned broker drop is handled like an offline period: events fired before the reconnect join the Offline_Queue, and after the reconnect and hello they replay with `time_uncertain: true`. A queued event leaves the queue only once the Broker acknowledges its publish, and replay resumes from the first unacknowledged event after any further drop, so an event may reach the Gateway twice (deduped by `event_id`) but is not lost while queued.
- **G51. Crash output.** An uncaught exception or unhandled promise rejection writes one stdout entry with no error text, writes nothing to stderr, and exits non-zero, so no stack trace can leak a value.
- **G52. No intern dependency before Phase 6.** Per Omar, intern intervention starts at Phase 6. Every hardware-facing choice in this spec (G8 auth header, G11 /cmd-only subscription, G18 downstream framing, the R10 `ts` on hello and ack, the ruling 2 and 3 shapes and ranges, OP7 `max_dist_mm` on stop) is final for Phases 1.2–5 and is confirmed against firmware in Phase 6. No requirement, test or Done-when check in this phase depends on the intern.
- **G53. WebSocket message ceiling (D7, Omar approved).** The Audio_Server caps every WebSocket message at 65,536 bytes. A message over that is closed by the WebSocket library before its type is known and is logged as `frame_too_large`. Every message up to 65,536 bytes is classified exactly. The limit is not raised.

### Open points

None of these blocks Phase 1.2. Items that need the intern are deferred to Phase 6 (hardware bring-up), when the same tests run against the real robot; until then the stated choice stands.

- **OP-G1. Initial config push.** Document B's connection sequence says the cloud pushes the current config on `/cmd` after hello. There is no settings source until Supabase, so this phase pushes none. Deferred to the settings spec.
- **OP-G2. Audio socket auth (G8). Phase 6 item.** This phase proceeds with the `Authorization: Bearer` header on upgrade as final for Phases 1.2–5. At Phase 6 the intern confirms that the firmware's WebSocket client can send it; if not, the auth method is changed then in the gateway and simulator (not a wire change). Omar to decide whether this belongs in Document B at the next `proto_ver` review.
- **OP-G3. Downstream framing (G18). Phase 6 item.** This phase proceeds as final for Phases 1.2–5 with the cloud's reply on the audio socket as binary frames followed by `audio_end`, with no downstream `audio_start`, and the socket then closing. At Phase 6 the intern confirms the firmware handles it; a mismatch found then needs a `proto_ver` bump with sign-off from both sides.
- **OP-G4. Mismatch reporting.** Document B says the robot "reports the mismatch" on a `proto_ver` difference but defines no message for it. Omar to define it in a later `proto_ver`; the intern's part (how the firmware reports it) is a Phase 6 item. Until then the simulator only logs it (G30).
- **Carried from Phase 1 (R10, OP7, OP8).** Each is final for Phases 1.2–5. The intern confirms each against the firmware at Phase 6; a mismatch found then needs a `proto_ver` bump with sign-off from both sides.
  - R10: the firmware must send `ts` on hello and ack (ruling 1). The gateway rejects a hello or ack without `ts`, so a firmware that omits it never comes online. Confirmed at Phase 6.
  - The ruling 2 shapes and ruling 3 ranges: the simulator and gateway follow the contract as built. Confirmed at Phase 6.
  - OP7: the contract requires `max_dist_mm` on a `stop` move. Operator-sent stop moves carry it. Confirmed at Phase 6.
  - OP8: the simulator follows the `/cmd`-only reading (G11). Confirmed at Phase 6.
  - R6: `device_id` values with whitespace or U+0000 pass the contract. Both services check `DEVICE_ID` with `buildTopic` at start-up and refuse to start if it is rejected.

## Glossary

- **Gateway**: the Node.js service in `services/gateway` (`@xelulu/gateway`).
- **Simulator**: the Node.js service in `services/simulator` (`@xelulu/simulator`), a fake robot.
- **Shared_Package**: `packages/shared` (`@xelulu/shared`), imported by both services.
- **Contract_Module**: the Phase 1 Document B v2 contract exported from the Shared_Package (types, schemas, `buildTopic`, `parseTopic`, parse and serialise functions, enum constants, `AUDIO_FORMAT`, `PROTO_VER`).
- **Document_B_v2**: `docs/B-gateway-and-hardware-seam.docx`, Version 2.0, `proto_ver` 2, with Omar's Phase 1 rulings applied.
- **Event_Kind**, **Cmd_Action**, **Message_Variant**, **Closed_Enum**, **Open_Vocabulary**: as defined in the Phase 1 gateway-contract spec. An Event_Kind is one of the 8 values of `EVENT_KINDS`; a Cmd_Action is one of the 11 values of `CMD_ACTIONS`; a Message_Variant is hello, status, each Event_Kind, audio_start, audio_end, ack or each Cmd_Action; a Closed_Enum field accepts exactly a fixed list; an Open_Vocabulary field accepts any non-empty string.
- **Broker**: the EMQX MQTT broker at `MQTT_BROKER_URL`.
- **Env_Module**: the single file `src/env.ts` in each service that reads environment variables.
- **Config**: the typed, frozen object the Env_Module returns.
- **Local_Mode**: the state in which `APP_ENV` equals exactly `local` (case-sensitive, with no surrounding spaces).
- **Panel**: the root `.env.example`, the approved list of env keys.
- **Panel_Key**: a key declared in the Panel.
- **Registered_Device**: a device the Gateway knows. In this phase, exactly the device named by `DEVICE_ID`, with token `DEVICE_TOKEN` (G5).
- **Heartbeat**: a valid hello or status message from a Registered_Device that is not `auth_failed` (G12).
- **Presence**: a Registered_Device's state: `unknown`, `online` or `offline`.
- **Silence_Window**: 45 s, the time without a Heartbeat after which a device is `offline`.
- **Dedupe_Store**: the Gateway's in-memory record of accepted (`device_id`, `event_id`) pairs (G13).
- **Pending_Command**: a command the Gateway has published and whose outcome is not yet final.
- **Retained_Command**: a command among the 1,000 most recently published for a device, which the Gateway keeps in memory with its state or Ack_Outcome (Requirement 8.13, G44).
- **Ack_Outcome**: the final result for a Pending_Command: `done`, `rejected`, `failed` or `timed_out`.
- **Ack_Reason**: one of `picked_up`, `at_edge`, `charging`, `quiet_hours`, `low_battery`, `unsafe`, `busy`, `unknown_action` (the Contract_Module's `ACK_REASONS`).
- **Command_Error**: the error the Gateway returns when it refuses a command: `unknown_device`, `device_offline`, `broker_disconnected` or `invalid_command` (with Safe_Issues), checked in that order (Requirement 8.2, G39).
- **Audio_Server**: the Gateway's WebSocket server for audio turns.
- **Audio_Turn**: one WebSocket connection carrying one `turn_id`: upload, then reply. An aborted or finished turn is forgotten. Until then, an Audio_Turn is in exactly one of three stages:
  - `awaiting_start`: the upgrade was accepted and no valid `audio_start` has arrived.
  - `uploading`: a valid `audio_start` has arrived and no valid `audio_end` has.
  - `replying`: a valid `audio_end` has arrived and the TurnResponder is replying.
- **Abort_Cause**: the single cause on an `audio_turn` Log_Entry with phase `aborted`. One of: `invalid_message`, `text_too_large`, `frame_before_start`, `end_before_start`, `duplicate_start`, `turn_id_mismatch`, `frame_too_large`, `too_many_frames`, `start_timeout`, `idle_timeout`, `client_closed` (Requirements 9.11, 9.12 and 10.7), `replaced` (Requirement 9.9), `device_offline` or `broker_disconnected` (Requirement 10.5). An `interrupted` entry's cause is null, `device_offline` or `broker_disconnected` (Requirement 11.6).
- **Synthetic_Frame**: a 40-byte deterministic placeholder binary frame that contains no recorded audio (G17).
- **Fake_Reply**: the Gateway's reply to an Audio_Turn: a `say` command, 50 Synthetic_Frames, then `audio_end` (G18).
- **TurnResponder**: the Gateway interface that produces the reply for an Audio_Turn; the Fake_Reply is its only implementation in this phase.
- **Gateway_Log**: the Gateway's in-process stream of Log_Entries.
- **Log_Entry**: one record in the Gateway_Log (Requirement 12).
- **GATEWAY_LOG_VERSION**: the Shared_Package constant that numbers the Gateway_Log shape; 1 in this phase (G43).
- **log_ver**: the Log_Entry field that carries `GATEWAY_LOG_VERSION`.
- **Safe_Issue**: an issue reduced to its `path` and `kind`, with the R2 rules of G21 applied to the path as Requirement 4.5 sets out.
- **Gateway_Issue_Kind**: one of the five Safe_Issue kinds that the Gateway adds and the Contract_Module does not report: `invalid_topic`, `unknown_device`, `payload_too_large`, `device_id_mismatch` and `auth_failed` (G38). These are Gateway_Log values, not wire values.
- **Operator_Surface**: the Gateway's local-only HTTP JSON surface and its CLI (G24).
- **Control_Surface**: the Simulator's local-only web panel, JSON API and CLI (G25).
- **Ack_Policy**: the Simulator's rule for answering commands (G27, G28, G47).
- **Offline_Queue**: the Simulator's queue of events fired while offline (G31, G50).
- **Repo_Checks**: the Vitest checks under `tooling/test/`, `packages/shared/test/`, `services/gateway/test/` and `services/simulator/test/`.
- **Compose_Acceptance_Check**: the automated check in the CI `compose` job that runs EMQX, the Gateway and the Simulator with Docker Compose and asserts the Done-when items.
- **Tech_Steering**, **Structure_Steering**: `.kiro/steering/tech.md` and `.kiro/steering/structure.md`.

## Requirements

### Requirement 1: Configuration and transport security

**User Story:** As Omar, I want both services configured only from the Panel and refusing insecure transport outside local development, so that nothing is hard-coded and every real hop uses TLS.

#### Acceptance Criteria

1. THE Env_Module of each service SHALL be the only module in that service's `src/` that reads an environment variable, and SHALL read only the keys listed for that service in G3, each by a static name.
2. WHEN a service starts, THE Env_Module SHALL return a Config that is frozen at every level.
3. IF any of the following holds at start-up, THEN THE service SHALL write exactly one line to stderr that names every offending key (key names only, never values) and SHALL exit with a non-zero code within 5 s of process start, having opened no network connection and no listening socket:
   - a required key is missing or has a zero-length value (required keys are every G3 key for that service except `APP_ENV`, and except `MQTT_USERNAME` and `MQTT_PASSWORD` in Local_Mode);
   - `MQTT_BROKER_URL` or `AUDIO_WSS_URL` is not a parsable absolute URL with a host;
   - `DEVICE_ID` is rejected by `buildTopic`;
   - a port key (`GATEWAY_OPERATOR_PORT` or `SIMULATOR_PANEL_PORT`) is anything other than ASCII decimal digits or is outside 1 to 65535;
   - criterion 4 or 5 is breached.
4. WHILE the service is not in Local_Mode, THE Gateway and THE Simulator SHALL require `MQTT_BROKER_URL` to use the `mqtts` scheme, `AUDIO_WSS_URL` to use the `wss` scheme, and both `MQTT_USERNAME` and `MQTT_PASSWORD` to be non-empty, and SHALL refuse to start under criterion 3 otherwise. "Not in Local_Mode" covers `APP_ENV` unset, empty, or any value other than exactly `local` (case-sensitive, so `LOCAL` and ` local` are not Local_Mode).
5. WHILE the service is in Local_Mode, THE Gateway and THE Simulator SHALL accept `mqtt` or `mqtts` for `MQTT_BROKER_URL` and `ws` or `wss` for `AUDIO_WSS_URL`, and SHALL accept `MQTT_USERNAME` and `MQTT_PASSWORD` when either or both are empty. They SHALL refuse to start under criterion 3 for any other scheme.
6. WHEN a service opens a TLS connection (`mqtts` or `wss`), THE service SHALL verify the server certificate chain and host name. No Config field and no env key the service reads SHALL turn verification off.
7. THE Gateway and THE Simulator SHALL write no environment variable value, whole or as a substring, to stdout, stderr, the Gateway_Log or any error message or stack trace they output. The one exception is the `device_id` value of `DEVICE_ID`. This SHALL be checked with test values of at least 8 characters for every key except `APP_ENV` and the port keys.
8. FOR ALL combinations of `APP_ENV` (unset, empty, `local`, a case variant of `local`, or another string), `MQTT_BROKER_URL` scheme (`mqtt`, `mqtts` or another), `AUDIO_WSS_URL` scheme (`ws`, `wss` or another), and `MQTT_USERNAME` and `MQTT_PASSWORD` each independently empty or non-empty, the config parser SHALL accept exactly the combinations that criteria 4 and 5 allow and reject all others under criterion 3 (property, at least 100 runs).
9. IF server certificate verification fails on a TLS connection (untrusted issuer, expired certificate or host name mismatch), THEN THE service SHALL close that connection without sending any credential, `DEVICE_TOKEN` or Document B message over it, and SHALL treat it as a failed connection attempt.

### Requirement 2: Contract use only

**User Story:** As Omar, I want both services to use the frozen contract from the Shared_Package and nothing else, so that the wire format cannot drift inside a service.

#### Acceptance Criteria

1. THE Gateway and THE Simulator SHALL pass every inbound Document_B_v2 message (each MQTT payload received on a Document B topic and each WebSocket text message received on an Audio_Turn) to a parse function exported by the Contract_Module before reading any field of it.
2. THE Gateway and THE Simulator SHALL build every topic they publish to or subscribe to with `buildTopic`, and SHALL pass the topic of every received MQTT message to `parseTopic` before using its `device_id` or suffix.
3. THE TypeScript source files under `services/gateway/src` and `services/simulator/src`, including every subfolder, SHALL contain no static import, dynamic import or `require` of `zod`, no string or template literal whose text starts with `xelulu/`, and no `type`, `interface`, `enum` or `class` declaration whose name exactly equals (case-sensitive) a type name exported by the Contract_Module.
4. THE Gateway and THE Simulator SHALL take every set of allowed wire values they check, iterate over or offer (for example touch zones, ack reasons, command actions) from the Contract_Module's enum constants (for example `TOUCH_ZONES`, `ACK_REASONS`, `CMD_ACTIONS`), and their `src` files SHALL declare no array, `Set` or union type made of two or more string literals that are all members of one Contract_Module enum constant.
5. WHEN the Repo_Checks run, THE Repo_Check SHALL scan every TypeScript file under `services/gateway/src` and `services/simulator/src`, and SHALL fail if any file breaches criterion 3 or criterion 4, naming the file and line of each breach.
6. THE Gateway and THE Simulator SHALL send every outbound Document_B_v2 message (each MQTT payload and each WebSocket text message) only as the unmodified output of a serialise function exported by the Contract_Module.
7. WHEN the Repo_Check for criteria 3 and 4 runs against a fixture holding one example of each banned pattern (a `zod` import, an `xelulu/` literal, a declaration named like a Contract_Module type, and a list of wire values), THE Repo_Check SHALL report every one of them, and SHALL report none for a fixture that uses only Contract_Module functions and enum constants.

### Requirement 3: Gateway broker connection

**User Story:** As the implementation engineer, I want the Gateway connected to EMQX with per-device subscriptions, so that it hears exactly the registered devices on the four Document B topics.

#### Acceptance Criteria

1. WHEN the Gateway starts with a valid Config, THE Gateway SHALL connect to the Broker at `MQTT_BROKER_URL` using MQTT 5, a clean start, no persistent session, a client id that is unique to the running process, and the Config's `MQTT_USERNAME` and `MQTT_PASSWORD` as credentials (no credentials when both are empty in Local_Mode).
2. WHEN the Gateway's broker connection is established, THE Gateway SHALL subscribe, for each Registered_Device, to exactly the three topics `buildTopic` gives for that device's `status`, `event` and `ack`, at QoS 1 and with no wildcard, and SHALL hold no other subscription.
3. THE Gateway SHALL publish each command only on the `cmd` topic of its target Registered_Device, at QoS 1, with the retain flag off.
4. IF the broker connection drops or a connection attempt fails, THEN THE Gateway SHALL keep trying to reconnect with no limit on attempts, waiting 1 s before the first attempt and doubling the wait after each failed attempt up to a cap of 30 s (1, 2, 4, 8, 16, 30, 30 … s), SHALL reset the wait to 1 s after a successful connection, and SHALL subscribe again under criterion 2 after each successful reconnect.
5. WHEN a broker connection is established (first connect or reconnect), or an established broker connection drops, THE Gateway SHALL add exactly one `gateway` Log_Entry with the state `broker_connected` or `broker_disconnected` respectively, and SHALL add neither entry for a connection attempt that fails before it is established.
6. THE Gateway SHALL publish no message on any topic other than a Registered_Device's `cmd` topic, so that it publishes nothing on the `status`, `event` or `ack` topics, and SHALL neither publish to nor subscribe to any `ota` topic.
7. IF a command is requested for an `online` Registered_Device while the Gateway's broker connection is not established, THEN THE Gateway SHALL refuse the command with the Command_Error `broker_disconnected` (Requirement 8.2), SHALL record no Pending_Command for it, and SHALL not publish it after a later reconnect.

### Requirement 4: Inbound validation and safe rejection logging

**User Story:** As Omar, I want every inbound message validated and every rejection logged without values, so that bad input cannot reach later logic and logs cannot leak data (ruling R2).

#### Acceptance Criteria

1. WHEN the Gateway receives an MQTT message, THE Gateway SHALL handle it in this order before any other processing: parse the topic with `parseTopic` (criterion 9), check that the topic's `device_id` is a Registered_Device (criterion 10), check the payload size under criterion 2, parse the payload with `parseDeviceMessage` for the topic's suffix (criterion 3), and, for a hello, apply criterion 4. A message that fails a step SHALL go through none of the later steps.
2. IF an MQTT payload from a Registered_Device's topic is larger than 8,192 bytes, THEN THE Gateway SHALL drop it without parsing, and add one `message_rejected` Log_Entry with transport `mqtt`, the topic's `device_id`, the topic suffix and exactly one Safe_Issue with an empty path and kind `payload_too_large`. A payload of exactly 8,192 bytes SHALL go on to parsing.
3. IF a payload fails `parseDeviceMessage` (including a wrong or missing `proto_ver`, an unknown field or a wrong type), THEN THE Gateway SHALL drop the message, leave the device's Presence, auth state, Dedupe_Store, event counts and Pending_Commands unchanged, and add one `message_rejected` Log_Entry with transport `mqtt`, the `device_id` from the topic, the topic suffix and the message's Safe_Issues.
4. IF a valid hello's `device_id` differs from the `device_id` in its topic, THEN THE Gateway SHALL drop the hello without comparing its `auth`, count it as no Heartbeat, add no `auth` Log_Entry, and add one `message_rejected` Log_Entry with transport `mqtt`, the topic's `device_id`, topic suffix `status` and exactly one Safe_Issue with path `["device_id"]` and kind `device_id_mismatch`. The entry SHALL not contain the hello's `device_id` value.
5. WHEN the Gateway turns contract issues into Safe_Issues, THE Gateway SHALL keep only each issue's `path` and `kind`, keep only the first 20 issues in the order the Contract_Module reports them, and transform each path segment as follows:
   - a numeric segment (an array index) is kept as its decimal integer unchanged;
   - a string segment that is a field name declared by the Contract_Module's schemas is kept unchanged;
   - any other string segment is an unknown key name and is cut to its first 32 Unicode code points;
   - then every code point outside printable ASCII (U+0020 to U+007E) in a string segment is replaced with one `?`.
6. WHEN an MQTT message passes every step of criterion 1, THE Gateway SHALL add one `message_in` Log_Entry with transport `mqtt`, the topic's `device_id`, the topic suffix, the Message_Variant and the message's identifiers that apply (`event_id`, `cmd_id`), before any other Log_Entry for that message.
7. FOR ALL invalid payloads on a Registered_Device's topic, including oversized payloads and payloads with generated unknown key names of 33 to 200 code points, non-printable characters in keys, and values of at least 8 characters that differ from the topic's `device_id`, the Log_Entries and stdout lines the Gateway writes for them SHALL contain no value from the payload, no unknown key name longer than 32 code points and no character outside printable ASCII in any Safe_Issue path (property, at least 100 runs).
8. FOR ALL path segments (strings of 0 to 200 code points drawn from all of Unicode, and non-negative integers), the Safe_Issue rules of criterion 5 SHALL give an unknown-key segment of at most 32 characters, all printable ASCII, SHALL leave a numeric segment and a declared field name unchanged, and SHALL give the same result when applied a second time to their own output (property, at least 100 runs).
9. IF `parseTopic` rejects a received topic, THEN THE Gateway SHALL drop the message without parsing its payload, and add one `message_rejected` Log_Entry with transport `mqtt`, `device_id` null, `topic_suffix` null and exactly one Safe_Issue with an empty path and kind `invalid_topic`. The entry SHALL contain no part of the topic string.
10. IF a received topic parses but its `device_id` is not a Registered_Device, THEN THE Gateway SHALL drop the message without parsing its payload, leave every Registered_Device's Presence, Dedupe_Store and Pending_Commands unchanged, and add one `message_rejected` Log_Entry with transport `mqtt`, `device_id` null, the topic suffix and exactly one Safe_Issue with an empty path and kind `unknown_device`.

Note: `device_id` is null for `invalid_topic` and `unknown_device` because an unverified id never goes into a log (G37, FLAG). The five Gateway_Issue_Kinds are listed in G38.

### Requirement 5: Device registry and hello auth

**User Story:** As Omar, I want the Gateway to trust only registered devices with the right token, so that a stranger cannot pose as a child's robot.

#### Acceptance Criteria

1. THE Gateway SHALL treat exactly one device as a Registered_Device: the device whose `device_id` equals `DEVICE_ID`, with `DEVICE_TOKEN` as its token (G5). Every other `device_id` is unregistered and handled under Requirement 4.10's `unknown_device` rule.
2. WHEN a valid hello that passed Requirement 4.4 arrives from a Registered_Device, THE Gateway SHALL compare the hello's `auth` with the device's token using a constant-time comparison whose running time does not depend on the position of the first differing character, and SHALL treat an `auth` whose length differs from the token's as not matching.
3. IF a hello's `auth` does not match, THEN THE Gateway SHALL mark the device `auth_failed` (including when it is already marked), add one `auth` Log_Entry with transport `mqtt`, the `device_id` and outcome `failed`, and SHALL NOT count that hello as a Heartbeat.
4. WHEN a hello's `auth` matches, THE Gateway SHALL clear any `auth_failed` mark, add one `auth` Log_Entry with transport `mqtt`, the `device_id` and outcome `ok`, and treat the hello as a Heartbeat (Requirement 6). Status, event and ack messages that arrive after that hello are then processed normally.
5. THE Gateway SHALL NOT include the `auth` value of any received hello, the value of `DEVICE_TOKEN`, or any substring of 8 or more characters from either, in any Log_Entry, stdout line, stderr line or Operator_Surface response, for both matching and non-matching hellos. This SHALL hold FOR ALL generated `auth` values and tokens of at least 16 characters (property, at least 100 runs).
6. WHILE a Registered_Device is marked `auth_failed`, WHEN a valid status, event or ack arrives from it, THE Gateway SHALL drop the message and take no other action on it (no Presence change, no Dedupe_Store entry, no Pending_Command update, no barge-in), and add one `message_rejected` Log_Entry with transport `mqtt`, the `device_id`, the topic suffix and exactly one Safe_Issue with an empty path and kind `auth_failed`.
7. WHILE no hello has arrived from a Registered_Device since the Gateway started, THE Gateway SHALL process that device's valid status, event and ack messages normally, with no auth check (G9). Every Registered_Device SHALL start unmarked when the Gateway starts, because the `auth_failed` mark is held in memory only.

### Requirement 6: Presence

**User Story:** As a parent, I want to know whether the robot is online, so that the app can show it (Document B: offline after 45 s of silence).

#### Acceptance Criteria

1. WHEN the Gateway receives a Heartbeat from a device whose Presence is `unknown` or `offline`, THE Gateway SHALL set its Presence to `online` before it processes the next inbound message, and SHALL add one `presence` Log_Entry with state `online` and a cause equal to the Heartbeat's type (`hello` or `status`), so that a `status` with no new hello brings an `offline` device back `online`.
2. WHILE a device is `online`, WHEN 45,000 ms pass since its last Heartbeat with no newer Heartbeat, THE Gateway SHALL set its Presence to `offline` and add a `presence` Log_Entry with state `offline` and cause `silence`. By the wall clock this SHALL happen no earlier than 45,000 ms and no later than 46,000 ms after that Heartbeat. Under an injected clock it SHALL happen at exactly 45,000 ms, as in criterion 5.
3. WHILE a device is `online`, THE Gateway SHALL keep it `online` for as long as each Heartbeat arrives less than 45,000 ms after the previous one.
4. THE Gateway SHALL change Presence only on Heartbeats and Silence_Window expiry, so that events, acks and invalid or `auth_failed` messages leave Presence unchanged.
5. FOR ALL sequences of Heartbeat arrival times and query times, the Gateway's Presence and its sequence of `presence` Log_Entries SHALL equal those of a reference model in which:
   - a device is `online` at time t if and only if a Heartbeat arrived in the interval (t − 45,000 ms, t], `unknown` if no Heartbeat has ever arrived, and `offline` otherwise;
   - every timer due at or before a Heartbeat's arrival time fires before that Heartbeat is processed, so a Heartbeat arriving exactly 45,000 ms after the previous one gives `offline` (cause `silence`) and then `online`;
   - Presence is read after every timer due at or before t has fired

   (model-based property, at least 100 runs, with an injected clock).
6. THE Gateway SHALL add exactly one `presence` Log_Entry per Presence change, in the order the changes happen, and none when Presence does not change, including for a Heartbeat from a device that is already `online`.
7. WHEN the Gateway starts, THE Gateway SHALL set the Presence of every Registered_Device to `unknown` and add no `presence` Log_Entry for it. THE Gateway SHALL never move a device from `unknown` to `offline`.

### Requirement 7: Event dedupe and time handling

**User Story:** As a parent, I want each robot event counted once, even after the robot was offline, so that reports and alerts are not doubled.

#### Acceptance Criteria

1. WHEN a valid event (one that passes the Contract_Module's event parser and is not rejected under Requirement 4 or dropped under Requirement 5) arrives whose (`device_id`, `event_id`) is not in the Dedupe_Store, THE Gateway SHALL add the pair to the Dedupe_Store with its first-acceptance time from the Gateway clock, increase the device's accepted-event count by 1, and add exactly one `event_accepted` Log_Entry.
2. IF a valid event arrives whose (`device_id`, `event_id`) is already in the Dedupe_Store, THEN THE Gateway SHALL treat it as a duplicate even if its `ts`, `event`, `data` or `time_uncertain` differ from the accepted event. It SHALL leave the accepted-event count, the pair's first-acceptance time and the device's highest accepted `ts` unchanged, increase the device's duplicate-event count by 1, and add exactly one `event_duplicate` Log_Entry with `back_dated: false`.
3. THE Gateway SHALL accept a new valid event under criterion 1 whatever its contract-valid `ts`, including a `ts` earlier than, equal to or later than events already accepted from that device, and SHALL neither reject nor reorder an event because of its `ts`.
4. WHEN the Gateway accepts a new event, THE Gateway SHALL set `back_dated: true` on its `event_accepted` Log_Entry if its `ts` is strictly earlier than the highest `ts` among all events accepted for that device since the Gateway started (counting events with or without `time_uncertain`, counting no duplicates, and unaffected by Dedupe_Store eviction), and `back_dated: false` otherwise, including for the device's first accepted event and for a `ts` equal to that highest `ts`.
5. WHEN the Gateway adds an `event_accepted` or `event_duplicate` Log_Entry for an event that carries `time_uncertain: true`, THE Gateway SHALL set the entry's `time_uncertain` to true and its `ordering` to `approximate`.
6. THE Gateway SHALL set `received_at` on every `event_accepted` and `event_duplicate` Log_Entry to the Gateway clock time at which the event message was received, and SHALL set `device_ts` to the event's `ts` unchanged.
7. WHILE a device holds 10,000 pairs in the Dedupe_Store, WHEN a new pair for that device is added, THE Gateway SHALL evict that device's pair with the earliest first-acceptance time (the earliest added, if times are equal), so that the device holds exactly 10,000 pairs, and SHALL leave the accepted-event and duplicate-event counts unchanged by the eviction.
8. WHEN 604,800,000 ms (7 days) or more have passed on the Gateway clock since a pair's first-acceptance time, THE Gateway SHALL evict that pair, so that an event with that pair arriving at or after that time is accepted as new under criterion 1 and one arriving earlier is a duplicate under criterion 2.
9. FOR ALL sequences of valid events containing repeated `event_id`s in any order, with differing `ts`, `data` and `time_uncertain` on repeats, at most 10,000 distinct pairs per device, and every arrival less than 7 days after the first, the set of accepted pairs SHALL equal the set of distinct pairs in the sequence, the accepted-event count SHALL equal its size, and the duplicate-event count SHALL equal the sequence length minus that size (property, at least 100 runs).
10. FOR ALL sequences of valid events within the bounds of criterion 9, processing the same sequence a second time SHALL leave the accepted set and accepted-event count unchanged and SHALL increase the duplicate-event count by exactly the sequence length (idempotence property, at least 100 runs).
11. WHEN the Gateway adds an `event_accepted` or `event_duplicate` Log_Entry for an event whose `time_uncertain` is false or absent, THE Gateway SHALL set the entry's `time_uncertain` to false and its `ordering` to `device_ts`.
12. IF an event message is rejected under Requirement 4 or dropped under Requirement 5, THEN THE Gateway SHALL leave the Dedupe_Store, the device's highest accepted `ts`, and the accepted-event and duplicate-event counts unchanged.

### Requirement 8: Commands and ack tracking

**User Story:** As the implementation engineer, I want each command matched to its acks by `cmd_id`, with a timeout, so that the cloud knows what the robot did and treats refusals as final.

#### Acceptance Criteria

1. WHEN a source listed in G15 asks the Gateway to send a command to a Registered_Device whose Presence is `online`, with data the Contract_Module's serialiser accepts, THE Gateway SHALL generate a new `cmd_id` under G16 that differs from every `cmd_id` it has generated since it started, serialise the command with the Contract_Module, publish it once on that device's `cmd` topic, record a Pending_Command keyed on (`device_id`, `cmd_id`) with its publish time from the Gateway clock, and add one `message_out` Log_Entry.
2. IF the Gateway is asked to send a command to a device that is not a Registered_Device, to a Registered_Device whose Presence is `unknown` or `offline`, while the broker connection is not established, or with data the Contract_Module's serialiser rejects, THEN THE Gateway SHALL publish nothing, queue nothing for later, record no Pending_Command, add no `message_out` Log_Entry, and return the Command_Error for the first of these that applies, checked in this order: `unknown_device`, `device_offline`, `broker_disconnected`, `invalid_command` (with Safe_Issues).
3. WHEN the first `accepted` ack arrives for a Pending_Command that has no Ack_Outcome, THE Gateway SHALL mark the command accepted, cancel its 10,000 ms `no_ack` timer, keep its 60,000 ms `no_completion` timer running, and add one `ack_result` Log_Entry with outcome `accepted` and the ack's `reason`.
4. WHEN the first `done`, `rejected` or `failed` ack arrives for a Pending_Command that has no Ack_Outcome, whether or not an `accepted` ack came before it, THE Gateway SHALL set the ack's status as the Ack_Outcome, record the ack's `reason` exactly as received (an Ack_Reason or `""`), cancel all of the command's timers, and add one `ack_result` Log_Entry with that outcome and reason. THE Gateway SHALL NOT change the status because of the reason, so a `failed` ack with reason `unsafe` or `picked_up` stays `failed`.
5. IF a Pending_Command has received no ack of any status by the time 10,000 ms have passed since its publish time, THEN THE Gateway SHALL set the Ack_Outcome to `timed_out` with cause `no_ack`, and add one `ack_result` Log_Entry with outcome `timed_out`, reason null and that cause. An ack that arrives less than 10,000 ms after publish is in time; one that arrives at 10,000 ms or later is not.
6. IF a Pending_Command marked accepted has received no `done`, `rejected` or `failed` ack by the time 60,000 ms have passed since its publish time (measured from publish, not from the `accepted` ack), THEN THE Gateway SHALL set the Ack_Outcome to `timed_out` with cause `no_completion`, and add one `ack_result` Log_Entry with outcome `timed_out`, reason null and that cause.
7. WHEN an Ack_Outcome is set to `rejected`, `failed` or `timed_out`, whatever the ack's `reason`, THE Gateway SHALL publish no further message with that `cmd_id` and SHALL publish no other command as a result of that outcome.
8. IF an ack arrives for a Retained_Command whose Ack_Outcome is already set, THEN THE Gateway SHALL leave the Ack_Outcome and its recorded reason unchanged and add one `ack_result` Log_Entry with outcome `duplicate` when the ack's status equals the Ack_Outcome, or `late` when the Ack_Outcome is `timed_out` or the ack's status differs from it (including an `accepted` ack that arrives after a terminal ack).
9. IF an ack arrives whose (`device_id`, `cmd_id`) matches no Retained_Command (including a `cmd_id` sent to a different device, or one evicted under criterion 13), THEN THE Gateway SHALL change the state of no command and add one `ack_result` Log_Entry with outcome `unmatched` and `action` null.
10. FOR ALL sequences of command publishes, acks (any status, including repeats, acks for unknown `cmd_id`s and acks after timeouts) and clock advances, each command's Ack_Outcome and every `ack_result` outcome SHALL equal a reference model in which:
    - the outcome is the status of the first terminal ack, if that ack arrives less than 10,000 ms after publish, or less than 60,000 ms after publish when an `accepted` ack arrived less than 10,000 ms after publish;
    - otherwise the outcome is `timed_out`, with cause `no_ack` if no ack arrived within 10,000 ms, or `no_completion` if one did;
    - every other ack is classified under criteria 8, 9 and 12;
    - each `cmd_id` is published exactly once

    (model-based property, at least 100 runs, with an injected clock).
11. THE Gateway SHALL send commands only from the sources in G15.
12. IF a further `accepted` ack arrives for a Pending_Command that is already marked accepted and has no Ack_Outcome, THEN THE Gateway SHALL leave the command's state and timers unchanged and add one `ack_result` Log_Entry with outcome `duplicate` and the ack's `reason`.
13. THE Gateway SHALL keep in memory only, for the 1,000 most recently published commands per device (oldest evicted first by publish time), each command's `cmd_id`, action, publish time and either its pending or accepted state or its Ack_Outcome with reason and timeout cause; a gateway restart SHALL forget them. (Requirement 13.4 reports the last 100 of these.)

### Requirement 9: Audio turn server

**User Story:** As the implementation engineer, I want a per-turn WebSocket server that accepts the Document B audio sequence, so that the voice loop has a working pipe before the brain exists.

#### Acceptance Criteria

1. WHEN the Gateway starts with a valid Config, THE Audio_Server SHALL listen on the address chosen by G7 and add a `gateway` Log_Entry with state `audio_listening`.
2. WHEN a WebSocket upgrade request carries `Authorization: Bearer <token>` whose token matches a Registered_Device's token (constant-time comparison), THE Audio_Server SHALL accept the upgrade and open an Audio_Turn for that device, in the `awaiting_start` stage, with frame and byte counts of 0.
3. IF an upgrade request has no `Authorization` header, a scheme other than `Bearer`, an empty token, or a token that matches no Registered_Device, THEN THE Audio_Server SHALL answer HTTP 401, open no socket and no Audio_Turn, and add an `auth` Log_Entry with outcome `failed`, transport `ws` and `device_id` null.
4. WHEN an Audio_Turn receives a text message of at most 4,096 bytes, THE Audio_Server SHALL parse it with `parseAudioControlMessage` before handling it in any other way, and SHALL not parse a text message over 4,096 bytes (cause `text_too_large` for a text message over 4,096 and up to 65,536 bytes, and `frame_too_large` for any message over 65,536 bytes, criteria 11 and 12).
5. WHEN an Audio_Turn in the `awaiting_start` stage receives a valid `audio_start` as its first message, THE Audio_Server SHALL record its `turn_id`, move the turn to the `uploading` stage, and add an `audio_turn` Log_Entry with phase `started`.
6. WHILE an Audio_Turn is in the `uploading` stage, WHEN a binary frame of at most 1,500 bytes arrives and the turn has received fewer than 3,000 frames, THE Audio_Server SHALL add 1 to the turn's frame count and the frame's length to its byte count, and then release the frame without keeping, copying or forwarding its bytes.
7. WHEN a valid `audio_end` with the turn's `turn_id` arrives while the Audio_Turn is in the `uploading` stage, THE Audio_Server SHALL move the turn to the `replying` stage, add one `audio_turn` Log_Entry with phase `ended` and the frame and byte counts, and call the TurnResponder exactly once for that turn.
8. IF an Audio_Turn is aborted for a cause in criterion 9, 11 or 12, THEN THE Audio_Server SHALL close the socket within 1,000 ms (unless the device has already closed it), send no further binary frame and no `audio_end` on it, make no TurnResponder call if the upload had not ended, forget the turn so the device can open a new one, and add exactly one `audio_turn` Log_Entry with phase `aborted`, that cause, the frame and byte counts so far, and Safe_Issues only for cause `invalid_message`.
9. WHEN an upgrade for a device is accepted while that device has an Audio_Turn in any stage, THE Audio_Server SHALL abort the older turn under criterion 8 with cause `replaced` (its `turn_id`, or null if no `audio_start` was received) before handling any message on the new socket, and SHALL handle the new turn as if no other turn existed.
10. THE Audio_Server SHALL write no audio frame bytes to any file, log, Log_Entry, stdout line or error.
11. IF any of the following happens to an Audio_Turn before it reaches the `replying` stage, THEN THE Audio_Server SHALL abort the turn under criterion 8 with the cause named:
    - a text message that fails `parseAudioControlMessage` (`invalid_message`);
    - a text message over 4,096 bytes and up to 65,536 bytes (`text_too_large`);
    - a binary frame in the `awaiting_start` stage (`frame_before_start`);
    - an `audio_end` in the `awaiting_start` stage (`end_before_start`);
    - a second `audio_start` (`duplicate_start`);
    - an `audio_end` whose `turn_id` differs from the turn's (`turn_id_mismatch`);
    - a binary frame over 1,500 bytes and up to 65,536 bytes (`frame_too_large`);
    - any message over 65,536 bytes, text or binary (`frame_too_large`), because the WebSocket library closes it before its type is known (G53);
    - a binary frame after 3,000 counted frames (`too_many_frames`);
    - no valid `audio_start` within 5,000 ms of the upgrade (`start_timeout`);
    - no message of any kind for 10,000 ms in the `uploading` stage (`idle_timeout`);
    - the device closing the socket (`client_closed`).

    Classification by message type is exact for every message up to 65,536 bytes.
12. WHILE an Audio_Turn is in the `replying` stage, IF the device sends a binary frame of at most 1,500 bytes or a text message of at most 4,096 bytes, THEN THE Audio_Server SHALL release a binary frame under criterion 6 without changing the logged counts, SHALL parse a text message under criterion 4 and act on no `audio_start` or `audio_end` in it, SHALL add a `message_rejected` Log_Entry (transport `ws`) with Safe_Issues for a text message that fails parsing, and SHALL leave the reply running; a text message over 4,096 bytes and up to 65,536 bytes (`text_too_large`), a binary frame over 1,500 bytes and up to 65,536 bytes (`frame_too_large`), or any message over 65,536 bytes (`frame_too_large`, G53) in this stage SHALL abort the turn under criterion 8.

Note: device traffic during the reply is ignored rather than aborting, and an aborted turn gets no `audio_end` (G41, FLAG). This is conservative and keeps barge-in on the MQTT `interrupt` path.

### Requirement 10: Fake say reply

**User Story:** As the implementation engineer, I want a fake spoken reply streamed back down the socket, so that the round trip and its timing can be tested with no STT, LLM or TTS.

#### Acceptance Criteria

1. WHEN an Audio_Turn's upload ends under Requirement 9.7, THE Fake_Reply SHALL ask the Gateway to send, under Requirement 8.1, one `say` command to that turn's device whose `data` holds exactly `expression` `happy`, `lang` `en-IN`, `voice` `xelulu` and `duration_hint_ms` 1000 and no other key, and THE Gateway SHALL track it as a Pending_Command under Requirement 8.
2. WHEN the `say` command has been published, THE Fake_Reply SHALL, without waiting for any ack of that command, add an `audio_turn` Log_Entry with phase `reply_started` and send exactly 50 Synthetic_Frames as binary messages on the turn's socket, the first no later than 20 ms after the publish and frame n (n = 1 to 49) 20 ms × n after the first on the Gateway's clock, with no frame sent before the publish.
3. WHEN the 50th Synthetic_Frame has been sent, THE Fake_Reply SHALL send one `audio_end` with the turn's `turn_id`, serialised with the Contract_Module, then close the socket with WebSocket close code 1000, and add an `audio_turn` Log_Entry with phase `reply_ended` and a frames-sent count of 50.
4. THE Fake_Reply SHALL send every Synthetic_Frame as exactly 40 bytes, byte-identical to one constant pattern fixed in the Gateway's source for every frame and every turn, and SHALL use no inbound frame, file or recorded audio to build it.
5. IF the Gateway returns `device_offline` or `broker_disconnected` under Requirement 8.2 for the Fake_Reply's `say` command, THEN THE Fake_Reply SHALL send no Synthetic_Frame and no `audio_end`, close the socket, and add an `audio_turn` Log_Entry with phase `aborted` and cause `device_offline` or `broker_disconnected`.
6. THE Gateway SHALL send no downstream `audio_start` (OP-G3), and SHALL send no text message on an Audio_Turn's socket other than the `audio_end` of criterion 3 or Requirement 11.1.
7. IF an Audio_Turn's socket closes or errors, or the turn is aborted as `replaced` under Requirement 9.9, before the Fake_Reply has sent its `audio_end`, THEN THE Fake_Reply SHALL send no further frame and no `audio_end` on that socket, publish no further command for that turn, leave the `say` Pending_Command tracked under Requirement 8, and add exactly one `audio_turn` Log_Entry for the turn with phase `aborted`, cause `client_closed` or `replaced`, and the count of frames sent (for `replaced`, this is the one entry Requirement 9.8 requires).

Note: the `say` data above is contract-valid. The reply does not wait for the `say` ack, because the Simulator sends `done` only after the reply's `audio_end` (G42).

### Requirement 11: Barge-in

**User Story:** As a child, I want Xelulu to stop talking when I talk over it, so that the conversation feels natural (Document B §3.5).

#### Acceptance Criteria

1. WHILE the Fake_Reply is sending a device's reply (after the turn's `say` command is published and before its 50th Synthetic_Frame is sent), WHEN the Gateway accepts a new `interrupt` event from that device under Requirement 7.1, THE Gateway SHALL send no Synthetic_Frame on that turn's socket more than 100 ms after accepting the event, send `audio_end` with that turn's `turn_id` serialised with the Contract_Module, close the socket normally, and then ask to send a `stop_audio` command to the device, tracked under Requirement 8.
2. THE Gateway SHALL send the barge-in `audio_end` before it publishes `stop_audio`, SHALL send no Synthetic_Frame after that `audio_end`, and SHALL send at most one `audio_end` per Audio_Turn.
3. WHEN the Gateway handles a barge-in under criterion 1, THE Gateway SHALL add exactly one `audio_turn` Log_Entry with phase `interrupted`, the turn's `turn_id`, `frames_out` equal to the number of Synthetic_Frames actually sent on that socket (0 to 50), and cause null unless criterion 6 applies. THE Gateway SHALL add no `reply_ended` Log_Entry for that turn.
4. IF an `interrupt` event is a duplicate under Requirement 7.2, or arrives while no reply is being sent for that device (including while the device's Audio_Turn is still uploading, and after the turn's reply `audio_end` has been sent), THEN THE Gateway SHALL send no `audio_end` and no `stop_audio` for it, and SHALL leave any open Audio_Turn of that device unchanged.
5. THE Gateway SHALL use no WebSocket message for barge-in other than `audio_end`.
6. IF the barge-in `stop_audio` cannot be sent because the device's Presence is not `online` or the broker is disconnected (Requirement 8.2), THEN THE Gateway SHALL publish no `stop_audio` and neither retry nor queue it, SHALL still have sent the turn's `audio_end` and closed the socket under criterion 1, and SHALL set cause `device_offline` (or `broker_disconnected`) on the turn's `interrupted` Log_Entry.

### Requirement 12: Gateway_Log stream

**User Story:** As the intern, I want one stream of everything the Gateway sees and does, so that the admin console (Phase 1.3) can show live device activity.

#### Acceptance Criteria

1. THE Shared_Package SHALL export, from `packages/shared/src/gateway-log/`, a `GatewayLogEntry` type that is a union discriminated on `kind`, one type per kind, a frozen `GATEWAY_LOG_KINDS` constant listing every kind exactly once, and a `GATEWAY_LOG_VERSION` constant that equals 1 in this phase and goes up by 1 whenever a kind or a field is added, removed or changed (G43).
2. THE `GatewayLogEntry` kinds SHALL be exactly `gateway`, `message_in`, `message_out`, `message_rejected`, `auth`, `presence`, `event_accepted`, `event_duplicate`, `ack_result` and `audio_turn`.
3. THE Gateway SHALL give every Log_Entry these fields: `log_ver`, equal to `GATEWAY_LOG_VERSION`; `seq`, an integer that is 1 for the first entry after the Gateway process starts and goes up by 1 for each entry; `at`, a UTC date-time string from the Gateway clock in the form `YYYY-MM-DDTHH:mm:ss.sssZ`; and `kind`.
4. Every field listed below SHALL be present on every entry of its kind, set to null (never left out) when it has no value, and an entry SHALL hold no field that is not listed for its kind:
   - `gateway`: `state` (`starting`, `broker_connected`, `broker_disconnected`, `audio_listening`, `stopping`).
   - `message_in`: `transport` (`mqtt` or `ws`), `device_id`, `topic_suffix` (`status`, `event` or `ack`; null for `ws`), `variant` (the Message_Variant name), `event_id`, `cmd_id` and `turn_id` (each null when the message has none), and `battery_pct`, `charging` and `mode` (null for every variant except status). Binary audio frames produce no `message_in` entry.
   - `message_out`: `transport`, `device_id`, `variant`, `cmd_id` (null for `ws`) and `turn_id` (null for `mqtt`). Binary reply frames produce no `message_out` entry.
   - `message_rejected`: `transport` (`mqtt`, or `ws` for a reply-stage invalid text message under Requirement 9.12; an invalid text message before the reply is logged only as an `audio_turn` entry with phase `aborted`), `device_id` (null when the topic does not parse or names an unregistered device, G37), `topic_suffix` (null for `ws` or when the topic does not parse) and `issues` (1 to 20 Safe_Issues; `invalid_topic`, `unknown_device`, `payload_too_large` and `auth_failed` are each one issue with an empty path, and `device_id_mismatch` is one issue with path `["device_id"]`).
   - `auth`: `transport`, `device_id` (null when no Registered_Device matches) and `outcome` (`ok` or `failed`).
   - `presence`: `device_id`, `state` (`online` or `offline`) and `cause` (`hello`, `status` or `silence`).
   - `event_accepted` and `event_duplicate`: `device_id`, `event_id`, `event` (the Event_Kind), `data`, `time_uncertain`, `back_dated`, `ordering` (`device_ts` or `approximate`), `device_ts` and `received_at`. `data` holds only that Event_Kind's Closed_Enum data keys (touch `zone` and `gesture`, wake `source`, motion `event`, button `button` and `action`) and is an empty object for every other Event_Kind; `time_uncertain` is false when the event leaves it out; `back_dated` is always false on `event_duplicate`; `device_ts` is the event's `ts` in unix seconds, unchanged; `received_at` uses the same form as `at`.
   - `ack_result`: `device_id`, `cmd_id`, `action` (the Pending_Command's action, or null for `unmatched`), `outcome` (`accepted`, `done`, `rejected`, `failed`, `timed_out`, `duplicate`, `late` or `unmatched`), `reason` (the received ack's `reason` exactly as sent, an Ack_Reason or `""`; null for `timed_out`) and `timeout_cause` (`no_ack` or `no_completion` when `outcome` is `timed_out`, null otherwise).
   - `audio_turn`: `device_id`, `turn_id` (null before a valid `audio_start`), `phase` (`started`, `ended`, `reply_started`, `reply_ended`, `interrupted` or `aborted`), `frames_in`, `bytes_in`, `frames_out` (the turn's non-negative integer totals at the time of the entry), `cause` (null unless `phase` is `aborted` or `interrupted`; for `aborted` one Abort_Cause, that is, one of the causes of Requirement 9.11 (which include `client_closed`), `replaced`, `device_offline` or `broker_disconnected`; for `interrupted` null, `device_offline` or `broker_disconnected`) and `issues` (Safe_Issues for cause `invalid_message`, an empty array otherwise).
5. THE Log_Entry types SHALL hold no field for `auth`, tokens, passwords, `fw_ver`, Open_Vocabulary values, error `code` or `detail`, `card_id`, `active_child_id`, `manifest_url`, `quiet_hours`, audio bytes, transcripts or names (G21).
6. WHEN a caller subscribes to the Gateway_Log, THE Gateway SHALL deliver the retained backlog (the most recent entries, at most 1,000) in `seq` order, then every later entry in `seq` order, with no entry missed or repeated between the backlog and the later entries, and SHALL return an unsubscribe function; after its first call the subscriber receives no further entry, and later calls have no effect.
7. IF a subscriber throws while receiving an entry, THEN THE Gateway SHALL remove that subscriber so that it receives no later entry, deliver that same entry to every other subscriber, and keep running and writing entries to stdout.
8. THE Gateway SHALL write every Log_Entry to stdout as exactly one line holding the entry's JSON serialisation, whether or not any subscriber exists, and SHALL write nothing else to stdout, so that `docker compose logs gateway` shows the Gateway_Log.
9. FOR ALL generated sequences of Gateway inputs and subscribe times, including subscribing after more than 1,000 entries, the `seq` values one subscriber receives (backlog, then later entries) SHALL go up by exactly 1 with no gaps or repeats, and the backlog SHALL end with the last entry added before subscribing (property, at least 100 runs).
10. FOR ALL generated inbound messages whose `auth`, `fw_ver`, Open_Vocabulary, `code`, `detail`, `card_id`, `active_child_id` and `manifest_url` values are generated with at least 8 characters, no Log_Entry and no stdout line produced for them SHALL contain any of those values (property, at least 100 runs).
11. FOR ALL generated Log_Entries of every kind, every value in the entry SHALL be a string, a finite number, a boolean, null, an array or a plain object (never undefined, a Date, NaN or Infinity), and parsing the entry's stdout line as JSON SHALL give a value deep-equal to the entry delivered to subscribers (property, at least 100 runs).

### Requirement 13: Operator_Surface

**User Story:** As the implementation engineer, I want a local way to send commands and read the Gateway's state, so that the cmd and ack paths can be tested before the admin console exists.

#### Acceptance Criteria

1. WHILE the Gateway is in Local_Mode, THE Operator_Surface SHALL listen on `127.0.0.1` at `GATEWAY_OPERATOR_PORT` and on no other address (not `0.0.0.0`, `::` or the container's Compose network address), so that inside Compose it is reachable only from processes in the gateway container (such as `docker compose exec gateway`).
2. WHILE the Gateway is not in Local_Mode, THE Gateway SHALL open no Operator_Surface listener on any address or port, and the operator CLI SHALL write one line to stderr stating that the Operator_Surface is local-only and exit with a non-zero code within 5 s.
3. WHEN the Operator_Surface receives a send-command request whose body is a JSON object with exactly a `device_id`, an `action` and a `data` field, THE Operator_Surface SHALL pass it to the Gateway under Requirement 8.1 and, within 1,000 ms and without waiting for any ack, return either the new `cmd_id` or the Command_Error from Requirement 8.2 (with Safe_Issues only, in the order Requirement 8.2 checks them), with nothing published in the error case.
4. WHEN the Operator_Surface receives a devices request, THE Operator_Surface SHALL return, for each Registered_Device and with no other fields, its `device_id`, Presence (`unknown`, `online` or `offline`), last Heartbeat time (ISO 8601 UTC, or null), `auth_failed` mark (boolean), accepted-event count, duplicate-event count, and for each of its last 100 Retained_Commands (Requirement 8.13): `cmd_id`, `action`, state (`pending`, `accepted` or its Ack_Outcome), `reason` (an Ack_Reason, `""` or null) and `timeout_cause` (`no_ack`, `no_completion` or null).
5. WHEN the Operator_Surface receives a log request, THE Operator_Surface SHALL return the retained Log_Entries (at most the last 1,000) in ascending `seq` order, or, when a non-negative integer `after` is given, only those with `seq` greater than `after` (an empty list when `after` is at or beyond the latest `seq`).
6. THE gateway package SHALL include an operator CLI that takes the port from the Config, calls only `127.0.0.1:GATEWAY_OPERATOR_PORT` for criteria 3–5, prints the JSON response to stdout, and exits with code 0 for a success response and a non-zero code for an error response or when the Operator_Surface cannot be reached within 5 s (writing one line to stderr in that case), so that `docker compose exec gateway` can run it.
7. IF the Operator_Surface receives a request whose body is over 8 KiB, is not valid JSON, is not a JSON object, has a missing, extra or wrongly typed field, or names an unknown route or a method that route does not define, THEN THE Operator_Surface SHALL stop reading the body, return an error response naming which of these causes applied (with Safe_Issues for field problems and no echo of submitted values), change no Gateway state, publish nothing, and keep serving later requests.
8. IF the Operator_Surface cannot listen on `127.0.0.1:GATEWAY_OPERATOR_PORT` at start-up in Local_Mode, THEN THE Gateway SHALL write one line naming `GATEWAY_OPERATOR_PORT` (name only) to stderr and exit with a non-zero code within 5 s.
9. THE Operator_Surface SHALL include in no response, and the operator CLI SHALL print to no output, any `auth` value, token, password, environment variable value other than the `device_id` value of `DEVICE_ID`, or any value G21 excludes from Log_Entries, including values taken from a rejected or invalid request. This SHALL hold FOR ALL generated `DEVICE_TOKEN`, `MQTT_PASSWORD` and request `data` string values of at least 8 characters: no response body or CLI output contains them (property, at least 100 runs).
10. IF an Operator_Surface request has an `Origin` header, or a `Host` header other than `127.0.0.1` or `localhost` at `GATEWAY_OPERATOR_PORT`, or a state-changing request arrives as GET or without a JSON content type, THEN THE Operator_Surface SHALL refuse it with an error response, change no Gateway state and publish nothing. (Browser cross-origin protection, G46; same rule as Requirement 20.7.)

### Requirement 14: Provider seams and no-backend boundary

**User Story:** As Omar, I want the brain seams in place but unused, so that the voice-loop phase can plug in providers without reshaping the Gateway.

#### Acceptance Criteria

1. THE Gateway SHALL export `SttProvider`, `LlmProvider` and `TtsProvider` as TypeScript interfaces from modules under `services/gateway/src/brain/`, and SHALL export from the same folder a `TurnResponder` interface. After a valid `audio_end` (Requirement 9.7), calling the `TurnResponder` SHALL be the Audio_Server's only way to produce a turn's reply.
2. THE Gateway SHALL pass the Fake_Reply as the Audio_Server's only TurnResponder. No module under `services/gateway/src` outside `src/brain/` SHALL import or construct an `SttProvider`, `LlmProvider` or `TtsProvider` stub, and a Repo_Check SHALL verify this.
3. THE `dependencies` in `services/gateway/package.json` SHALL be exactly `@xelulu/shared`, `mqtt` and `ws`. Neither `dependencies` nor `devDependencies` SHALL contain any `@supabase/` package or any STT, LLM or TTS vendor SDK. No source file under `services/gateway/src` SHALL import such a package or call the global `fetch`. A Repo_Check that reads the manifest and the sources SHALL verify all of this.
4. WHILE the Gateway is running, THE Gateway SHALL open outbound network connections only to the host and port of `MQTT_BROKER_URL`, and SHALL accept inbound connections only on the Audio_Server's listen address (G7) and, in Local_Mode only, on `127.0.0.1:GATEWAY_OPERATOR_PORT`.
5. IF any method of an `SttProvider`, `LlmProvider` or `TtsProvider` stub is called, THEN THE stub SHALL throw an error saying it is not implemented, without opening a network connection, reading an env var or keeping its arguments.
6. THE `SttProvider`, `LlmProvider` and `TtsProvider` interfaces SHALL each require an implementation to declare, as read-only values, whether the vendor keeps request data and whether it may train on it, and every stub in this phase SHALL declare no retention and no training (safety.md §1; G45, FLAG).

### Requirement 15: Simulator connection and heartbeat

**User Story:** As the implementation engineer, I want a fake robot that connects exactly like the real one, so that the cloud can be built with no hardware.

#### Acceptance Criteria

1. WHEN the Simulator starts with a valid Config, THE Simulator SHALL connect to the Broker using MQTT 5, a clean start, the configured credentials and the client id `DEVICE_ID`.
2. WHEN the Simulator's broker connection is established, THE Simulator SHALL subscribe to its own `cmd` topic only (G11), and after the subscription is acknowledged SHALL publish, not retained, a hello serialised with the Contract_Module on its `status` topic at QoS 1 with `proto_ver` 2, `ts` the current time, `type` `hello`, `device_id` `DEVICE_ID`, `fw_ver` `sim-0.1.0`, `auth` `DEVICE_TOKEN` and `proto` 2, and no other key.
3. WHEN a hello has been published, THE Simulator SHALL publish, not retained and at QoS 0, a status serialised with the Contract_Module within 1,000 ms and then one status every 15 s, each carrying `proto_ver` 2, `type` `status`, the current `ts` and the Simulator's current `battery_pct`, `charging`, `mode`, `wifi_rssi`, `fault`, `active_child_id` and `temp_c` (start values as in G26), and no other key. These are the fields of the Contract_Module's status schema.
4. WHILE the Simulator's broker connection is up, THE Simulator SHALL keep the interval between consecutive status messages at 15,000 ms ± 500 ms, measured on an injected clock, between status messages sent after the same hello; the 15 s timer restarts from each new hello.
5. IF the broker connection drops while the Simulator is not toggled offline, THEN THE Simulator SHALL stop sending status messages, add every event fired before the reconnect to the Offline_Queue under Requirement 19 criteria 2 and 3, and reconnect under G32.
6. THE Simulator SHALL set every `ts` it sends to the current unix time in whole seconds (the injected clock's milliseconds divided by 1,000, rounded down), except replayed events (Requirement 19 and criterion 7), which keep the `ts` set when they were fired.
7. WHEN the Simulator reconnects after a drop it did not toggle, THE Simulator SHALL publish a hello under criterion 2, then replay the Offline_Queue exactly as Requirements 19.4 and 19.7 describe (original `event_id`, `event`, `data` and `ts`, with `time_uncertain: true`), and then restart status messages under criterion 3 (G50).

### Requirement 16: Simulator events

**User Story:** As the intern, I want to fire every event kind from the Simulator, so that each gateway path can be exercised.

#### Acceptance Criteria

1. WHILE the Simulator is online, WHEN the Control_Surface asks for a touch event with a `zone` from `TOUCH_ZONES` and a `gesture` from `TOUCH_GESTURES`, THE Simulator SHALL publish exactly one touch event whose `data` is exactly `{zone, gesture}` with the requested values.
2. WHILE the Simulator is online, WHEN the Control_Surface asks for a wake, cry, motion, button, nfc, interrupt or error event, THE Simulator SHALL publish exactly one event of that kind whose `data` holds only the contract fields for that kind with the requested values: wake `source` from `WAKE_SOURCES` and optional integer `dir_deg` 0–359; cry `confidence` 0–1 and `duration_s` ≥ 0; motion `event` from `MOTION_KINDS` and finite `value`; button `button` from `BUTTONS` and `action` from `BUTTON_ACTIONS`; nfc non-empty `card_id`; interrupt `{}`; error `code` and `detail` (any string, empty allowed). THE Control_Surface SHALL return the published `event_id` and `ts` in its response.
3. WHEN the Simulator publishes a newly fired event (not a replay under Requirement 19), THE Simulator SHALL give it an `event_id` generated under G16 that differs from every `event_id` the Simulator process has generated before, a `ts` equal to the current unix time in whole seconds from its injected clock, and no `time_uncertain` key.
4. IF the Control_Surface asks for an event whose kind is not one of the 8 Event_Kinds, or whose data (after the defaults of criterion 7) the Contract_Module rejects, THEN THE Simulator SHALL publish nothing, add nothing to the Offline_Queue, and return an error response listing at most 20 Safe_Issues, leaving the Simulator state unchanged.
5. THE Simulator SHALL publish each event on its own `event` topic, built with `buildTopic` for `DEVICE_ID`, at QoS 1, not retained, with the payload produced by `serialiseEventMessage`.
6. FOR ALL generated event requests across all 8 Event_Kinds that the Contract_Module accepts, the published payload SHALL parse with `parseEventMessage` to a message with the requested `event` and `data` and the `event_id` and `ts` returned to the Control_Surface (property, at least 100 runs).
7. WHEN the Control_Surface asks for an event and omits one or more of that kind's required `data` fields, THE Simulator SHALL fill only the omitted fields with these defaults and keep every supplied value unchanged: touch `zone` `belly`, `gesture` `tap`; wake `source` `hey_lulu` and no `dir_deg`; cry `confidence` 0.9, `duration_s` 6; motion `event` `pickup`, `value` 0; button `button` `belly_talk`, `action` `press`; nfc `card_id` `sim-card-1`; error `code` `sim_error`, `detail` `""`; interrupt `{}`.

Note: Omar listed touch, wake, cry, motion, nfc and button. `interrupt` (needed for barge-in) and `error` are included for completeness. The defaults of criterion 7 are a stated choice (G48, FLAG); the cry default of 6 s sits above the C01 5 s threshold.

### Requirement 17: Simulator commands and acks

**User Story:** As Omar, I want the Simulator to answer every command the way the robot does, including safety refusals, so that rejected paths are tested before the hardware exists.

#### Acceptance Criteria

1. WHEN the Simulator receives a command that passes `parseCmdMessage`, with any of the 11 `CMD_ACTIONS` and a `cmd_id` it has not handled before, THE Simulator SHALL apply it under G27 and answer under the Ack_Policy in force at the moment of receipt, where a per-action override for that command's action takes precedence over an all-actions override, and a policy change made after receipt does not change the acks for that `cmd_id`.
2. WHILE neither a per-action nor an all-actions override applies to a command's action, THE Simulator SHALL publish an `accepted` ack and then a `done` ack for that `cmd_id`, each with `reason` `""`, publishing `done` within 100 ms of `accepted` (on the injected clock) for every command except a `say` received while an audio turn is in progress, whose `done` follows Requirement 18.4.
3. WHILE a `reject` override with an Ack_Reason applies, THE Simulator SHALL publish exactly one ack for that `cmd_id`, with status `rejected` and that reason, and SHALL leave its state unchanged.
4. WHILE a `fail` override applies, THE Simulator SHALL apply the command under G27 and publish an `accepted` ack and then a `failed` ack with the override's reason (`""` or an Ack_Reason), and no other ack for that `cmd_id`.
5. WHILE an `accept_only` override applies, THE Simulator SHALL apply the command under G27 and publish exactly one ack for that `cmd_id`, with status `accepted` and `reason` `""`, and no terminal ack.
6. WHILE a `silent` override applies, THE Simulator SHALL apply the command under G27, publish no ack for that `cmd_id`, and record the `cmd_id` as handled with no acks.
7. IF the Control_Surface is asked for a `reject` override without an Ack_Reason, or with a reason outside the Ack_Reason list, THEN THE Control_Surface SHALL refuse the request and leave the Ack_Policy unchanged.
8. WHEN the Simulator receives a command whose `cmd_id` is among the last 1,000 `cmd_id`s it handled (G29), whatever the command's other fields, THE Simulator SHALL re-publish, in their original order, only the acks it has already published for that `cmd_id`, apply nothing again, and publish any ack still due for the first receipt (for example `done` for a `say` waiting on `audio_end`) once only, when it falls due.
9. IF a received command fails `parseCmdMessage`, THEN THE Simulator SHALL publish no ack, apply nothing, record no `cmd_id` as handled, and log the Safe_Issues only (at most 20, under G21).
10. THE Simulator SHALL publish every ack on its own `ack` topic at QoS 1 with the retain flag off, each serialised with `serialiseAckMessage` and carrying `proto_ver` 2, the `cmd_id` of the command it answers, and `ts` set to the current unix time in whole seconds at the moment of publishing (ruling 1).
11. FOR ALL generated commands and Ack_Policies (per-action, all-actions or both), every ack the Simulator publishes SHALL parse with `parseAckMessage` and carry `ts`, every `rejected` ack SHALL carry an Ack_Reason, the ack sequence SHALL follow the per-action override when both kinds apply, and receiving the same command twice SHALL leave the Simulator state equal to receiving it once (property, at least 100 runs).

Note: a per-action override beats an all-actions override, and `fail`, `accept_only` and `silent` still apply the command; only `reject` applies nothing (G47, FLAG).

### Requirement 18: Simulator audio turn

**User Story:** As the implementation engineer, I want the Simulator to play a fake audio turn against the Gateway, so that the turn and its latency can be measured end to end.

#### Acceptance Criteria

1. WHEN the Control_Surface asks for an audio turn while the Simulator is online and no audio turn is in progress, THE Simulator SHALL open one WebSocket to `AUDIO_WSS_URL` with `Authorization: Bearer <DEVICE_TOKEN>`, and the turn SHALL count as in progress from that request until its result is reported.
2. WHEN the socket opens, THE Simulator SHALL send, each serialised with the Contract_Module, an `audio_start` with a new `turn_id` (G16) and the current `ts`, then exactly 50 Synthetic_Frames as binary messages at 20 ms intervals on the injected clock, then an `audio_end` with the same `turn_id` and the current `ts`.
3. WHEN the Simulator receives a valid `audio_end` with its `turn_id` after sending its own `audio_end`, and no interrupt was fired for the turn, THE Simulator SHALL report the turn as complete on the Control_Surface with the number of binary frames received and the latency in whole milliseconds on the injected clock from sending its own `audio_end` to receiving the first reply frame (null if no frame arrived), whether or not the `say` command has arrived yet, and SHALL discard each reply frame's bytes on receipt.
4. WHILE no Ack_Policy override applies to `say`, WHEN the Simulator receives a valid `say` command while an audio turn is in progress, whether before or after the first reply frame, THE Simulator SHALL publish an `accepted` ack within 100 ms, then a `done` ack when that turn's reply `audio_end` is received, or a `failed` ack with reason `""` if the turn is reported failed under criterion 6; a `say` received when no turn is in progress SHALL be answered under Requirement 17.2.
5. WHEN the Simulator receives a valid `stop_audio` command while an audio turn is in progress, THE Simulator SHALL count no reply frame that arrives after it for that turn, and SHALL then answer the `stop_audio` under its Ack_Policy (by default `accepted` then `done`).
6. IF the upgrade is refused or the socket cannot be opened, the socket closes before the reply's `audio_end`, a text message arrives that fails `parseAudioControlMessage` or carries a different `turn_id`, 10,000 ms pass on the injected clock after the Simulator sends its own `audio_end` without the reply's `audio_end`, or the Simulator is toggled offline during the turn, THEN THE Simulator SHALL stop sending frames, close the socket if it is still open, end the turn, and report it as failed with a cause that identifies which condition occurred.
7. THE Simulator SHALL build its upstream frames as Synthetic_Frames only, and SHALL read no microphone, audio device or audio file.
8. IF the Control_Surface asks for an audio turn while the Simulator is offline or while another audio turn is in progress, THEN THE Control_Surface SHALL refuse the request with an error naming which condition applies, and THE Simulator SHALL open no socket, send nothing, and leave any in-progress turn unchanged.
9. WHILE an audio turn is receiving reply frames, WHEN the Control_Surface fires an `interrupt` event, THE Simulator SHALL publish the event under Requirement 16.2, keep the socket open, and on receiving the reply's `audio_end` for that `turn_id` report the turn as interrupted (not complete) with the reply frames counted and the first-frame latency.

### Requirement 19: Simulator offline queue and replay

**User Story:** As Omar, I want to prove that events queued offline replay with their original ids and are counted once, so that the cloud handles the robot's offline periods correctly.

#### Acceptance Criteria

1. WHEN the Control_Surface toggles the Simulator offline while it is online, THE Simulator SHALL, within 1 s, abort any open audio turn, stop sending status messages, end its broker connection and disable reconnect, and SHALL publish no hello, status, event or ack until it is toggled online.
2. WHILE the Simulator is offline, WHEN an event is fired, THE Simulator SHALL add the event to the tail of the Offline_Queue with a new `event_id` (G16) and a `ts` equal to the Simulator clock's unix seconds at firing time, and SHALL publish nothing.
3. IF the Offline_Queue holds 500 events and another event is added, THEN THE Simulator SHALL remove the oldest queued event, add the new event at the tail, keep the queue length at 500, and write one simulator log entry carrying the removed event's `event_id`.
4. WHEN the Control_Surface toggles the Simulator offline-to-online, THE Simulator SHALL re-enable reconnect, reconnect to the Broker, publish a hello, and only after the hello publish each queued event in queue order, with its original `event_id`, `event`, `data` and `ts` and with `time_uncertain: true`, removing each event from the Offline_Queue only once the Broker has acknowledged its publish (QoS 1); its first status message comes within 1 s after the last replayed message, and status messages then follow every 15 s.
5. WHERE `duplicate_replay` is on, WHEN the Simulator replays the Offline_Queue after an offline-to-online toggle, THE Simulator SHALL, after the last queued event and before the first status message, re-publish the last 5 events it published before going offline (or all of them if fewer than 5), in their original publish order, with their original `event_id`, `event`, `data` and `ts` and with `time_uncertain: true`, so that the Gateway can be shown to count each `event_id` once.
6. FOR ALL generated sequences of 0 to 600 events fired while offline, and for every point at which the broker connection may drop during replay, once replay completes the published event messages SHALL contain each of the most recent min(N, 500) queued events at least once, the first publication of each SHALL follow firing order, each SHALL equal its queued event with `time_uncertain` set to true, no other `event_id` SHALL appear except the `duplicate_replay` re-publications, and the Offline_Queue SHALL be empty (property, at least 100 runs).
7. IF the broker connection ends, or the Control_Surface toggles the Simulator offline, before every queued event has been acknowledged by the Broker, THEN THE Simulator SHALL keep every unacknowledged event at the head of the Offline_Queue in its original order, and on the next reconnect SHALL publish a hello and then resume replay from the first unacknowledged event under criterion 4; any re-sent event keeps its original `event_id` and `ts`.
8. IF the Control_Surface toggles the Simulator online while it is already online, or offline while it is already offline, THEN THE Simulator SHALL leave its connection, Offline_Queue, timers and reconnect setting unchanged, publish nothing, and report its current online state in the response.

### Requirement 20: Simulator Control_Surface

**User Story:** As the intern, I want a small local panel and CLI to drive the Simulator, so that each feature can be tested by hand and by script.

#### Acceptance Criteria

1. WHILE the Simulator is running, in Local_Mode or not, THE Control_Surface SHALL listen on `127.0.0.1` at `SIMULATOR_PANEL_PORT` only, and SHALL open no listener on any other address or port.
2. THE Control_Surface SHALL offer: fire each Event_Kind with its data (one control per touch zone), start an audio turn, toggle offline and online, set `duplicate_replay`, set and clear Ack_Policy overrides, set `battery_pct` and `charging`, and read the Simulator state (online flag, Offline_Queue length, active Ack_Policy, the last 50 received commands with `cmd_id`, action and the acks sent for each, and the last audio turn result).
3. THE web panel SHALL load no external resource, use native form controls and buttons, give every control a visible text label that is programmatically associated with it, let every control be reached and operated with the keyboard alone in on-screen order, show a visible focus indicator on the focused control, and contain no animation, transition or flashing.
4. THE simulator package SHALL include a CLI that calls the Control_Surface for each operation in criterion 2, so that `docker compose exec simulator` can run it; on a success response it prints the JSON response to stdout and exits 0; on an error response, or if the Control_Surface does not answer within 5 s, it writes the error to stderr and exits with a non-zero code.
5. THE Control_Surface responses, including the web panel page and every error response, SHALL contain no `DEVICE_TOKEN`, broker password or other env value except `DEVICE_ID`.
6. IF a Control_Surface request has a body larger than 16 KiB, a body that is not valid JSON, an unknown operation, event data the Contract_Module rejects, a `battery_pct` outside the contract's range, a `reject` override without an Ack_Reason, or a `fail` override whose reason is neither `""` nor an Ack_Reason, THEN THE Control_Surface SHALL return an error response naming the problem without echoing the submitted value, change no Simulator state, publish nothing, and keep serving later requests.
7. IF a Control_Surface request has an `Origin` header other than the Control_Surface's own loopback origin, or a `Host` header other than `127.0.0.1` or `localhost` at `SIMULATOR_PANEL_PORT`, or a state-changing operation arrives as GET or without a JSON content type, THEN THE Control_Surface SHALL refuse it with an error response, change no Simulator state and publish nothing.

Note: G25 is kept. The Control_Surface drives only the fake robot, so it is not limited to Local_Mode; loopback binding plus criterion 7 is the mitigation (G46, FLAG).

### Requirement 21: Child audio and data safety

**User Story:** As a parent, I want no child audio kept and no personal data in logs, so that the system follows safety.md from the first working build.

#### Acceptance Criteria

1. THE source files under `services/gateway/src` and `services/simulator/src` SHALL contain no call to a file-writing API (`writeFile`, `writeFileSync`, `appendFile`, `appendFileSync`, `createWriteStream`, `mkdir`, `mkdirSync`, `copyFile`, `copyFileSync`, `cp`, `cpSync`, `rename`, `renameSync`, `truncate`, `truncateSync`), whether from `node:fs`, `fs`, `node:fs/promises` or `fs.promises`, and a Repo_Check SHALL fail on any such call.
2. WHEN the Audio_Server receives an inbound binary frame, THE Gateway SHALL update the turn's frame and byte counts (Requirement 9.6) and SHALL keep no reference to, copy of, or concatenation of the frame's bytes after the handler that updated those counts returns.
3. THE Gateway and THE Simulator SHALL write to stdout only lines that each hold exactly one JSON-encoded Log_Entry (Gateway) or Simulator log entry (Simulator), SHALL write to stderr only the config and listen error lines of Requirements 1.3 and 13.8, and SHALL write no error message, stack trace or Node.js process warning text to either stream (the CLIs of Requirements 13.6 and 20.4 are separate processes with their own output rules).
4. THE Simulator log entries SHALL carry only the field types G21 allows, SHALL carry none of the values G21 forbids, and SHALL record each invalid input only as its Safe_Issues, built under the rules of Requirement 4.5 (at most 20 issues).
5. THE Gateway SHALL open outbound connections only to the host and port of `MQTT_BROKER_URL`, and THE Simulator SHALL open outbound connections only to the host and port of `MQTT_BROKER_URL` or `AUDIO_WSS_URL`, so that receiving a `manifest_url` or any other URL never causes a connection.
6. IF an uncaught exception or unhandled promise rejection occurs in THE Gateway or THE Simulator, THEN that service SHALL write exactly one stdout entry holding no error message, stack trace or value from the error (for the Gateway, a `gateway` Log_Entry with state `stopping`; for the Simulator, a Simulator log entry), SHALL write nothing to stderr, and SHALL exit with a non-zero code within 5 s (G51).
7. WHEN a Repo_Check scans `services/gateway/src` and `services/simulator/src`, THE Repo_Check SHALL fail on any use of `console`, `process.stdout.write` or `process.stderr.write` outside each service's logger module, its config error writer and its CLI module, as the design names them.
8. FOR ALL generated invalid commands and Control_Surface requests whose unknown keys and whose `auth`, `fw_ver`, Open_Vocabulary, `code`, `detail`, `card_id`, `active_child_id` and `manifest_url` values are generated with at least 8 characters, no Simulator log entry or stdout line SHALL contain any of those values, the Config's `DEVICE_TOKEN` or `MQTT_PASSWORD`, or an unknown key name longer than 32 characters (property, at least 100 runs).

### Requirement 22: Repo check, panel and steering updates

**User Story:** As the implementation engineer, I want the Phase 0 and Phase 1 checks updated to fit two real services, without weakening anything else.

#### Acceptance Criteria

1. THE env-read Repo_Check in `tooling/test/env-reads.test.ts` SHALL replace its test "admin, gateway, simulator and shared sources contain no env reads at all" with checks that:
   - (a) fail on any env read in `services/gateway/src/env.ts` or `services/simulator/src/env.ts` whose name is computed or destructured or is not one of the G3 keys for that service;
   - (b) fail if either `env.ts` file is missing from the scan;
   - (c) still find zero env reads in `apps/admin/src`, `apps/admin/vite.config.ts`, `apps/admin/index.html`, `packages/shared/src` and every other file under `services/gateway/src` and `services/simulator/src`.

   The parent-app test and the Property 8 detector tests SHALL stay unchanged.
2. THE network-module Repo_Check in `tooling/test/placeholder.test.ts` (the test "%s imports no network modules") SHALL allow modules matched by its existing network-module pattern (`net`, `http`, `https`, `http2`, `dgram`, `tls`, with or without `node:`, plus `mqtt` and `ws` and their subpaths) only in files under the transport folders named in the design for each service, and SHALL fail, naming the file, on any such import elsewhere in `services/gateway/src` or `services/simulator/src`. The "detector sanity" test and every other test in that file SHALL stay unchanged.
3. THE Phase 0 start tests in `services/gateway/test/start.test.ts` and `services/simulator/test/start.test.ts` (which now require `ok` on stdout and exit code 0) SHALL be replaced by start tests that check Requirement 1.3 for both `node dist/index.js` and `pnpm --silent start`, covering every Panel_Key removed and every Panel_Key set to a sentinel value; each case asserts a non-zero exit within 5 s, a stderr naming each offending key, and no sentinel value in stdout or stderr. The existing "without a build" test SHALL be kept.
4. THE `.env.example` and `tooling/fixtures/approved-panel.txt` SHALL each gain one new final section: a `# --- ... ---` header comment, then `GATEWAY_OPERATOR_PORT=` under a comment line starting `# [cloud]` and `SIMULATOR_PANEL_PORT=` under a comment line starting `# [device]`, both comments marking the key as local only. Every existing line SHALL keep its content and order, `checkPanel` SHALL return no issues, and `EXPECTED_KEY_COUNT` in `tooling/test/panel-check.test.ts` SHALL change from 21 to 23.
5. THE CI workflow `.github/workflows/ci.yml` SHALL remove the `pnpm start:gateway` and `pnpm start:simulator` steps from the `checks` job, and the "Gateway and simulator print ok and exit 0 within 60 s" and "After 30 s, both are still exited and EMQX is still running" steps from the `compose` job. The "Compose up" step, which asserts no `.env` exists, SHALL be replaced by the Compose_Acceptance_Check. The steps "Config resolves with no .env", "Every Panel_Key reaches gateway and simulator", "EMQX dashboard answers within 120 s", "EMQX ports listen on 127.0.0.1 only", "Compose logs on failure" and "Compose down" (`if: always()`) SHALL be kept with unchanged assertions.
6. THE Phase 1 export test `packages/shared/test/exports.test.ts` SHALL add each Gateway_Log runtime constant (`GATEWAY_LOG_KINDS`, `GATEWAY_LOG_VERSION` and any other the design names) to `EXPECTED_RUNTIME_EXPORTS` and each Gateway_Log type to its `import type` list; its length assertion SHALL rise from 144 by exactly the number of runtime names added, and every Phase 1 name SHALL stay in both lists.
7. THE Structure_Steering SHALL gain exactly one added line, inside the `packages/shared/` block of the tree, listing `src/gateway-log/` with a one-line description; no other line of `.kiro/steering/structure.md` SHALL change.
8. THE root README SHALL gain a section on running and driving the Gateway and Simulator locally, naming the `docker compose exec gateway …` and `docker compose exec simulator …` CLIs and the `GATEWAY_OPERATOR_PORT` and `SIMULATOR_PANEL_PORT` keys, saying that both surfaces are unauthenticated and loopback-only (and the Operator_Surface Local_Mode-only), and stating that the Gateway uses `DEVICE_ID` and `DEVICE_TOKEN` as a prototype registry (G5). The `tooling/test/readme.test.ts` test "%s prints ok and exits with code 0" for the `pnpm start:gateway` and `pnpm start:simulator` rows SHALL be replaced by a check that each row says the service keeps running; every other README check SHALL stay unchanged.
9. THE Repo_Checks not named in criteria 1–8 SHALL pass with their test files unchanged, including `secret-check.test.ts`, `url-scan.test.ts`, `file-names.test.ts`, `manifests.test.ts`, `no-cross-package-import.test.ts`, `compose-static.test.ts`, `layout.test.ts`, `lint-format.test.ts`, `gitignore.test.ts`, `tsconfig.test.ts`, `contrast.test.ts` and `supabase.test.ts`, and `services/gateway/src/index.ts` and `services/simulator/src/index.ts`, which these checks name, SHALL remain.
10. THE Gateway and Simulator `package.json` files SHALL each have `dependencies` of exactly `@xelulu/shared` (`workspace:*`), `mqtt` (an exact 5.x version) and `ws` (an exact 8.x version), the same versions in both and recorded in the design, plus `@types/ws` as an exact-pinned devDependency, and no other new dependency, so that the exact-version check in `tooling/test/manifests.test.ts` passes.

### Requirement 23: Compose run and Done-when acceptance

**User Story:** As Omar, I want the seven Done-when checks proven by an automated run of the real stack, so that Phase 1.2 is finished when CI says so.

#### Acceptance Criteria

1. WHEN `docker compose up` runs with the temporary Local_Mode `.env` of G36, THE Compose stack SHALL start EMQX, the Gateway and the Simulator, and within 120 s of `docker compose up` returning, THE Gateway's log SHALL show a `gateway` `broker_connected` entry, a `message_in` hello from `DEVICE_ID`, an `auth` entry with outcome `ok`, a `presence` entry with state `online` and cause `hello`, and at least two `message_in` status entries from `DEVICE_ID` whose `at` values are no more than 30 s after the hello's. (Done-when 1)
2. WHILE the Simulator is online, WHEN the Control_Surface fires each of the eight Event_Kinds (Omar's touch, wake, cry, motion, button and nfc, plus interrupt and error), with touch fired once for each of the seven `TOUCH_ZONES` (14 events, 14 distinct `event_id`s), THE Gateway's log SHALL show, within 5 s of each firing, exactly one `message_in` and exactly one `event_accepted` entry for that `event_id`, and SHALL show no `message_rejected` entry, no `event_duplicate` entry and no `stop_audio` `message_out` during this step. (Done-when 2)
3. WHILE no Ack_Policy override is set, WHEN the Operator_Surface sends a `say` command and then an `animate` command to the Simulator, THE Simulator's Control_Surface state SHALL list each returned `cmd_id` among its received commands, and THE Gateway's log SHALL show, within 10 s of each send, one `message_out` for that `cmd_id`, an `ack_result` with outcome `accepted` and then exactly one `ack_result` with outcome `done` and reason `""` for that `cmd_id`, with no `timed_out` outcome for it. (Done-when 3, first part)
4. WHILE a `reject` override with reason `picked_up` is set for `animate` only, WHEN the Operator_Surface sends an `animate` command to the Simulator, THE Simulator's Control_Surface state SHALL list the returned `cmd_id` among its received commands, and THE Gateway's log SHALL show, within 10 s of the send, exactly one `ack_result` with outcome `rejected` and reason `picked_up` for that `cmd_id`, and up to 15 s after the send SHALL show no `accepted`, `done` or `timed_out` outcome and no second `message_out` for that `cmd_id`. (Done-when 3, second part)
5. WHILE the Simulator is online, WHEN the Control_Surface starts an audio turn, THE Gateway's log SHALL show, within 10 s and for one `turn_id`, `audio_turn` phases `started`, `ended` (with `frames_in` 50), `reply_started` and `reply_ended` (with `frames_out` 50) in that order, with no `aborted` phase, plus one `say` `message_out` logged before `reply_started` and an `ack_result` `done` for that `say` `cmd_id`, and THE Simulator SHALL report the turn complete with 50 reply frames received. (Done-when 4)
6. WHILE `duplicate_replay` is on and the Simulator has published at least 5 events since connecting, WHEN the Simulator is toggled offline, exactly one event is fired while offline, and the Simulator is toggled online again, THE Gateway's log SHALL show, within 10 s of the online toggle, exactly one `event_accepted` with `time_uncertain: true` and ordering `approximate` for the queued `event_id` and exactly one `event_duplicate` for each of the 5 re-published pre-offline `event_id`s, and THE devices snapshot SHALL show the accepted-event count equal to its value before the offline toggle plus exactly 1 and the duplicate-event count equal to its value before the offline toggle plus exactly 5. (Done-when 5)
7. WHEN the Simulator is toggled offline and left offline, THE Gateway's log SHALL show exactly one `presence` entry with state `offline` and cause `silence` for `DEVICE_ID`, whose `at` is at least 45.0 s and at most 46.0 s after the `at` of the last `message_in` hello or status from the Simulator before the toggle, and no earlier `presence` `offline` entry in that period. (Done-when 6, first part)
8. WHEN the Simulator is toggled online after the `presence` `offline` entry of criterion 7, THE Gateway's log SHALL show a `message_in` hello and a `presence` entry with state `online` and cause `hello` within 10 s of the toggle. (Done-when 6, second part)
9. WHEN `pnpm build`, `pnpm lint`, `pnpm format:check` and `pnpm test` run at the workspace root, each SHALL exit with code 0, with zero TypeScript errors under strict mode, zero lint errors, zero unformatted files and zero failed tests, and the new gateway and simulator test files SHALL contain no skipped or todo tests. (Done-when 7)
10. THE gateway and simulator test suites SHALL together include, for each of Done-when items 2–6, at least one in-process test that asserts that service's side of the outcomes in criteria 2–8, using an in-memory broker double and fake timers (G35), with no Docker and no network beyond loopback, so that they pass on the Linux, macOS and Windows CI runners.
11. WHEN the Compose_Acceptance_Check ends, whether it passed or failed, THE Compose_Acceptance_Check SHALL stop the Compose stack, delete the temporary `.env`, leave no `.env` or other generated file in the working tree, and print no env value except `DEVICE_ID`.
12. THE Compose_Acceptance_Check SHALL run the steps of criteria 1–8 in that order against one running Compose stack, and SHALL pass, exiting with code 0, only if every assertion in criteria 1–8 holds and the whole run finishes within 600 s of `docker compose up` starting.
13. IF any assertion in criteria 1–8 fails, or 600 s pass before the run finishes, THEN THE Compose_Acceptance_Check SHALL stop at that point, exit with a non-zero code, name the first failed criterion (or the time budget), and still clean up under criterion 11.

## Done when

This phase is done when all seven checks pass, stated as Omar gave them.

| # | Done when | Requirements |
|---|---|---|
| 1 | `docker-compose up` starts EMQX + gateway + simulator; the simulator connects and the gateway logs the hello + heartbeats. | 3, 5.4, 6.1, 12.8, 15, 23.1, 23.12 |
| 2 | Firing each event type from the simulator shows it validated and logged by the gateway. | 4, 7.1, 16, 23.2, 23.12 |
| 3 | A cmd (say, animate) reaches the simulator and its ack is matched to the cmd_id; a safety-refusal cmd returns a rejected ack with a valid reason. | 8, 13, 17, 23.3, 23.4, 23.12 |
| 4 | A fake audio turn completes (audio_start -> frames -> fake say back -> audio_end). | 9, 10, 18, 23.5, 23.12 |
| 5 | The offline test: an event queued offline replays after reconnect, is flagged time_uncertain, and is NOT double-counted. | 7, 19, 23.6, 23.12 |
| 6 | Presence flips to offline after 45 s silence and back on reconnect. | 6, 23.7, 23.8, 23.12 |
| 7 | pnpm build, lint and tests pass. | 2, 21, 22, 23.9, 23.10, 23.11, 23.13 |

The other requirements (configuration and TLS, hello auth, barge-in, the Gateway_Log shape, provider seams and the safety rules) support these checks and are verified by the same test suite and during review.

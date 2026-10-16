# Requirements Document

## Introduction

Phase 1 (gateway contract) writes the Document B v2 contract (`proto_ver` 2) into its single home, `packages/shared/src/gateway-contract/`, as TypeScript types, Zod schemas, constants, parse/serialise functions and golden fixtures. It also adds the shared domain interfaces in `packages/shared/src/domain/` (with two content row classes), a pure age-stage function and a pure content row-class helper, and exports all of it from `packages/shared/src/index.ts`.

The contract is the seam between the robot and the cloud. The gateway, the simulator and the admin console will import it from the Shared_Package and from nowhere else. The schemas are strict: a message that is not exactly Document B v2 is rejected, so the cloud never quietly accepts a drifted wire format.

`docs/B-gateway-and-hardware-seam.docx` is Document B Version 2.0 (`proto_ver` 2, 8 Oct 2026), provisionally frozen pending the intern's confirmation of the five `proto_ver` 2 changes. The facts below summarise it. Omar's rulings of 8 Oct 2026 on the open points are applied on top (see "Open points and rulings"). The docx is not edited by this spec.

### Document B v2 facts

1. `proto_ver` is `2` in every message.
2. Four MQTT topics only: `xelulu/{device_id}/status`, `/event`, `/cmd` and `/ack`. There is no `/ota` topic.
3. `ota` is a `/cmd` action with `data.manifest_url`. It carries a `cmd_id` and is answered with an `ack`.
4. `audio_start` and `audio_end` carry `proto_ver` and `ts`, like every other message, plus `type` and `turn_id`.
5. Events have an optional boolean `time_uncertain`.
6. Command actions: `say`, `animate`, `gesture`, `move`, `play`, `set_mode`, `led`, `volume`, `config`, `stop_audio`, `ota`.
7. Ack `status` is `accepted|done|rejected|failed` with a `reason`. Reasons: `picked_up`, `at_edge`, `charging`, `quiet_hours`, `low_battery`, `unsafe`, `busy`, `unknown_action`.
8. Unchanged from v1: the seven touch zones (`head`, `left_ear`, `right_ear`, `belly`, `back`, `left_hand`, `right_hand`) and Opus audio at 16 kHz mono with 20 ms frames in both directions.
9. Envelope rule: every upstream message carries `proto_ver`, `ts` and `type`.
10. Barge-in (§3.5): the device sends an `interrupt` event, then the cloud sends `audio_end` followed by a `stop_audio` command. There is no WebSocket cancel frame.
11. Pairing (§10) moves to Document C and is not part of this contract.

### Out of scope

- MQTT, WebSocket and Supabase connections, topic routing, ack tracking, presence, dedupe stores and retries (later gateway and simulator specs). This spec gives them types, schemas and pure functions only.
- Opus encoding, decoding and binary-frame handling. Only the audio format constants are defined.
- Supabase tables, migrations and RLS. Domain interfaces here are TypeScript only, with no Zod schemas and no SQL.
- Editing `docs/B-gateway-and-hardware-seam.docx` or any other source document.
- Bluetooth or Wi-Fi pairing messages (Document C) and any WebSocket cancel frame (Document B v2 has none; OP4).
- Running the barge-in sequence (sending `audio_end` and then `stop_audio` after an `interrupt` event). That is gateway behaviour for a later spec; this spec only defines the messages involved.
- Firmware.

### Assumptions and choices

Each choice below was made without asking further questions. The requirements reflect them.

- **C1. Fixtures.** The derived golden fixtures are the Document B v2 JSON examples: hello §3.1, status §3.2, event/touch §3.3, audio_start and audio_end §3.4, say §4.1 and ack §5. Status, event/touch (including `"time_uncertain": false`), audio_start (`ts` 1733400001), audio_end (`ts` 1733400004) and say are copied verbatim. Hello and ack are copied with one addition: a `ts`, placed after `proto_ver`, because ruling 1 and the envelope rule require it (OP1). Hello gets `ts` 1733400000 and ack gets `ts` 1733400005. Every other event kind and command action gets one fixture built from Document B's field tables, marked "constructed" (not verbatim). The ota fixture is constructed too: the §4.2 example's host is a placeholder (`https://.../manifest.json`), not a real URL, and would fail the non-local URL scan, so the fixture keeps the §4.2 shape with the URL `https://localhost/ota/manifest.json` (C19). The docx itself is not edited.
- **C2. Envelopes.** Every device→cloud message (`hello`, `status`, `event`, `ack`, `audio_start`, `audio_end`) requires `proto_ver` 2, `ts` (a non-negative integer of unix seconds) and `type`. The command (cloud→device) envelope is `{proto_ver: 2, cmd_id, action, data}` with no `ts`, because Document B's downstream envelope has none. In the v2 barge-in sequence (§3.5) the cloud also sends `audio_end`; it uses the same `audio_end` shape.
- **C3. Strictness.** Every object schema is strict: unknown keys are rejected at every level, including inside `data`. A wrong or missing `proto_ver` is rejected. A wrong `type`, `action` or `event` discriminator is rejected.
- **C4. Closed and open lists.** Where Document B gives a closed list, the schema uses a closed enum: touch zones, touch gestures, wake source, motion kinds, button, button action, modes, move `cmd`, play source, LED target, LED effect, say voice, ack status and ack reasons. Lists that end in "…" in Document B (animate `expression`, animate `eyes`, gesture `name`) are open: any non-empty string is accepted, and the known values are exported as constants. The say `expression` uses the same open vocabulary as animate `expression`.
- **C5. Field types.**
  - `confidence`: a number from 0 to 1 inclusive.
  - `battery_pct` and volume `level`: integers from 0 to 100 inclusive.
  - `wifi_rssi`: an integer.
  - `temp_c`: a finite number.
  - `duration_s`, `duration_hint_ms` and `max_dist_mm`: non-negative finite numbers; `duration_hint_ms` is also an integer.
  - `dir_deg`: an integer from 0 to 359 inclusive, optional (Document B says "if known") (ruling 3, intern to confirm ranges).
  - `linear_mms` and `angular_mrad_s`: non-negative finite numbers with no upper bound (ruling 3, intern to confirm ranges). On a `move` with `cmd: "stop"` both are optional (ruling 4).
  - `fault`: an array of strings.
  - `active_child_id`: a string or `null`.
  - `lang` (say and config `language`): a BCP-47-like tag of a 2–3 letter lowercase language subtag, an optional 4-letter title-case script subtag, and an optional region subtag of 2 uppercase letters or 3 digits, separated by `-` (for example `en-IN`, `hi-IN`, `en`).
  - ota `manifest_url`: an absolute `https` URL.
  - nfc `card_id`: a non-empty string.
  - motion `data`: `{event, value}`, where `value` is a finite number (ruling 3, OP6).
  - error `data`: `{code, detail}`, where `code` and `detail` are each a string, and the empty string is accepted for both (ruling 3, OP6).
  - Identifiers (`device_id`, `event_id`, `cmd_id`, `turn_id`, `content_id`, `fw_ver`, `auth`): non-empty strings with no format beyond that.
- **C6. Empty data.** The `interrupt` event and the `stop_audio` command carry `data: {}`, a strict empty object. `time_uncertain` is an optional boolean on every event.
- **C7. Ack reason.** `reason` is always present. It is `""` or one of the reason enum values. An ack with status `rejected` requires a non-empty reason from the enum. An ack with status `failed` may have an empty reason (ruling 5).
- **C8. Constants.** The contract exports `PROTO_VER = 2`, the four topic suffixes, a topic builder for `xelulu/{device_id}/<suffix>`, and the audio format constants (Opus, 16000 Hz, mono, 20 ms frames). A topic parser is added as the inverse of the builder, so the builder can be round-trip tested and the gateway can route by topic in a later spec.
- **C9. Naming.** Contract types end in `Message`: `HelloMessage`, `StatusMessage`, `EventMessage` with one type per event kind (for example `TouchEventMessage`), `AudioStartMessage`, `AudioEndMessage`, `AckMessage`, and `CmdMessage` with one type per action (for example `SayCmdMessage`). Each schema is named after its type with a `Schema` suffix (for example `HelloMessageSchema`). Domain types have plain names (`Household`, `User`, …, `Event` for the stored domain event). Wire fields are snake_case exactly as in Document B. Everything is exported from `index.ts` with no name collisions.
- **C10. Codec API.** Each message has a `parse` and a `serialise` function. Union parsers exist for each topic or direction: the device→cloud topics (`status` carries hello or status, `event`, `ack`), commands, and audio control. `serialise` returns the JSON text of a validated message. `parse` turns JSON text into a validated message. The Result-returning `parse` never throws for bad input; a throwing variant is also offered. `serialise` validates its input and throws a contract error if the input is invalid, because an invalid outgoing message is a programming error.
- **C11. Zod.** Zod 4 (the current stable major), exact-pinned, is the Shared_Package's only runtime dependency. The design phase records the exact version. This intentionally supersedes Phase 0 Requirements 8.5, 8.6, 8.7 and 8.9 (placeholder-only folders, zero exports, zero runtime dependencies). The Phase 0 repo checks that encode those rules are updated in this spec: `packages/shared/test/exports.test.ts`, the `.gitkeep` checks for the two shared folders in `tooling/test/layout.test.ts`, the "shared has no runtime dependencies" check in `tooling/test/manifests.test.ts`, and the README note "gateway-contract is empty on purpose" with its check in `tooling/test/readme.test.ts`. Every other Phase 0 check stays green unchanged. The Phase 0 spec documents are not edited; this spec records the supersession.
- **C12. Domain.**
  - `ChildProfile.age_stage` is derived by a pure function from `date_of_birth` and a reference date: age under 3 → `tiny`, 3–5 → `little`, 6–8 → `explorer`, 9 and over → `maker`. The product.md ranges are assumptions. Under 1 maps to `tiny`, and over 12 is capped at `maker`.
  - Age is counted in completed years. A 29 February birthday is treated as reached on 1 March in non-leap years.
  - Dates are ISO 8601 calendar dates (`YYYY-MM-DD`). Timestamps are ISO 8601 UTC date-time strings.
  - Domain fields are snake_case, matching the database columns they will map to.
  - Every household-scoped entity carries `household_id`.
  - Content has two first-class row classes (ruling 6). A household content row (`HouseholdContentItem`) has a `household_id` string, is protected by RLS by `household_id`, and is written by the household's parents. A global curated content row (`GlobalContentItem`) has `household_id` `null`, is a read-only reference for every household, and is written only by admins (the service role or the admin console). Both share every other field. `ContentItem` is the union of the two, `ContentRowClass` is `"household" | "global"`, and a pure helper `contentRowClass(item)` returns the row class. The RLS policies and writer rules belong to the later database spec; here they are recorded as doc comments on the types.
  - No domain type has a field that holds audio bytes or a child-audio reference (safety.md §1). `GrandmaAsset` references its adult-provided recording by a storage path and requires `consent_record_id`.
  - `Consent` records who, what, when, the notice version, the verification method, and withdrawal.
  - Transcripts live on `Session` as text-only turns with retention metadata, defaulting to 30 days.
  - `Device` carries no token, key or other secret.
- **C13. Steering.** The "Document B seam" section of `.kiro/steering/tech.md` is updated to `proto_ver` 2 as part of this spec: four topics, `ota` as a command action, audio markers carrying `proto_ver` and `ts`, `time_uncertain`, the barge-in sequence, pairing in Document C, and the docx's status as Version 2.0, provisionally frozen pending intern confirmation. The "Domain model notes" in `.kiro/steering/structure.md` are updated with the two content row classes (ruling 6).
- **C14. No improvements.** The wire format has no fields beyond Document B v2 plus the choices stated here.
- **C15. Field optionality.** Every field that Document B lists for a message, event kind or command action is required, except `wake.dir_deg`, `event.time_uncertain`, the `config` delta keys, and `linear_mms` and `angular_mrad_s` on a `move` with `cmd: "stop"` (ruling 4). The `config` delta keys (`volume`, `quiet_hours`, `movement_on`, `language`, `active_child_id`) are each optional, and at least one must be present. `max_dist_mm` is not a speed, so it stays required for every move `cmd`, including `stop` (stated choice; OP7 asks the intern to confirm). This is the strictest reading. Relaxing a field to optional later is a `proto_ver` decision (OP7).
- **C16. Say audio.** Document B's say table lists `audio` as "streamed Opus down the WS". That is the WebSocket audio, not a JSON field. The say `data` object has no `audio` key, and a say command that carries one is rejected.
- **C17. Status mode.** `status.mode` uses the same closed list as `set_mode` (`idle`, `play`, `story`, `quiet`, `sleep`) (ruling 3, intern to confirm). Document B shows only `idle` in the status example.
- **C18. Fixture files.** Each fixture is a `.json` file in `gateway-contract/fixtures/` holding exactly one wire message, with a kebab-case name (for example `hello.json`, `event-touch.json`, `cmd-stop-audio.json`). A `fixtures/manifest.json` records, for each fixture file, its Document B source section, its provenance (`derived` or `constructed`) and a provenance note (Requirement 13.5). Fixtures are test data: they are not exported from `index.ts`.
- **C19. Fixture URLs.** The constructed ota fixture uses an `https` URL whose host is `localhost`, so the Phase 0 non-local URL scan (which covers `packages/shared/src`) stays unchanged. Generated test inputs may use any host, because test files are already excluded from that scan.
- **C20. Error output.** Parse and serialise errors report the field path and issue kind only, never the field value. This keeps `auth` tokens and any free text out of logs (safety.md §7).
- **C21. JSON input.** Parse input is UTF-8 JSON text. Text that is not valid JSON, or whose top-level value is not an object, is rejected with a contract error. Duplicate keys follow `JSON.parse` (the last one wins) and are not detected.
- **C22. Value equality.** Round-trip equality is deep structural equality of JSON values. Generators produce only JSON-representable values: finite numbers and no `-0`, because JSON writes `-0` as `0`.
- **C23. Topic device IDs.** The topic builder accepts a `device_id` that is non-empty and contains none of `/`, `+` or `#` (the MQTT level separator and wildcards).
- **C24. Move data.** The `move` command's `data` is discriminated on `cmd` (ruling 4): `come` and `turn` require `linear_mms`, `angular_mrad_s` and `max_dist_mm`; `stop` requires `max_dist_mm` and accepts `linear_mms` and `angular_mrad_s` either absent or present.

### Open points and rulings

Omar ruled on the open points on 8 Oct 2026. Items marked "intern to confirm" still need the hardware side's confirmation. Changing any choice later needs sign-off from the software side (Claude/Omar) and the hardware side (intern), with a `proto_ver` bump.

- **OP1. `ts` on hello and ack. RESOLVED by Omar's ruling (8 Oct 2026, ruling 1).** The Document B v2 hello and ack examples show no `ts`, but the envelope rule says every upstream message carries one, and the envelope rule wins. `ts` is required on both (C2). Flag to the intern so the firmware sends `ts` on hello and ack.
- **OP2. Undefined shapes. RESOLVED by Omar's ruling (8 Oct 2026, ruling 2), intern to confirm.** `quiet_hours` is `{start: "HH:MM", end: "HH:MM"}` in 24-hour local time, `color` is `"#RRGGBB"`, and `brightness` is an integer from 0 to 100.
- **OP3. hello `proto`.** hello's `proto` field duplicates `proto_ver`. It is kept and must equal 2.
- **OP4. Outside the contract. RESOLVED by Document B v2.** There is no WebSocket cancel frame (barge-in is `interrupt` → `audio_end` → `stop_audio`, §3.5), and Bluetooth/Wi-Fi pairing moves to Document C (§10). Both stay outside this contract.
- **OP5. Reason on `failed`. RESOLVED by Omar's ruling (8 Oct 2026, ruling 5).** A `failed` ack may have an empty reason. A `rejected` ack requires a reason from the fixed list (C7).
- **OP6. Unstated value types. RESOLVED by Omar's ruling (8 Oct 2026, ruling 3), intern to confirm ranges.** `status.mode` is the closed list `idle`, `play`, `story`, `quiet`, `sleep` (C17); wake `dir_deg` is an integer from 0 to 359 inclusive; move `linear_mms` and `angular_mrad_s` are non-negative finite numbers with no upper bound; `max_dist_mm` stays a non-negative finite number; motion `value` is a finite number; error `code` and `detail` are strings.
- **OP7. Field optionality.** Document B does not say which data fields are optional. Choice C15 makes every listed field required except `dir_deg`, `time_uncertain`, the `config` delta keys, and the two speeds on a `stop` move. Omar's ruling 4 (8 Oct 2026) resolves the `move` example: with `cmd: "stop"`, `linear_mms` and `angular_mrad_s` are optional (C24). Still open, intern to confirm: whether a `stop` move needs `max_dist_mm` (choice: required, because it is not a speed). Other fields stay required under C15; for example, `animate` must carry `eyes` and `loop`.
- **OP8. Connection-sequence subscription.** The Document B v2 connection sequence says the robot "subscribes to /cmd and /ack", but §7.2 says it subscribes to `/cmd` only. This is likely a typo. Intern to confirm that the device subscribes to `/cmd` only. No contract change: this spec defines no subscription rules.

## Glossary

- **Shared_Package**: the TypeScript package at `packages/shared` (`@xelulu/shared`).
- **Contract_Module**: everything under `packages/shared/src/gateway-contract/`. It is the single home of the Document B v2 types, schemas, constants, codec functions and fixtures.
- **Domain_Module**: everything under `packages/shared/src/domain/`.
- **Shared_Entry**: `packages/shared/src/index.ts` and its built output, the Shared_Package's only public entry.
- **Document_B_v2**: the frozen Document B contract at `proto_ver` 2, meaning `docs/B-gateway-and-hardware-seam.docx` (Version 2.0, 8 Oct 2026, provisionally frozen pending intern confirmation) with Omar's rulings in "Open points and rulings" applied.
- **Wire_Message**: any JSON message defined by Document_B_v2: hello, status, event (any kind), audio_start, audio_end, ack, or a command (any action).
- **Device_Message**: a Wire_Message sent from device to cloud: hello, status, event, ack, audio_start or audio_end.
- **Cmd_Message**: a Wire_Message sent from cloud to device on the `cmd` topic, discriminated by `action`.
- **Event_Kind**: the value of an event's `event` field: `touch`, `wake`, `cry`, `motion`, `button`, `nfc`, `interrupt` or `error`.
- **Cmd_Action**: the value of a Cmd_Message's `action` field: `say`, `animate`, `gesture`, `move`, `play`, `set_mode`, `led`, `volume`, `config`, `stop_audio` or `ota`.
- **Message_Variant**: one of the following: hello, status, each Event_Kind, audio_start, audio_end, ack, and each Cmd_Action.
- **Discriminator**: the field that selects a Message_Variant: `type` on Device_Messages, `event` on events, `action` on Cmd_Messages.
- **Message_Schema**: the Zod schema exported for a Message_Variant or a union of Message_Variants.
- **Closed_Enum**: a field whose accepted values are exactly a fixed list from Document_B_v2 (C4).
- **Open_Vocabulary**: a field that accepts any non-empty string, with the known values exported as constants (C4).
- **Codec**: the `parse` and `serialise` functions for a Message_Variant or a union.
- **Parse_Result**: the value a Result-returning parse function returns: either success with the validated message, or failure with a Contract_Error.
- **Contract_Error**: the error value or thrown error the Codec produces. It lists one or more issues, each with a field path and an issue kind, and contains no field values.
- **Topic_Suffix**: one of `status`, `event`, `cmd` or `ack`.
- **Topic_Builder**: the function that builds `xelulu/{device_id}/{Topic_Suffix}`.
- **Topic_Parser**: the function that splits a topic string into `device_id` and Topic_Suffix.
- **Golden_Fixture**: a JSON file in `packages/shared/src/gateway-contract/fixtures/` holding one Wire_Message.
- **Derived_Fixture**: a Golden_Fixture copied from a Document_B_v2 JSON example, verbatim except for the `ts` added to hello and ack (C1).
- **Constructed_Fixture**: a Golden_Fixture built from Document B's field tables because Document_B_v2 has no usable JSON example for that Message_Variant (no example, or, for ota, an example with a placeholder host) (C1).
- **Fixture_Manifest**: `packages/shared/src/gateway-contract/fixtures/manifest.json` (C18).
- **Message_Generator**: a fast-check arbitrary that produces valid Wire_Messages of one Message_Variant.
- **JSON_Equality**: deep structural equality of JSON values (C22).
- **Age_Stage**: one of `tiny`, `little`, `explorer` or `maker`.
- **Age_Stage_Function**: the pure function that derives an Age_Stage from a `date_of_birth` and a reference date.
- **Repo_Checks**: the Vitest checks under `tooling/test/` and `packages/shared/test/` that Phase 0 created.
- **Household_Content_Item**: a content row scoped to one household, with a `household_id` string (C12).
- **Global_Content_Item**: a curated content row with `household_id` `null`, read-only for every household and written only by admins (C12).
- **Content_Row_Class**: `household` for a Household_Content_Item or `global` for a Global_Content_Item.
- **Tech_Steering**: `.kiro/steering/tech.md`.
- **Structure_Steering**: `.kiro/steering/structure.md`.

## Requirements

### Requirement 1: Contract constants and topics

**User Story:** As the implementation engineer, I want the protocol version, topics and audio format as exported constants, so that no package hard-codes them.

#### Acceptance Criteria

1. THE Contract_Module SHALL export a constant `PROTO_VER` whose value is the number `2`.
2. THE Contract_Module SHALL export exactly four Topic_Suffix constants, `status`, `event`, `cmd` and `ack`, and SHALL export no constant, type or string for an `ota` topic.
3. WHEN the Topic_Builder is called with a valid `device_id` (C23) and a Topic_Suffix, THE Topic_Builder SHALL return the string `xelulu/{device_id}/{Topic_Suffix}`.
4. IF the Topic_Builder is called with a `device_id` that is empty or contains `/`, `+` or `#`, or with a suffix that is not one of the four Topic_Suffix values (including `ota`), THEN THE Topic_Builder SHALL throw a Contract_Error and return no topic string.
5. WHEN the Topic_Parser is given a string of the form `xelulu/{device_id}/{Topic_Suffix}` with a valid `device_id`, THE Topic_Parser SHALL return that `device_id` and Topic_Suffix.
6. IF the Topic_Parser is given a string that does not have exactly three `/`-separated levels, whose first level is not exactly `xelulu` (case-sensitive), whose `device_id` is invalid (C23), or whose last level is not a Topic_Suffix (including `ota`), THEN THE Topic_Parser SHALL return a failure Parse_Result and SHALL NOT throw.
7. FOR ALL valid `device_id` values and Topic_Suffix values, parsing the Topic_Builder output with the Topic_Parser SHALL return the same `device_id` and Topic_Suffix (round-trip property, at least 100 runs).
8. THE Contract_Module SHALL export audio format constants with codec `opus`, sample rate `16000` Hz, channel count `1` and frame duration `20` ms, applying to both directions.

### Requirement 2: Message envelopes

**User Story:** As the implementation engineer, I want every message envelope enforced exactly as Document_B_v2 states, so that the gateway and the robot agree on the outer shape of every message.

#### Acceptance Criteria

1. THE Message_Schema of every Device_Message SHALL require `proto_ver` equal to `2`, `ts` as a non-negative safe integer of unix seconds, and `type` equal to the Message_Variant's type name (`hello`, `status`, `event`, `ack`, `audio_start` or `audio_end`).
2. THE Message_Schema of every Cmd_Message SHALL require exactly the envelope keys `proto_ver` equal to `2`, `cmd_id` as a non-empty string, `action` equal to the Cmd_Action, and `data` as a JSON object (an array or `null` is rejected).
3. IF a Cmd_Message carries a `ts` key or a `type` key, THEN THE Codec SHALL reject the message with a Contract_Error.
4. THE Message_Schema of every event SHALL require `event_id` as a non-empty string, `event` as an Event_Kind and `data` as a JSON object (an array or `null` is rejected), and SHALL accept `time_uncertain` either absent or present as a boolean, rejecting any other value including `null`.
5. THE Message_Schema of every event SHALL accept any non-negative safe integer `ts`, including a `ts` earlier than other events already received, so that back-dated events queued while offline are valid.

### Requirement 3: Strict validation

**User Story:** As Omar, I want any message that drifts from Document_B_v2 to be rejected, so that the wire format cannot change quietly.

#### Acceptance Criteria

1. IF a Wire_Message contains a key that Document_B_v2 and the stated choices do not define for its Message_Variant, at the top level or at any nested depth (including inside `data` and `quiet_hours`), THEN THE Codec SHALL reject the message with a Contract_Error whose issue path names the unknown key's location.
2. IF a Wire_Message has no `proto_ver`, or a `proto_ver` that is not the number `2` (including the string `"2"`, `1`, `3`, a non-integer or `null`), THEN THE Codec SHALL reject the message with a Contract_Error.
3. IF a Wire_Message's Discriminator value is missing, is not a string, or is not one of the values defined for that position, THEN THE Codec SHALL reject the message with a Contract_Error.
4. IF a Wire_Message's Discriminator names one Message_Variant and its remaining fields do not satisfy that Message_Variant's Message_Schema, even when they would satisfy a different Message_Variant's Message_Schema (for example a `touch` event whose `data` holds `confidence` and `duration_s`), THEN THE Codec SHALL reject the message with a Contract_Error.
5. IF a required field is missing, has the wrong JSON type (including `null` where `null` is not stated as allowed), or is outside its stated range or pattern (C5), THEN THE Codec SHALL reject the message with a Contract_Error.
6. IF a Closed_Enum field holds a value outside its list, including a value that differs only by letter case or surrounding whitespace, THEN THE Codec SHALL reject the message with a Contract_Error.
7. IF an Open_Vocabulary field holds an empty string or a non-string value, THEN THE Codec SHALL reject the message with a Contract_Error.
8. IF the parse input is not valid JSON text, or its top-level value is not a JSON object, THEN THE Codec SHALL reject the input with a Contract_Error (C21).
9. THE Contract_Error SHALL contain at least one issue, each issue SHALL hold a field path (empty for issues about the whole input, such as invalid JSON text) and an issue kind, and THE Contract_Error SHALL contain no field value from the input.

### Requirement 4: hello and status

**User Story:** As the implementation engineer, I want hello and status validated exactly, so that the gateway knows who connected and how the robot is doing.

#### Acceptance Criteria

1. THE HelloMessageSchema SHALL require exactly the keys `proto_ver`, `ts`, `type` equal to `hello`, `device_id` (non-empty string), `fw_ver` (non-empty string), `auth` (non-empty string) and `proto` (the number `2`, see criterion 2).
2. IF a hello message has a `proto` value other than the number `2` (including the string `"2"`, `1` or `null`), THEN THE Codec SHALL reject the message with a Contract_Error (OP3).
3. THE StatusMessageSchema SHALL require exactly the keys `proto_ver`, `ts`, `type` equal to `status`, `battery_pct` (integer 0–100), `charging` (boolean), `mode` (Closed_Enum `idle`, `play`, `story`, `quiet`, `sleep`), `wifi_rssi` (integer), `fault` (array of strings, where an empty array is accepted), `active_child_id` (string or `null`) and `temp_c` (finite number).
4. WHEN valid hello or status JSON text is parsed with the `status` topic union parser, THE Codec SHALL return a success Parse_Result holding a `HelloMessage` if `type` is `hello` and a `StatusMessage` if `type` is `status`.
5. IF the `status` topic union parser is given a Wire_Message of any other Message_Variant (an event, ack, audio_start, audio_end or Cmd_Message), even one that is otherwise valid, THEN THE Codec SHALL return a failure Parse_Result.

### Requirement 5: Events

**User Story:** As the implementation engineer, I want every event kind validated with its own data shape, so that touch, wake, cry and the rest reach the cloud exactly as the robot sent them.

#### Acceptance Criteria

1. WHEN the Event_Kind is `touch`, THE EventMessageSchema SHALL require `data` to hold exactly `zone` (Closed_Enum `head`, `left_ear`, `right_ear`, `belly`, `back`, `left_hand`, `right_hand`) and `gesture` (Closed_Enum `tap`, `double_tap`, `hold`, `pat`).
2. WHEN the Event_Kind is `wake`, THE EventMessageSchema SHALL require `data` to hold `source` (Closed_Enum `hey_lulu`, `touch`), SHALL accept an optional `dir_deg` (integer 0–359 inclusive), and SHALL accept no other key in `data`.
3. WHEN the Event_Kind is `cry`, THE EventMessageSchema SHALL require `data` to hold exactly `confidence` (number 0–1 inclusive) and `duration_s` (non-negative finite number).
4. IF a `cry` event's `data` holds any key other than `confidence` and `duration_s`, including any audio, transcript or URL field, THEN THE Codec SHALL reject the message with a Contract_Error.
5. WHEN the Event_Kind is `motion`, THE EventMessageSchema SHALL require `data` to hold exactly `event` (Closed_Enum `pickup`, `shake`, `upside_down`, `drop`, `tilt`) and `value` (finite number).
6. WHEN the Event_Kind is `button`, THE EventMessageSchema SHALL require `data` to hold exactly `button` (Closed_Enum `belly_talk`) and `action` (Closed_Enum `press`, `release`).
7. WHEN the Event_Kind is `nfc`, THE EventMessageSchema SHALL require `data` to hold exactly `card_id` (non-empty string).
8. WHEN the Event_Kind is `interrupt`, THE EventMessageSchema SHALL require `data` to be an empty object with no keys (C6).
9. WHEN the Event_Kind is `error`, THE EventMessageSchema SHALL require `data` to hold exactly `code` (string, empty allowed) and `detail` (string, empty allowed).
10. THE Contract_Module SHALL export one TypeScript type per Event_Kind (for example `TouchEventMessage`, `CryEventMessage`) and an `EventMessage` union of all of them, narrowed by the `event` field.

### Requirement 6: Audio control messages

**User Story:** As the implementation engineer, I want the audio turn markers validated, so that each WebSocket turn opens and closes with the same `turn_id`.

#### Acceptance Criteria

1. THE AudioStartMessageSchema SHALL require exactly the keys `proto_ver`, `ts`, `type` equal to `audio_start` and `turn_id` (non-empty string).
2. THE AudioEndMessageSchema SHALL require exactly the keys `proto_ver`, `ts`, `type` equal to `audio_end` and `turn_id` (non-empty string).
3. WHEN JSON text that satisfies criterion 1 or criterion 2 is given to the audio control union parser, THE Codec SHALL return a success Parse_Result holding an `AudioStartMessage` if `type` is `audio_start`, or an `AudioEndMessage` if `type` is `audio_end`.
4. IF the audio control union parser is given JSON text whose `type` is neither `audio_start` nor `audio_end` (including a valid hello, status, event or ack), or that fails criterion 1 or criterion 2, THEN THE Codec SHALL return a failure Parse_Result holding a Contract_Error.
5. IF an audio control message carries an audio payload key, an audio URL key or any other key outside criteria 1 and 2, THEN THE Codec SHALL reject the message with a Contract_Error.
6. THE Codec SHALL validate each audio control message on its own, so that an `audio_end` is accepted whether or not an `audio_start` with the same `turn_id` was parsed before it (turn pairing is outside this spec's scope).

### Requirement 7: Acknowledgements

**User Story:** As the implementation engineer, I want acks validated with the hardware's refusal reasons, so that the cloud treats each refusal as final.

#### Acceptance Criteria

1. THE AckMessageSchema SHALL require exactly the keys `proto_ver`, `ts`, `type` equal to `ack`, `cmd_id` (non-empty string), `status` (Closed_Enum `accepted`, `done`, `rejected`, `failed`) and `reason`.
2. THE AckMessageSchema SHALL accept as `reason` the empty string `""` or one value of the Closed_Enum `picked_up`, `at_edge`, `charging`, `quiet_hours`, `low_battery`, `unsafe`, `busy`, `unknown_action`.
3. IF an ack's `reason` is missing, is not a string, or is a string other than `""` and the eight values in criterion 2 (including letter-case variants, whitespace-only strings and listed values with surrounding whitespace), THEN THE Codec SHALL reject the message with a Contract_Error.
4. IF an ack has status `rejected` and its `reason` is `""`, THEN THE Codec SHALL reject the message with a Contract_Error.
5. WHEN an ack has status `accepted`, `done` or `failed`, THE AckMessageSchema SHALL accept a `reason` of `""` or any value in criterion 2 (C7; ruling 5 for `failed`).
6. THE Contract_Module SHALL export the ack status list as a constant holding exactly the four values in criterion 1, and the ack reason list as a constant holding exactly the eight values in criterion 2 without `""`.

### Requirement 8: Commands

**User Story:** As the implementation engineer, I want every command action validated with its own data shape, so that the cloud only ever sends the robot commands it understands.

#### Acceptance Criteria

1. WHEN the Cmd_Action is `say`, THE CmdMessageSchema SHALL require `data` to hold exactly `expression` (Open_Vocabulary), `lang` (BCP-47-like tag, C5), `voice` (Closed_Enum `xelulu`, `grandma`) and `duration_hint_ms` (non-negative integer).
2. IF a `say` command's `data` holds an `audio` key, or any key other than the four in criterion 1, THEN THE Codec SHALL reject the message with a Contract_Error (C16).
3. WHEN the Cmd_Action is `animate`, THE CmdMessageSchema SHALL require `data` to hold exactly `expression` (Open_Vocabulary), `eyes` (Open_Vocabulary) and `loop` (boolean).
4. WHEN the Cmd_Action is `gesture`, THE CmdMessageSchema SHALL require `data` to hold exactly `name` (Open_Vocabulary).
5. WHEN the Cmd_Action is `move` and `data.cmd` is `come` or `turn`, THE CmdMessageSchema SHALL require `data` to hold exactly `cmd`, `linear_mms` (non-negative finite number), `angular_mrad_s` (non-negative finite number) and `max_dist_mm` (non-negative finite number) (C24, ruling 3, ruling 4).
6. WHEN the Cmd_Action is `move` and `data.cmd` is `stop`, THE CmdMessageSchema SHALL require `data` to hold `cmd` and `max_dist_mm` (non-negative finite number), SHALL accept `linear_mms` and `angular_mrad_s` (each a non-negative finite number) either absent or present, and SHALL accept no other key in `data` (C24, ruling 4; OP7 for `max_dist_mm`).
7. WHEN the Cmd_Action is `play`, THE CmdMessageSchema SHALL require `data` to hold exactly `content_id` (non-empty string) and `source` (Closed_Enum `stream`, `cache`).
8. WHEN the Cmd_Action is `set_mode`, THE CmdMessageSchema SHALL require `data` to hold exactly `mode` (Closed_Enum `idle`, `play`, `story`, `quiet`, `sleep`).
9. WHEN the Cmd_Action is `led`, THE CmdMessageSchema SHALL require `data` to hold exactly `target` (Closed_Enum `ears`, `cheeks`, `belly`), `color` (a 7-character string of `#` followed by exactly six hexadecimal digits `0`–`9`, `A`–`F` or `a`–`f`), `effect` (Closed_Enum `solid`, `pulse`, `rainbow`) and `brightness` (integer 0–100) (ruling 2).
10. WHEN the Cmd_Action is `volume`, THE CmdMessageSchema SHALL require `data` to hold exactly `level` (integer 0–100).
11. WHEN the Cmd_Action is `config`, THE CmdMessageSchema SHALL accept in `data` only the optional keys `volume` (integer 0–100), `quiet_hours` (an object with exactly the keys `start` and `end`, each a 24-hour `HH:MM` string of a two-digit hour `00`–`23`, a colon and a two-digit minute `00`–`59`, with no ordering required between `start` and `end`, ruling 2), `movement_on` (boolean), `language` (BCP-47-like tag) and `active_child_id` (string or `null`, where a key present with value `null` counts as present).
12. IF a `config` command's `data` is an empty object holding none of the keys in criterion 11, THEN THE Codec SHALL reject the message with a Contract_Error.
13. WHEN the Cmd_Action is `stop_audio`, THE CmdMessageSchema SHALL require `data` to be an empty object with no keys (C6).
14. WHEN the Cmd_Action is `ota`, THE CmdMessageSchema SHALL require `data` to hold exactly `manifest_url`, an absolute URL with a non-empty host whose scheme is `https`.
15. IF an `ota` command's `manifest_url` is not an absolute URL with a non-empty host, or its scheme is not `https` (for example `http`, `wss`, a relative path or the empty string), THEN THE Codec SHALL reject the message with a Contract_Error.
16. THE Contract_Module SHALL export one TypeScript type per Cmd_Action (for example `SayCmdMessage`, `OtaCmdMessage`) and a `CmdMessage` union of all of them, narrowed by the `action` field, and SHALL type move `data` as a union of the `come`, `turn` and `stop` shapes, narrowed by `data.cmd`.

### Requirement 9: Enumerations and vocabularies

**User Story:** As the implementation engineer, I want every list in the contract exported as a constant, so that the simulator panel and the gateway use the same values as the schemas.

#### Acceptance Criteria

1. THE Contract_Module SHALL export each Closed_Enum list (touch zones, touch gestures, wake sources, motion kinds, buttons, button actions, modes, move commands, play sources, LED targets, LED effects, say voices, ack statuses, ack reasons, Event_Kinds and Cmd_Actions) as a constant holding exactly the values stated for that field in Requirements 4, 5, 7 and 8 and in the Glossary, and each Message_Schema SHALL accept exactly the values in the matching constant.
2. THE Contract_Module SHALL export the seven touch zones in the order `head`, `left_ear`, `right_ear`, `belly`, `back`, `left_hand`, `right_hand`.
3. THE Contract_Module SHALL export the known values of each Open_Vocabulary as constants: animate expressions (`happy`, `love`, `sleepy`, `curious`, `sad`, `listening`), which are also the known values of the say `expression` (C4), animate eyes (`blink`, `hearts`) and gesture names (`wave`, `high_five`, `hug`, `clap`, `point_left`, `nod`, `shake`).
4. THE Contract_Module SHALL type every constant in criteria 1 and 3 as read-only, so that a compile-time assertion that assigning to an element is a type error passes, and SHALL freeze every such constant at runtime, so that an attempt to modify it leaves its contents unchanged.
5. WHEN an Open_Vocabulary field holds a non-empty string that is absent from its known-values constant (including a whitespace-only string or a letter-case variant of a known value), THE Codec SHALL accept the field.

### Requirement 10: Codec API

**User Story:** As the implementation engineer, I want one parse and one serialise function per message plus union parsers, so that the gateway and simulator never hand-roll JSON handling.

#### Acceptance Criteria

1. THE Contract_Module SHALL export, for each Message_Variant, a Result-returning parse function, a throwing parse function and a serialise function.
2. THE Contract_Module SHALL export union parsers, each with a Result-returning and a throwing variant, for: the `status` topic (accepting hello or status), the `event` topic (accepting any Event_Kind), the `ack` topic (accepting ack), any Device_Message received on MQTT (taking a Topic_Suffix and JSON text, and accepting only the Message_Variants of that topic's parser, so the `cmd` suffix accepts none), any Cmd_Message, and audio control messages (accepting audio_start or audio_end).
3. IF a Result-returning parse function is given input that fails validation, including text that is not valid JSON or whose top-level value is not a JSON object (C21), THEN THE Codec SHALL return a failure Parse_Result holding a Contract_Error and SHALL NOT throw.
4. IF a throwing parse function is given input that fails validation, THEN THE Codec SHALL throw a Contract_Error whose issues (field path and issue kind) are the same as the issues the Result-returning variant reports for that input.
5. WHEN a parse function is given input that passes validation, THE Codec SHALL return a message that is JSON_Equal to the parsed JSON value: as a success Parse_Result from the Result-returning variant, and as the returned value from the throwing variant.
6. WHEN a serialise function is given a valid message, THE Codec SHALL return JSON text whose parsed value is JSON_Equal to that message.
7. IF a serialise function is given a value that fails its Message_Schema, THEN THE Codec SHALL throw a Contract_Error and return no text.
8. IF the Device_Message parser is given a Topic_Suffix and a message whose Message_Variant does not belong on that topic (for example an ack on the `event` topic, a hello on the `ack` topic, or any message on the `cmd` topic), THEN THE Codec SHALL return a failure Parse_Result.
9. THE TypeScript type of each Message_Variant SHALL equal the output type of its Message_Schema, checked by a compile-time type assertion that fails `pnpm build` or the test type-check when the two differ.

### Requirement 11: Round-trip property

**User Story:** As Omar, I want every message to survive serialise then parse unchanged, so that nothing is lost or altered crossing the seam.

#### Acceptance Criteria

1. THE Contract_Module tests SHALL provide one Message_Generator per Message_Variant. Each Message_Generator SHALL produce only messages that the Message_Variant's Message_Schema accepts, and only JSON-representable values: finite numbers and no `-0` (C22).
2. FOR ALL messages produced by each Message_Generator, parsing the output of serialise SHALL return a success Parse_Result whose message is JSON_Equal to the original (round-trip property, at least 100 runs per Message_Variant).
3. FOR ALL messages produced by each Message_Generator, parsing the serialised message with the union parser for its topic or direction SHALL return a message JSON_Equal to the original (round-trip property, at least 100 runs per Message_Variant). The union parsers are: the `status` topic parser for hello and status, the `event` topic parser for every Event_Kind, the `ack` topic parser for ack, the Cmd_Message parser for every Cmd_Action, the audio control parser for audio_start and audio_end, and also the Device_Message parser with the matching Topic_Suffix for hello, status, events and ack.
4. FOR EACH Golden_Fixture, parsing the fixture text with its Message_Variant's parse function and with its union parser (as in criterion 3) SHALL succeed, and parsing the serialised result SHALL return a message JSON_Equal to the first parse result and to the fixture's JSON value.
5. FOR ALL messages produced by each Message_Generator, serialising then parsing then serialising SHALL produce text identical to the first serialisation (serialisation stability property, at least 100 runs per Message_Variant).
6. WHEN 1,000 messages are sampled from each Message_Generator with a fixed seed, THE Contract_Module tests SHALL find in those samples: each optional field (`wake.dir_deg`, `time_uncertain`, each `config` delta key, and `linear_mms` and `angular_mrad_s` on a `stop` move) both present and absent; every value of every Closed_Enum the Message_Variant uses; ack `reason` as `""` and as each enum value; `active_child_id` as a string and as `null`; error `code` and `detail` as `""`; and these boundary values: `ts` 0 and 9007199254740991, `battery_pct`, volume `level`, config `volume` and LED `brightness` 0 and 100, `confidence` 0 and 1, `dir_deg` 0 and 359, `duration_s`, `duration_hint_ms`, `max_dist_mm`, `linear_mms` and `angular_mrad_s` 0, and `quiet_hours` `start` and `end` `00:00` and `23:59`.

### Requirement 12: Rejection properties

**User Story:** As Omar, I want property tests that prove bad messages are rejected, so that strictness does not erode over time.

#### Acceptance Criteria

1. FOR ALL valid messages produced by each Message_Generator and every object position inside them (the top level, `data`, and `quiet_hours`), adding one key whose name is not defined for that position SHALL make the matching parse function and the union parser for its topic or direction (Requirement 11.3) return a failure Parse_Result (property, at least 100 runs per Message_Variant).
2. FOR ALL valid messages produced by each Message_Generator, replacing `proto_ver` with any JSON value other than the number `2`, or removing it, SHALL make the matching parse function and its union parser return a failure Parse_Result (property, at least 100 runs per Message_Variant).
3. FOR ALL valid messages produced by each Message_Generator, replacing each Discriminator in the message (`type`, and `event` on events, or `action` on Cmd_Messages) with any string outside its defined values, or with any non-string JSON value, SHALL make the matching parse function and its union parser return a failure Parse_Result (property, at least 100 runs per Message_Variant).
4. FOR ALL valid messages produced by each Message_Generator and every Closed_Enum field in them, replacing the field with a string outside its list, including a listed value with the case of one or more letters changed or with a leading or trailing space added, SHALL make the matching parse function return a failure Parse_Result (property, at least 100 runs per Message_Variant).
5. FOR ALL valid messages produced by each Message_Generator and every bounded numeric field in them, replacing the field with a value below its minimum or above its maximum (for integer fields, including minimum − 1 and maximum + 1), or with a non-integer where an integer is required, SHALL make the matching parse function return a failure Parse_Result (property, at least 100 runs per Message_Variant).
6. FOR ALL valid messages produced by each Message_Generator and every field that is required for that message's Discriminator and move `cmd` values (so `linear_mms` and `angular_mrad_s` count as required on `come` and `turn` moves and not on `stop` moves), removing that field, or replacing it with a value of a JSON type the field does not accept, SHALL make the matching parse function return a failure Parse_Result (property, at least 100 runs per Message_Variant).
7. FOR ALL valid Device_Messages, removing `ts`, or replacing it with a negative number, a non-integer, an integer greater than 9007199254740991 or a string, SHALL make the matching parse function return a failure Parse_Result (property, at least 100 runs per Message_Variant).
8. FOR ALL rejected inputs in criteria 1–7, and for the Contract_Error thrown when the same invalid value is given to serialise, THE Contract_Error's message and its issues serialised as JSON SHALL contain none of these values when each is generated with at least 8 characters: the identifiers, `auth`, `fw_ver`, the Open_Vocabulary fields, `card_id`, `code`, `detail`, `active_child_id`, `manifest_url`, and the value of any added unknown key (property, C20).

### Requirement 13: Golden fixtures

**User Story:** As the intern, I want golden fixtures copied from Document B v2, so that the firmware and the cloud test against the same bytes.

#### Acceptance Criteria

1. THE Contract_Module SHALL contain one Derived_Fixture each for hello (§3.1), status (§3.2), event `touch` (§3.3), audio_start and audio_end (§3.4), the `say` command (§4.1) and ack (§5).
2. THE Derived_Fixtures for status, event `touch`, audio_start, audio_end and the `say` command SHALL hold exactly the keys and values of their Document_B_v2 example, copied verbatim (C1).
3. THE Derived_Fixtures for hello and ack SHALL hold exactly the keys and values of their Document_B_v2 example plus one added `ts` placed after `proto_ver`, with the value `1733400000` for hello and `1733400005` for ack (ruling 1, C1).
4. THE Contract_Module SHALL contain at least one Constructed_Fixture for each remaining Event_Kind (`wake`, `cry`, `motion`, `button`, `nfc`, `interrupt`, `error`) and each remaining Cmd_Action (`animate`, `gesture`, `move`, `play`, `set_mode`, `led`, `volume`, `config`, `stop_audio`, `ota`), so that every Message_Variant has at least one Golden_Fixture. The `ota` Constructed_Fixture SHALL follow the Document_B_v2 §4.2 shape with the URL `https://localhost/ota/manifest.json` in place of the placeholder host.
5. THE Fixture_Manifest SHALL list every Golden_Fixture file exactly once, with its Document B source section, its provenance (`derived` or `constructed`) and a note, where the note of each verbatim Derived_Fixture is "copied verbatim from Document B v2 §N" (its section), and the note of the hello and ack Derived_Fixtures is "v2 example + ts added per envelope rule (ruling 1)".
6. WHEN the fixture test runs, THE fixture test SHALL fail in any of these cases: a Golden_Fixture file is missing from the Fixture_Manifest; the Fixture_Manifest names a missing file; a fixture listed in criterion 1 is not recorded as `derived` with the note stated in criterion 5; any other fixture is not recorded as `constructed`; or any Message_Variant (identified by each fixture's Discriminator values) has no Golden_Fixture.
7. THE Golden_Fixtures SHALL use kebab-case `.json` file names, and each file SHALL hold exactly one Wire_Message as its top-level JSON object (C18).
8. THE Golden_Fixtures SHALL hold no real token, key or password, and SHALL use `localhost` as the host of any URL (C19), so that the Phase 0 file-name, secret and non-local URL Repo_Checks pass without any change to those checks.

### Requirement 14: Public exports

**User Story:** As the implementation engineer, I want everything exported from one entry with stable names, so that the gateway, simulator and admin console import the contract one way.

#### Acceptance Criteria

1. THE Shared_Entry SHALL export every type, Message_Schema, constant, Codec function, Topic_Builder, Topic_Parser, domain interface, the Age_Stage_Function and the `contentRowClass` helper defined by this spec.
2. THE Shared_Entry SHALL export no default export and SHALL export no Golden_Fixture data (C18).
3. THE Shared_Entry SHALL export no two symbols with the same name. The domain `Event` interface and the contract `EventMessage` type SHALL both be exported under those names.
4. THE type name of each Message_Variant and of each union of Message_Variants (for example `EventMessage`, `CmdMessage`) SHALL end in `Message`, each Message_Schema name SHALL be its type name followed by `Schema`, and every wire field name SHALL be the snake_case name used in Document_B_v2.
5. WHEN the export test runs, THE export test SHALL compare the Shared_Entry's runtime export names with an expected list kept in the test, and SHALL fail on any missing or unexpected name.
6. WHEN the export test is type-checked, THE type-check SHALL fail if any Message_Variant type, the `EventMessage` or `CmdMessage` union, the Parse_Result type, the Contract_Error type, the Topic_Suffix type, the Age_Stage type or any domain interface named in this spec cannot be imported from the Shared_Entry.

### Requirement 15: Domain interfaces

**User Story:** As the implementation engineer, I want shared domain interfaces that respect the safety rules, so that later database and app work start from one model.

#### Acceptance Criteria

1. THE Domain_Module SHALL export the TypeScript types `Household`, `User`, `ChildProfile`, `Device`, `Session`, `Event`, `ContentItem` (with `HouseholdContentItem` and `GlobalContentItem`), `GrandmaAsset`, `Consent` and `Report` as types only, with no Zod schema or other runtime validator for them, and with every field name in lowercase snake_case.
2. THE `User`, `ChildProfile`, `Device`, `Session`, `Event`, `HouseholdContentItem`, `GrandmaAsset`, `Consent` and `Report` interfaces SHALL each require a `household_id` string field, and THE `GlobalContentItem` interface SHALL require a `household_id` field of type `null`, so that content rows fall into exactly two first-class Content_Row_Classes (criterion 13, C12, ruling 6).
3. THE `User` interface SHALL require a `role` field of type `"parent" | "caregiver" | "grandma"`.
4. THE `ChildProfile` interface SHALL require a `date_of_birth` string field holding an ISO 8601 calendar date (`YYYY-MM-DD`) and an `age_stage` field of type `"tiny" | "little" | "explorer" | "maker"`.
5. THE `GrandmaAsset` interface SHALL require a `consent_record_id` string field that is neither optional nor nullable, and SHALL reference its recording through exactly one storage path string field and no other recording field.
6. THE `Consent` interface SHALL require fields recording who gave consent (the parent's `user_id`), what it covers (a purpose of `child_data_processing`, `grandma_recording` or `grandma_voice_clone`), when (`given_at`, an ISO 8601 UTC date-time string), the notice `version` and the `verification_method`, and SHALL require a `withdrawn_at` field that is an ISO 8601 UTC date-time string or `null`, where `null` means consent has not been withdrawn.
7. THE `Session` interface SHALL hold transcript turns in which each turn has a speaker of `child` or `xelulu` and a text string and no other content field, and SHALL require a `transcript_expires_at` ISO 8601 UTC date-time string.
8. THE Domain_Module SHALL export a constant for the default transcript retention period whose value is the number `30`, expressed in days.
9. THE `Device` interface SHALL require `device_id` and `household_id`, and SHALL hold no field for a device token, `auth` value, key, certificate, password or other secret.
10. THE `Event` interface SHALL require `event_id`, `device_id`, `household_id`, the Event_Kind, the device `ts` (a non-negative integer of unix seconds), a `received_at` ISO 8601 UTC date-time string and `time_uncertain` as a required boolean, and its event data SHALL use the contract event data type that matches its Event_Kind.
11. THE Domain_Module SHALL contain no interface field typed as binary data (`Uint8Array`, `ArrayBuffer` or any other typed array or buffer type), and no interface field other than the `GrandmaAsset` storage path that references an audio recording.
12. THE `Report` interface SHALL require a `period` of `"daily" | "weekly"`, the `child_id` string of the child it covers, the period start as an ISO 8601 calendar date and the generation time as an ISO 8601 UTC date-time string.
13. THE Domain_Module SHALL export `HouseholdContentItem` and `GlobalContentItem` interfaces that share every field except `household_id`, a `ContentItem` type that is the union of exactly those two, and a `ContentRowClass` type of `"household" | "global"`, each documented with its access rule: household rows protected by RLS by `household_id` and written by the household's parents, global rows a read-only reference for every household written only by admins (C12).
14. WHEN `contentRowClass` is given a `ContentItem`, THE Domain_Module SHALL return `household` if its `household_id` is a string and `global` if its `household_id` is `null`, without throwing.

### Requirement 16: Age-stage derivation

**User Story:** As a parent, I want my child's age stage worked out from their date of birth, so that replies match their age without me picking a stage.

#### Acceptance Criteria

1. WHEN the Age_Stage_Function is given a valid `date_of_birth` and a valid reference date on or after it, THE Age_Stage_Function SHALL return a success result holding `tiny` for an age under 3 completed years, `little` for 3 to 5, `explorer` for 6 to 8, and `maker` for 9 or more.
2. WHEN the reference date is on the child's 3rd, 6th or 9th birthday, THE Age_Stage_Function SHALL return `little`, `explorer` or `maker` respectively.
3. WHEN the `date_of_birth` is 29 February and the reference year is not a leap year, THE Age_Stage_Function SHALL count that year's birthday as reached on 1 March and not on 28 February (for example, a `date_of_birth` of `2020-02-29` gives `tiny` on `2023-02-28` and `little` on `2023-03-01`).
4. IF the `date_of_birth` or the reference date is not a string of the exact form `YYYY-MM-DD`, or does not name a real Gregorian calendar date (month `01`–`12`, day `01` to the last day of that month, `29` February only in leap years), or the reference date is before the `date_of_birth`, THEN THE Age_Stage_Function SHALL return a failure result and SHALL NOT throw.
5. FOR ALL valid `date_of_birth` and reference date pairs with the reference date on or after the `date_of_birth`, THE Age_Stage_Function SHALL return a success result holding exactly one Age_Stage (totality property, at least 100 runs).
6. FOR ALL valid `date_of_birth` values and any two reference dates where the second is on or after the first, the Age_Stage for the second date SHALL be the same as or later than the Age_Stage for the first, in the order `tiny`, `little`, `explorer`, `maker` (monotonic property, at least 100 runs).
7. FOR ALL valid `date_of_birth` values, including generated 29 February dates, the Age_Stage_Function SHALL agree with a reference model that counts completed years by comparing year, month and day directly and applies the 1 March rule of criterion 3 (model-based property, at least 100 runs).
8. THE Age_Stage_Function SHALL return the same result for the same inputs regardless of the system clock, the host time zone or any environment variable.
9. WHEN the reference date is the day before the child's 3rd, 6th or 9th birthday, THE Age_Stage_Function SHALL return `tiny`, `little` or `explorer` respectively.

### Requirement 17: Runtime dependency and Phase 0 check updates

**User Story:** As the implementation engineer, I want the Phase 0 checks updated to match the new shared package, so that the test suite stays green without weakening any other check.

#### Acceptance Criteria

1. THE Shared_Package SHALL declare exactly one runtime dependency, `zod`, at one exact Zod 4 version of the form `4.MINOR.PATCH` with no range operator, recorded in the design, and `pnpm-lock.yaml` SHALL record that same version so that `pnpm install --frozen-lockfile` succeeds.
2. THE Repo_Checks in `tooling/test/manifests.test.ts` SHALL fail if the Shared_Package's runtime dependencies are not exactly `zod`, or if its version string is not a bare `MAJOR.MINOR.PATCH` (no `^`, `~`, `>`, `<`, `*`, `x` or tag), replacing the Phase 0 "no runtime dependencies" check.
3. THE `packages/shared/test/exports.test.ts` check SHALL no longer assert that the Shared_Entry has zero exports, and SHALL be replaced by the export test in Requirement 14.5.
4. THE Repo_Checks in `tooling/test/layout.test.ts` SHALL stop requiring a lone `.gitkeep` in the Contract_Module and Domain_Module folders, and SHALL instead fail if the Contract_Module has no `fixtures/` folder containing the Fixture_Manifest, or if either folder contains no `.ts` source file.
5. THE `.gitkeep` files in the Contract_Module and Domain_Module folders SHALL be removed.
6. THE Root_README SHALL no longer contain the note that the gateway-contract folder is empty on purpose, and SHALL contain a note stating that the Contract_Module holds the Document_B_v2 contract at `proto_ver` 2, with golden fixtures copied from `docs/B-gateway-and-hardware-seam.docx`.
7. THE Repo_Checks not named in criteria 2–6 and 8 SHALL pass with their test files unchanged from Phase 0.
8. THE readme check in `tooling/test/readme.test.ts` SHALL fail if the Root_README lacks the note of criterion 6, and SHALL no longer check for the "empty on purpose" note.

### Requirement 18: Steering updates

**User Story:** As Omar, I want the steering files to describe the v2 contract and the two content row classes, so that later specs do not build to the v1 seam or to a single-class content model.

#### Acceptance Criteria

1. THE Tech_Steering "Document B seam" section SHALL state `proto_ver` 2 as the frozen contract, and SHALL contain no statement that `proto_ver` 1 is the current contract.
2. THE Tech_Steering "Topics" list SHALL name exactly the four topics `status`, `event`, `cmd` and `ack`, and SHALL contain no `xelulu/{device_id}/ota` entry.
3. THE Tech_Steering SHALL state that `ota` is a `cmd` action carrying `data.manifest_url` and a `cmd_id`, answered with an ack.
4. THE Tech_Steering "Audio turns" section SHALL show `audio_start` and `audio_end` carrying `proto_ver`, `ts`, `type` and `turn_id`.
5. THE Tech_Steering SHALL state that events carry an optional boolean `time_uncertain`.
6. THE Tech_Steering SHALL note that `docs/B-gateway-and-hardware-seam.docx` is Document B v2.0, provisionally frozen pending the intern's confirmation.
7. THE Tech_Steering sections outside "Document B seam" SHALL remain unchanged by this spec.
8. THE Tech_Steering "Audio turns" section SHALL state the barge-in sequence: an `interrupt` event from the device, then `audio_end` and then a `stop_audio` command from the cloud, with no WebSocket cancel frame.
9. THE Tech_Steering "Document B seam" section SHALL state that pairing is defined in Document C and is not part of Document B.
10. THE Structure_Steering "Domain model notes" SHALL replace the bullet "Every row is scoped by `household_id`." with two bullets: household-scoped rows carry `household_id` and are protected by RLS by household and role; global curated content rows have `household_id` null, are a read-only reference for every household, and are written only by admins.
11. THE Structure_Steering content outside the bullets named in criterion 10 SHALL remain unchanged by this spec.

### Requirement 19: Build, lint and test

**User Story:** As the implementation engineer, I want the whole workspace green after this phase, so that the next phase starts from a clean baseline.

#### Acceptance Criteria

1. WHEN `pnpm build` runs at the Workspace root, THE Shared_Package and every other Workspace_Package SHALL build with exit code 0 and zero TypeScript errors under strict mode.
2. WHEN `pnpm lint` runs at the Workspace root, THE lint run SHALL report zero errors and exit with code 0.
3. WHEN `pnpm test` runs at the Workspace root, every test (the Contract_Module tests, the Domain_Module tests and the Repo_Checks) SHALL pass with zero failed tests, the Contract_Module and Domain_Module test files SHALL contain no skipped or todo tests, and the run SHALL exit with code 0.
4. WHEN `pnpm format:check` runs at the Workspace root, THE format check SHALL report zero unformatted files and exit with code 0.
5. THE Contract_Module and Domain_Module SHALL import nothing from `apps/*` or `services/*`, so that the Phase 0 dependency-direction lint rule reports no error.

## Done when

This phase is done when all three checks pass, stated exactly as given.

| # | Done when | Requirements |
|---|---|---|
| 1 | Round-trip property holds: parse(serialise(x)) == x for every message, checked against the golden fixtures. | 1.7, 10.5, 10.6, 11.1–11.6, 13.1–13.8 |
| 2 | Unknown fields and wrong proto_ver are rejected. | 2.1–2.4, 3.1–3.9, 12.1–12.8 |
| 3 | pnpm build, lint and tests pass. | 10.9, 17.1–17.8, 19.1–19.5 |

The other requirements support these checks. They define the message shapes being round-tripped and rejected (Requirements 1–9), the API under test (Requirement 10), the exports (Requirement 14), the domain model and age-stage function (Requirements 15 and 16), and the steering updates (Requirement 18). They are checked by the same test suite and during review.

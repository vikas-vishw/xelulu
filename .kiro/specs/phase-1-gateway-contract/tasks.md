# Implementation Plan: Phase 1 gateway contract

## Overview

Fill `packages/shared` with the Document B v2 contract (`proto_ver` 2) and the shared domain model, in TypeScript (strict), using Zod 4.6.5 and the existing Vitest + fast-check setup. Work goes bottom-up: dependency, constants and errors, primitives, message schemas, codec, contract index, fixtures, domain, shared entry. A build checkpoint follows, then test helpers and the contract tests, then the domain tests, the Phase 0 check updates, the steering updates (tech.md, plus a check of structure.md) and the final verification.

## Ground rules

- No git commits, branches or pushes unless Omar asks. Report every task's results (commands run, exit codes, notable output) in the task result.
- Toolchain prefix for every command on this machine (PowerShell):
  `$env:Path = "c:\xelulu\.tools\node-v24.21.0-win-x64;" + $env:Path; $env:COREPACK_HOME = "c:\xelulu\.tools\corepack"; $env:COREPACK_ENABLE_DOWNLOAD_PROMPT = "0";` then `corepack pnpm ...`.
- Exact version pins only. File names are kebab-case. Wire fields are snake_case exactly as in Document B.
- No env var reads, no network, no clock or time-zone use in `packages/shared/src`. No non-local URLs in `packages/shared/src` (the only URL is `https://localhost/...` in the ota fixture).
- Document B v2 (`docs/B-gateway-and-hardware-seam.docx`, Version 2.0) plus Omar's rulings of 8 Oct 2026 recorded in requirements.md are the source of truth. Never "improve" the wire format: no fields, defaults, transforms or relaxations beyond requirements.md and design.md.
- Do not edit `requirements.md`, `design.md`, `.config.kiro`, the Phase 0 spec documents or anything in `docs/`.
- C:\ disk is tight (about 4 GB free). Install only `zod`. No extra packages, global tools or caches.
- Contract errors never carry input values (C20). Logs and test output carry no tokens.
- Property tests: one `it` per property (`it.each` over variants where the property ranges over variants), `fc.assert` with `numRuns` at least 100, and the tag comment `// Feature: phase-1-gateway-contract, Property N: <title>`. No `it.skip`, `it.todo` or `.only`.
- Shared tests import the built entry `../dist/index.js` (design D5), so they run after `corepack pnpm build`.
- Expected interim failures: from task 2 onward, the Phase 0 checks that this phase supersedes (`tooling/test/manifests.test.ts` "no runtime dependencies", the `.gitkeep` cases in `tooling/test/layout.test.ts`, and the old `packages/shared/test/exports.test.ts`) fail until tasks 20 and 23 replace them. Report these failures, do not work around them early.

## Tasks

- [x] 1. Add the Zod runtime dependency
  - [x] 1.1 Pin `zod` 4.6.5 in `@xelulu/shared`
    - Run `corepack pnpm view zod version`. If it is not `4.6.5`, stop and report instead of changing the pin (design D1).
    - Run `corepack pnpm --filter @xelulu/shared add zod@4.6.5 --save-exact`; confirm `packages/shared/package.json` has `"dependencies": { "zod": "4.6.5" }` and `pnpm-lock.yaml` records `zod@4.6.5`.
    - Run `corepack pnpm install --frozen-lockfile` and confirm exit code 0.
    - _Requirements: 17.1_

- [x] 2. Constants, enums, errors and topics
  - [x] 2.1 Create `packages/shared/src/gateway-contract/constants.ts`
    - `PROTO_VER = 2 as const` and the frozen `AUDIO_FORMAT` (opus, 16000, 1, 20) per design.
    - _Requirements: 1.1, 1.8_
  - [x] 2.2 Create `packages/shared/src/gateway-contract/enums.ts`
    - Every closed list and open vocabulary from the design table, each `Object.freeze([...] as const)`, in the stated order, with the derived types (`TouchZone`, `MoveCommand`, `ButtonName`, `AckReason`, `EventKind`, `CmdAction`, ...).
    - _Requirements: 1.2, 7.6, 9.1, 9.2, 9.3, 9.4_
  - [x] 2.3 Create `packages/shared/src/gateway-contract/errors.ts`
    - `ContractIssueKind`, `ContractIssue`, `ContractError` (fixed message template, frozen issues, no `cause`, throws on empty issue list), `ParseResult<T>`, and internal `mapZodIssues` per design (unknown-key path = parent path + key name; custom kinds from `params.kind`; unknown Zod codes map to `custom`; only `path` and code are read).
    - _Requirements: 3.1, 3.9, 10.3, 10.4_
  - [x] 2.4 Create `packages/shared/src/gateway-contract/topics.ts`
    - `TOPIC_PREFIX`, frozen `TOPIC_SUFFIXES`, `TopicSuffix`, `ParsedTopic`, `buildTopic` (throws `ContractError` variant `topic`, runtime suffix check) and `parseTopic` (never throws; issue kinds `invalid_topic`, `invalid_device_id`, `invalid_topic_suffix`). No `ota` constant, type member or string anywhere in the file.
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6_

- [x] 3. Internal field primitives and envelopes
  - [x] 3.1 Create `packages/shared/src/gateway-contract/primitives.ts` (internal, not re-exported)
    - Field schemas from the design table (`protoVer`, `unixSeconds`, `nonEmpty`, `anyString`, `nonNegFinite`, `degInt`, `pct`, `unit`, `lang`, `hhmm`, `hexColor`, `httpsUrl`, `emptyData`, `enumOf`, ...), the anchored flag-free regexes, and `isAbsoluteHttpsUrl` (lowercase `https://` prefix, `URL.parse`, `https:` protocol, non-empty hostname). `degInt` is `z.int().min(0).max(359)` (ruling 3). No `.default`, `.transform`, `.coerce`, `.catch` or `.passthrough`.
    - _Requirements: 2.1, 3.5, 5.2, 8.1, 8.9, 8.11, 8.14, 8.15_
  - [x] 3.2 Create `packages/shared/src/gateway-contract/envelope.ts` (internal)
    - `deviceEnvelope`, `eventSchema(kind, data)` and `cmdSchema(action, data)` as `z.strictObject`, exactly as in the design (commands have no `ts` or `type`; `time_uncertain` optional boolean).
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 4. Message schemas and hand-written wire types
  - [x] 4.1 Create `hello.ts` and `status.ts`
    - `HelloMessage(+Schema)` with `proto: literal(2)`; `StatusMessage(+Schema)`; `StatusTopicMessage(+Schema)` as a discriminated union on `type`.
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - [x] 4.2 Create `events.ts`
    - Eight event schemas and types (`TouchEventMessage` ... `ErrorEventMessage`), `EventMessage(+Schema)` discriminated on `event`, and `EventDataFor<K>`. Wake `dir_deg` is optional `degInt` (integer 0–359); error `code` and `detail` are `anyString` (empty allowed) (ruling 3).
    - _Requirements: 2.4, 2.5, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10_
  - [x] 4.3 Create `audio.ts`
    - `AudioStartMessage(+Schema)`, `AudioEndMessage(+Schema)`, `AudioControlMessage(+Schema)` discriminated on `type`.
    - _Requirements: 6.1, 6.2, 6.3, 6.5, 6.6_
  - [x] 4.4 Create `ack.ts`
    - `AckMessage(+Schema)` with `reason: "" | AckReason` and the `rejectedNeedsReason` refinement (`params.kind: "reason_required"`).
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_
  - [x] 4.5 Create `commands.ts`
    - Eleven command schemas and types (`SayCmdMessage` ... `OtaCmdMessage`), `QuietHours`, the config `atLeastOneDeltaKey` refinement on the nested `data` schema (`params.kind: "config_empty"`; `null` counts as present), and `CmdMessage(+Schema)` discriminated on `action`. Say `data` has no `audio` key.
    - Move `data` is `z.discriminatedUnion("cmd", [...])` of three strict objects (design D9, ruling 4): `come` and `turn` require `linear_mms`, `angular_mrad_s` and `max_dist_mm`; `stop` requires `max_dist_mm` and has optional `linear_mms` and `angular_mrad_s`. All three are `nonNegFinite` (ruling 3). Export the `MoveCmdData` union type; `MoveCmdMessage` is `CmdEnvelope<"move", MoveCmdData>`.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.11, 8.12, 8.13, 8.14, 8.15, 8.16_

- [x] 5. Codec and device dispatch
  - [x] 5.1 Create `codec.ts` with the internal `makeCodec` factory and the per-variant codecs
    - For each of the 24 variants: `parseN`, `parseNOrThrow`, `serialiseN` as typed named `const`s with the design's variant labels. Non-string input → `invalid_type`; `JSON.parse` failure → `invalid_json` (error text discarded); non-object top level → `not_object`; `OrThrow` throws the same `ContractError` the Result variant built; `serialise` validates and returns `JSON.stringify(result.data)`.
    - _Requirements: 3.8, 10.1, 10.3, 10.4, 10.5, 10.6, 10.7_
  - [x] 5.2 Add union codecs and device dispatch to `codec.ts`
    - Codecs for `StatusTopicMessage`, `EventMessage`, `AudioControlMessage`, `CmdMessage`; types `MqttDeviceMessage`, `DeviceMessage`, `DeviceMessageForTopic<S>`; `parseDeviceMessage` / `parseDeviceMessageOrThrow` routing `status`/`event`/`ack`, failing `cmd` with `wrong_topic` without reading the text, and unknown runtime suffixes with `invalid_topic_suffix`.
    - _Requirements: 4.4, 4.5, 6.3, 6.4, 10.2, 10.8_

- [x] 6. Contract public surface
  - [x] 6.1 Create `packages/shared/src/gateway-contract/index.ts`
    - Explicit named exports matching the design's "Public exports" lists (runtime values and types). Do not export `primitives.ts`, `envelope.ts`, `makeCodec` or `mapZodIssues`. No default export.
    - _Requirements: 14.1, 14.2, 14.3, 14.4_

- [x] 7. Golden fixtures and manifest
  - [x] 7.1 Create the seven derived fixtures in `packages/shared/src/gateway-contract/fixtures/`
    - `hello.json`, `status.json`, `event-touch.json`, `audio-start.json`, `audio-end.json`, `cmd-say.json`, `ack.json` with exactly the content in the design's "Derived" table. Status, event-touch (with `"time_uncertain": false`), audio-start (`ts` 1733400001), audio-end (`ts` 1733400004) and cmd-say are verbatim Document B v2 examples. Hello adds only `ts` 1733400000 and ack adds only `ts` 1733400005, each placed after `proto_ver` (ruling 1). Prettier-formatted.
    - _Requirements: 13.1, 13.2, 13.3, 13.7, 13.8_
  - [x] 7.2 Create the constructed fixtures
    - One per remaining event kind and command action, per the design's "Constructed" table (`ts` from 1733400010, `cmd_id`/`event_id` in the examples' style, `time_uncertain: true` on the nfc fixture, wake `dir_deg` an integer in 0–359). `cmd-ota.json` follows the Document B v2 §4.2 shape (`cmd_id "a1b2"`) with `manifest_url` `https://localhost/ota/manifest.json` in place of the placeholder host.
    - _Requirements: 13.4, 13.7, 13.8_
  - [x] 7.3 Create `fixtures/manifest.json`
    - One entry per fixture file, in the tables' order, with `file`, `source`, `provenance` and `note` exactly as specified. Derived notes: "copied verbatim from Document B v2 §N" (its section) for status, event-touch, audio-start, audio-end and cmd-say; "v2 example + ts added per envelope rule (ruling 1)" for hello and ack. Sources are written "Document B v2 §…"; the ota source is "Document B v2 §4.2 (shape; placeholder host replaced)".
    - _Requirements: 13.5, 13.6_

- [x] 8. Domain module
  - [x] 8.1 Create `packages/shared/src/domain/common.ts` and `retention.ts`
    - `IsoDate`, `IsoDateTime` aliases; `DEFAULT_TRANSCRIPT_RETENTION_DAYS = 30`.
    - _Requirements: 15.8_
  - [x] 8.2 Create `packages/shared/src/domain/age-stage.ts`
    - `AGE_STAGES` (frozen), `AgeStage`, `AgeStageError`, `AgeStageResult`, `deriveAgeStage` using the design's string-and-integer algorithm only (no `Date`, `Intl` or `process`; 29 February → 1 March in non-leap years; year `0000` rejected; never throws).
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 16.8, 16.9_
  - [x] 8.3 Create the ten domain interface files
    - `household.ts`, `user.ts`, `child-profile.ts`, `device.ts`, `session.ts`, `event.ts`, `content-item.ts`, `grandma-asset.ts`, `consent.ts`, `report.ts` exactly as in the design (snake_case, `household_id` scoping, required `consent_record_id`, no secrets, no binary or child-audio fields; `Event<K>` uses `EventDataFor<K>` via `import type`). All are type-only except `content-item.ts`.
    - `content-item.ts` holds the two content row classes (design D10, ruling 6): exported `ContentItemBase`, `HouseholdContentItem` (`household_id: string`) and `GlobalContentItem` (`household_id: null`) with their access-rule doc comments, `ContentItem` as their union, `ContentRowClass = "household" | "global"`, and the pure `contentRowClass(item)` helper.
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.9, 15.10, 15.11, 15.12, 15.13, 15.14_
  - [x] 8.4 Create `packages/shared/src/domain/index.ts`
    - Explicit named exports of every domain type (including `ContentItemBase`, `HouseholdContentItem`, `GlobalContentItem`, `ContentRowClass`), `AGE_STAGES`, `deriveAgeStage`, `DEFAULT_TRANSCRIPT_RETENTION_DAYS` and `contentRowClass`.
    - _Requirements: 14.1, 14.3_

- [x] 9. Shared entry
  - [x] 9.1 Update `packages/shared/src/index.ts`
    - `export * from "./gateway-contract/index.js";` and `export * from "./domain/index.js";` only. Confirm no name collision (TypeScript ambiguity error) and no default export.
    - _Requirements: 14.1, 14.2, 14.3, 19.5_

- [x] 10. Checkpoint: the build compiles
  - Run `corepack pnpm build`, `corepack pnpm lint` and `corepack pnpm format:check`; all must exit 0 with zero TypeScript errors under strict mode.
  - Report the expected interim Phase 0 failures (see Ground rules) if `corepack pnpm test` is run. Ensure all tests pass apart from those, ask the user if questions arise.
  - _Requirements: 19.1, 19.2, 19.4_

- [x] 11. Test helpers
  - [x] 11.1 Create `packages/shared/test/arbitraries.ts`
    - One Message_Generator per variant and the `VARIANTS` table (`name`, `arb`, `parse`, `parseOrThrow`, `serialise`, `union`, `topic`) with the design's building blocks (`withEdges`, `fc.maxSafeNat` for `ts`, `-0` mapped to `0`, test-local copies of the format regexes, optional keys absent rather than `undefined`, non-empty config deltas, `active_child_id` with `null` edge).
    - Ruling 3 and 4 generators: wake `dir_deg` integer 0–359 with edges 0 and 359; `linear_mms` and `angular_mrad_s` non-negative with edge 0 and no maximum; error `code` and `detail` any string with edge `""`; move data as `come` / `turn` (all keys) or `stop` (speeds each present or absent).
    - _Requirements: 11.1, 11.6_
  - [x] 11.2 Create `packages/shared/test/mutations.ts`
    - Hand-written `FIELD_TABLE` per variant (independent of `src`), `objectPositions`, `addKey` via `Object.defineProperty`, `setAt`, `deleteAt`, `isRequired`, `optionalRemovalCases`, and the arbitraries `unknownKeyArb`, `notTwoArb`, `badDiscriminatorArb`, `enumPerturbationArb`, `outOfRangeArb`, `wrongTypeArb`, `badTsArb`, `sentinelArb`.
    - Move speeds have conditional requiredness (`{ when: { path: ["data", "cmd"], in: ["come", "turn"] } }`); `max_dist_mm` is always required. Error `code` has kind `string`; wake `dir_deg` has kind `deg`. `outOfRangeArb` covers `deg` (−1, 360, any int outside 0–359, non-integers) and negative speeds.
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8_

- [x] 12. Constants and topic tests
  - [x]* 12.1 Write `packages/shared/test/constants.test.ts`
    - Exact lists and order, `PROTO_VER`, `AUDIO_FORMAT`, `TOPIC_SUFFIXES`, `Object.isFrozen`, `// @ts-expect-error` assignment that throws `TypeError` and leaves contents unchanged.
    - _Requirements: 1.1, 1.2, 1.8, 7.6, 9.1, 9.2, 9.3, 9.4_
  - [x]* 12.2 Write property test for topic round trip in `topics.test.ts`
    - **Property 1: Topic round trip**
    - **Validates: Requirements 1.3, 1.5, 1.7**
  - [x]* 12.3 Write property test for invalid topics in `topics.test.ts`
    - **Property 2: Invalid topics are refused**
    - Plus examples `xelulu/x/ota`, `Xelulu/x/status`, `xelulu/x/status/extra`, and a static check that the topics module exports no `ota`.
    - **Validates: Requirements 1.2, 1.4, 1.6**

- [x] 13. Compile-time contract type checks
  - [x] 13.1 Write `packages/shared/test/contract-types.test.ts`
    - `expectTypeOf<T>().toEqualTypeOf<z.output<typeof TSchema>>()` for all 24 variants and the 4 unions (`import type { z } from "zod"`), `MoveCmdData` against the move data union, plus narrowing checks on `event`, `action` and move `data.cmd` (speeds `number | undefined` on `stop`, `number` on `come`/`turn`). If Zod's empty-object or optional output differs from the hand-written alias, adjust the alias only (risk R5).
    - _Requirements: 5.10, 8.16, 10.9_

- [x] 14. Round-trip properties (Done-when check 1)
  - [x] 14.1 Write property test for variant round trip in `codec-roundtrip.test.ts`
    - **Property 3: Variant round trip**
    - **Validates: Requirements 4.1, 4.3, 5.1, 5.2, 5.3, 5.5, 5.6, 5.7, 5.8, 5.9, 6.1, 6.2, 7.1, 8.1, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.13, 8.14, 10.5, 10.6, 11.1, 11.2**
  - [x] 14.2 Write property test for union round trip in `codec-roundtrip.test.ts`
    - **Property 4: Union round trip**
    - **Validates: Requirements 4.4, 6.3, 10.2, 11.3**
  - [x] 14.3 Write property test for serialisation stability in `codec-roundtrip.test.ts`
    - **Property 5: Serialisation is stable**
    - **Validates: Requirements 11.5**

- [x] 15. Rejection properties (Done-when check 2)
  - [x] 15.1 Write property test for unknown keys in `codec-rejection.test.ts`
    - **Property 7: Unknown keys are rejected at every depth**
    - Also assert the `__proto__` example is rejected without prototype pollution.
    - **Validates: Requirements 2.2, 2.3, 3.1, 5.4, 5.8, 6.5, 8.2, 8.6, 8.13, 12.1**
  - [x] 15.2 Write property test for literal-2 fields in `codec-rejection.test.ts`
    - **Property 8: Literal-2 fields**
    - **Validates: Requirements 2.1, 2.2, 3.2, 4.2, 12.2**
  - [x]* 15.3 Write property test for discriminators in `codec-rejection.test.ts`
    - **Property 9: Discriminators are exact**
    - **Validates: Requirements 3.3, 12.3**
  - [x]* 15.4 Write property test for closed enums in `codec-rejection.test.ts`
    - **Property 10: Closed enums are exact**
    - **Validates: Requirements 3.6, 9.1, 12.4**
  - [x]* 15.5 Write property test for bounded numbers in `codec-rejection.test.ts`
    - **Property 11: Bounded numbers are enforced**
    - Includes `dir_deg` (−1, 360, non-integers) and negative `linear_mms` / `angular_mrad_s`.
    - **Validates: Requirements 3.5, 5.2, 8.5, 8.6, 12.5**
  - [x]* 15.6 Write property test for required fields and JSON types in `codec-rejection.test.ts`
    - **Property 12: Required fields and JSON types are enforced**
    - Removing a speed from a `come` or `turn` move is rejected; removing either or both speeds from a `stop` move stays valid; removing `max_dist_mm` from any move is rejected.
    - **Validates: Requirements 2.2, 2.4, 3.5, 3.7, 5.9, 8.5, 8.6, 12.6**
  - [x]* 15.7 Write property test for `ts` bounds in `codec-rejection.test.ts`
    - **Property 13: `ts` accepts exactly the non-negative safe integers**
    - **Validates: Requirements 2.1, 2.5, 12.7**
  - [x]* 15.8 Write property test for throwing and serialising variants in `codec-rejection.test.ts`
    - **Property 20: Throwing and serialising variants agree with the Result variant**
    - **Validates: Requirements 10.4, 10.7**

- [x] 16. Contract rule properties
  - [x]* 16.1 Write property test for variant and topic isolation in `codec-rules.test.ts`
    - **Property 6: Messages only parse as their own variant and topic**
    - **Validates: Requirements 3.4, 4.5, 6.4, 10.8**
  - [x]* 16.2 Write property test for the ack reason rule in `codec-rules.test.ts`
    - **Property 14: Ack reason rule**
    - **Validates: Requirements 7.2, 7.3, 7.4, 7.5**
  - [x]* 16.3 Write property test for the config delta rule in `codec-rules.test.ts`
    - **Property 15: Config delta needs at least one key**
    - **Validates: Requirements 8.11, 8.12**
  - [x]* 16.4 Write property test for open vocabularies in `codec-rules.test.ts`
    - **Property 16: Open vocabularies accept any non-empty string**
    - **Validates: Requirements 3.7, 9.5**
  - [x]* 16.5 Write property test for formatted strings in `codec-rules.test.ts`
    - **Property 17: Formatted strings match their reference patterns**
    - **Validates: Requirements 8.1, 8.9, 8.11, 8.14, 8.15**
  - [x]* 16.6 Write unit examples in `codec-rules.test.ts`
    - A `touch` event carrying `{ confidence, duration_s }` data is rejected; an `audio_end` with no prior `audio_start` is accepted.
    - _Requirements: 3.4, 6.6_

- [x] 17. Error shape properties
  - [x]* 17.1 Write property test for error shape and value leaks in `errors.test.ts`
    - **Property 18: Contract errors are well-formed and leak no values**
    - **Validates: Requirements 3.9, 12.8**
  - [x]* 17.2 Write property test for never-throwing parsers in `errors.test.ts`
    - **Property 19: Result parsers never throw**
    - Plus the example that a `SyntaxError` message never appears in the error.
    - **Validates: Requirements 3.8, 10.3**

- [x] 18. Generator coverage
  - [x] 18.1 Write `packages/shared/test/generator-coverage.test.ts`
    - `fc.sample(arb, { seed: 20261008, numRuns: 1000 })` per variant; assert every optional field present and absent (including `linear_mms` and `angular_mrad_s` on `stop` moves), every closed-enum value used (including each move `cmd`), ack `reason` `""` and each value, `active_child_id` string and `null`, error `code` and `detail` `""`, and every boundary value listed in Requirement 11.6 (including `dir_deg` 0 and 359 and the speeds at 0).
    - _Requirements: 11.1, 11.6_

- [x] 19. Golden fixture checks (Done-when check 1)
  - [x] 19.1 Write `packages/shared/test/fixtures.test.ts`
    - Read `src/gateway-contract/fixtures/` with `node:fs`; manifest lists every fixture exactly once and no missing file; derived/constructed provenance and the exact derived notes ("copied verbatim from Document B v2 §N", or "v2 example + ts added per envelope rule (ruling 1)" for hello and ack); the ota source "Document B v2 §4.2 (shape; placeholder host replaced)"; every variant covered by its Discriminator values; derived files deep-equal the expected Document B v2 example objects held in the test (verbatim, plus `ts` 1733400000 on hello and 1733400005 on ack); each fixture parses with its variant and union parser; serialise → parse is JSON_Equal to the first parse and the file's JSON; kebab-case `.json` names; one top-level object per file.
    - _Requirements: 11.4, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8_

- [x] 20. Public export check (replaces the Phase 0 export test)
  - [x] 20.1 Replace `packages/shared/test/exports.test.ts`
    - `Object.keys(ns).sort()` equals the expected runtime list from the design; no `default`; no fixture-shaped export; `import type { ... }` of every listed type so a missing type fails the test type-check. The Phase 0 "zero exports" assertion is removed.
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 17.3_

- [x] 21. Checkpoint: contract tests pass
  - Run `corepack pnpm build`, then `corepack pnpm exec vitest run packages/shared/test`. Ensure all tests pass, ask the user if questions arise. Only the tooling checks replaced in task 23 may still fail at this point.
  - _Requirements: 19.3_

- [x] 22. Domain tests
  - [x]* 22.1 Write `packages/shared/test/domain-types.test.ts`
    - `expectTypeOf` checks on required, nullable and union fields (`HouseholdContentItem["household_id"]` is `string`, `GlobalContentItem["household_id"]` is `null`, `ContentItem` equals their union, `ContentRowClass`, `GrandmaAsset["consent_record_id"]`, `Event<"cry">["data"]`, `User["role"]`, ...), a `HasBinaryField<T>` check that is `false` for every interface, a static scan of `src/domain/*.ts` for secret-like names, binary types and audio/recording fields outside `GrandmaAsset.recording_storage_path`, `DEFAULT_TRANSCRIPT_RETENTION_DAYS === 30`, and `contentRowClass` examples (a household row gives `household`, a global row gives `global`).
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8, 15.9, 15.10, 15.11, 15.12, 15.13, 15.14_
  - [x]* 22.2 Write property test for the age-stage model in `age-stage.test.ts`
    - **Property 21: Age stage agrees with the reference model**
    - **Validates: Requirements 16.1, 16.3, 16.5, 16.7**
  - [x]* 22.3 Write property test for birthday boundaries in `age-stage.test.ts`
    - **Property 22: Birthday boundaries**
    - **Validates: Requirements 16.2, 16.9**
  - [x]* 22.4 Write property test for monotonicity in `age-stage.test.ts`
    - **Property 23: Age stage is monotonic**
    - **Validates: Requirements 16.6**
  - [x]* 22.5 Write property test for invalid dates in `age-stage.test.ts`
    - **Property 24: Invalid dates fail without throwing**
    - **Validates: Requirements 16.4**
  - [x]* 22.6 Write property test for environment independence in `age-stage.test.ts`
    - **Property 25: Age stage ignores the environment**
    - Set `process.env.TZ` per case and use `vi.useFakeTimers()` / `vi.setSystemTime(...)`, restoring both afterwards.
    - **Validates: Requirements 16.8**
  - [x]* 22.7 Write unit examples in `age-stage.test.ts`
    - `2020-02-29` gives `tiny` on `2023-02-28` and `little` on `2023-03-01`; the 3rd/6th/9th birthday and the day before; static check that `src/domain/age-stage.ts` contains no `Date`, `Intl` or `process`.
    - _Requirements: 16.2, 16.3, 16.8, 16.9_

- [x] 23. Phase 0 check updates (supersede Phase 0 Requirements 8.5, 8.6, 8.7, 8.9)
  - [x] 23.1 Update `tooling/test/manifests.test.ts`
    - Replace "gives the shared package no runtime dependencies" with the design's "exactly one runtime dependency, zod, at an exact 4.x version" test (bare `4.MINOR.PATCH` regex, lockfile contains `zod@<spec>`). Add imports only if absent.
    - _Requirements: 17.1, 17.2_
  - [x] 23.2 Update `tooling/test/layout.test.ts` and remove the shared `.gitkeep` files
    - Replace the lone-`.gitkeep` case for the two shared folders with the design's three checks, rename the `describe` to "shared contract and domain folders (Phase 1 Req 17.4)", keep `expectOnlyEmptyGitkeep` for the Supabase checks.
    - Delete `packages/shared/src/gateway-contract/.gitkeep` and `packages/shared/src/domain/.gitkeep`.
    - _Requirements: 17.4, 17.5_
  - [x] 23.3 Update the README note and `tooling/test/readme.test.ts`
    - Replace the "empty on purpose" README line with the design's Document B v2 note ("`packages/shared/src/gateway-contract/` holds the Document B v2 contract (`proto_ver` 2): types, Zod schemas, codecs and golden fixtures copied from `docs/B-gateway-and-hardware-seam.docx`."); replace the `describe("gateway contract folder (Req 14.7)", ...)` block with the design's "gateway contract note (Phase 1 Req 17.6, 17.8)" block, which checks for "Document B v2", "`proto_ver` 2" and "docs/B-gateway-and-hardware-seam.docx".
    - _Requirements: 17.6, 17.8_

- [x] 24. Steering updates
  - [x] 24.1 Replace the "Document B seam" section of `.kiro/steering/tech.md`
    - Replace from `## Document B seam` up to, not including, `## Hardware context` with the design's text (docx is Document B v2.0, provisionally frozen pending intern confirmation; pairing in Document C; barge-in sequence under Audio turns). Confirm with `git diff -- .kiro/steering/tech.md` that no other section changed.
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7, 18.8, 18.9_
  - [x] 24.2 Verify the "Domain model notes" in `.kiro/steering/structure.md`
    - The two content row-class bullets from the design replaced "Every row is scoped by `household_id`." when the rulings were recorded. Confirm they are present exactly once and the old bullet is gone; apply the design's text only if it is missing. Confirm with `git diff -- .kiro/steering/structure.md` that nothing else in the file changed.
    - _Requirements: 18.10, 18.11_

- [x] 25. Final verification and Done-when report
  - [x] 25.1 Run the full workspace verification
    - Run, in order: `corepack pnpm install --frozen-lockfile`, `corepack pnpm build`, `corepack pnpm lint`, `corepack pnpm format:check`, `corepack pnpm test`. All must exit 0, with zero failed, skipped or todo tests in the shared tests and every other Phase 0 check unchanged and green. Fix any failure in the code under this spec, never by weakening a check.
    - _Requirements: 17.1, 17.7, 19.1, 19.2, 19.3, 19.4, 19.5_
  - [x] 25.2 Report the Done-when checks in the task result
    - Check 1 (round trip, against golden fixtures): Properties 1, 3, 4, 5, `fixtures.test.ts`, `generator-coverage.test.ts`.
    - Check 2 (unknown fields and wrong `proto_ver` rejected): Properties 7 and 8, plus whichever of Properties 6, 9–20 were implemented.
    - Check 3 (build, lint, tests pass): the task 25.1 command results, `contract-types.test.ts`, `exports.test.ts` and the updated Repo_Checks.
    - List any optional test tasks that were skipped, the items flagged for Omar (R2, R6), and the items awaiting intern confirmation (R10: firmware `ts` on hello and ack, ruling 2 shapes, ruling 3 ranges, OP7 `max_dist_mm` on `stop`, OP8 `/cmd`-only subscription).
    - _Requirements: 10.9, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 12.1, 12.2, 13.6, 17.7, 19.3_

- [x] 26. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster pass. The Done-when tests (Properties 3, 4, 5, 7, 8, the fixtures, contract-types and export tests, generator coverage) and every Phase 0 check update are required.
- Each task references requirement clauses for traceability; property tasks name their design property.
- Tasks that write the same file sit in different waves of the dependency graph below.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "2.2", "7.1", "7.2", "8.1"] },
    { "id": 1, "tasks": ["2.3", "3.1", "7.3", "8.2"] },
    { "id": 2, "tasks": ["2.4", "3.2"] },
    { "id": 3, "tasks": ["4.1", "4.2", "4.3", "4.4", "4.5"] },
    { "id": 4, "tasks": ["5.1", "8.3"] },
    { "id": 5, "tasks": ["5.2", "8.4"] },
    { "id": 6, "tasks": ["6.1"] },
    { "id": 7, "tasks": ["9.1"] },
    { "id": 8, "tasks": ["11.1", "11.2", "12.1", "13.1", "19.1", "20.1"] },
    { "id": 9, "tasks": ["12.2", "14.1", "15.1", "16.1", "17.1", "18.1"] },
    { "id": 10, "tasks": ["12.3", "14.2", "15.2", "16.2", "17.2"] },
    { "id": 11, "tasks": ["14.3", "15.3", "16.3"] },
    { "id": 12, "tasks": ["15.4", "16.4"] },
    { "id": 13, "tasks": ["15.5", "16.5"] },
    { "id": 14, "tasks": ["15.6", "16.6"] },
    { "id": 15, "tasks": ["15.7"] },
    { "id": 16, "tasks": ["15.8"] },
    { "id": 17, "tasks": ["22.1", "22.2", "23.1", "23.2", "23.3", "24.1", "24.2"] },
    { "id": 18, "tasks": ["22.3"] },
    { "id": 19, "tasks": ["22.4"] },
    { "id": 20, "tasks": ["22.5"] },
    { "id": 21, "tasks": ["22.6"] },
    { "id": 22, "tasks": ["22.7"] },
    { "id": 23, "tasks": ["25.1"] },
    { "id": 24, "tasks": ["25.2"] }
  ]
}
```

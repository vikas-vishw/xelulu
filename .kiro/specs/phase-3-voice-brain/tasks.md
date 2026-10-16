# Implementation Plan: Phase 3 Voice Brain

## Overview

Build order: shared constants, types and the mock audio codec; the frame-byte hand-off; the providers and their gate; the Safety_Layer; the tools and stores; the pipeline, the Filler and latency; the operator channel; the Simulator utterances; the Admin_Console page; the Repo_Checks and docs; then a final verification and Done-when report.

TypeScript strict throughout. Kebab-case files, PascalCase types, snake_case wire and log fields. No new dependency. No `fetch`, no vendor SDK, no network import under `brain/`. No non-loopback URL literal and no Panel_Key assignment line in tracked source. `.env.example` and `tooling/fixtures/approved-panel.txt` are not touched. No git commits.

Toolchain for every command (PowerShell): `$env:Path = "c:\xelulu\.tools\node-v24.21.0-win-x64;" + $env:Path; $env:COREPACK_HOME = "c:\xelulu\.tools\corepack"; $env:COREPACK_ENABLE_DOWNLOAD_PROMPT = "0";` then `corepack pnpm ...` with cwd `c:\xelulu`. Never system Node 22 or a global pnpm. Redirect noisy output to a log under `c:\xelulu\.tools\` and delete it afterwards.

Green baseline that must not regress: `corepack pnpm test` = 89 Vitest files / 1,558 tests plus 13 parent-app Jest suites / 267 tests; `corepack pnpm lint` and `corepack pnpm format:check` clean. This phase deletes `fake-reply.test.ts` and adds the files below, so the file and test counts move up; nothing may move down for a reason other than those deletions.

## Tasks

- [x] 1. Shared constants, types and codec
  - [x] 1.1 Extend `packages/shared/src/gateway-log/constants.ts`
    - `GATEWAY_LOG_VERSION` 1 â†’ 2; append the six new kinds to `GATEWAY_LOG_KINDS` leaving the ten existing ones in place and in order
    - Add `BRAIN_TURN_PHASES`, `BRAIN_TURN_CAUSES`, `SAFETY_STAGES`, `SAFETY_DECISIONS`, `SAFETY_RULES`, `DEFERRAL_TOPICS`, `ALLOW_LISTED_TOOLS`, `TOOL_OUTCOMES`, `TOOL_DENIED_REASONS`, `PROVIDER_CAPABILITIES`, `PROVIDER_IDS`, `PARENT_ALERT_KINDS`, `TRANSCRIPT_RETENTION_ACTIONS` exactly as the design lists them
    - _Requirements: 17.1, 17.4, 9.1_
  - [x] 1.2 Add `packages/shared/src/domain/language.ts` and the six entry types
    - `SUPPORTED_LANGS` and `SupportedLang`; export from `domain/index.ts`
    - In `gateway-log/entries.ts`, add `BrainTurnLogEntry`, `SafetyDecisionLogEntry`, `ToolCallLogEntry`, `ProviderCheckLogEntry`, `ParentAlertLogEntry`, `TranscriptRetentionLogEntry` and join them to `GatewayLogEntry`; change no existing kind and no existing field
    - _Requirements: 17.2, 17.3, 17.5, 11.1_
  - [x] 1.3 Add `packages/shared/src/mock-audio/`
    - `MOCK_AUDIO_VERSION`, `MOCK_FRAME_MAX_BYTES`, `encodeUtteranceFrames`, `decodeUtteranceFrames`, `UtteranceFrames`, `DecodedUtterance`, with the `MA1\0<lang>\0<index>\0<total>\0<chunk>` layout; export from `src/index.ts`
    - Header comment stating it is not the contract, is not covered by `proto_ver`, and is deleted when a real codec arrives
    - _Requirements: 19.2, 2.1_
  - [x] 1.4 Extend `packages/shared/src/gateway-log/stream.ts`
    - `OPERATOR_STREAM_EVENTS` gains `turn`; add `ConversationTurnState` and `ConversationTurnView`
    - _Requirements: 18.1, 18.3_
  - [x] 1.5 Write the shared tests
    - `packages/shared/test/mock-audio.test.ts`: **Property 2: Mock audio round trip**, plus `not_mock_audio`, `incomplete` and `bad_frame` examples
    - `gateway-log.test.ts`: the six new kinds round-trip as JSON, every existing kind keeps its Phase 1.2 field set, `GATEWAY_LOG_VERSION` is 2
    - _Requirements: 17.2, 17.6, 19.2, 22.6_
  - [x] 1.6 Update `packages/shared/test/exports.test.ts`
    - Add the 18 new runtime names (158 â†’ 176), the new types to the `import type` list, and the `GATEWAY_LOG_VERSION === 2` assertion
    - _Requirements: 21.5_

- [x] 2. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Frame-byte hand-off and provider seams
  - [x] 3.1 Change `services/gateway/src/audio/audio-transport.ts` and its `ws` listener
    - The `binary` variant gains `bytes: Uint8Array`; the listener passes the frame through; rewrite the header comments that say frame bytes never reach the core
    - _Requirements: 14.2_
  - [x] 3.2 Change `services/gateway/src/audio/audio-turn.ts`
    - `AudioTurnDeps` gains `stt: SttSession`; `handleBinary` pushes the frame after the counts, inside the handler, keeping no reference; `closeTurn()` calls `deps.stt.release()` on every terminal path; reply-stage frames are still released without counting and are not pushed
    - _Requirements: 14.2, 14.3, 13.1_
  - [x] 3.3 Fill in the three provider interfaces under `src/brain/providers/`
    - Move `provider-declaration.ts`, `stt-provider.ts`, `llm-provider.ts`, `tts-provider.ts` into `providers/`; add `id: ProviderId` to each interface; define `SttSession`, `Transcript`, `SttResult`, `ToolRequest`, `LlmTurnInput`, `LlmReply`, `TtsInput` exactly as the design gives them
    - Delete `src/brain/stub-providers.ts`
    - _Requirements: 1.1, 1.2_
  - [x] 3.4 Add `src/brain/providers/provider-gate.ts`
    - `checkProvider`, `checkProviders`, one `provider_check` entry per capability, accepted only for no retention and no training
    - _Requirements: 1.3, 1.5_
  - [x] 3.5 Write `services/gateway/test/support/no-remote-sockets.ts` and `test/provider-gate.test.ts`
    - The socket guard fails a test on any connection to a non-loopback address
    - **Property 1: Provider acceptance equals no retention and no training**; the mocks' declarations; the start-up refusal example (one stderr line naming capability and provider id, non-zero exit, no listener)
    - _Requirements: 1.3, 1.4, 1.5, 22.5, 22.8_

- [x] 4. Providers
  - [x] 4.1 Add `src/brain/providers/mock-stt.ts`
    - One `SttSession` per turn over `decodeUtteranceFrames`, a bounded buffer, `bytesHeld()`, `release()`, `no_speech` for Phase 1.2 synthetic frames
    - _Requirements: 2.1, 14.3_
  - [x] 4.2 Add `src/brain/providers/mock-llm.ts`
    - `MockLlmRule`, `MOCK_LLM_RULES` covering all eight required cases including one with `delayMs` 1,200, `MOCK_LLM_DEFAULT_SEED`, `createMockLlm` with every delay on `Deadlines`
    - _Requirements: 2.2, 2.5, 2.4_
  - [x] 4.3 Add `src/brain/providers/mock-tts.ts`
    - Frame count a documented function of text length, each frame the existing synthetic frame constant, no file read
    - _Requirements: 2.3_
  - [x] 4.4 Add the four Adapter_Scaffolds
    - `adapter-sarvam-stt.ts`, `adapter-sarvam-tts.ts`, `adapter-elevenlabs-tts.ts`, `adapter-hosted-llm.ts`: provider id, Provider_Declaration with the recorded zero-retention and no-training settings, and a factory returning `not_configured`; no env read, no socket, no vendor type, no HTTP
    - _Requirements: 3.1, 3.2, 3.3, 3.4_
  - [x] 4.5 Write `test/mock-providers.test.ts`
    - **Property 3: Mock providers are deterministic**; the rule table's coverage of all eight cases; each scaffold's factory refusing with `not_configured` without reading env or opening a socket
    - _Requirements: 2.2, 2.3, 2.4, 2.6, 3.3_

- [x] 5. Safety layer
  - [x] 5.1 Add `src/brain/safety/forbidden-spans.ts` and `age-shape.ts`
    - `firstForbidden` for url, contact_detail, price and brand, returning a kind and never the span; `AGE_SENTENCE_LIMITS`, `AGE_WORD_LIMITS`, `sentenceCount`, `wordCount`, `withinAgeShape`
    - _Requirements: 6.2, 10.2_
  - [x] 5.2 Add `src/brain/safety/safe-text.ts`
    - `SAFE_REDIRECT`, `DEFERRAL_REPLY`, `COMFORT_REPLY`, `FILLER_TEXT` for both languages and every Age_Stage; the Comfort text names no number, URL or service
    - _Requirements: 6.7, 8.3, 11.6_
  - [x] 5.3 Add `src/brain/safety/input-guard.ts`
    - `checkInput` with the design's precedence; parent-added topics logged as `parent_added`; `uncertain` as the fallback
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 7.5_
  - [x] 5.4 Add `src/brain/safety/output-guard.ts`
    - `checkOutput` with the design's precedence, including the romantic, frightening, medical, legal, financial and length rules, and `uncertain` as the fallback
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
  - [x] 5.5 Write `test/input-guard.test.ts`
    - **Property 5: The input guard is total and ordered**; one example per Defer_Topic, per distress phrase and per blocked category
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
  - [x] 5.6 Write `test/output-guard.test.ts`
    - **Property 4: Every spoken text fits the age stage and passes the output guard**, **Property 6: No forbidden span is ever spoken**; one example per forbidden kind and per refused content class
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.7, 10.2, 11.6_

- [x] 6. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Tools and in-process state
  - [x] 7.1 Add `src/brain/state/child-context.ts`
    - `DevicePolicy`, `ChildContext`, `MOST_RESTRICTIVE_CONTEXT`, `ChildContextTable` over an in-source fixture; wire `setActiveChild` into `handleInbound`'s `status` branch beside `statusMemory.record`; never log `active_child_id`
    - _Requirements: 10.1, 10.3, 10.4, 10.5_
  - [x] 7.2 Add `src/brain/state/transcript-store.ts`
    - `TRANSCRIPT_SWEEP_INTERVAL_MS`, the capacity caps, `add`, `sweep`, `deleteAll`, `counts`, `textFor`; the sweep re-schedules itself on `Deadlines` under the key `transcripts:sweep` and logs `transcript_retention`
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.7_
  - [x] 7.3 Add `src/brain/state/memory-store.ts` and `state/alerts.ts`
    - Memory: 50 facts per child, 120 code points each, over-long refused; Alerts: Parent_Alerts and Deferred_Questions with ids, `parent_alert` entries, topic codes only
    - _Requirements: 16.1, 16.3, 7.2, 7.3, 8.2, 8.4_
  - [x] 7.4 Add `src/brain/tools/content-library.ts`, `routines.ts` and `device-action.ts`
    - In-process fixtures with no I/O; `DEVICE_ACTION_ALLOWED`, the quiet-hours, play-limit and movement gates, and the command sender
    - _Requirements: 9.4, 9.5_
  - [x] 7.5 Add `src/brain/tools/tool-router.ts`
    - Exact-match allow-list check before any handler, `MAX_TOOL_CALLS_PER_TURN`, `tool_call` entries with the resolved tool or null and no requested name or argument
    - _Requirements: 9.1, 9.2, 9.3, 9.7, 9.8_
  - [x] 7.6 Write `test/tool-router.test.ts`
    - **Property 7: Only allow-listed tools run**, **Property 8: Device policy gates before sending**; examples for each of the five tools, the memory cap, and a `rejected` ack producing no replacement command and no reason in speech
    - _Requirements: 9.1â€“9.8, 16.3_
  - [x] 7.7 Write `test/transcript-store.test.ts`
    - **Property 10: Retention removes exactly the expired turns**; the sweep firing through fake timers; `deleteAll` emptying the store
    - _Requirements: 15.1, 15.3, 15.4, 15.5, 15.7_

- [x] 8. The pipeline, the filler and latency
  - [x] 8.1 Add `src/brain/turn-latency.ts` and `src/brain/filler.ts`
    - Turn_Latency arithmetic over the `Clock`; the Filler synthesised once per language at start-up through the Tts provider, held in memory, written to no file
    - _Requirements: 12.1, 12.7_
  - [x] 8.2 Add `src/brain/turn-pipeline.ts`
    - The ordered run; one `say` published immediately before the first frame; the anchored 20 ms frame chain; `finish()` at the end; the Filler at 600 ms with a frame-boundary stop; every error path from the design's table; one `brain_turn` entry per phase with no text
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 12.2, 12.3, 12.4, 12.5, 12.6, 12.8, 11.2, 11.3, 11.4_
  - [x] 8.3 Add `src/brain/state/conversation-view.ts` and `src/brain/voice-brain.ts`
    - The Conversation_Turn_View per phase, with text only when `includeTranscriptText`; `createVoiceBrain` with `openStt`, `respond` and `stop`; stop-signal teardown that cancels deadlines and releases buffers
    - _Requirements: 18.2, 18.3, 18.4, 18.5, 13.1, 13.2, 13.3, 13.4, 13.5_
  - [x] 8.4 Wire the brain into `src/gateway.ts` and `src/index.ts`
    - Build the mocks, run `checkProviders` before `start()` and exit non-zero on a refusal; pass the Voice_Brain as the Audio_Server's only responder; hand each opened turn its `SttSession`; add `operatorTranscriptsEnabled` to `listen-host.ts` and read the Transcripts_Argument in `index.ts`; call `brain.stop()` in `stop()`
    - Delete `src/brain/fake-reply.ts`
    - _Requirements: 1.4, 1.7, 13.5, 18.4_
  - [x] 8.5 Write `test/turn-pipeline.test.ts`
    - **Property 9: Exactly one say per spoken turn, and nothing after the turn stops**; the happy path; the Deferral path; the refusal path; the comfort path; the unsupported-language fallback; the code-mixed utterance
    - _Requirements: 4.1â€“4.8, 5.6, 6.2, 7.1, 8.1, 11.3, 11.4, 13.1, 13.3, 22.2_
  - [x] 8.6 Write `test/filler.test.ts` and `test/latency.test.ts`
    - Filler: the 599/600/601 ms boundary, one `say` only, the reply continuing on the same turn, no Filler frame after a reply frame, a barge-in during the Filler
    - Latency: every Mock_Llm rule's first frame within 1,600 ms, and within 1,000 ms for every rule below the Filler_Deadline
    - _Requirements: 12.2, 12.3, 12.4, 12.5, 12.6, 12.8, 13.2, 22.4_
  - [x] 8.7 Write `test/no-audio-retention.test.ts`
    - **Property 11: Nothing leaks without the transcripts argument**; `bytesHeld()` zero after every terminal path; a sentinel utterance text absent from every entry, stdout line and response
    - _Requirements: 14.1, 14.3, 14.5, 14.6, 18.5, 18.6, 22.7_
  - [x] 8.8 Rewrite the Phase 1.2 tests that assert the Fake_Reply
    - `audio-server.test.ts`, `barge-in.test.ts`, `brain.test.ts`, `done-when.test.ts`, `stream-done-when.test.ts` now drive the mock pipeline; delete `fake-reply.test.ts`; `done-when.test.ts` gains the end-to-end turn of Requirement 22.1
    - _Requirements: 22.1, 22.2, 13.2_

- [x] 9. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Operator channel
  - [x] 10.1 Extend `src/operator/operator-stream.ts`
    - A `turn` event, the `views` backlog source and `publishTurn`; open order `devices`, `entry` backlog, `turn` backlog, then live; the caps, keep-alive and idempotent close unchanged
    - _Requirements: 18.2, 18.6_
  - [x] 10.2 Extend `src/operator/operator-routes.ts`, `snapshot.ts` and the operator CLI
    - `GET /v1/conversation`, `GET /v1/brain`, `POST /v1/transcripts/delete-all`, each behind the unchanged guard; the CLI gains the three operations; no response carries text without the Transcripts_Argument
    - _Requirements: 7.4, 8.5, 15.5, 15.6, 16.5, 18.5, 18.7_
  - [x] 10.3 Write `test/conversation-view.test.ts` and extend `test/operator-stream.test.ts`
    - The view's fields per phase, text with and without the argument; a `turn` event after a view change; the backlog order; the three new routes refusing a foreign `Host`, any `Origin` and a wrong method
    - _Requirements: 18.2, 18.3, 18.4, 18.5, 18.7_

- [ ] 11. Simulator utterances
  - [x] 11.1 Add `services/simulator/src/audio/test-utterances.ts`
    - `TestUtterance`, `TEST_UTTERANCES`, `TEST_UTTERANCE_NAMES` with the eight named cases
    - _Requirements: 19.5_
  - [x] 11.2 Change `src/audio/audio-turn-client.ts` and `src/control/control-routes.ts`
    - `request(utterance?)` uploads `encodeUtteranceFrames` output when given and the Phase 1.2 synthetic frames otherwise; `POST /api/audio-turn` accepts an optional `utterance` and refuses an unknown name with `400 invalid_fields` and no echo
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.7_
  - [x] 11.3 Change `src/control/panel-assets.ts`
    - A `<label>` bound to a `<select>` of utterance names beside the audio-turn button; keyboard operable, visible focus, no animation, no external resource
    - _Requirements: 19.6_
  - [x] 11.4 Write the simulator tests
    - `test/test-utterances.test.ts`: every name encodes to contract-valid frames within 1,500 bytes; the table covers all eight cases
    - `audio-turn-client.test.ts` and `control-routes.test.ts` additions: the utterance upload, the unchanged no-utterance path, the unchanged latency report, the unknown-name refusal, the panel label
    - _Requirements: 19.1â€“19.8_

- [ ] 12. Admin console
  - [x] 12.1 Extend `src/stream/stream-client.ts` and `src/stream/console-state.ts`
    - A `turn` listener with a shape guard; `turns` state with a 50-turn cap, replace-by-`turn_id`, and clearing on `reset`
    - _Requirements: 20.4, 20.6_
  - [x] 12.2 Extend `src/log/entry-label.ts`
    - One case per new kind, built only from closed-enum and id fields; no Panel_Key name in any string
    - _Requirements: 20.5, 20.8_
  - [x] 12.3 Add `src/components/conversation-list.tsx` and `src/pages/conversation-page.tsx`, and wire them in
    - The Req 20.2 fields per turn; text when present, lengths plus the "text is off" note when absent; `#/conversation` in `use-hash-page.ts`; one more `nav` link with `aria-current` in `app.tsx`; layout-only CSS with no animation
    - _Requirements: 20.1, 20.2, 20.3, 20.7_
  - [x] 12.4 Write the admin tests
    - `test/conversation-page.test.tsx`: a turn row with its decisions, tools, latency and state; text shown and hidden; the 50-turn cap; `reset` clearing the list
    - `entry-label.test.ts` and `stream-client.test.ts` additions: one label per new kind; a malformed `turn` payload ignored
    - _Requirements: 20.1â€“20.7_

- [ ] 13. Repo checks, Compose and docs
  - [x] 13.1 Add `tooling/checks/audio-retention.ts` and `tooling/test/audio-retention.test.ts`
    - `AUDIO_BYTE_MODULES`, `findAudioByteUse`; the test scans both service trees, re-runs `findFileWrites` over them, and self-tests the detector against new banned and clean fixtures
    - _Requirements: 14.4, 21.1, 22.7_
  - [x] 13.2 Re-point the provider-module detector
    - `tooling/checks/service-sources.ts`: `PROVIDER_STUB_NAMES` becomes the mock and adapter names, `STUB_MODULE_RE` becomes `src/brain/providers/`; update `tooling/fixtures/gateway-boundaries-banned.txt` and `-clean.txt`; `gateway-boundaries.test.ts`'s walk guard names `brain/providers/mock-stt.ts`; keep the import-allowlist, manifest and `fetch` tests unchanged
    - _Requirements: 21.2, 21.3, 1.2_
  - [x] 13.3 Update `docker-compose.yml` and `tooling/test/compose-static.test.ts`
    - The gateway `command` becomes `["node", "dist/index.js", "--listen-all-interfaces", "--operator-transcripts"]`; the static check asserts that array; every other assertion unchanged
    - _Requirements: 18.8, 21.7_
  - [x] 13.4 Add the `conversation` criterion to `tooling/compose/compose-acceptance.ts`
    - After `stream`: start an audio turn with `{"utterance":"story"}` on the Simulator, then assert on the Gateway's stream a `brain_turn` `transcribed` entry, `safety_decision` entries for both stages, a `say` `message_out`, an `ack_result` `done`, and a `turn` event reaching state `done`; PASSED line `PASSED 23.1â€“23.8 + stream + conversation`; update `tooling/test/compose-acceptance.test.ts`
    - _Requirements: 22.1, 22.2_
  - [x] 13.5 Update the steering line and the README
    - `.kiro/steering/structure.md`: exactly one added line inside the `packages/shared/` block for `src/mock-audio/`; no other line changed
    - Root README: a short section on running a turn locally, naming the panel's utterance control, the Conversation page, the Transcripts_Argument and the in-memory-only transcripts; keep `tooling/test/readme.test.ts` passing, extending it only if a row it checks changes
    - _Requirements: 21.8, 21.9_

- [ ] 14. Final verification and report
  - [x] 14.1 Run the full verification
    - `corepack pnpm install --frozen-lockfile`, `corepack pnpm build`, `corepack pnpm lint`, `corepack pnpm format:check`, `corepack pnpm test`; fix every failure before continuing
    - If Docker is available: `docker compose build gateway simulator`, then `node tooling/compose/compose-acceptance.ts` (it writes and deletes its own `.env`; never leave a `.env` behind); otherwise state that it was not run and why
    - Confirm `.env.example`, `tooling/fixtures/approved-panel.txt` and `apps/parent-app` are unchanged, that the panel key count is still 23, and that no new dependency was added to any manifest
    - Delete any log file written under `c:\xelulu\.tools\`
    - _Requirements: 21.4, 21.6, 22.9, 16.2, 16.4_
  - [ ] 14.2 Write the Done-when report
    - For each of Omar's ten Done-when checks, name the automated test that covers it and its result; list the manual browser checklist from the design as not run by the agent unless it was run
    - List each FLAG (C1, C2, C3, C4, C5, C6, C7, C10, C21, C22, C23) and each superseded prior item from the requirements table, with its final state
    - State the Gateway_Log version move and its blast radius as handled, the final export count, and that no Panel_Key was added
    - List anything not verified and every open ruling (F1â€“F5) still outstanding
    - _Requirements: 22.1â€“22.10_

## Notes

- Test sub-tasks are not marked optional: Omar's Done-when requires each of them to pass.
- Properties 1â€“11 are fast-check runs of at least 100 iterations, as tech.md allows for shared, gateway and simulator; everything else is example-based. The parent app is untouched.
- Every timing test drives the existing `Clock` and `Deadlines` through Vitest fake timers. No test waits on wall-clock time.
- No new network code: `services/gateway/src/brain/` has no `transport/` folder in this phase, so the network-module Repo_Check and its count of three transport folders per service are unchanged.
- The Admin_Console stays read-only; the delete-all transcripts route is reachable only from the operator CLI inside the gateway container.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.3", "3.1", "5.1", "5.2", "7.4", "11.1", "13.1"] },
    { "id": 1, "tasks": ["1.2", "1.4", "3.3", "5.3", "5.4", "7.1", "7.2", "13.2"] },
    { "id": 2, "tasks": ["1.5", "1.6", "3.2", "3.4", "4.1", "4.2", "4.3", "4.4", "7.3", "7.5", "11.2"] },
    { "id": 3, "tasks": ["3.5", "4.5", "5.5", "5.6", "7.6", "7.7", "8.1", "11.3", "13.3"] },
    { "id": 4, "tasks": ["8.2", "11.4", "12.1", "12.2"] },
    { "id": 5, "tasks": ["8.3", "10.1", "12.3"] },
    { "id": 6, "tasks": ["8.4", "10.2", "12.4"] },
    { "id": 7, "tasks": ["8.5", "8.6", "8.7", "10.3", "13.4", "13.5"] },
    { "id": 8, "tasks": ["8.8"] },
    { "id": 9, "tasks": ["14.1"] },
    { "id": 10, "tasks": ["14.2"] }
  ]
}
```

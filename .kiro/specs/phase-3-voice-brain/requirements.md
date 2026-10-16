# Requirements Document

## Introduction

Phase 3 builds the voice brain inside `services/gateway`, against the Simulator and the per-turn audio WebSocket that Phase 1.2 already serves. One full turn runs end to end: the Simulator sends a test utterance as audio frames → speech-to-text → child-safety guardrails → an LLM with allow-listed internal tools → guardrails again → text-to-speech → Xelulu speaks back, streamed down the same socket, with a "let me think" filler on the slow path.

Every vendor sits behind a provider interface and every provider declares its retention and training posture. Only deterministic mocks are wired in this phase, so the whole loop and the whole test suite run offline, with no API key and no network. The Document B v2 contract does not change: `proto_ver` stays 2, no field is added, no enum renamed. Multilingual needs no bump either, because `say.data.lang` is already a free-form BCP-47-like string (`LANG_RE` in `packages/shared/src/gateway-contract/primitives.ts` accepts `en-IN`, `hi-IN` and `hi-Deva-IN`).

The Gateway_Log is not the contract and is versioned separately; this phase adds six entry kinds and bumps `GATEWAY_LOG_VERSION` to 2 (C3). There is still no backend in this repo, so transcripts, deferred questions, parent alerts and memory live in the Gateway's own process (C10).

### Out of scope

- Any real provider call. No vendor SDK, no HTTP client, no API key read (C7).
- The LLM vendor choice (F1).
- Supabase: persistence, RLS, parent view/delete/export of transcripts (C10, F2).
- The parent app, which stays on mock data and is untouched.
- Grandma voice, voice cloning and the `grandma` say voice (C20).
- The remaining eight Indian languages (C13).
- A real content library, routines engine, reports, homework hints and cry detection on the device.
- Real hardware, OTA, pairing, and any `proto_ver` change.
- Authentication on the Operator_Surface or the Admin_Console (still open from Phase 1.2 G24/G46).
- Every other Admin_Console page from the admin design.

### Choices made

Each choice was made without asking. Items marked FLAG change a steering rule, a prior-phase decision, a protected file or a dependency; approving this spec approves them as written. Rulings that genuinely need Omar are listed separately under "Rulings still needed".

- **C1. FLAG: the Voice_Brain replaces the Fake_Reply at the same seam.** `TurnResponder` is unchanged, so the Audio_Server is untouched: after a valid `audio_end` it still calls `respond(target)` exactly once. The composition root passes the Voice_Brain instead of the Fake_Reply, and `services/gateway/src/brain/fake-reply.ts` and `services/gateway/test/fake-reply.test.ts` are deleted. Blast radius: `gateway.ts`; the integration tests that assert the Fake_Reply's exact behaviour (`audio-server.test.ts`, `barge-in.test.ts`, `done-when.test.ts`, `stream-done-when.test.ts`, `brain.test.ts`) are rewritten against the mock pipeline; `FAKE_SAY_DATA`, `FAKE_REPLY_FRAMES` and `FAKE_REPLY_FRAME_INTERVAL_MS` disappear. Supersedes Phase 1.2 Requirements 10.1–10.7 and 14.2.
- **C2. FLAG: inbound frame bytes reach the Stt_Session.** Phase 1.2 deliberately dropped frame bytes at the transport ("the frame's bytes are never passed in"), which no real or mock STT can work with. `AudioInbound`'s `binary` variant gains the frame bytes; the Audio_Turn passes them to the turn's Stt_Session synchronously, inside the transport's message handler, and keeps no reference itself. The Stt_Session holds a bounded per-turn buffer (at most `MAX_UPLOAD_FRAMES` × `MAX_FRAME_BYTES`) that is dropped when the turn ends for any reason. Nothing else changes: no file write anywhere, no byte in any Log_Entry, stdout line, response or error. Narrows Phase 1.2 Requirements 9.6 and 21.2; Requirements 9.10 and 21.1 stay exactly as they are.
- **C3. FLAG: `GATEWAY_LOG_VERSION` 1 → 2, purely additive.** Six new kinds (`brain_turn`, `safety_decision`, `tool_call`, `provider_check`, `parent_alert`, `transcript_retention`). No existing kind is removed and no field of an existing kind is added, removed or changed, so every entry an existing test or fixture builds still parses, and only `log_ver` differs. Blast radius, each handled in tasks: `packages/shared/src/gateway-log/constants.ts` and `entries.ts`; `packages/shared/test/exports.test.ts` (runtime-export count, type list, and the `GATEWAY_LOG_VERSION` assertion); every golden log fixture and every Phase 1.2 gateway log test that asserts `log_ver: 1`; `apps/admin/src/log/entry-label.ts`, whose `switch` ends in a `never` default and therefore fails to compile until the six kinds are handled; the Admin_Console kind filter, which reads `GATEWAY_LOG_KINDS` and needs no change; `packages/shared/src/gateway-log/stream.ts` (`OPERATOR_STREAM_EVENTS` gains `turn`, C4); and `tooling/compose/compose-acceptance.ts` with `tooling/test/compose-acceptance.test.ts`.
- **C4. FLAG: transcripts never enter the Gateway_Log; the conversation view is a separate operator-only channel.** safety.md §7 says logs carry IDs only, and Phase 1.2 Requirement 12.5 forbids transcripts in Log_Entry types; both stay true. The six new kinds carry closed enums, IDs, counts and times only. The conversation view travels instead as a new `turn` event on the Operator_Stream, carrying a Conversation_Turn_View that is not a Log_Entry, is never written to stdout, and is held only in the bounded in-process Transcript_Store. Its transcript and reply text are sent only when the Gateway was started with the Transcripts_Argument (`--operator-transcripts`), which is Local_Mode only and off by default; without it the view carries decisions, tool names, timings and text lengths but no text. This follows the Phase 1.3 C8 precedent for a local-surface argument rather than adding a Panel_Key (C22). Supersedes Phase 1.3 Requirement 2.5's "SHALL leave every Log_Entry type and `GATEWAY_LOG_VERSION` (1) unchanged".
- **C5. FLAG: the test utterance is driven from the Simulator panel, not the console.** structure.md requires the Simulator to be a peer of the robot that uses only the Document B wire format with no shortcut into Gateway internals, and the Document B audio turn carries no text field, so the utterance must travel in the audio frames. The Control_Surface's `POST /api/audio-turn` gains an optional `utterance` naming one of the Simulator's Test_Utterances; the Simulator encodes that utterance's text as Utterance_Frames and uploads them as its turn's binary frames. The Admin_Console stays read-only (Phase 1.3 Requirement 8.2 holds) and gains no write path, so its Dev_Proxy still forwards `GET /v1/stream` only. Supersedes Phase 1.2 Requirement 18.2's fixed count of 50 Synthetic_Frames and narrows 18.7 (frames are still built from text constants in source; no microphone, audio device or audio file is read).
- **C6. FLAG: one new shared folder, `packages/shared/src/mock-audio/`.** It holds the Mock_Audio_Codec only: a version constant, a frame size cap, and `encodeUtteranceFrame` / `decodeUtteranceFrame`. It must be shared because the Simulator writes the frames and the Gateway's Mock_Stt reads them, and services may not import each other. It is not the contract, is not covered by `proto_ver`, carries its own `MOCK_AUDIO_VERSION`, and is deleted when a real codec arrives. `.kiro/steering/structure.md` gains exactly one line inside the `packages/shared/` block, as Phase 1.2 Requirement 22.7 did for `src/gateway-log/`.
- **C7. FLAG: mocks only; the real adapters are declaration-only scaffolds.** Phase 1.2 Requirement 14.3 fixes the gateway's runtime dependencies at exactly `@xelulu/shared`, `mqtt` and `ws`, bans every vendor SDK and bans the global `fetch`; Requirement 14.4 allows outbound connections only to the broker. Phase 3 keeps all of that. So each named adapter (`sarvam-stt`, `sarvam-tts`, `elevenlabs-tts`, and a vendor-neutral `hosted-llm`) exists as a module that exports its provider id, its Provider_Declaration with the vendor's recorded zero-retention and no-training settings, and a factory that refuses with `not_configured` without reading an env var or opening a socket. Real HTTP wiring arrives in a later phase that must amend Requirements 14.3 and 14.4 and add `services/gateway/src/brain/transport/` to the transport allowlist in `tooling/test/placeholder.test.ts` (whose assertion that each service has exactly 3 transport folders must then rise to 4).
- **C8. Provider refusal fails Gateway startup.** A capability whose Provider_Declaration is not "no retention, no training" is refused by the Safety_Layer at construction: the Gateway writes one stderr line naming the capability and the provider id (never a key or a value), exits non-zero within 5 s, and opens no listener, mirroring `OperatorListenError`. There is no fallback to it and no degraded mode: a gateway that cannot run a turn safely should not be reachable, and silently disabling a capability would hide a safety failure behind a timeout. A per-call gate re-checks before each use as defence in depth and refuses the turn with a Safe_Redirect. Both outcomes are logged as `provider_check` with outcome `refused`.
- **C9. Child_Context comes from the device's own `status`.** `status.active_child_id` is already in the contract. The Gateway keeps an in-process Child_Context table keyed by that id, holding `age_stage`, languages, allowed content categories, Defer_Topics and device policy (quiet hours, play limit, movement toggle). When `active_child_id` is null or unknown, the most restrictive context applies: `age_stage` `tiny`, `en-IN`, no extra categories. No new write surface is added. The Gateway_Log never carries `active_child_id` (Phase 1.2 Requirement 12.5 holds) but may carry `age_stage`, which is one of four buckets and names nobody.
- **C10. FLAG: the Phase 3 no-backend boundary.** Transcripts, Deferred_Questions, Parent_Alerts and Memory_Store entries live in the Gateway process only, bounded and in memory, surfaced through the Gateway_Log, the Operator_Surface and the Admin_Console. None of them reaches the parent app, which stays on mock data. A process restart loses all of them. The later Supabase backend phase (Phase 4) must persist each of them with Row Level Security by `household_id` and role, and must give parents the view, delete and export that safety.md §1 and §2 require.
- **C11. Transcript retention is real code, not a comment.** The Transcript_Store holds text only, with a default 30-day TTL taken from the existing `DEFAULT_TRANSCRIPT_RETENTION_DAYS`, an active sweep scheduled on the Deadlines abstraction that removes expired turns and logs a `transcript_retention` entry, a bounded capacity, an operator-visible held count, and a delete-all operation that really deletes. Nothing is written to disk. Durable 30-day retention with parent view, delete and export arrives with the backend (C10).
- **C12. Memory is in-process, text-only and capped.** The memory tool stores at most 50 short facts per child, each at most 120 code points, with no audio, no raw request values and no free-text child identifier. Facts are lost on restart.
- **C13. Languages: `en-IN` and `hi-IN`.** Both are carried through STT, the Safety_Layer, the LLM, TTS and the `say` command's `lang`, including one code-mixed utterance. No `proto_ver` bump: `LANG_RE` already accepts both. The ten languages product.md names arrive in a later phase. `voice` stays `xelulu`.
- **C14. One `say` per turn, published at the moment of first audio.** The Filler is spoken when no reply audio is ready by the Filler_Deadline (600 ms after the device's `audio_end`). The turn's single `say` is published when the first audio frame is about to be sent, whichever stream it belongs to, so the device animates once and the ack machinery tracks one command per spoken utterance. Two `say` commands per turn were rejected: the device would animate twice and the Simulator answers `done` on the reply's `audio_end` (Phase 1.2 G42), so a second command would hang. `duration_hint_ms` is a hint in Document B and covers filler plus reply.
- **C15. Filler audio is pre-rendered in memory at startup.** The Filler is Xelulu's own synthesised speech, not child audio, so caching it is allowed and is not a retention violation. It is synthesised once per supported language at startup through the Tts provider and held in memory; it is never written to disk and never cached across processes. The Filler is spoken only on the slow path, never alongside or after the real reply's frames, and stops with the turn on barge-in.
- **C16. Latency is measured on the Clock, never on wall clock.** Turn_Latency is the time from the device's `audio_end` to the first frame the Gateway sends on that turn. The budgets (1,000 ms typical, 1,600 ms worst) are constants asserted in tests driven by Vitest fake timers through the existing Clock and Deadlines, with the mock providers' own delays also scheduled on Deadlines. The Simulator independently measures the same interval from its side (Phase 1.2 Requirement 18.3).
- **C17. Crisis mechanism now, wording later.** Distress and disclosure of harm produce a Comfort_Response, an encouragement to tell a trusted grown-up, and a Parent_Alert. The reply wording and the escalation protocol need expert sign-off before launch (F3). This spec claims no clinical adequacy.
- **C18. The tool allow-list is frozen in code.** Exactly five Allow_Listed_Tools: `content_lookup`, `routine_lookup`, `memory_read`, `memory_write`, `device_action`. The Tool_Router executes nothing else, whatever a provider asks for. No tool browses, searches, fetches a URL or runs code. `device_action` may request only `say`, `animate`, `gesture`, `led` and `play`, is checked against quiet hours, the play limit and the movement toggle before anything is sent, and treats every ack `reason` as final.
- **C19. Output filters refuse rather than redact.** A reply containing a URL, a phone-like number, a price or a brand name is refused whole and replaced with a Safe_Redirect, not edited. Redaction risks speaking half a forbidden thing and makes the test weaker.
- **C20. No voice cloning, licence gate recorded.** tech.md requires a licence check before use and notes that cloning models may be non-commercial only. This phase clones nothing and ships no art or voice asset. The gate is recorded for the Grandma-voice phase (F4).
- **C21. FLAG: the provider-stub Repo_Check is re-pointed, and a no-raw-audio scan joins it.** `stub-providers.ts` is deleted; `tooling/checks/service-sources.ts`'s `PROVIDER_STUB_NAMES` and `STUB_MODULE_RE` become the mock and adapter module names, the fixture files `tooling/fixtures/gateway-boundaries-banned.txt` and `-clean.txt` change with them, and `gateway-boundaries.test.ts`'s walk guard names `brain/providers/mock-stt.ts` instead of `brain/stub-providers.ts`. A new `tooling/checks/audio-retention.ts` plus `tooling/test/audio-retention.test.ts` prove that byte-typed values appear only in the named Audio_Byte_Modules and that no file-writing API exists in either service. Supersedes Phase 1.2 Requirement 14.5.
- **C22. `.env.example` and `tooling/fixtures/approved-panel.txt` are unchanged.** The Panel already carries `LLM_API_KEY`, `STT_API_KEY`, `TTS_API_KEY`, `LLM_PROVIDER`, `LLM_MODEL`, `STT_PROVIDER` and `TTS_PROVIDER`. Phase 3 reads none of them, because the only provider it can construct is the mock: reading a key whose single accepted value is `mock` would add a way to stop the Gateway for no gain. `GATEWAY_CONFIG_KEYS` is therefore unchanged too, and the later adapter phase adds the three `*_PROVIDER` keys to it. Nothing new is hard-coded: the Transcripts_Argument is a local-surface argument on the C8 precedent, not an address or a key.
- **C23. FLAG: Compose passes the Transcripts_Argument to the gateway.** `docker-compose.yml`'s gateway `command` becomes `["node", "dist/index.js", "--listen-all-interfaces", "--operator-transcripts"]`, so the manual browser checklist can watch a conversation. This is local development only, published on host loopback only, on an internal console, and in this phase every "child" utterance is a Simulator test constant, so no real child speech exists anywhere in the system. Supersedes Phase 1.3 Requirement 3.3's `command` value and the exact-`command` assertion in `tooling/test/compose-static.test.ts`.
- **C24. The Admin_Console gains one page, read-only.** A Conversation page listing turns newest first, each with its transcript in, the Safety_Layer's decision, the tools called and the reply out. It reuses the existing shell, stream client, reducer and table patterns, adds no dependency, keeps the Phase 1.3 accessibility bar (semantic elements, labelled controls, 44 pt targets, visible focus, status as text and never colour alone, contrast pairs), and contains no animation, transition or flashing.
- **C25. Testing depth: property-based where the invariant is universal.** tech.md specifies Vitest plus fast-check for shared, gateway and simulator, and the Safety_Layer's invariants, the Mock_Audio_Codec round trip, the tool allow-list and the retention sweep are genuine properties. Everything else is example-based. The parent app is untouched, so its no-fast-check rule is not involved.
- **C26. Tests stay offline by construction, with one guard.** No new dependency, no `fetch`, no network-module import outside the transport folders, and `brain/` has no transport folder in this phase, so no brain module can open a socket at all; the existing Repo_Checks already prove each part. On top of that, the brain tests install a socket guard that fails the test if anything connects to a non-loopback address.

### Rulings still needed

1. **F1. The LLM vendor.** tech.md says "a hosted model with function calling" and names nobody. The adapter shape is vendor-neutral and unwired; the choice, its region, its zero-retention contract terms and its function-calling dialect are Omar's.
2. **F2. Reports and cry alerts against DPDP s.9.** safety.md already records that the legal review of parent-facing reports and cry alerts is pending. Phase 3 raises Parent_Alerts in-process; whether they may be persisted and shown to a parent as built needs that review before the backend phase.
3. **F3. The crisis protocol wording and escalation.** The mechanism is built in this phase. The exact comfort wording, the escalation path and whether a Parent_Alert alone is sufficient need expert sign-off before launch.
4. **F4. Licence confirmation per vendor and per asset.** Before any real provider or voice is used: the vendor's commercial licence and zero-retention terms, and for the Grandma voice phase the cloning model's licence.
5. **F5. Whether the Admin_Console may show transcript text at all.** C4 ships it behind an off-by-default argument and C23 turns it on in local Compose. If Omar prefers the console never to show text, drop C23 and leave the argument off; the automated tests do not depend on it.
6. **F6. RULED, and recorded as a gate: Safety Hardening.** Not an open question — Omar has ruled. The Safety_Layer's structural properties are verified in this phase (both guards total and correctly ordered, deferral and comfort wording at every stage-and-language cell, no child text in any Log_Entry, no raw audio anywhere), and group 5 is accepted on that basis. What remains is term-**coverage** completeness, which is unreachable while every input and every reply is a fixed mock constant. Those items are enumerated as the numbered **Safety Hardening** gate in `.kiro/steering/safety.md`, which **must close before any real STT, LLM or TTS provider is wired**. Phase 3A does not chase them.

## Glossary

- **Gateway**: the Node.js service in `services/gateway`.
- **Simulator**: the Node.js fake robot in `services/simulator`.
- **Admin_Console**: the internal web app in `apps/admin`.
- **Shared_Package**: `packages/shared` (`@xelulu/shared`).
- **Local_Mode**: `APP_ENV` equal to `local` (Phase 1.2).
- **Audio_Server**, **Audio_Turn**, **ReplyTarget**, **TurnResponder**: the Phase 1.2 audio plane and its reply seam, unchanged.
- **Voice_Brain**: the Gateway's `TurnResponder` for this phase, under `services/gateway/src/brain/`.
- **Turn_Pipeline**: one run of STT → Input_Guard → LLM with tools → Output_Guard → TTS for one Audio_Turn.
- **Provider_Declaration**: a provider's read-only statement of whether its vendor retains request data and whether it may train on it (`DataHandlingDeclaration`, Phase 1.2).
- **Mock_Stt**, **Mock_Llm**, **Mock_Tts**: the deterministic, seeded providers wired in this phase.
- **Adapter_Scaffold**: a named vendor module that exports its provider id and Provider_Declaration and refuses with `not_configured` (C7).
- **Stt_Session**: the per-turn speech-to-text session that receives frame bytes and produces a Transcript.
- **Transcript**: the text of one side of one turn. Text only, never audio.
- **Safety_Layer**: the Gateway's own guardrails, which run whatever the provider.
- **Input_Guard**: the Safety_Layer check on the child's Transcript, before the LLM.
- **Output_Guard**: the Safety_Layer check on the reply text, after the LLM.
- **Safety_Decision**: one of `allow`, `defer`, `comfort`, `refuse`, with a Safety_Rule code.
- **Safety_Rule**: a closed-enum reason code for a Safety_Decision. Never free text.
- **Defer_Topic**: one of `death`, `body`, `violence`, `religion`, `family_conflict`, or `parent_added` for anything in the Child_Context's parent-added list.
- **Deferral**: a short gentle answer plus "let's ask a grown-up together", with a Deferred_Question raised.
- **Comfort_Response**: the distress and harm-disclosure reply: comfort, encourage telling a trusted grown-up, raise a Parent_Alert (C17).
- **Safe_Redirect**: the fixed, age-shaped reply that replaces a refused turn.
- **Tool_Router**: the only path from a provider's tool request to an Allow_Listed_Tool.
- **Allow_Listed_Tool**: one of `content_lookup`, `routine_lookup`, `memory_read`, `memory_write`, `device_action` (C18).
- **Child_Context**: the active child's `age_stage`, languages, allowed categories, Defer_Topics and device policy (C9).
- **Age_Stage**: `tiny`, `little`, `explorer` or `maker` (`AGE_STAGES`, Shared_Package).
- **Transcript_Store**: the bounded in-process store of Transcript turns with a 30-day TTL (C11).
- **Memory_Store**: the bounded in-process fact store behind `memory_read` and `memory_write` (C12).
- **Parent_Alert**: an in-process alert record (`cry`, `distress`, `harm_disclosure` or `deferred_question`).
- **Deferred_Question**: an in-process record of a topic deferred to a grown-up.
- **Filler**: the "let me think" speech spoken on the slow path (C14, C15).
- **Filler_Deadline**: 600 ms after the device's `audio_end`.
- **Turn_Latency**: `audio_end` to the first frame the Gateway sends on that turn (C16).
- **Say_Command**: the turn's single `say` command (C14).
- **Mock_Audio_Codec**: `packages/shared/src/mock-audio/`, which encodes and decodes Utterance_Frames (C6).
- **Utterance_Frame**: one binary frame carrying part of a Test_Utterance's text under the Mock_Audio_Codec.
- **Test_Utterance**: one named utterance in the Simulator's own table (C5).
- **Gateway_Log**, **Log_Entry**: the Phase 1.2 log stream and its entries, now at `GATEWAY_LOG_VERSION` 2.
- **Operator_Surface**, **Operator_Stream**: the Gateway's Local_Mode HTTP surface and its SSE route (Phase 1.2, Phase 1.3).
- **Conversation_Turn_View**: the payload of a `turn` Operator_Stream event (C4). Not a Log_Entry.
- **Transcripts_Argument**: the command-line argument `--operator-transcripts` (C4).
- **Control_Surface**: the Simulator's local panel and JSON API (Phase 1.2).
- **Audio_Byte_Modules**: the named Gateway and Simulator modules allowed to hold byte-typed audio values (C21).
- **Repo_Check**: a test under `tooling/test/`.

## Requirements

### Requirement 1: Provider interfaces and declarations

**User Story:** As Omar, I want every vendor behind an interface that must declare how it handles our data, so that no provider can be used until it declares no retention and no training.

#### Acceptance Criteria

1. THE Gateway SHALL define `SttProvider`, `LlmProvider` and `TtsProvider` as TypeScript interfaces under `services/gateway/src/brain/`, each requiring a read-only `dataHandling` Provider_Declaration and a read-only provider id from a frozen list, and each declaring its own input and output types with no vendor type in them.
2. THE Gateway SHALL contain no import of a vendor SDK, no call to the global `fetch` and no network-module import under `services/gateway/src/brain/`, and its `dependencies` SHALL stay exactly `@xelulu/shared`, `mqtt` and `ws` (Phase 1.2 Requirements 14.3, 22.2 and 22.10, unchanged).
3. WHEN the Safety_Layer checks a provider whose Provider_Declaration has `vendorRetainsRequestData` or `vendorMayTrainOnRequestData` true, THE Safety_Layer SHALL refuse that provider, and THE Gateway SHALL add one `provider_check` Log_Entry with that capability, that provider id and outcome `refused`.
4. IF any of the three capabilities is refused under criterion 3 at start-up, THEN THE Gateway SHALL open no listener, write exactly one stderr line naming the capability and the provider id and no other value, and exit with a non-zero code within 5 s.
5. WHEN the Gateway starts with three accepted providers, THE Gateway SHALL add one `provider_check` Log_Entry per capability with outcome `accepted` and that provider's declared retention and training values, before the first Audio_Turn can run.
6. IF a Turn_Pipeline is about to use a provider whose Provider_Declaration fails criterion 3, THEN THE Turn_Pipeline SHALL use no provider for that turn, SHALL reply with a Safe_Redirect, and THE Gateway SHALL add one `provider_check` Log_Entry with outcome `refused`.
7. THE Gateway SHALL pass the Voice_Brain as the Audio_Server's only TurnResponder, and no module outside `services/gateway/src/brain/` SHALL import a provider implementation module. (Supersedes Phase 1.2 Requirement 14.2.)

### Requirement 2: Mock providers

**User Story:** As the implementation engineer, I want deterministic mocks of all three providers, so that the whole loop and the whole test suite run offline with no key and no network.

#### Acceptance Criteria

1. THE Mock_Stt SHALL decode the frames of a turn with the Mock_Audio_Codec and return the decoded text as the turn's Transcript, with the language tag the frames carry, and SHALL return an empty Transcript when the frames decode to no text.
2. THE Mock_Llm SHALL choose its reply from a rule table fixed in the Gateway's source, matched against the Transcript's text and the Child_Context, and SHALL return the same reply, the same tool requests and the same delay for the same Transcript, Child_Context and seed, on every run and in every process.
3. THE Mock_Tts SHALL return a frame stream whose frame count is a documented function of the reply text's length, each frame exactly the Gateway's existing synthetic frame constant, and SHALL read no file and no recorded audio.
4. THE Mock_Stt, Mock_Llm and Mock_Tts SHALL each declare no retention and no training, SHALL read no environment variable, SHALL open no socket, and SHALL schedule every delay they simulate on the Gateway's Deadlines.
5. THE Mock_Llm rule table SHALL cover at least: a plain question, a question on a Defer_Topic, an unsafe request, a distress disclosure, a request that needs `content_lookup`, a Hindi utterance, a code-mixed utterance, and one rule whose delay is longer than the Filler_Deadline.
6. WHEN a Turn_Pipeline runs with the mocks, THE Gateway SHALL need no `LLM_API_KEY`, `STT_API_KEY` or `TTS_API_KEY` value and SHALL read none of those keys.

### Requirement 3: Adapter scaffolds

**User Story:** As Omar, I want the real providers' shapes and retention postures recorded now, so that wiring a vendor later is configuration rather than redesign.

#### Acceptance Criteria

1. THE Gateway SHALL include one Adapter_Scaffold module per named vendor capability: Sarvam speech-to-text, Sarvam text-to-speech, ElevenLabs text-to-speech, and a vendor-neutral hosted LLM.
2. Each Adapter_Scaffold SHALL export its provider id, its Provider_Declaration recording the vendor's zero-retention and no-training settings as safety.md §1 requires, and a factory.
3. WHEN an Adapter_Scaffold's factory is called, THE factory SHALL return a refusal naming `not_configured`, without reading an environment variable, opening a socket, importing a vendor package or keeping its arguments.
4. THE Adapter_Scaffold modules SHALL contain no HTTP, WebSocket or socket call and no vendor type.

### Requirement 4: The turn pipeline

**User Story:** As a child, I want Xelulu to answer when I talk to it, so that it feels like a conversation.

#### Acceptance Criteria

1. WHEN the Audio_Server calls the Voice_Brain's `respond` for a turn, THE Turn_Pipeline SHALL run, in this order: the Stt_Session's Transcript, the Input_Guard, the LLM with the Allow_Listed_Tool catalogue, the Tool_Router for each requested tool, the Output_Guard, and the Tts provider's frames.
2. WHEN the Turn_Pipeline is about to send its first frame on a turn, THE Gateway SHALL first ask to send exactly one `say` command for that turn whose `data` holds exactly `expression` from the known expressions, `lang` from the supported languages, `voice` `xelulu` and a non-negative `duration_hint_ms`, tracked as a Pending_Command under Phase 1.2 Requirement 8.
3. WHEN the Tts frames for a turn are exhausted, THE Turn_Pipeline SHALL send the turn's `audio_end` and close the socket through the ReplyTarget's `finish`, and THE Gateway SHALL add one `brain_turn` Log_Entry with phase `done`, the turn's Turn_Latency and its frame count.
4. IF the Gateway refuses the turn's `say` command with `device_offline` or `broker_disconnected`, THEN THE Turn_Pipeline SHALL send no frame and no `audio_end`, SHALL abort the turn through the ReplyTarget with that cause, and SHALL add one `brain_turn` Log_Entry with phase `aborted` and that cause.
5. THE Turn_Pipeline SHALL send no downstream `audio_start` and no text message on a turn's socket other than the `audio_end` that Phase 1.2 Requirements 10.6 and 11.1 allow.
6. IF any provider call or tool call throws or returns a refusal, THEN THE Turn_Pipeline SHALL speak a Safe_Redirect if it has sent no frame yet, SHALL finish the turn if it has, SHALL add one `brain_turn` Log_Entry with phase `failed` and a closed-enum cause, and SHALL keep the Gateway running.
7. THE Turn_Pipeline SHALL add one `brain_turn` Log_Entry per phase it reaches (`started`, `transcribed`, `replied`, `speaking`, `filler`, `done`, `failed`, `aborted`), each carrying `device_id`, `turn_id`, the language, the Age_Stage, elapsed milliseconds since the turn's `audio_end`, frames sent so far and a closed-enum cause or null, and no text.
8. THE Turn_Pipeline SHALL run at most one pipeline per Audio_Turn and SHALL start no pipeline for a turn whose upload did not end.

### Requirement 5: Input guardrails

**User Story:** As a parent, I want every child utterance checked before it reaches the model, so that the model never sees or answers something it should not.

#### Acceptance Criteria

1. WHEN a Transcript is produced, THE Input_Guard SHALL classify it before any LLM call and SHALL produce exactly one Safety_Decision with one Safety_Rule code.
2. WHERE the Transcript's topic is outside the Child_Context's allowed content categories, THE Input_Guard SHALL decide `refuse` with rule `blocked_category`.
3. WHEN the Transcript names a Defer_Topic, THE Input_Guard SHALL decide `defer` with rule `defer_topic` and that topic's code.
4. WHEN the Transcript shows distress or discloses harm, THE Input_Guard SHALL decide `comfort` with rule `distress` or `harm_disclosure`.
5. IF the Input_Guard cannot classify the Transcript with confidence, THEN THE Input_Guard SHALL decide `refuse` with rule `uncertain`.
6. WHEN the Input_Guard decides anything other than `allow`, THE Turn_Pipeline SHALL make no LLM call for that turn and SHALL speak the reply that decision requires.
7. WHEN the Input_Guard produces a Safety_Decision, THE Gateway SHALL add one `safety_decision` Log_Entry with stage `input`, that decision, that rule, the topic code or null, and no text.

### Requirement 6: Output guardrails

**User Story:** As a parent, I want every reply checked after the model, so that nothing unsafe is ever spoken even if the model misbehaves.

#### Acceptance Criteria

1. WHEN the LLM returns reply text, THE Output_Guard SHALL check it before any Tts call and SHALL produce exactly one Safety_Decision with one Safety_Rule code.
2. IF the reply text contains a URL, a phone-like number, a price or a brand name from the blocked list, THEN THE Output_Guard SHALL decide `refuse` with rule `url`, `contact_detail`, `price` or `brand`, and THE Turn_Pipeline SHALL speak a Safe_Redirect instead of the reply, with no part of the reply spoken.
3. IF the reply text contains romantic, frightening, medical, legal or financial content, THEN THE Output_Guard SHALL decide `refuse` with the matching rule.
4. IF the reply text is longer than the Age_Stage's sentence limit, THEN THE Output_Guard SHALL decide `refuse` with rule `length`.
5. IF the Output_Guard cannot classify the reply text with confidence, THEN THE Output_Guard SHALL decide `refuse` with rule `uncertain`.
6. WHEN the Output_Guard produces a Safety_Decision, THE Gateway SHALL add one `safety_decision` Log_Entry with stage `output`, that decision, that rule and no text.
7. THE Safe_Redirect text SHALL be a constant in the Gateway's source per supported language and Age_Stage, SHALL be 1 to 3 sentences, and SHALL itself pass the Output_Guard.

### Requirement 7: Deferral

**User Story:** As a parent, I want hard questions handed back to me, so that I decide how my child hears about them.

#### Acceptance Criteria

1. WHEN the Input_Guard decides `defer`, THE Turn_Pipeline SHALL speak a reply that gives a short gentle answer and then invites asking a grown-up together, in the turn's language and within the Age_Stage's sentence limit.
2. WHEN a Deferral is spoken, THE Gateway SHALL record one Deferred_Question holding the topic code, the turn id, the device id and the time, and no transcript text and no child name.
3. WHEN a Deferred_Question is recorded, THE Gateway SHALL raise one Parent_Alert with kind `deferred_question` and SHALL add one `parent_alert` Log_Entry with that kind and its alert id.
4. THE Operator_Surface SHALL report the recorded Deferred_Questions, each with its topic code, turn id, device id and time, and no text.
5. WHEN a Defer_Topic comes from the Child_Context's parent-added list, THE Gateway SHALL use the topic code `parent_added` in every Log_Entry and Deferred_Question, so that no parent-authored topic text is logged.

### Requirement 8: Distress and disclosure of harm

**User Story:** As a parent, I want to be told at once if my child is distressed or discloses harm, so that a grown-up can act.

#### Acceptance Criteria

1. WHEN the Input_Guard decides `comfort`, THE Turn_Pipeline SHALL speak a Comfort_Response that comforts the child and encourages telling a trusted grown-up, within the Age_Stage's sentence limit, and SHALL make no LLM call for that turn.
2. WHEN a Comfort_Response is spoken, THE Gateway SHALL raise one Parent_Alert with kind `distress` or `harm_disclosure` and SHALL add one `parent_alert` Log_Entry with that kind and its alert id.
3. THE Comfort_Response SHALL name no emergency number, no URL and no service, so that the Output_Guard's rules hold for it too.
4. WHEN the Gateway accepts a `cry` event, THE Gateway SHALL raise one Parent_Alert with kind `cry` carrying only the event's `confidence` and `duration_s` and its ids, and no audio and no transcript.
5. THE Operator_Surface SHALL report the raised Parent_Alerts, each with its kind, alert id, device id, optional turn id and time, and no text.

Note: the mechanism is built here; the wording and the escalation protocol need expert sign-off before launch (F3). No clinical adequacy is claimed.

### Requirement 9: Tool allow-list

**User Story:** As Omar, I want the model to reach nothing but our own tools, so that there is no open internet for the child.

#### Acceptance Criteria

1. THE Shared_Package SHALL export a frozen `ALLOW_LISTED_TOOLS` constant listing exactly `content_lookup`, `routine_lookup`, `memory_read`, `memory_write` and `device_action`.
2. WHEN the LLM requests a tool whose name is in `ALLOW_LISTED_TOOLS`, THE Tool_Router SHALL run that tool and add one `tool_call` Log_Entry with that tool name and outcome `ok` or `error`.
3. IF the LLM requests a tool whose name is not in `ALLOW_LISTED_TOOLS`, THEN THE Tool_Router SHALL run nothing, SHALL return a denial to the LLM, and SHALL add one `tool_call` Log_Entry with outcome `denied` and reason `not_allow_listed`, naming no requested value.
4. THE Allow_Listed_Tools SHALL perform no HTTP request, no URL fetch, no search, no file read and no code execution, and SHALL read only the Gateway's in-process content fixture, routine fixture, Memory_Store and command sender.
5. WHEN `device_action` is requested, THE Tool_Router SHALL allow only the actions `say`, `animate`, `gesture`, `led` and `play`, SHALL deny the request with reason `policy` when the Child_Context's quiet hours or play limit are in force or, for a movement-bearing action, the movement toggle is off, and SHALL send nothing in that case.
6. WHEN a `device_action` command receives a `rejected` or `failed` ack, THE Gateway SHALL treat the ack's `reason` as final, SHALL send no replacement command for it, and SHALL mention no reason text in the spoken reply.
7. THE Turn_Pipeline SHALL run at most 3 tool calls per turn and SHALL deny further requests with reason `policy`.
8. THE Gateway SHALL include no tool argument value in any Log_Entry.

### Requirement 10: Age-appropriate replies

**User Story:** As a parent of a 2-year-old and a 9-year-old, I want each of them to hear a reply pitched at them, so that Xelulu fits each child.

#### Acceptance Criteria

1. WHEN the Gateway accepts a `status` message, THE Gateway SHALL set that device's Child_Context from the message's `active_child_id`, and SHALL use the most restrictive Child_Context when that id is null or unknown.
2. THE Turn_Pipeline SHALL shape every spoken reply to the active Child_Context's Age_Stage: at most 1 sentence for `tiny`, at most 2 for `little`, and at most 3 for `explorer` and `maker`, each within that stage's word-count limit.
3. THE Turn_Pipeline SHALL pass the Age_Stage, the allowed categories and the Defer_Topics to the LLM as part of its input, and SHALL apply the same limits in the Output_Guard whatever the LLM returns.
4. THE Gateway SHALL include the Age_Stage but never `active_child_id` and never a child name in any Log_Entry (Phase 1.2 Requirement 12.5, unchanged).
5. THE Gateway SHALL hold the Child_Context table in memory only, from a fixture fixed in the Gateway's source, and SHALL lose it on restart (C9, C10).

### Requirement 11: Multilingual

**User Story:** As an Indian parent, I want Xelulu to answer in our language, including when my child mixes two, so that it belongs in our home.

#### Acceptance Criteria

1. THE Gateway SHALL support exactly the language tags `en-IN` and `hi-IN` in this phase, exported as a frozen constant from the Shared_Package.
2. WHEN the Stt_Session returns a Transcript with a supported language tag, THE Turn_Pipeline SHALL carry that tag through the Input_Guard, the LLM, the Output_Guard, the Tts provider and the turn's `say` command's `lang` field unchanged.
3. IF the Stt_Session returns a language tag that is not supported, THEN THE Turn_Pipeline SHALL use the Child_Context's first language and SHALL add one `safety_decision` Log_Entry with rule `unsupported_language`.
4. WHEN a Transcript mixes both supported languages, THE Turn_Pipeline SHALL reply in the Child_Context's first language and SHALL carry that language's tag in the `say` command.
5. THE `say` command's `lang` value SHALL satisfy the contract's `LANG_RE`, and THE Gateway SHALL make no change to the Document B contract, its schemas or `proto_ver` for multilingual support.
6. THE Safe_Redirect, the Deferral reply, the Comfort_Response and the Filler SHALL each exist in both supported languages.

### Requirement 12: Latency and the filler

**User Story:** As a child, I want Xelulu to answer quickly, and to say something while it thinks, so that waiting never feels like being ignored.

#### Acceptance Criteria

1. THE Gateway SHALL measure each turn's Turn_Latency on its Clock from the device's `audio_end` to the first frame it sends on that turn, and SHALL record it on that turn's `brain_turn` Log_Entries and its Conversation_Turn_View.
2. WHEN a Turn_Pipeline runs with the mock providers on a rule whose delay is below the Filler_Deadline, THE Gateway SHALL send the turn's first frame within 1,000 ms of the device's `audio_end` on its Clock.
3. THE Gateway SHALL send the first frame of every turn that it answers within 1,600 ms of the device's `audio_end` on its Clock, with the mock providers.
4. IF no reply frame is ready 600 ms after the device's `audio_end`, THEN THE Turn_Pipeline SHALL send the turn's `say` command and then stream the Filler for the turn's language, and SHALL add one `brain_turn` Log_Entry with phase `filler`.
5. WHEN the reply's first frame becomes ready while the Filler is streaming, THE Turn_Pipeline SHALL stop the Filler at a frame boundary, send no further Filler frame, and continue the same turn with the reply's frames.
6. THE Turn_Pipeline SHALL send at most one Filler per turn, SHALL send no Filler after a reply frame, and SHALL send exactly one `say` command per turn whether or not the Filler was spoken.
7. THE Gateway SHALL synthesise the Filler once per supported language at start-up through the Tts provider, hold it in memory, and write it to no file.
8. THE Gateway SHALL schedule the Filler_Deadline on its Deadlines, and no test SHALL wait on wall-clock time for it.

### Requirement 13: Barge-in and teardown

**User Story:** As a child, I want Xelulu to stop at once when I talk over it, so that I can interrupt it like a person.

#### Acceptance Criteria

1. WHEN a turn's ReplyTarget signals that it has stopped, for any cause, THE Turn_Pipeline SHALL send no further frame, send no `audio_end`, cancel every deadline it scheduled for that turn, abandon any pending provider or tool work, and release that turn's frame buffers and Transcript buffers.
2. WHEN a turn is interrupted while the Filler is streaming, THE Turn_Pipeline SHALL stop the Filler under criterion 1 and SHALL leave the barge-in sequence of Phase 1.2 Requirement 11 unchanged.
3. THE Turn_Pipeline SHALL add exactly one `brain_turn` Log_Entry with phase `aborted` and a closed-enum cause for a turn that stops before it finishes, and SHALL add no `done` entry for that turn.
4. WHEN a turn stops after some frames were sent, THE Gateway SHALL keep that turn's Conversation_Turn_View consistent, marked as interrupted with the frames actually sent, and SHALL leave no partial audio anywhere.
5. WHEN the Gateway stops, THE Voice_Brain SHALL cancel every pipeline deadline and release every buffer, and `stop()` SHALL complete.

### Requirement 14: No raw child audio

**User Story:** As a parent, I want to be certain no recording of my child exists, so that I can trust the robot in my house.

#### Acceptance Criteria

1. THE Gateway SHALL write no audio frame byte to any file, Log_Entry, stdout line, stderr line, response body or error, in any code path. (Phase 1.2 Requirements 9.10 and 21.1, unchanged.)
2. WHEN the Audio_Turn receives an inbound binary frame, THE Audio_Turn SHALL update its frame and byte counts and pass the frame's bytes to that turn's Stt_Session within the handler that received them, and SHALL keep no reference to them itself. (Supersedes Phase 1.2 Requirement 9.6's "without keeping, copying or forwarding its bytes".)
3. THE Stt_Session SHALL hold at most `MAX_UPLOAD_FRAMES` × `MAX_FRAME_BYTES` bytes for a turn, SHALL release them when the turn ends for any reason, and SHALL pass them to no other module. (Supersedes Phase 1.2 Requirement 21.2.)
4. THE Gateway and THE Simulator source trees SHALL declare or accept a byte-typed audio value (`Uint8Array`, `Buffer` or `ArrayBuffer`) only in the Audio_Byte_Modules the design names, and a Repo_Check SHALL fail, naming the file, on any such value elsewhere.
5. THE Gateway SHALL hold a Transcript as text only, and SHALL hold no audio for a `cry` event beyond its `confidence` and `duration_s`.
6. FOR ALL generated Test_Utterance texts of at least 8 characters, no Log_Entry, no stdout line and no Operator_Surface response body SHALL contain that text or any byte sequence from the turn's frames, when the Gateway runs without the Transcripts_Argument (property, at least 100 runs).

### Requirement 15: Transcript store and retention

**User Story:** As a parent, I want transcripts to be text only and to expire, so that nothing about my child is kept longer than it should be.

#### Acceptance Criteria

1. WHEN a turn produces a Transcript or a spoken reply, THE Transcript_Store SHALL hold them as text turns with a speaker of `child` or `xelulu`, a time and an expiry of the turn's time plus `DEFAULT_TRANSCRIPT_RETENTION_DAYS`.
2. THE Transcript_Store SHALL hold its turns in memory only, SHALL write to no file, and SHALL lose them on process restart.
3. THE Transcript_Store SHALL hold at most a fixed capacity of turns per device and in total, dropping the oldest first when the capacity is reached.
4. WHEN a scheduled sweep runs, THE Transcript_Store SHALL remove every turn whose expiry has passed on the Gateway's Clock, and THE Gateway SHALL add one `transcript_retention` Log_Entry with action `expired`, the number removed and the number held.
5. WHEN the Operator_Surface receives a delete-all transcripts request, THE Transcript_Store SHALL remove every turn it holds, and THE Gateway SHALL add one `transcript_retention` Log_Entry with action `deleted_all`, the number removed and a held count of 0.
6. THE Operator_Surface SHALL report the number of Transcript turns held per device and in total, and no transcript text unless the Gateway was started with the Transcripts_Argument.
7. THE Gateway SHALL schedule the retention sweep on its Deadlines, so that tests drive it with fake timers.

### Requirement 16: In-process state and the Phase 3 boundary

**User Story:** As Omar, I want the no-backend boundary written down, so that nobody mistakes this phase's state for a product promise.

#### Acceptance Criteria

1. THE Gateway SHALL hold the Transcript_Store, the Memory_Store, the Deferred_Questions and the Parent_Alerts in its own process only, each bounded, and SHALL lose all of them on restart.
2. THE Gateway SHALL send none of them to any other service, and THE parent app SHALL stay unchanged and on mock data.
3. THE Memory_Store SHALL hold at most 50 facts per child, each at most 120 code points of text, with no audio and no raw request value, and `memory_write` SHALL refuse a longer fact with outcome `error`.
4. THE Gateway SHALL contain no `@supabase/` package, no Supabase client and no persistence call. (Phase 1.2 Requirement 14.3, unchanged.)
5. THE Gateway SHALL surface each of these stores through the Operator_Surface and the Gateway_Log only.

### Requirement 17: Gateway_Log additions

**User Story:** As the intern, I want the brain's decisions in the same log stream as everything else, so that one feed explains a turn.

#### Acceptance Criteria

1. THE Shared_Package SHALL set `GATEWAY_LOG_VERSION` to 2 and SHALL add exactly the kinds `brain_turn`, `safety_decision`, `tool_call`, `provider_check`, `parent_alert` and `transcript_retention` to `GATEWAY_LOG_KINDS`. (Supersedes Phase 1.2 Requirements 12.1 and 12.2.)
2. THE Shared_Package SHALL leave every existing Log_Entry kind, and every field of every existing kind, unchanged, so that an entry built for `GATEWAY_LOG_VERSION` 1 differs only in `log_ver`.
3. THE new Log_Entry types SHALL carry only closed-enum values, identifiers, booleans, counts and times, and SHALL have no field for a transcript, a reply text, a tool argument, `active_child_id`, a child name, audio bytes, an `auth` value or a token. (safety.md §7; Phase 1.2 Requirement 12.5.)
4. THE Shared_Package SHALL export one frozen constant per new closed list that the design names, and SHALL export each new entry type.
5. THE `brain_turn`, `safety_decision`, `tool_call`, `provider_check`, `parent_alert` and `transcript_retention` entries SHALL each carry the fields the design's data model lists, present on every entry of that kind and set to null rather than left out when they have no value. (Phase 1.2 Requirement 12.4's rule, applied to the new kinds.)
6. THE Gateway SHALL write every new entry to stdout as one JSON line like every other entry, and the Phase 1.2 Gateway_Log properties (sequence, JSON round trip, subscriber delivery) SHALL hold for them unchanged.

### Requirement 18: Operator conversation channel

**User Story:** As the implementation engineer, I want to watch a whole conversation turn, so that I can see what the brain did without reading transcripts out of a log.

#### Acceptance Criteria

1. THE Shared_Package SHALL add `turn` to `OPERATOR_STREAM_EVENTS` and SHALL export the Conversation_Turn_View type. (Supersedes Phase 1.3 Requirement 2.5's unchanged-version clause.)
2. WHEN a turn reaches a phase that changes its Conversation_Turn_View, THE Gateway SHALL send one `turn` event on each open Operator_Stream carrying that turn's view.
3. THE Conversation_Turn_View SHALL carry the turn id, the device id, the language, the Age_Stage, the input and output Safety_Decisions with their rule codes, the tool names called with their outcomes, the Turn_Latency, whether the Filler was spoken, the frames sent, the turn's state, and the character lengths of the Transcript and the reply.
4. WHERE the Gateway was started with the Transcripts_Argument in Local_Mode, THE Conversation_Turn_View SHALL also carry the Transcript text and the spoken reply text.
5. IF the Gateway was not started with the Transcripts_Argument, or is not in Local_Mode, THEN THE Conversation_Turn_View SHALL carry no Transcript text and no reply text, and the Operator_Surface SHALL return none.
6. THE Gateway SHALL write no Conversation_Turn_View to stdout, SHALL put none of its text in any Log_Entry, and SHALL keep the Operator_Stream's existing `devices` and `entry` events unchanged.
7. THE Operator_Surface SHALL apply its Phase 1.2 request guard to every new route unchanged, and the Operator_Stream SHALL stay read-only and Local_Mode only.
8. THE `docker-compose.yml` gateway service SHALL set `command` to `["node", "dist/index.js", "--listen-all-interfaces", "--operator-transcripts"]`. (Supersedes Phase 1.3 Requirement 3.3's `command` value.)

### Requirement 19: Simulator test utterances

**User Story:** As the implementation engineer, I want to drive a chosen utterance from the Simulator panel, so that a whole turn can be exercised by hand and in CI.

#### Acceptance Criteria

1. THE Control_Surface SHALL accept an optional `utterance` field on its audio-turn request, naming one of the Simulator's Test_Utterances, and SHALL refuse an unknown name with an error naming the field and echoing no value.
2. WHEN an audio turn starts with an `utterance`, THE Simulator SHALL upload that utterance's text as Utterance_Frames built with the Mock_Audio_Codec, each at most the codec's frame cap and at most the contract's 1,500 bytes, at 20 ms intervals on its injected clock, then send its `audio_end`. (Supersedes Phase 1.2 Requirement 18.2's fixed 50 frames.)
3. WHEN an audio turn starts with no `utterance`, THE Simulator SHALL upload the Phase 1.2 synthetic frames unchanged.
4. THE Simulator SHALL build every upstream frame from text constants in its own source and SHALL read no microphone, audio device or audio file. (Narrows Phase 1.2 Requirement 18.7.)
5. THE Simulator's Test_Utterance table SHALL include at least: a plain English question, a Defer_Topic question, an unsafe request, a distress disclosure, a story request that needs a tool, a Hindi utterance, a code-mixed utterance, and one that triggers the Filler path.
6. THE web panel SHALL offer the Test_Utterances in a labelled native control next to the audio-turn button, and SHALL keep the Phase 1.2 panel accessibility rules (text labels tied to controls, keyboard operation, visible focus, no animation).
7. THE Simulator SHALL keep reporting the turn's outcome, reply frame count and first-frame latency as Phase 1.2 Requirement 18.3 defines, and SHALL discard each reply frame's bytes on receipt.
8. THE Simulator SHALL contain no transcript text in any log entry it writes, and no Utterance_Frame byte.

### Requirement 20: Admin console conversation view

**User Story:** As the intern, I want to watch a conversation end to end in the console, so that I can see the brain working without a terminal.

#### Acceptance Criteria

1. THE Admin_Console SHALL add one Conversation page, reachable from the existing navigation, listing turns newest first.
2. THE Conversation page SHALL show, per turn: the time, the device id, the turn id, the language, the Age_Stage, the input and output Safety_Decisions with their rule codes as text, the tools called with their outcomes, the Turn_Latency in milliseconds, whether the Filler was spoken, the frames sent, and the turn's state.
3. WHERE a `turn` event carries Transcript and reply text, THE Conversation page SHALL show them as the child's words and Xelulu's reply; otherwise it SHALL show their character lengths and a note that text is off.
4. THE Admin_Console SHALL keep at most a fixed number of the most recent turns and SHALL clear them when the Operator_Stream reopens, as it already does for Log_Entries.
5. THE Live_Log's kind filter SHALL offer every kind in `GATEWAY_LOG_KINDS`, including the six new ones, and the entry label function SHALL give each new kind a label built only from its closed-enum and id fields.
6. THE Admin_Console SHALL stay read-only, SHALL send no request other than `GET /v1/stream` to its own origin, and SHALL add no dependency. (Phase 1.3 Requirements 8.1 and 8.2, unchanged.)
7. THE Conversation page SHALL use a semantic table or list, a labelled control for any filter, one `h1` for the app, visible focus on every focusable control, status as text and never colour alone, and SHALL contain no animation, transition or flashing.
8. THE Admin_Console SHALL show no secret, token, env value or Panel_Key name, and its built bundle SHALL contain no Panel_Key name. (Phase 0 check, unchanged.)

Note: these checks cover the basics only. Full WCAG validation needs manual testing with assistive technologies and an expert accessibility review.

### Requirement 21: Repo checks and boundaries

**User Story:** As the implementation engineer, I want the existing checks updated only where this phase changes what they guard, and one new check for the thing that matters most.

#### Acceptance Criteria

1. THE new audio-retention Repo_Check SHALL fail on any byte-typed audio value outside the Audio_Byte_Modules, on any file-writing API call in either service, and SHALL include fixture self-tests that prove the detector reports a banned sample and nothing for a clean one.
2. THE gateway-boundaries Repo_Check SHALL keep its import allowlist, manifest and `fetch` tests unchanged, SHALL name an existing brain provider module in its walk guard, and SHALL fail on any use of a provider implementation module outside `services/gateway/src/brain/`.
3. THE network-module Repo_Check SHALL pass unchanged, with no network import added anywhere under `services/gateway/src/brain/` and no new transport folder in this phase.
4. THE env-read, secret, URL, contract-use, cross-package-import, manifest, file-name, style-prop and contrast Repo_Checks SHALL pass with their rules unchanged, and no tracked source file SHALL contain a non-loopback URL literal or a Panel_Key assignment line.
5. THE Phase 1 export test SHALL add each new runtime constant to `EXPECTED_RUNTIME_EXPORTS`, raising its length by exactly the number of names the design lists, SHALL add each new type to its type list, and SHALL assert `GATEWAY_LOG_VERSION` equals 2.
6. THE `.env.example` and `tooling/fixtures/approved-panel.txt` files SHALL stay unchanged, and `tooling/test/panel-check.test.ts`'s expected key count SHALL stay 23.
7. THE Compose static Repo_Check SHALL assert the gateway service's new `command` value and SHALL keep every other assertion in that file.
8. THE Structure_Steering SHALL gain exactly one added line, inside the `packages/shared/` block, listing `src/mock-audio/` with a one-line description; no other line of `.kiro/steering/structure.md` SHALL change.
9. THE root README SHALL gain a short section on running a conversation turn locally, naming the panel's utterance control, the Conversation page and the Transcripts_Argument, and stating that transcripts are in-memory only and lost on restart.

### Requirement 22: Verification

**User Story:** As Omar, I want every Done-when check backed by an automated test, with only the browser steps left manual.

#### Acceptance Criteria

1. THE gateway tests SHALL include a full-turn test, driven by the fake device and Vitest fake timers, that shows: an utterance uploaded as Utterance_Frames, a `brain_turn` `transcribed` entry, `safety_decision` entries for input and output, a `say` `message_out` with `lang` `en-IN`, reply frames, a reply `audio_end`, an `ack_result` with outcome `done`, and a reply within the Age_Stage's sentence limit.
2. THE gateway tests SHALL show the Deferral path (a gentle reply, a Deferred_Question recorded, a `parent_alert` entry with kind `deferred_question`) and the refusal path (an unsafe utterance, a `safety_decision` with decision `refuse`, a Safe_Redirect spoken, and no part of the unsafe content in any frame or entry).
3. THE gateway tests SHALL show that the Tool_Router runs allow-listed tools and denies every other name, and that no URL, phone-like number, price or brand name can reach a spoken reply.
4. THE gateway tests SHALL show the Filler path under fake timers (no reply ready at 600 ms, Filler frames, one `say`, the reply continuing on the same turn, no double speech) and SHALL assert the 1,000 ms and 1,600 ms budgets.
5. THE gateway tests SHALL show that each provider's declaration is checked, that a retaining or training provider fails start-up with one stderr line and a non-zero exit, and that the mocks declare neither.
6. THE gateway and shared tests SHALL show both supported languages round-tripping, including a code-mixed utterance, and the Mock_Audio_Codec round trip as a property.
7. THE Repo_Checks SHALL prove that no raw audio is written anywhere and that byte-typed audio values exist only in the Audio_Byte_Modules, and the gateway tests SHALL prove that only transcript text and `cry` `confidence` and `duration_s` exist as retained data.
8. THE brain tests SHALL install a socket guard that fails the test if any connection is opened to a non-loopback address.
9. WHEN `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm lint`, `pnpm format:check` and `pnpm test` run, each SHALL succeed, and the suite SHALL have no fewer passing tests than the Phase 2.2 baseline of 89 Vitest files and 1,558 tests plus 13 parent-app Jest suites and 267 tests, allowing for the files this phase deletes and adds.
10. THE design's manual checklist SHALL cover the browser steps, which are not automated: opening the Conversation page, choosing each Test_Utterance from the panel, and watching the turn appear.

## Superseded items

Approving this spec supersedes exactly these prior-phase items:

| Item | Replaced by | Why |
|---|---|---|
| Phase 1.2 Req 10.1–10.7 (Fake say reply) | Req 4, Req 12 | The real pipeline answers turns; the Fake_Reply is deleted (C1). |
| Phase 1.2 Req 14.2 (Fake_Reply is the only TurnResponder; no stub use outside `brain/`) | Req 1.7, Req 21.2 | The Voice_Brain is the TurnResponder; the detector is re-pointed (C1, C21). |
| Phase 1.2 Req 14.5 (stubs throw `not implemented`) | Req 2, Req 3 | Mocks run; the scaffolds refuse with `not_configured` (C7, C21). |
| Phase 1.2 Req 9.6 ("release the frame without keeping, copying or forwarding its bytes") | Req 14.2 | STT needs the bytes; they are handed over inside the handler (C2). |
| Phase 1.2 Req 21.2 (no reference after the handler returns) | Req 14.3 | The Stt_Session holds a bounded per-turn buffer, released at turn end (C2). |
| Phase 1.2 Req 12.1, 12.2 (`GATEWAY_LOG_VERSION` 1; exactly ten kinds) | Req 17.1, 17.2 | Six additive kinds; version 2 (C3). |
| Phase 1.2 Req 18.2 (exactly 50 Synthetic_Frames) | Req 19.2, 19.3 | The upload carries the chosen utterance (C5). |
| Phase 1.2 Req 18.7 (Synthetic_Frames only) | Req 19.4 | Narrowed: frames come from text constants in source; no microphone or audio file (C5). |
| Phase 1.2 Req 22.6 (export-count rise from 144) | Req 21.5 | The count rises again for the new constants (C3). |
| Phase 1.3 Req 2.5 ("leave every Log_Entry type and `GATEWAY_LOG_VERSION` (1) unchanged") | Req 17.1, Req 18.1 | Version 2 and a third stream event (C3, C4). |
| Phase 1.3 Req 3.3 (the gateway service's `command` value) | Req 18.8 | The Transcripts_Argument is added in Compose (C23). |

Everything else in Phases 0, 1, 1.2, 1.3, 2.1 and 2.2 stands unchanged, including every Document B requirement, the Phase 1.2 request guards, the Phase 1.3 read-only console rule and the `.env.example` Panel.

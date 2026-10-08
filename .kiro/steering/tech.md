---
inclusion: always
---
# Xelulu: Tech

## One language
TypeScript everywhere, in strict mode: app, gateway, simulator, shared types and Supabase edge functions (Deno). Firmware (C++/Arduino) belongs to the intern and is outside this repo's build.

## Stack
| Layer | Choice |
|---|---|
| Parent app | React Native + Expo (TypeScript), Expo Router, NativeWind, Reanimated/Moti |
| Character | Rive (primary, state machines for expressions) + Lottie (secondary, simple loops). Rive needs an Expo dev build (`expo-dev-client`), not Expo Go, from Phase 2. |
| Backend | Supabase: Auth, Postgres (RLS), Storage, Realtime, Edge Functions. Client: `supabase-js`. |
| Control plane | MQTT 5 over TLS on EMQX. MQTT.js in the gateway and simulator. |
| Audio plane | Per-turn WebSocket over TLS (`wss`). Opus, 16 kHz mono, 20 ms frames, both directions. |
| Gateway | Node.js (current LTS, pinned in `.nvmrc`), TypeScript. Bridges MQTT/WS to Supabase and the brain. |
| Simulator | Node.js + TypeScript + a small local web control panel. Speaks Document B exactly. |
| Validation | Zod schemas in `packages/shared` for every Document B message. |
| Tests | Vitest + fast-check (property-based testing) for shared, gateway and simulator. jest-expo + React Native Testing Library for the app. |
| Tooling | pnpm workspaces, ESLint + Prettier. Add Turborepo only if builds get slow. |

## ElatoAI reuse (MIT, github.com/akdeb/ElatoAI)
**Fork or adapt:**
- Supabase schema and auth patterns
- Device registry
- OTA flow
- Opus audio handling over WSS
- `firmware-arduino`, which the intern uses

**Add:** MQTT (EMQX) control per Document B. Elato is WS-only.

**Build new:**
- Parent app and cartoon character UI
- Child-safety brain, Grandma mode, stories and content
- Parent controls
- Simulator

Keep Elato's MIT licence notice wherever its code is copied. OpenToys is a secondary reference only.

## Voice brain (inside `services/gateway` for v1)
Pipeline: STT → LLM with guardrails → TTS, streamed end-to-end, with a "let me think" filler if the reply is slow.

Every vendor sits behind an interface:
- `SttProvider`: default Sarvam (hosted). Fallback faster-whisper (self-hosted).
- `LlmProvider`: a hosted model with function calling. Only allow-listed internal tools.
- `TtsProvider`: default Sarvam, alternative ElevenLabs. Self-host options: AI4Bharat Indic-Parler-TTS, IndicF5.

Safety is ours and runs regardless of provider (see `safety.md`). Vendor SDKs never leak past the provider interface.

**Licence checks are required before use:**
- Voice cloning (Coqui XTTS and similar): some models are non-commercial only.
- Every individual Rive/Lottie art file.

## Document B seam (frozen contract, proto_ver 1)
- Document B is the source of truth. If code disagrees with Document B, the code is wrong.
- Changes only happen with a `proto_ver` bump and sign-off from both the software and hardware sides.
- Never invent fields, rename enums or "improve" the wire format.

### Topics
- `xelulu/{device_id}/status`: device → cloud. `hello` on connect, `status` every 15 s.
- `xelulu/{device_id}/event`: device → cloud. Event types: touch, wake, cry, motion, button, nfc, interrupt, error.
- `xelulu/{device_id}/cmd`: cloud → device. Actions: say, animate, gesture, move, play, set_mode, led, volume, config, stop_audio, ota.
- `xelulu/{device_id}/ack`: device → cloud. Status is `accepted|done|rejected|failed`, with a `reason`.
- `xelulu/{device_id}/ota`: subscribed by the device (see the open ambiguity in the approval notes).

### Message rules
- Every message carries `proto_ver`.
- Upstream messages carry `ts` (unix seconds) and `type`.
- Every command carries `cmd_id`, and commands are idempotent.
- Every event carries `event_id`. The cloud dedupes events, including back-dated ones that arrive after the robot was offline.
- QoS: commands use 1; telemetry uses 0 or 1.
- A device is considered offline after 45 s of silence.
- On a `proto_ver` mismatch, the device keeps its last-known-good state and reports the mismatch.

### Audio turns
- Open the socket at `AUDIO_WSS_URL`.
- Send `{type:"audio_start",turn_id}`, then binary Opus frames, then `{type:"audio_end",turn_id}`.
- `say` audio is streamed down the WebSocket, never as a URL.

### Device facts
- Ack `reason` values are the hardware's truth. The cloud must accept them, not retry around them.
- Auth: a device token for the prototype. A per-device certificate and key in ESP32-S3 secure storage for production.
- `device_id` is issued by the cloud at provisioning and bound to exactly one `household_id`.

### Where the types live
`packages/shared/src/gateway-contract/` holds the TypeScript types and Zod schemas generated from Document B, with golden fixtures copied from Document B's examples. Everything imports the contract from there and nowhere else.

## Hardware context (for reasoning, not for code here)
- ESP32-S3 (N16R8) handles voice, face, wake word, cry detection, MQTT and WS.
- A body controller (STM32G0 or RP2040) handles motors, servos, cliff sensors, bumper and hard safety limits, talking to the ESP32-S3 over UART.
- GPIO pins are not part of the contract.

## Hosting
- Local dev: Supabase CLI, plus Docker Compose running EMQX, the gateway and the simulator.
- Hosted: Supabase cloud in the Mumbai region (ap-south-1).
- Gateway: a container on Fly.io in Mumbai (bom), as a provisional choice. Render or Railway are acceptable alternatives.
- Broker: EMQX Cloud, or EMQX self-hosted in the same region.

## Configuration
- Every key and address comes from env vars defined in the root `.env.example`.
- Nothing is hard-coded.
- The app only receives `EXPO_PUBLIC_*` values.
- The app's Device page shows connection status and non-secret values. For secrets it only shows "set" or "not set".

## Testing expectations
- Contract round-trip properties: every Document B message must survive parse(serialise(x)) == x.
- Unknown fields and wrong `proto_ver` must be rejected.
- Dedupe by `event_id`, and idempotency by `cmd_id`.
- The simulator drives the gateway end-to-end in CI. Phase 6 points the same tests at the real robot.
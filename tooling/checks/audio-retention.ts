// No raw child audio is written anywhere (Phase 3 Req 14.4, 21.1; safety.md §1).
//
// This is the STRUCTURAL half of that promise. The behavioural half lives in
// `services/gateway/test/no-audio-retention.test.ts`, which drives real turns and asserts that a
// turn's buffer is released on every exit path and that a sentinel utterance reaches no entry.
//
// The file-writing ban already exists as `findFileWrites` in `service-sources.ts` (Req 21.1), so
// it is reused rather than reimplemented. What this module adds is the second rule: a byte-typed
// value may appear only in the named modules that are ALLOWED to touch a frame. Anywhere else, a
// `Uint8Array` or `Buffer` is a new path for audio to travel, and that has to be a deliberate
// decision rather than an accident.
//
// Matching on the TYPE rather than on an audio-sounding name is deliberate: a frame renamed
// `blob` or `chunk` would slip a name-based scan. The cost of that choice is that it also sees
// byte-typed values that are not audio at all — an MQTT payload, an HTTP body, a hash digest — so
// those modules are declared in a SECOND list, `WIRE_BYTE_MODULES`, kept apart from the audio one
// on purpose: the audio list has to stay short enough to read in one breath, and lumping the
// control plane into it would make "allowed to hold a frame" mean nothing.
//
// THE LIMIT, stated rather than papered over: a scan proves the absence of these SHAPES, not the
// absence of a cleverly obfuscated write. It cannot see through a dynamic import, a computed
// property name or a base64 round-trip. It guards against drift; it is not a proof.
import type { SourceFinding } from "./service-sources.js";

/**
 * The modules allowed to hold a byte-typed audio value. Each is a place a frame legitimately
 * passes through, and the list is short on purpose: every addition is a new path for audio.
 */
export const AUDIO_BYTE_MODULES: readonly string[] = Object.freeze([
  // Gateway: the audio plane, and the providers that consume or produce a frame.
  "services/gateway/src/audio/audio-transport.ts",
  "services/gateway/src/audio/audio-turn.ts",
  "services/gateway/src/audio/audio-server.ts",
  "services/gateway/src/audio/synthetic-frame.ts",
  "services/gateway/src/audio/transport/ws-audio-listener.ts",
  "services/gateway/src/brain/providers/stt-provider.ts",
  "services/gateway/src/brain/providers/mock-stt.ts",
  "services/gateway/src/brain/providers/tts-provider.ts",
  "services/gateway/src/brain/providers/mock-tts.ts",
  "services/gateway/src/brain/filler.ts",
  "services/gateway/src/brain/voice-brain.ts",
  // The reply's sink: `sendFrame` is the one way a synthesised frame leaves the brain.
  "services/gateway/src/brain/turn-responder.ts",
  // Simulator: its upload and its reply counting.
  "services/simulator/src/audio/audio-transport.ts",
  "services/simulator/src/audio/audio-turn-client.ts",
  "services/simulator/src/audio/synthetic-frame.ts",
  "services/simulator/src/audio/transport/ws-audio-client.ts",
]);

/**
 * The modules whose byte-typed value is NOT audio: an MQTT payload, an HTTP request or response
 * body, or a hash digest. None of them is on the audio plane, and none may become so without
 * moving to `AUDIO_BYTE_MODULES` and being argued for there.
 *
 * Why list them at all, rather than narrow the rule to a path under `audio/`? Because the rule's
 * value is that a NEW byte-typed value anywhere in either service fails the build and has to be
 * classified by a human. A path-scoped rule would silently permit the next one.
 */
export const WIRE_BYTE_MODULES: readonly string[] = Object.freeze([
  // Gateway: the MQTT control plane carries a JSON payload as bytes, start to finish.
  "services/gateway/src/gateway.ts",
  "services/gateway/src/mqtt/mqtt-transport.ts",
  "services/gateway/src/mqtt/broker-session.ts",
  "services/gateway/src/mqtt/inbound-pipeline.ts",
  "services/gateway/src/mqtt/transport/mqtt-js-connector.ts",
  // Gateway: the loopback operator console's HTTP bodies, and the device-token digest.
  "services/gateway/src/operator/transport/http-client.ts",
  "services/gateway/src/operator/transport/http-listener.ts",
  "services/gateway/src/devices/registry.ts",
  // Simulator: the same two planes, on its side of the wire.
  "services/simulator/src/mqtt/mqtt-transport.ts",
  "services/simulator/src/mqtt/transport/mqtt-js-connector.ts",
  "services/simulator/src/control/transport/http-client.ts",
  "services/simulator/src/control/transport/http-listener.ts",
]);

/** A byte-typed value: the two shapes a frame can take in this codebase. */
const BYTE_TYPE_RE = /\b(?:Uint8Array|Buffer)\b/;

/** Line and block comments blanked, so a prose mention is never a finding. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, "");
}

/**
 * Every byte-typed value in `source`, by line — unless `path` is an allowed module, in which case
 * there is nothing to report.
 */
export function findAudioByteUse(path: string, source: string): SourceFinding[] {
  const normalised = path.replace(/\\/g, "/");
  if (AUDIO_BYTE_MODULES.includes(normalised) || WIRE_BYTE_MODULES.includes(normalised)) return [];
  return stripComments(source)
    .split(/\r?\n/)
    .flatMap((line, i) =>
      BYTE_TYPE_RE.test(line) ? [{ path, lineNo: i + 1, rule: "audio_bytes" }] : [],
    );
}

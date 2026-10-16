// Log redaction through the composed gateway (Req 12.5, 12.10): Property 10. Inbound hellos,
// statuses, events of every kind, acks and audio markers (valid, or made invalid with sentinel
// keys and values), plus operator-sent commands with sentinel free-text values, go through the
// gateway; no Log_Entry and no stdout line may hold any sentinel. The device token is a sentinel
// too, so hellos with the right `auth` keep the device trusted while carrying a sentinel.
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

import {
  CMD_ACTIONS,
  PLAY_SOURCES,
  serialiseAudioEndMessage,
  serialiseAudioStartMessage,
} from "@xelulu/shared";

import {
  audioEndArb,
  audioStartArb,
  idArb,
  sentinelArb,
  SENTINEL_PREFIX,
  unknownKeyArb,
  validInboundArb,
} from "./support/arbitraries.js";
import {
  flush,
  HARNESS_DEVICE_ID,
  startHarness,
  stringsIn,
  type Harness,
} from "./support/gateway-harness.js";

type Mutation =
  | { readonly how: "none" }
  | { readonly how: "unknown_key"; readonly key: string; readonly value: string }
  | { readonly how: "replace"; readonly pick: number; readonly value: string }
  | { readonly how: "unknown_data_key"; readonly key: string; readonly value: string };

const mutationArb: fc.Arbitrary<Mutation> = fc.oneof(
  fc.constant({ how: "none" as const }),
  fc.record({
    how: fc.constant("unknown_key" as const),
    key: fc.oneof(sentinelArb, unknownKeyArb),
    value: sentinelArb,
  }),
  fc.record({ how: fc.constant("replace" as const), pick: fc.nat(), value: sentinelArb }),
  fc.record({
    how: fc.constant("unknown_data_key" as const),
    key: fc.oneof(sentinelArb, unknownKeyArb),
    value: sentinelArb,
  }),
);

const IDENTIFIER_KEYS: ReadonlySet<string> = new Set(["event_id", "cmd_id", "turn_id"]);

/** Applies one mutation to a serialised JSON object. */
function mutate(json: string, m: Mutation): string {
  if (m.how === "none") return json;
  const obj = JSON.parse(json) as Record<string, unknown>;
  switch (m.how) {
    case "unknown_key":
      obj[m.key] = m.value;
      break;
    case "replace": {
      // Identifiers are logged by design (G21), so they are never replaced with a sentinel.
      const keys = Object.keys(obj).filter((k) => !IDENTIFIER_KEYS.has(k));
      const key = keys[m.pick % keys.length];
      if (key !== undefined) obj[key] = m.value;
      break;
    }
    case "unknown_data_key": {
      const data = obj["data"];
      if (data !== null && typeof data === "object") {
        (data as Record<string, unknown>)[m.key] = m.value;
      } else {
        obj[m.key] = m.value;
      }
      break;
    }
  }
  return JSON.stringify(obj);
}

type Item =
  | { readonly kind: "mqtt"; readonly topic: string; readonly payload: string }
  | { readonly kind: "audio"; readonly texts: readonly string[]; readonly frames: number }
  | { readonly kind: "command"; readonly action: string; readonly data: unknown };

function mqttItemArb(token: string): fc.Arbitrary<Item> {
  return fc
    .tuple(
      validInboundArb(HARNESS_DEVICE_ID, { auth: fc.oneof(fc.constant(token), sentinelArb) }),
      mutationArb,
    )
    .map(([c, m]): Item => ({ kind: "mqtt", topic: c.topic, payload: mutate(c.payload, m) }));
}

const audioItemArb: fc.Arbitrary<Item> = fc
  .tuple(idArb, audioStartArb, audioEndArb, mutationArb, mutationArb, fc.nat({ max: 3 }))
  .map(([turnId, start, end, mStart, mEnd, frames]): Item => ({
    kind: "audio",
    texts: [
      mutate(serialiseAudioStartMessage({ ...start, turn_id: turnId }), mStart),
      mutate(serialiseAudioEndMessage({ ...end, turn_id: turnId }), mEnd),
    ],
    frames,
  }));

/** Operator commands with sentinel free-text values (valid) or sentinel keys (invalid). */
const commandItemArb: fc.Arbitrary<Item> = fc.oneof(
  sentinelArb.map((s): Item => ({
    kind: "command",
    action: "say",
    data: { expression: s, lang: "en-IN", voice: "xelulu", duration_hint_ms: 500 },
  })),
  fc.tuple(sentinelArb, sentinelArb).map(([a, b]): Item => ({
    kind: "command",
    action: "animate",
    data: { expression: a, eyes: b, loop: false },
  })),
  sentinelArb.map((s): Item => ({ kind: "command", action: "gesture", data: { name: s } })),
  fc.tuple(sentinelArb, fc.constantFrom(...PLAY_SOURCES)).map(([s, source]): Item => ({
    kind: "command",
    action: "play",
    data: { content_id: s, source },
  })),
  sentinelArb.map((s): Item => ({
    kind: "command",
    action: "config",
    data: { active_child_id: s },
  })),
  sentinelArb.map((s): Item => ({
    kind: "command",
    action: "ota",
    data: { manifest_url: "https" + "://" + "updates.invalid/" + s },
  })),
  fc
    .tuple(fc.constantFrom(...CMD_ACTIONS), fc.oneof(sentinelArb, unknownKeyArb), sentinelArb)
    .map(([action, key, value]): Item => ({ kind: "command", action, data: { [key]: value } })),
);

function itemsArb(token: string): fc.Arbitrary<Item[]> {
  return fc.array(fc.oneof(mqttItemArb(token), audioItemArb, commandItemArb), {
    minLength: 1,
    maxLength: 6,
  });
}

function terminalTurns(h: Harness): number {
  return h.entries.filter(
    (e) => e.kind === "audio_turn" && (e.phase === "aborted" || e.phase === "reply_ended"),
  ).length;
}

async function run(h: Harness, item: Item): Promise<void> {
  switch (item.kind) {
    case "mqtt":
      await h.device.publishRaw(item.topic, item.payload);
      await flush();
      return;
    case "command":
      h.gateway.sendCommand({ device_id: HARNESS_DEVICE_ID, action: item.action, data: item.data });
      await flush();
      return;
    case "audio": {
      const before = terminalTurns(h);
      const opened = await h.device.openAudio(h.gateway.audioPort());
      if (opened.kind !== "open") throw new Error("audio upgrade refused");
      const [start, end] = item.texts;
      if (start !== undefined) opened.audio.sendText(start);
      for (let i = 0; i < item.frames; i++) opened.audio.sendFrame();
      if (end !== undefined) opened.audio.sendText(end);
      opened.audio.close();
      await opened.audio.closed;
      await vi.waitFor(() => {
        expect(terminalTurns(h)).toBe(before + 1);
      });
      return;
    }
  }
}

describe("log redaction", () => {
  // Feature: phase-1-2-gateway-simulator, Property 10: Forbidden wire values never reach the log
  it("never writes a forbidden wire value to a Log_Entry or a stdout line", async () => {
    await fc.assert(
      fc.asyncProperty(
        sentinelArb.chain((token) => fc.tuple(fc.constant(token), itemsArb(token))),
        async ([token, items]) => {
          const h = await startHarness({ token });
          try {
            await h.online();
            for (const item of items) await run(h, item);
          } finally {
            await h.stop();
          }
          for (const s of stringsIn(h.entries)) expect(s).not.toContain(SENTINEL_PREFIX);
          for (const line of h.sink.lines) expect(line).not.toContain(SENTINEL_PREFIX);
          expect(h.sink.lines.join("\n")).not.toContain(token);
        },
      ),
      { numRuns: 100 },
    );
  });
});

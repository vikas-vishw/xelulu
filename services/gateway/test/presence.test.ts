// Presence: Property 5, model-based (Req 6.1–6.7). The pure presence module is driven with the
// manual test clock and the real deadline scheduler; `fireDue(t)` runs before every input, exactly
// as the gateway does before handling an inbound message.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { createDeadlines } from "../src/deadlines.js";
import {
  createPresence,
  SILENCE_WINDOW_MS,
  type PresenceChange,
  type PresenceState,
} from "../src/devices/presence.js";
import { createTestClock } from "./support/test-clock.js";

type Input = {
  readonly gap: number;
  readonly device: number;
  /** hello and status are Heartbeats; event, ack and invalid never change Presence; query reads it. */
  readonly what: "hello" | "status" | "event" | "ack" | "invalid" | "query";
};

const gapArb = fc.oneof(
  fc.constantFrom(0, 1, 44_999, 45_000, 45_001),
  fc.integer({ min: 0, max: 100_000 }),
);

const inputArb = (devices: number): fc.Arbitrary<Input> =>
  fc.record({
    gap: gapArb,
    device: fc.integer({ min: 0, max: devices - 1 }),
    what: fc.constantFrom(
      "hello" as const,
      "status" as const,
      "event" as const,
      "ack" as const,
      "invalid" as const,
      "query" as const,
    ),
  });

const scenarioArb = fc
  .integer({ min: 1, max: 2 })
  .chain((devices) =>
    fc.tuple(fc.constant(devices), fc.array(inputArb(devices), { maxLength: 80 })),
  );

type ModelDevice = { state: PresenceState; last: number | null; lastIdx: number };

describe("presence", () => {
  // Feature: phase-1-2-gateway-simulator, Property 5: Presence agrees with the silence-window model
  // **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7**
  it("agrees with the silence-window model in state and in its entries", () => {
    fc.assert(
      fc.property(scenarioArb, ([deviceCount, inputs]) => {
        const ids = Array.from({ length: deviceCount }, (_, k) => `xlu_00000${k}`);
        const clock = createTestClock(1_700_000_000_000);
        const deadlines = createDeadlines(clock);
        const entries: PresenceChange[] = [];
        const presence = createPresence({ deadlines, onSilence: (c) => entries.push(c) });

        const model = ids.map((): ModelDevice => ({ state: "unknown", last: null, lastIdx: -1 }));
        const modelEntries: PresenceChange[] = [];
        let t = clock.now();

        /** Every silence timer due at or before t fires first, in (due time, scheduling) order. */
        function modelExpire(now: number): void {
          const due = model
            .map((m, k) => ({ m, k }))
            .filter(
              ({ m }) =>
                m.state === "online" && m.last !== null && m.last + SILENCE_WINDOW_MS <= now,
            )
            .sort((a, b) => (a.m.last ?? 0) - (b.m.last ?? 0) || a.m.lastIdx - b.m.lastIdx);
          for (const { m, k } of due) {
            m.state = "offline";
            modelEntries.push({
              kind: "presence",
              device_id: ids[k] ?? "",
              state: "offline",
              cause: "silence",
            });
          }
        }

        /** The definition of Requirement 6.5, independent of the state machine. */
        function definitional(m: ModelDevice, now: number): PresenceState {
          if (m.last === null) return "unknown";
          return now - m.last < SILENCE_WINDOW_MS ? "online" : "offline";
        }

        inputs.forEach((input, idx) => {
          t += input.gap;
          clock.set(t);
          deadlines.fireDue(t);
          modelExpire(t);

          const id = ids[input.device] ?? "";
          const m = model[input.device];
          if (m === undefined) return;

          if (input.what === "hello" || input.what === "status") {
            const change = presence.heartbeat(id, t, input.what);
            if (change !== null) entries.push(change);
            if (m.state !== "online") {
              modelEntries.push({
                kind: "presence",
                device_id: id,
                state: "online",
                cause: input.what,
              });
            }
            m.state = "online";
            m.last = t;
            m.lastIdx = idx;
          } else if (input.what === "query") {
            for (let k = 0; k < ids.length; k++) {
              const mk = model[k];
              if (mk === undefined) continue;
              expect(presence.state(ids[k] ?? "")).toBe(mk.state);
              expect(presence.state(ids[k] ?? "")).toBe(definitional(mk, t));
              expect(presence.lastHeartbeatAt(ids[k] ?? "")).toBe(mk.last);
            }
          }
          // event, ack and invalid: only fireDue ran, Presence must not change.
        });

        // Final query after one more full window, so every pending silence has fired.
        t += SILENCE_WINDOW_MS;
        clock.set(t);
        deadlines.fireDue(t);
        modelExpire(t);
        ids.forEach((id, k) => {
          const mk = model[k];
          if (mk !== undefined) expect(presence.state(id)).toBe(definitional(mk, t));
        });

        expect(entries).toEqual(modelEntries);
        // Never unknown -> offline: each device's first entry is an online one.
        for (const id of ids) {
          const first = entries.find((e) => e.device_id === id);
          if (first !== undefined) expect(first.state).toBe("online");
        }
      }),
      { numRuns: 300 },
    );
  });
});

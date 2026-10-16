// Dedupe store: Properties 6 and 7, eviction and expiry examples (Req 7.1–7.11).
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { EventMessage } from "@xelulu/shared";

import { isoAt } from "../src/clock.js";
import {
  createDedupeStore,
  createDeviceDedupe,
  DEDUPE_EXPIRY_MS,
  DEDUPE_MAX_PAIRS,
  observeEvent,
  type EventLogFields,
} from "../src/devices/dedupe-store.js";
import { eventArb } from "./support/arbitraries.js";

const START = 1_700_000_000_000;
const DEVICE_IDS = ["xlu_000001", "xlu_000002", "xlu_000003"] as const;

type Arrival = { readonly device: number; readonly gap: number; readonly message: EventMessage };

/** Repeated event_ids from a small pool, repeats with other ts, kind, data and time_uncertain. */
const arrivalArb: fc.Arbitrary<Arrival> = fc.record({
  device: fc.integer({ min: 0, max: DEVICE_IDS.length - 1 }),
  gap: fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 1_000_000 })),
  message: eventArb({
    eventId: fc.constantFrom(...Array.from({ length: 12 }, (_, k) => `ev_${k}`)),
    ts: fc.oneof(fc.integer({ min: 0, max: 20 }), fc.constant(1_800_000_000)),
  }),
});

/** Test-local projection of Requirement 12.4, independent of src/devices/event-log-data.ts. */
function expectedLogged(m: EventMessage): { event: string; data: Record<string, unknown> } {
  switch (m.event) {
    case "touch":
      return { event: m.event, data: { zone: m.data.zone, gesture: m.data.gesture } };
    case "wake":
      return { event: m.event, data: { source: m.data.source } };
    case "motion":
      return { event: m.event, data: { event: m.data.event } };
    case "button":
      return { event: m.event, data: { button: m.data.button, action: m.data.action } };
    default:
      return { event: m.event, data: {} };
  }
}

type ModelDevice = {
  seen: Set<string>;
  highest: number | null;
  accepted: number;
  duplicates: number;
};

function runModel(arrivals: readonly Arrival[], start: number) {
  const devices = DEVICE_IDS.map((): ModelDevice => ({
    seen: new Set(),
    highest: null,
    accepted: 0,
    duplicates: 0,
  }));
  const entries: unknown[] = [];
  let now = start;
  for (const a of arrivals) {
    now += a.gap;
    const d = devices[a.device];
    if (d === undefined) continue;
    const m = a.message;
    const first = !d.seen.has(m.event_id);
    const backDated = first && d.highest !== null && m.ts < d.highest;
    if (first) {
      d.seen.add(m.event_id);
      d.highest = d.highest === null ? m.ts : Math.max(d.highest, m.ts);
      d.accepted += 1;
    } else {
      d.duplicates += 1;
    }
    const uncertain = m.time_uncertain === true;
    entries.push({
      kind: first ? "event_accepted" : "event_duplicate",
      device_id: DEVICE_IDS[a.device],
      event_id: m.event_id,
      time_uncertain: uncertain,
      back_dated: backDated,
      ordering: uncertain ? "approximate" : "device_ts",
      device_ts: m.ts,
      received_at: isoAt(now),
      ...expectedLogged(m),
    });
  }
  return { devices, entries, end: now };
}

function runStore(
  store: ReturnType<typeof createDedupeStore>,
  arrivals: readonly Arrival[],
  start: number,
): { entries: EventLogFields[]; end: number } {
  const entries: EventLogFields[] = [];
  let now = start;
  for (const a of arrivals) {
    now += a.gap;
    entries.push(store.process(DEVICE_IDS[a.device] ?? "", a.message, now));
  }
  return { entries, end: now };
}

describe("dedupe store", () => {
  // Feature: phase-1-2-gateway-simulator, Property 6: Dedupe agrees with the set model
  // **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.9, 7.11**
  it("accepts each distinct pair once, counts the rest as duplicates, and logs what the model logs", () => {
    fc.assert(
      fc.property(fc.array(arrivalArb, { maxLength: 200 }), (arrivals) => {
        const store = createDedupeStore();
        const got = runStore(store, arrivals, START);
        const model = runModel(arrivals, START);

        expect(got.entries).toEqual(model.entries);
        DEVICE_IDS.forEach((id, k) => {
          const d = store.forDevice(id);
          const m = model.devices[k];
          if (m === undefined) return;
          expect(new Set(d.pairs.keys())).toEqual(m.seen);
          expect(d.accepted).toBe(m.seen.size);
          expect(d.duplicates).toBe(arrivals.filter((a) => a.device === k).length - m.seen.size);
          expect(d.highestTs).toBe(m.highest);
        });
      }),
      { numRuns: 200 },
    );
  });

  // Feature: phase-1-2-gateway-simulator, Property 7: Reprocessing a sequence only adds duplicates
  // **Validates: Requirements 7.10**
  it("processing the same sequence again leaves the accepted set alone and adds only duplicates", () => {
    fc.assert(
      fc.property(fc.array(arrivalArb, { maxLength: 200 }), (arrivals) => {
        const store = createDedupeStore();
        const first = runStore(store, arrivals, START);
        const snapshot = DEVICE_IDS.map((id) => {
          const d = store.forDevice(id);
          return { pairs: new Set(d.pairs.keys()), accepted: d.accepted, duplicates: d.duplicates };
        });

        const second = runStore(store, arrivals, first.end);
        expect(second.entries.every((e) => e.kind === "event_duplicate")).toBe(true);
        DEVICE_IDS.forEach((id, k) => {
          const d = store.forDevice(id);
          const before = snapshot[k];
          if (before === undefined) return;
          expect(new Set(d.pairs.keys())).toEqual(before.pairs);
          expect(d.accepted).toBe(before.accepted);
          expect(d.duplicates).toBe(
            before.duplicates + arrivals.filter((a) => a.device === k).length,
          );
        });
      }),
      { numRuns: 200 },
    );
  });

  it("evicts the earliest pair when the 10,001st is added, leaving the counts unchanged", () => {
    const d = createDeviceDedupe();
    for (let k = 0; k <= DEDUPE_MAX_PAIRS; k++) {
      expect(observeEvent(d, `ev_${k}`, 100, START + k).kind).toBe("accepted");
    }
    expect(d.pairs.size).toBe(DEDUPE_MAX_PAIRS);
    expect(d.pairs.has("ev_0")).toBe(false);
    expect(d.pairs.has("ev_1")).toBe(true);
    expect(d.accepted).toBe(DEDUPE_MAX_PAIRS + 1);
    expect(d.duplicates).toBe(0);

    // The evicted id is new again and evicts the next earliest.
    expect(observeEvent(d, "ev_0", 100, START + DEDUPE_MAX_PAIRS + 1).kind).toBe("accepted");
    expect(d.pairs.has("ev_1")).toBe(false);
    expect(d.pairs.size).toBe(DEDUPE_MAX_PAIRS);
    // A pair still held is a duplicate.
    expect(observeEvent(d, "ev_2", 100, START + DEDUPE_MAX_PAIRS + 2).kind).toBe("duplicate");
  });

  it("keeps highestTs when the pair that set it is evicted", () => {
    const d = createDeviceDedupe();
    observeEvent(d, "ev_high", 1_000, START);
    for (let k = 0; k < DEDUPE_MAX_PAIRS; k++) {
      expect(observeEvent(d, `ev_${k}`, 1, START + 1 + k)).toEqual({
        kind: "accepted",
        backDated: true,
      });
    }
    expect(d.pairs.has("ev_high")).toBe(false);
    expect(d.highestTs).toBe(1_000);
    expect(observeEvent(d, "ev_new", 500, START + DEDUPE_MAX_PAIRS + 1)).toEqual({
      kind: "accepted",
      backDated: true,
    });
  });

  it("treats a repeat 604,799,999 ms after first acceptance as a duplicate", () => {
    const d = createDeviceDedupe();
    observeEvent(d, "ev_x", 10, START);
    expect(observeEvent(d, "ev_x", 10, START + DEDUPE_EXPIRY_MS - 1)).toEqual({
      kind: "duplicate",
    });
    expect(d.accepted).toBe(1);
    expect(d.duplicates).toBe(1);
  });

  it("accepts a repeat 604,800,000 ms after first acceptance as new", () => {
    const d = createDeviceDedupe();
    observeEvent(d, "ev_x", 10, START);
    expect(observeEvent(d, "ev_x", 10, START + DEDUPE_EXPIRY_MS)).toEqual({
      kind: "accepted",
      backDated: false,
    });
    expect(d.accepted).toBe(2);
    expect(d.duplicates).toBe(0);
    expect(d.pairs.get("ev_x")).toBe(START + DEDUPE_EXPIRY_MS);
  });
});

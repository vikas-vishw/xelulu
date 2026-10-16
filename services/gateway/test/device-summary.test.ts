// Device_Summaries (Phase 1.3 C3, Req 2.2, 2.3): example-based (C15). Built from the real presence,
// dedupe store and Status_Memory, with the manual test clock.
import type { EventMessage } from "@xelulu/shared";
import { describe, expect, it } from "vitest";

import { isoAt } from "../src/clock.js";
import { createDeadlines } from "../src/deadlines.js";
import { createDedupeStore } from "../src/devices/dedupe-store.js";
import { createPresence } from "../src/devices/presence.js";
import {
  buildDeviceSummaries,
  createStatusMemory,
  type SummarySources,
} from "../src/operator/device-summary.js";
import { createTestClock } from "./support/test-clock.js";

const DEVICE = "xlu_000123";
const OTHER = "xlu_000456";

function sources(): SummarySources & {
  presence: ReturnType<typeof createPresence>;
  dedupe: ReturnType<typeof createDedupeStore>;
  status: ReturnType<typeof createStatusMemory>;
} {
  const clock = createTestClock();
  return {
    deviceIds: [DEVICE, OTHER],
    presence: createPresence({ deadlines: createDeadlines(clock), onSilence: () => undefined }),
    dedupe: createDedupeStore(),
    status: createStatusMemory(),
  };
}

function touch(eventId: string): EventMessage {
  return {
    proto_ver: 2,
    ts: 1_792_490_401,
    type: "event",
    event: "touch",
    event_id: eventId,
    data: { zone: "belly", gesture: "tap" },
  };
}

describe("buildDeviceSummaries", () => {
  it("gives null battery, charging and heartbeat before any status, in deviceIds order", () => {
    const summaries = buildDeviceSummaries(sources());
    expect(summaries).toEqual([
      {
        device_id: DEVICE,
        presence: "unknown",
        last_heartbeat_at: null,
        battery_pct: null,
        charging: null,
        events_accepted: 0,
        events_duplicate: 0,
      },
      {
        device_id: OTHER,
        presence: "unknown",
        last_heartbeat_at: null,
        battery_pct: null,
        charging: null,
        events_accepted: 0,
        events_duplicate: 0,
      },
    ]);
  });

  it("carries the latest recorded status values for that device only", () => {
    const src = sources();
    src.status.record(DEVICE, 100, false);
    src.status.record(DEVICE, 87, true);
    const [mine, other] = buildDeviceSummaries(src);
    expect(mine).toMatchObject({ device_id: DEVICE, battery_pct: 87, charging: true });
    expect(other).toMatchObject({ device_id: OTHER, battery_pct: null, charging: null });
    expect(src.status.latest(OTHER)).toBeNull();
  });

  it("reads presence, last heartbeat and event counts from the sources", () => {
    const src = sources();
    const at = 1_792_490_400_000;
    src.presence.heartbeat(DEVICE, at, "hello");
    src.dedupe.process(DEVICE, touch("ev_1"), at);
    src.dedupe.process(DEVICE, touch("ev_1"), at);
    src.dedupe.process(DEVICE, touch("ev_2"), at);
    const [mine, other] = buildDeviceSummaries(src);
    expect(mine).toMatchObject({
      presence: "online",
      last_heartbeat_at: isoAt(at),
      events_accepted: 2,
      events_duplicate: 1,
    });
    expect(other).toMatchObject({ presence: "unknown", last_heartbeat_at: null });
  });

  it("returns frozen summaries in a frozen list", () => {
    const src = sources();
    src.status.record(DEVICE, 50, false);
    const summaries = buildDeviceSummaries(src);
    expect(Object.isFrozen(summaries)).toBe(true);
    for (const s of summaries) expect(Object.isFrozen(s)).toBe(true);
    expect(Object.keys(summaries[0] ?? {}).sort()).toEqual(
      [
        "battery_pct",
        "charging",
        "device_id",
        "events_accepted",
        "events_duplicate",
        "last_heartbeat_at",
        "presence",
      ].sort(),
    );
  });
});

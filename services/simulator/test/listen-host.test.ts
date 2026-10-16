// Property 4: the listen-host decision for the Control_Surface (Req 3.2, 10.3), as examples: the
// four-case table, the exact Listen_All_Argument match, and the host the harness records in both
// modes with and without `listenAllInterfaces`. Harnesses are stopped after each test, which
// closes any listener bound on 0.0.0.0.
import { afterEach, describe, expect, it } from "vitest";

import { LISTEN_ALL_ARGUMENT, hasListenAllArgument, localSurfaceHost } from "../src/listen-host.js";
import { startSimHarness, type SimHarness } from "./support/sim-harness.js";

let running: SimHarness[] = [];

afterEach(async () => {
  for (const h of running) await h.stop();
  running = [];
});

describe("localSurfaceHost", () => {
  it.each([
    [true, true, "0.0.0.0"],
    [true, false, "127.0.0.1"],
    [false, true, "127.0.0.1"],
    [false, false, "127.0.0.1"],
  ] as const)("Local_Mode %s, argument %s gives %s", (localMode, listenAll, host) => {
    expect(localSurfaceHost(localMode, listenAll)).toBe(host);
  });
});

describe("hasListenAllArgument", () => {
  it("matches only the exact argument", () => {
    expect(LISTEN_ALL_ARGUMENT).toBe("--listen-all-interfaces");
    expect(hasListenAllArgument(["--other", LISTEN_ALL_ARGUMENT])).toBe(true);
    expect(hasListenAllArgument([])).toBe(false);
    expect(hasListenAllArgument(["--listen-all-interfaces=true"])).toBe(false);
    expect(hasListenAllArgument(["--listen-all"])).toBe(false);
  });
});

describe("Control_Surface listen host", () => {
  it.each([
    [true, undefined, "127.0.0.1"],
    [true, true, "0.0.0.0"],
    [false, undefined, "127.0.0.1"],
    [false, true, "127.0.0.1"],
  ] as const)("Local_Mode %s, option %s binds %s", async (localMode, listenAllInterfaces, host) => {
    // Outside Local_Mode the audio URL must be wss; no turn is started here.
    const audioUrlOverride = localMode ? undefined : "wss" + "://" + "127.0.0.1:1";
    const h = await startSimHarness({
      localMode,
      audioUrlOverride,
      ...(listenAllInterfaces === undefined ? {} : { listenAllInterfaces }),
    });
    running.push(h);
    expect(h.controlListens).toEqual([{ host, port: 0 }]);
    expect(h.sim.controlPort()).not.toBeNull();
  });
});

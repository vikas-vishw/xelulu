// Property 4: the listen-host decision for the Operator_Surface (Req 3.1, 10.3), as examples: the
// four-case table, the exact Listen_All_Argument match, and the host the harness records with and
// without `listenAllInterfaces`. Harnesses are stopped after each test, which closes any listener
// bound on 0.0.0.0.
import { afterEach, describe, expect, it } from "vitest";

import {
  DEVICE_CONTROL_ARGUMENT,
  LISTEN_ALL_ARGUMENT,
  deviceControlEnabled,
  hasListenAllArgument,
  localSurfaceHost,
} from "../src/listen-host.js";
import { startHarness, type Harness, type HarnessOptions } from "./support/gateway-harness.js";

let running: Harness[] = [];

afterEach(async () => {
  for (const h of running) await h.stop();
  running = [];
});

async function harness(opts: HarnessOptions): Promise<Harness> {
  const h = await startHarness(opts);
  running.push(h);
  return h;
}

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
    expect(hasListenAllArgument([LISTEN_ALL_ARGUMENT])).toBe(true);
    expect(hasListenAllArgument(["--other", LISTEN_ALL_ARGUMENT])).toBe(true);
    expect(hasListenAllArgument([])).toBe(false);
    expect(hasListenAllArgument(["--listen-all-interfaces=true"])).toBe(false);
    expect(hasListenAllArgument(["--listen-all"])).toBe(false);
    expect(hasListenAllArgument(["--LISTEN-ALL-INTERFACES"])).toBe(false);
    expect(hasListenAllArgument(["listen-all-interfaces"])).toBe(false);
  });
});

describe("deviceControlEnabled (Phase 6 Req 5.2, C11)", () => {
  it.each([
    [true, [DEVICE_CONTROL_ARGUMENT], true],
    [true, [], false],
    // Outside Local_Mode the argument is ignored entirely: a hosted gateway cannot be given a
    // command console by adding a flag to its command line.
    [false, [DEVICE_CONTROL_ARGUMENT], false],
    [false, [], false],
  ] as const)("Local_Mode %s with %j gives %s", (localMode, argv, expected) => {
    expect(deviceControlEnabled(localMode, argv)).toBe(expected);
  });

  it("matches only the exact argument, and is not the content flag", () => {
    expect(DEVICE_CONTROL_ARGUMENT).toBe("--device-control");
    expect(deviceControlEnabled(true, ["--other", DEVICE_CONTROL_ARGUMENT])).toBe(true);
    expect(deviceControlEnabled(true, ["--device-control=true"])).toBe(false);
    expect(deviceControlEnabled(true, ["--device"])).toBe(false);
    expect(deviceControlEnabled(true, ["--DEVICE-CONTROL"])).toBe(false);
    expect(deviceControlEnabled(true, ["device-control"])).toBe(false);
    // Editing content and firing commands are different powers (C11).
    expect(deviceControlEnabled(true, ["--content-admin"])).toBe(false);
  });
});

describe("Operator_Surface listen host", () => {
  it("binds 127.0.0.1 in Local_Mode without the option", async () => {
    const h = await harness({ localMode: true });
    expect(h.operatorListens).toEqual([{ host: "127.0.0.1", port: 0 }]);
    expect(h.gateway.operatorPort()).not.toBeNull();
  });

  it("binds 0.0.0.0 in Local_Mode with the option", async () => {
    const h = await harness({ localMode: true, listenAllInterfaces: true });
    expect(h.operatorListens).toEqual([{ host: "0.0.0.0", port: 0 }]);
    expect(h.gateway.operatorPort()).not.toBeNull();
  });

  it.each([false, true])(
    "opens no listener outside Local_Mode (option %s)",
    async (listenAllInterfaces) => {
      const h = await harness({ localMode: false, listenAllInterfaces });
      expect(h.operatorListens).toEqual([]);
      expect(h.gateway.operatorPort()).toBeNull();
    },
  );
});

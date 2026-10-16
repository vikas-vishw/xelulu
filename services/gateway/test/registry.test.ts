// One-device registry examples (Req 5.1–5.4, 5.7, 9.2).
import { describe, expect, it } from "vitest";

import { createRegistry } from "../src/devices/registry.js";

const DEVICE = { deviceId: "xlu_000123", token: "device-token-abcdef" } as const;

describe("registry", () => {
  it("registers exactly DEVICE_ID and starts unmarked with no hello seen", () => {
    const r = createRegistry(DEVICE);
    expect(r.isRegistered("xlu_000123")).toBe(true);
    expect(r.isRegistered("xlu_000124")).toBe(false);
    expect(r.isAuthFailed("xlu_000123")).toBe(false);
    expect(r.helloSeen("xlu_000123")).toBe(false);
  });

  it("marks auth_failed on a wrong or differently sized auth and clears it on a match", () => {
    const r = createRegistry(DEVICE);
    expect(r.checkHello("xlu_000123", "device-token-abcdeX")).toBe("failed");
    expect(r.isAuthFailed("xlu_000123")).toBe(true);
    expect(r.helloSeen("xlu_000123")).toBe(true);
    expect(r.checkHello("xlu_000123", "device-token-abcdef-longer")).toBe("failed");
    expect(r.isAuthFailed("xlu_000123")).toBe(true);
    expect(r.checkHello("xlu_000123", "device-token-abcdef")).toBe("ok");
    expect(r.isAuthFailed("xlu_000123")).toBe(false);
  });

  it("maps a bearer token to the device only when it matches exactly", () => {
    const r = createRegistry(DEVICE);
    expect(r.deviceForToken("device-token-abcdef")).toBe("xlu_000123");
    expect(r.deviceForToken("device-token-abcde")).toBeNull();
    expect(r.deviceForToken("")).toBeNull();
  });
});

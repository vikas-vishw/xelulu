// Pairing_Code and Device_Session (Document C Part 2; Phase 6 Req 2.1–2.4, 8.1).
// Property 1: the Pairing_Code is a pure derivation. Property 2: the Device_Session is total.
// Both are pure modules, so neither test needs a clock, a broker or a socket.
import { DEVICE_SESSION_STATES, type DeviceSessionState } from "@xelulu/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  createDeviceSessions,
  nextSession,
  type DeviceSessionInput,
} from "../src/devices/device-session.js";
import {
  PAIRING_CODE_ALPHABET,
  PAIRING_CODE_LENGTH,
  pairingCode,
} from "../src/devices/pairing-code.js";

const DEVICE = "xlu_000123";
const FW_VER = "0.1.0";

const states: readonly DeviceSessionState[] = DEVICE_SESSION_STATES;

/** Every Device_Session_Input shape, exactly once per constructor. */
const INPUTS: readonly DeviceSessionInput[] = Object.freeze([
  { kind: "hello", accepted: true },
  { kind: "hello", accepted: false },
  { kind: "heartbeat" },
  { kind: "turn_open" },
  { kind: "turn_closed" },
  { kind: "device_error" },
  { kind: "message_rejected" },
  { kind: "silence" },
]);

const anyState = (): fc.Arbitrary<DeviceSessionState> => fc.constantFrom(...states);
const anyInput = (): fc.Arbitrary<DeviceSessionInput> => fc.constantFrom(...INPUTS);

describe("Pairing_Code (Property 1, Req 2.1)", () => {
  it("is six characters of the alphabet for any device id and firmware version", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.string({ minLength: 1 }), (deviceId, fwVer) => {
        const code = pairingCode(deviceId, fwVer);
        expect(code).toHaveLength(PAIRING_CODE_LENGTH);
        for (const ch of code) expect(PAIRING_CODE_ALPHABET).toContain(ch);
      }),
    );
  });

  it("gives the same code for equal inputs and only changes when an input changes", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.string({ minLength: 1 }), (deviceId, fwVer) => {
        expect(pairingCode(deviceId, fwVer)).toBe(pairingCode(deviceId, fwVer));
      }),
    );
  });

  it("never carries a vowel, so no code reads as a word", () => {
    for (const vowel of ["A", "E", "I", "O", "U"]) {
      expect(PAIRING_CODE_ALPHABET).not.toContain(vowel);
    }
  });

  it("separates the two arguments, so a shifted boundary is a different code", () => {
    // Without the NUL join, ("xlu_00", "01.0") and ("xlu_0", "001.0") would hash the same string.
    expect(pairingCode("xlu_00", "01.0")).not.toBe(pairingCode("xlu_0", "001.0"));
  });
});

describe("Device_Session totality (Property 2, Req 2.3)", () => {
  it("answers every state and every input with a Device_Session_State", () => {
    fc.assert(
      fc.property(anyState(), anyInput(), (state, input) => {
        expect(states).toContain(nextSession(state, input));
      }),
    );
  });

  it("keeps the state a Device_Session_State for any sequence of inputs", () => {
    fc.assert(
      fc.property(anyState(), fc.array(anyInput(), { maxLength: 40 }), (start, inputs) => {
        const end = inputs.reduce(nextSession, start);
        expect(states).toContain(end);
      }),
    );
  });
});

describe("Device_Session transitions (Document C Part 2, Req 2.2)", () => {
  it("takes any state to connected on an accepted hello", () => {
    for (const state of states) {
      expect(nextSession(state, { kind: "hello", accepted: true })).toBe("connected");
    }
  });

  it("takes any state to error on a hello whose auth failed", () => {
    for (const state of states) {
      expect(nextSession(state, { kind: "hello", accepted: false })).toBe("error");
    }
  });

  it("leaves unpaired unchanged for every input but a hello", () => {
    for (const input of INPUTS) {
      if (input.kind === "hello") continue;
      expect(nextSession("unpaired", input)).toBe("unpaired");
    }
  });

  it("takes connected, idle, in_turn and error to idle on a Heartbeat", () => {
    for (const state of ["connected", "idle", "in_turn", "error"] as const) {
      expect(nextSession(state, { kind: "heartbeat" })).toBe("idle");
    }
  });

  it("does not clear offline on a bare Heartbeat: Document B requires a hello on connect", () => {
    expect(nextSession("offline", { kind: "heartbeat" })).toBe("offline");
  });

  it("opens a turn only from connected or idle", () => {
    expect(nextSession("connected", { kind: "turn_open" })).toBe("in_turn");
    expect(nextSession("idle", { kind: "turn_open" })).toBe("in_turn");
    expect(nextSession("error", { kind: "turn_open" })).toBe("error");
    expect(nextSession("offline", { kind: "turn_open" })).toBe("offline");
  });

  it("closes a turn back to idle, and changes nothing when no turn is open", () => {
    expect(nextSession("in_turn", { kind: "turn_closed" })).toBe("idle");
    expect(nextSession("idle", { kind: "turn_closed" })).toBe("idle");
    expect(nextSession("connected", { kind: "turn_closed" })).toBe("connected");
    expect(nextSession("error", { kind: "turn_closed" })).toBe("error");
  });

  it("takes every paired state to error on a device error or a rejected message", () => {
    for (const state of ["connected", "idle", "in_turn", "error", "offline"] as const) {
      expect(nextSession(state, { kind: "device_error" })).toBe("error");
      expect(nextSession(state, { kind: "message_rejected" })).toBe("error");
    }
  });

  it("takes every paired state to offline when the Silence_Window expires", () => {
    for (const state of ["connected", "idle", "in_turn", "error", "offline"] as const) {
      expect(nextSession(state, { kind: "silence" })).toBe("offline");
    }
  });
});

describe("createDeviceSessions", () => {
  it("starts every device unpaired with no firmware version, code or ack", () => {
    const sessions = createDeviceSessions();
    expect(sessions.state(DEVICE)).toBe("unpaired");
    expect(sessions.fwVer(DEVICE)).toBeNull();
    expect(sessions.pairingCode(DEVICE)).toBeNull();
    expect(sessions.lastAck(DEVICE)).toBeNull();
  });

  it("records the hello's firmware version and derives its code", () => {
    const sessions = createDeviceSessions();
    sessions.recordHello(DEVICE, FW_VER);
    sessions.apply(DEVICE, { kind: "hello", accepted: true });
    expect(sessions.state(DEVICE)).toBe("connected");
    expect(sessions.fwVer(DEVICE)).toBe(FW_VER);
    expect(sessions.pairingCode(DEVICE)).toBe(pairingCode(DEVICE, FW_VER));
  });

  // Req 2.4: offline -> accepted hello -> connected, with the Pairing_Code unchanged.
  it("returns an offline device to connected with its code unchanged", () => {
    const sessions = createDeviceSessions();
    sessions.recordHello(DEVICE, FW_VER);
    sessions.apply(DEVICE, { kind: "hello", accepted: true });
    const code = sessions.pairingCode(DEVICE);
    sessions.apply(DEVICE, { kind: "heartbeat" });
    sessions.apply(DEVICE, { kind: "silence" });
    expect(sessions.state(DEVICE)).toBe("offline");

    sessions.recordHello(DEVICE, FW_VER);
    sessions.apply(DEVICE, { kind: "hello", accepted: true });
    expect(sessions.state(DEVICE)).toBe("connected");
    expect(sessions.pairingCode(DEVICE)).toBe(code);
  });

  it("gives a new code when the firmware version changes", () => {
    const sessions = createDeviceSessions();
    sessions.recordHello(DEVICE, FW_VER);
    const first = sessions.pairingCode(DEVICE);
    sessions.recordHello(DEVICE, "0.2.0");
    expect(sessions.pairingCode(DEVICE)).not.toBe(first);
  });

  it("walks the Document C lifecycle in order", () => {
    const sessions = createDeviceSessions();
    const seen: DeviceSessionState[] = [];
    const step = (input: DeviceSessionInput): void => {
      sessions.apply(DEVICE, input);
      seen.push(sessions.state(DEVICE));
    };
    sessions.recordHello(DEVICE, FW_VER);
    step({ kind: "hello", accepted: true });
    step({ kind: "heartbeat" });
    step({ kind: "turn_open" });
    step({ kind: "turn_closed" });
    step({ kind: "silence" });
    step({ kind: "hello", accepted: true });
    expect(seen).toEqual(["connected", "idle", "in_turn", "idle", "offline", "connected"]);
  });

  it("keeps one session per device", () => {
    const sessions = createDeviceSessions();
    sessions.recordHello(DEVICE, FW_VER);
    sessions.apply(DEVICE, { kind: "hello", accepted: true });
    expect(sessions.state("xlu_000456")).toBe("unpaired");
    expect(sessions.pairingCode("xlu_000456")).toBeNull();
  });

  it("holds the last ack it was given, frozen", () => {
    const sessions = createDeviceSessions();
    sessions.recordAck(DEVICE, { action: "say", outcome: "accepted", reason: "", cmd_id: "c1" });
    sessions.recordAck(DEVICE, {
      action: "led",
      outcome: "rejected",
      reason: "quiet_hours",
      cmd_id: "c2",
    });
    const ack = sessions.lastAck(DEVICE);
    expect(ack).toEqual({
      action: "led",
      outcome: "rejected",
      reason: "quiet_hours",
      cmd_id: "c2",
    });
    expect(Object.isFrozen(ack)).toBe(true);
  });

  it("has a state for every Device_Session_State the Shared_Package exports", () => {
    // The six states of Document C Part 2, imported rather than restated.
    expect(DEVICE_SESSION_STATES).toHaveLength(6);
    expect(new Set(DEVICE_SESSION_STATES).size).toBe(DEVICE_SESSION_STATES.length);
  });
});

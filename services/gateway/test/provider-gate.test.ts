// The Provider_Gate (Req 1.1, 1.3, 1.5) and the brain's socket guard (Req 22.5, 22.8).
// Property 1: a provider is accepted exactly when it declares no retention and no training, and
// the `provider_check` entry carries that provider id, those two booleans and the matching
// outcome. The gate is the Safety_Layer's, not a vendor's, so it is checked over every provider id
// in the closed list and every pair of declared booleans, not just the mocks' posture.
import { readFileSync } from "node:fs";
import { connect } from "node:net";
import { fileURLToPath } from "node:url";
import tls from "node:tls";

import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  PROVIDER_CAPABILITIES,
  PROVIDER_IDS,
  type GatewayLogEntry,
  type GatewayLogEntryOf,
  type ProviderCapability,
  type ProviderId,
} from "@xelulu/shared";

import type { AudioListen } from "../src/audio/audio-transport.js";
import type { LlmProvider } from "../src/brain/providers/llm-provider.js";
import { NO_RETENTION_NO_TRAINING } from "../src/brain/providers/provider-declaration.js";
import {
  checkProvider,
  checkProviders,
  type CheckableProvider,
} from "../src/brain/providers/provider-gate.js";
import type { SttProvider } from "../src/brain/providers/stt-provider.js";
import type { TtsProvider } from "../src/brain/providers/tts-provider.js";
import { formatProviderError, writeProviderError } from "../src/config-error-writer.js";
import { createGateway, ProviderRefusedError } from "../src/gateway.js";
import { randomIds } from "../src/ids.js";
import { createGatewayLog, type GatewayLog } from "../src/log/gateway-log.js";
import type { MqttConnector } from "../src/mqtt/mqtt-transport.js";
import type { OperatorListen } from "../src/operator/operator-routes.js";
import { createCaptureSink } from "./support/capture-sink.js";
import { harnessConfig, HARNESS_TOKEN } from "./support/gateway-harness.js";
import {
  installNoRemoteSockets,
  isLoopbackHost,
  type SocketGuard,
} from "./support/no-remote-sockets.js";
import { createTestClock } from "./support/test-clock.js";

/** Every brain test installs the socket guard: nothing here may reach the network (Req 22.8). */
let guard: SocketGuard;

beforeEach(() => {
  guard = installNoRemoteSockets();
});

afterEach(() => {
  // Restore first, then assert: a genuine violation must not leave the real connect functions
  // patched for the rest of the worker, which would nest a second wrapper on the next beforeEach.
  const attempts = guard.attempts();
  guard.restore();
  expect(attempts).toEqual([]);
});

type Declared = Readonly<{ retains: boolean; trains: boolean }>;

function declaring(id: ProviderId, d: Declared): CheckableProvider {
  return {
    id,
    dataHandling: {
      vendorRetainsRequestData: d.retains,
      vendorMayTrainOnRequestData: d.trains,
    },
  };
}

/** A capability's provider: only `id` and `dataHandling` are read, so one shape serves all three. */
function provider(id: ProviderId, d: Declared): SttProvider & LlmProvider & TtsProvider {
  const base = declaring(id, d);
  return {
    ...base,
    open: () => {
      throw new Error("not called");
    },
    reply: () => {
      throw new Error("not called");
    },
    synthesise: () => {
      throw new Error("not called");
    },
  };
}

function newLog(): { log: GatewayLog; entries: GatewayLogEntry[] } {
  const log = createGatewayLog(createTestClock(1_760_000_000_000), createCaptureSink());
  const entries: GatewayLogEntry[] = [];
  log.subscribe((e) => entries.push(e));
  return { log, entries };
}

function checks(entries: readonly GatewayLogEntry[]): GatewayLogEntryOf<"provider_check">[] {
  return entries.flatMap((e) => (e.kind === "provider_check" ? [e] : []));
}

const accepted: Declared = { retains: false, trains: false };

describe("Property 1: provider acceptance equals no retention and no training", () => {
  const capability = fc.constantFrom<ProviderCapability>(...PROVIDER_CAPABILITIES);
  const id = fc.constantFrom<ProviderId>(...PROVIDER_IDS);

  it("accepts exactly the declarations with neither retention nor training", () => {
    fc.assert(
      fc.property(capability, id, fc.boolean(), fc.boolean(), (cap, pid, retains, trains) => {
        const result = checkProvider(cap, declaring(pid, { retains, trains }));
        expect(result.ok).toBe(!retains && !trains);
        if (!result.ok) {
          expect(result.capability).toBe(cap);
          expect(result.provider).toBe(pid);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("logs one provider_check per capability carrying those same booleans and outcome", () => {
    const declaration = fc.record({ retains: fc.boolean(), trains: fc.boolean() });
    fc.assert(
      fc.property(id, fc.tuple(declaration, declaration, declaration), (pid, declared) => {
        const [sttDecl, llmDecl, ttsDecl] = declared;
        const { log, entries } = newLog();
        const result = checkProviders(
          { log },
          {
            stt: provider(pid, sttDecl),
            llm: provider(pid, llmDecl),
            tts: provider(pid, ttsDecl),
          },
        );
        const logged = checks(entries);
        expect(logged).toHaveLength(3);
        expect(logged.map((e) => e.capability)).toEqual(["stt", "llm", "tts"]);
        logged.forEach((entry, i) => {
          const d = declared[i] ?? accepted;
          expect(entry.provider).toBe(pid);
          expect(entry.retains).toBe(d.retains);
          expect(entry.trains).toBe(d.trains);
          expect(entry.outcome).toBe(!d.retains && !d.trains ? "accepted" : "refused");
        });
        const firstBad = declared.findIndex((d) => d.retains || d.trains);
        expect(result.ok).toBe(firstBad === -1);
        if (!result.ok) expect(result.capability).toBe(PROVIDER_CAPABILITIES[firstBad]);
      }),
      { numRuns: 200 },
    );
  });
});

describe("the declaration a provider must make", () => {
  it("the shared declaration is frozen at no retention and no training, and is accepted", () => {
    expect(NO_RETENTION_NO_TRAINING).toEqual({
      vendorRetainsRequestData: false,
      vendorMayTrainOnRequestData: false,
    });
    expect(Object.isFrozen(NO_RETENTION_NO_TRAINING)).toBe(true);
    for (const capability of PROVIDER_CAPABILITIES) {
      expect(
        checkProvider(capability, { id: "mock", dataHandling: NO_RETENTION_NO_TRAINING }).ok,
      ).toBe(true);
    }
  });

  it.each([
    ["retention", { retains: true, trains: false }],
    ["training", { retains: false, trains: true }],
    ["both", { retains: true, trains: true }],
  ] as const)("refuses a provider declaring %s, naming only the capability and id", (_name, d) => {
    const { log, entries } = newLog();
    const result = checkProvider("stt", declaring("sarvam", d));
    expect(result).toEqual({ ok: false, capability: "stt", provider: "sarvam" });

    checkProviders(
      { log },
      {
        stt: provider("sarvam", d),
        llm: provider("hosted_llm", accepted),
        tts: provider("mock", accepted),
      },
    );
    const logged = checks(entries);
    expect(logged.map((e) => [e.capability, e.provider, e.outcome])).toEqual([
      ["stt", "sarvam", "refused"],
      ["llm", "hosted_llm", "accepted"],
      ["tts", "mock", "accepted"],
    ]);
    // The entry carries closed-enum values, the declaration's booleans and nothing else.
    expect(Object.keys(logged[0] ?? {}).sort()).toEqual([
      "at",
      "capability",
      "kind",
      "log_ver",
      "outcome",
      "provider",
      "retains",
      "seq",
      "trains",
    ]);
  });

  it("checks every capability even when the first is refused, and returns the first refusal", () => {
    const { log, entries } = newLog();
    const result = checkProviders(
      { log },
      {
        stt: provider("mock", accepted),
        llm: provider("hosted_llm", { retains: false, trains: true }),
        tts: provider("elevenlabs", { retains: true, trains: false }),
      },
    );
    expect(result).toEqual({ ok: false, capability: "llm", provider: "hosted_llm" });
    expect(checks(entries).map((e) => e.outcome)).toEqual(["accepted", "refused", "refused"]);
  });
});

describe("the start-up refusal (Req 1.4, C8)", () => {
  /** A gateway whose `bad` capability declares retention, with every opening path counted. */
  async function startRefusing(bad: ProviderCapability, id: ProviderId) {
    const spies = { audio: 0, operator: 0, mqtt: 0, synthesise: 0 };
    const declFor = (cap: ProviderCapability): Declared =>
      cap === bad ? { retains: true, trains: false } : accepted;
    const idFor = (cap: ProviderCapability): ProviderId => (cap === bad ? id : "mock");
    const ttsBase = provider(idFor("tts"), declFor("tts"));
    const tts: TtsProvider = {
      id: ttsBase.id,
      dataHandling: ttsBase.dataHandling,
      synthesise: () => {
        // Counted rather than thrown from, so the assertion names the real failure: the Filler
        // must not be synthesised when the gate has already refused.
        spies.synthesise += 1;
        return (async function* (): AsyncGenerator<Uint8Array> {})();
      },
    };
    const listenAudio: AudioListen = () => {
      spies.audio += 1;
      throw new Error("no audio listener may open");
    };
    const listenOperator: OperatorListen = () => {
      spies.operator += 1;
      throw new Error("no operator listener may open");
    };
    const connectMqtt: MqttConnector = () => {
      spies.mqtt += 1;
      throw new Error("no broker connection may open");
    };

    // Local_Mode, so the Operator_Surface would be listened on too: more to stay shut.
    const gateway = createGateway(harnessConfig({ localMode: true }), {
      clock: createTestClock(1_760_000_000_000),
      connectMqtt,
      listenAudio,
      listenOperator,
      sink: createCaptureSink(),
      ids: randomIds,
      providers: {
        stt: provider(idFor("stt"), declFor("stt")),
        llm: provider(idFor("llm"), declFor("llm")),
        tts,
      },
    });
    const entries: GatewayLogEntry[] = [];
    gateway.log.subscribe((e) => entries.push(e));
    const error = await gateway.start().then(
      () => null,
      (e: unknown) => e,
    );
    return { spies, entries, error, gateway };
  }

  it.each([
    ["stt", "sarvam"],
    ["llm", "hosted_llm"],
    ["tts", "elevenlabs"],
  ] as const)("a refused %s stops start() and opens no listener at all", async (bad, id) => {
    const { spies, entries, error, gateway } = await startRefusing(bad, id);

    // There is no degraded mode: the error names the capability and the provider id, and that
    // is everything it carries.
    expect(error).toBeInstanceOf(ProviderRefusedError);
    const refusal = error as ProviderRefusedError;
    expect(refusal.capability).toBe(bad);
    expect(refusal.provider).toBe(id);
    expect(refusal.message).toBe("");

    // Nothing was opened and nothing was dialled, so there is no window in which a turn could
    // have run through a provider the Safety_Layer refused.
    expect(spies).toEqual({ audio: 0, operator: 0, mqtt: 0, synthesise: 0 });
    expect(gateway.audioPort()).toBe(0);
    expect(gateway.operatorPort()).toBeNull();

    // The log stops at the gate: `starting`, the three declarations, and no listener state.
    expect(entries.map((e) => (e.kind === "gateway" ? e.state : e.kind))).toEqual([
      "starting",
      "provider_check",
      "provider_check",
      "provider_check",
    ]);
    expect(checks(entries).map((e) => e.outcome)).toEqual(
      PROVIDER_CAPABILITIES.map((cap) => (cap === bad ? "refused" : "accepted")),
    );
  });

  it("writes exactly one stderr line naming only the capability and the provider id", () => {
    const lines: string[] = [];
    writeProviderError("stt", "sarvam", (line) => lines.push(line));
    expect(lines).toEqual(["gateway provider refused: stt sarvam\n"]);
    // One line: a single trailing newline and no other break.
    expect(lines[0]?.split("\n")).toHaveLength(2);
    // No Config value rides along: not the device token, not a host, not a URL (Req 21.3).
    const line = formatProviderError("stt", "sarvam");
    for (const secret of [HARNESS_TOKEN, "127.0.0.1", "mqtt", "://"]) {
      expect(line).not.toContain(secret);
    }
  });

  it("is mapped by the entry point to a non-zero exit", () => {
    // The branch lives in `index.ts`'s top-level body, which runs the real gateway on import, so
    // it cannot be called from a test. What is checkable here is that the mapping exists and that
    // the code it uses is non-zero; the behaviour above proves no listener was opened.
    const source = readFileSync(fileURLToPath(new URL("../src/index.ts", import.meta.url)), "utf8");
    const code = /EXIT_PROVIDER_REFUSED\s*=\s*(\d+)/.exec(source)?.[1];
    expect(Number(code)).toBeGreaterThan(0);
    const branch = source.slice(source.indexOf("instanceof ProviderRefusedError"));
    expect(branch).toContain("writeProviderError(err.capability, err.provider)");
    expect(branch).toContain("EXIT_PROVIDER_REFUSED");
  });
});

describe("the socket guard (Req 22.8)", () => {
  it("treats only loopback targets as allowed", () => {
    for (const host of [undefined, "127.0.0.1", "127.0.0.9", "localhost", "::1", "[::1]"]) {
      expect(isLoopbackHost(host)).toBe(true);
    }
    // The wildcard bind addresses are targets to refuse, not loopback hosts to dial.
    for (const host of [
      "10.0.0.1",
      "api.example.test",
      "203.0.113.7",
      "[2001:db8::1]",
      "0.0.0.0",
      "::",
    ]) {
      expect(isLoopbackHost(host)).toBe(false);
    }
  });

  it("fails and records a plain socket to a non-loopback address", () => {
    // A guard of its own, so this test's expected violation never reaches the outer afterEach.
    const inner = installNoRemoteSockets();
    try {
      expect(() => connect({ host: "203.0.113.7", port: 443 })).toThrow();
      expect(inner.attempts()).toEqual(["203.0.113.7"]);
    } finally {
      inner.restore();
    }
  });

  it("fails and records a tls socket to a non-loopback address", () => {
    // The tls branch is the path an https-based vendor adapter would take (Req 22.8).
    const inner = installNoRemoteSockets();
    try {
      expect(() => tls.connect({ host: "api.example.test", port: 443 })).toThrow();
      expect(inner.attempts()).toEqual(["api.example.test"]);
    } finally {
      inner.restore();
    }
  });
});

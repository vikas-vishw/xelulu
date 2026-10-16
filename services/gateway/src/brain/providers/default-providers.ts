// Which providers the Gateway runs with (Req 1.1, C7).
//
// One place decides, and it lives inside `brain/` on purpose: the Repo_Check in
// `tooling/test/gateway-boundaries.test.ts` requires that no module outside `src/brain/` imports
// a provider implementation, so the composition root asks for "the defaults" rather than naming
// a vendor or a mock. That keeps `gateway.ts` free of provider identities and means wiring a real
// adapter later changes this file and nothing else.
//
// In this phase the only constructible providers are the mocks (C7): every named vendor adapter
// is declaration-only and its factory refuses with `not_configured`, so there is nothing here to
// select between and no key is read.
import type { Clock } from "../../clock.js";
import type { Deadlines } from "../../deadlines.js";
import type { LlmProvider } from "./llm-provider.js";
import { createMockLlm } from "./mock-llm.js";
import { createMockStt } from "./mock-stt.js";
import { createMockTts } from "./mock-tts.js";
import type { SttProvider } from "./stt-provider.js";
import type { TtsProvider } from "./tts-provider.js";

export type Providers = Readonly<{ stt: SttProvider; llm: LlmProvider; tts: TtsProvider }>;

/** The mock trio. Offline, deterministic, declaring no retention and no training. */
export function createDefaultProviders(
  deps: Readonly<{ clock: Clock; deadlines: Deadlines }>,
): Providers {
  return {
    stt: createMockStt(),
    llm: createMockLlm({ clock: deps.clock, deadlines: deps.deadlines }),
    tts: createMockTts(),
  };
}

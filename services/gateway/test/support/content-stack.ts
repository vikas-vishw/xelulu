// The Phase 4 content stack a brain test needs: the Content_Store seeded from the
// Starter_Content, the Story_Sessions over it, and the Content_Library the Tool_Router reads.
//
// It exists so the five places that build a Tool_Router agree on how the stack is wired. It adds
// no behaviour of its own: each piece is constructed exactly as `gateway.ts` constructs it, so a
// test and the composition root cannot drift.
import { createStarterContent, createStarterWords } from "@xelulu/shared";

import type { Clock } from "../../src/clock.js";
import { createStorySessions, type StorySessions } from "../../src/brain/story/story-session.js";
import {
  createContentLibrary,
  type ContentLibrary,
} from "../../src/brain/tools/content-library.js";
import { createContentStore, type ContentStore } from "../../src/content/content-store.js";
import type { GatewayLog } from "../../src/log/gateway-log.js";

export type ContentStack = Readonly<{
  content: ContentStore;
  stories: StorySessions;
  library: ContentLibrary;
}>;

export function createContentStack(
  deps: Readonly<{ clock: Clock; log: Pick<GatewayLog, "add"> }>,
): ContentStack {
  const content = createContentStore({
    clock: deps.clock,
    log: deps.log,
    seed: createStarterContent(),
  });
  const stories = createStorySessions({ clock: deps.clock, log: deps.log, content });
  const library = createContentLibrary({ content, words: createStarterWords(), clock: deps.clock });
  return { content, stories, library };
}

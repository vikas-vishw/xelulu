// Hash routing with no router dependency: `#/` is the Dashboard, `#/live` is Devices + Live Log,
// `#/conversation` is the Conversation page, `#/devices` is the Phase 6 Devices page and
// `#/matrix` is the Phase 6 Test Matrix. Any other hash shows the Dashboard. Follows
// `hashchange`.
import { useSyncExternalStore } from "react";

export type ConsolePage = "dashboard" | "live" | "conversation" | "content" | "devices" | "matrix";

/** The hash that opens each page, for nav links. */
export const PAGE_HASHES: Readonly<Record<ConsolePage, string>> = Object.freeze({
  dashboard: "#/",
  live: "#/live",
  conversation: "#/conversation",
  content: "#/content",
  devices: "#/devices",
  matrix: "#/matrix",
});

/** Pure: the page for a `location.hash` value. */
export function pageFromHash(hash: string): ConsolePage {
  if (hash === PAGE_HASHES.live) return "live";
  if (hash === PAGE_HASHES.conversation) return "conversation";
  if (hash === PAGE_HASHES.content) return "content";
  if (hash === PAGE_HASHES.devices) return "devices";
  if (hash === PAGE_HASHES.matrix) return "matrix";
  return "dashboard";
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

function getSnapshot(): ConsolePage {
  return pageFromHash(window.location.hash);
}

function getServerSnapshot(): ConsolePage {
  return "dashboard";
}

export function useHashPage(): ConsolePage {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

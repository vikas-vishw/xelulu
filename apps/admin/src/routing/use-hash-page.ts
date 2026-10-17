// Hash routing with no router dependency: `#/` is the Dashboard, `#/live` is Devices + Live Log
// and `#/conversation` is the Conversation page. Any other hash shows the Dashboard. Follows
// `hashchange`.
import { useSyncExternalStore } from "react";

export type ConsolePage = "dashboard" | "live" | "conversation" | "content";

/** The hash that opens each page, for nav links. */
export const PAGE_HASHES: Readonly<Record<ConsolePage, string>> = Object.freeze({
  dashboard: "#/",
  live: "#/live",
  conversation: "#/conversation",
  content: "#/content",
});

/** Pure: the page for a `location.hash` value. */
export function pageFromHash(hash: string): ConsolePage {
  if (hash === PAGE_HASHES.live) return "live";
  if (hash === PAGE_HASHES.conversation) return "conversation";
  if (hash === PAGE_HASHES.content) return "content";
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

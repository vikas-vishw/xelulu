// The Memory_Store behind the `memory_read` and `memory_write` tools (Req 16, C12).
//
// Three limits, all deliberate. Facts are text and nothing else, so no audio reference, no
// storage path and no raw request value can be kept (safety.md §1). There are at most
// MEMORY_MAX_FACTS per child and MEMORY_MAX_FACT_CODE_POINTS per fact, so a model that decides to
// write a paragraph on every turn cannot grow the process without bound. And the key is the
// opaque child key from the Child_Context table, never a name and never anything logged (C9).
//
// Phase 3 boundary (C10): in memory, lost on restart, and not reachable by a parent. The
// parent-facing "what Xelulu remembers", with its review and delete, arrives with the backend.
export const MEMORY_MAX_FACTS = 50;
export const MEMORY_MAX_FACT_CODE_POINTS = 120;

export type MemoryWriteOutcome = "stored" | "too_long" | "blank" | "full";

export interface MemoryStore {
  /** The child's facts, oldest first. */
  read(childKey: string): readonly string[];
  /**
   * Stores one fact. `too_long` and `blank` refuse rather than truncate, because a truncated
   * fact is a sentence the child never said; `full` refuses once the cap is reached rather than
   * silently dropping the oldest memory a parent might expect to still be there.
   */
  write(childKey: string, fact: string): MemoryWriteOutcome;
  /** Really deletes one child's facts. Returns how many went. */
  forget(childKey: string): number;
  count(childKey: string): number;
}

export function createMemoryStore(): MemoryStore {
  const facts = new Map<string, string[]>();

  return {
    read(childKey) {
      return facts.get(childKey) ?? [];
    },

    write(childKey, fact) {
      const trimmed = fact.trim();
      if (trimmed.length === 0) return "blank";
      if ([...trimmed].length > MEMORY_MAX_FACT_CODE_POINTS) return "too_long";
      const held = facts.get(childKey) ?? [];
      if (held.length >= MEMORY_MAX_FACTS) return "full";
      // A repeat is not an error and does not consume a slot.
      if (held.includes(trimmed)) return "stored";
      held.push(trimmed);
      facts.set(childKey, held);
      return "stored";
    },

    forget(childKey) {
      const removed = facts.get(childKey)?.length ?? 0;
      facts.delete(childKey);
      return removed;
    },

    count(childKey) {
      return facts.get(childKey)?.length ?? 0;
    },
  };
}

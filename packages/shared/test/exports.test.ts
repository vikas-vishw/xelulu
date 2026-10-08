// Req 8.7: the Phase 0 shared entry point has no named exports and no default export.
import { describe, expect, it } from "vitest";
import * as ns from "../dist/index.js";

describe("@xelulu/shared entry point", () => {
  it("has no named exports", () => {
    expect(Object.keys(ns)).toEqual([]);
  });

  it("has no default export", () => {
    expect("default" in ns).toBe(false);
  });
});

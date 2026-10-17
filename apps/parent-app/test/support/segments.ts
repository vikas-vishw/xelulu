// The two segment assertions the segmented screens' suites share (Phase 2.2 Req 26.7, 26.8).
// Not a test file: Jest's `testMatch` only picks up `test/**/*.test.{ts,tsx}`.
//
// `screen` is imported from RNTL rather than from `expo-router/testing-library`, which re-exports
// it: both resolve to one module instance, so a tree rendered with `renderRouter` is the tree
// these queries read.

import { expect } from "@jest/globals";
import { fireEvent, screen, within } from "@testing-library/react-native";

import { SEGMENT_STATE } from "../../src/components/segmented-tabs";

/**
 * One selected option inside the screen's own segmented control, never two, and that option is
 * the only filled one.
 *
 * The scope is resolved by the feature's `segmentsLabel`, which is the `tablist` container's
 * accessibility label. It is resolved with `getByLabelText` rather than
 * `getByRole("tablist", { name })`, because RNTL's role query matches only elements whose
 * `accessible` prop is set, and `segmented-tabs.tsx` deliberately leaves the container's unset so
 * each option stays an accessibility element of its own. The scoping intent is identical either
 * way: the Tab_Bar's selected tab shares the `tab` role, so a whole-screen count would be false
 * on `/play` and `/grow`.
 */
export function expectOneSelectedSegment(segmentsLabel: string): void {
  const list = within(screen.getByLabelText(segmentsLabel, { exact: true }));
  const selected = list.getAllByRole("tab", { selected: true });
  expect(selected).toHaveLength(1);

  const fill = `bg-${SEGMENT_STATE.selected.bgToken}`;
  const filled = list
    .getAllByRole("tab")
    .filter((option) => String(option.props.className).includes(fill));
  expect(filled).toHaveLength(1);
  expect(filled[0]).toBe(selected[0]);
}

/** Presses the segment with the given visible label. */
export function pressSegment(label: string): void {
  fireEvent.press(screen.getByRole("tab", { name: label }));
}

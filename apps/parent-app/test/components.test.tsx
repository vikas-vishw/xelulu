// Component_Kit key-interaction tests (Req 11.1, 2.2–2.7, 3.3). Example-based only (C16).
// Covers Property 3 (controls report state and call handlers once) and Property 4 (status is
// never colour alone).
//
// `contrastRatio` is the repo's own helper in `tooling/checks`, so a ratio asserted here is
// computed from the token values the component applies, never written down as a number.

import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { StyleSheet, type ViewStyle } from "react-native";
import { SafeAreaProvider, type Metrics } from "react-native-safe-area-context";

import { AppText } from "../src/components/app-text";
import { Avatar } from "../src/components/avatar";
import { Button } from "../src/components/button";
import { Card } from "../src/components/card";
import { Chip } from "../src/components/chip";
import { CircleButton, DISC } from "../src/components/circle-button";
import { ConfirmDialog, type ConfirmAction } from "../src/components/confirm-dialog";
import { IconTile, type IconTileTone } from "../src/components/icon-tile";
import { ListRow } from "../src/components/list-row";
import { MediaCard } from "../src/components/media-card";
import { MetricRow } from "../src/components/metric-row";
import { MetricTile } from "../src/components/metric-tile";
import { PageDots } from "../src/components/page-dots";
import { SEGMENT_STATE, SegmentedTabs } from "../src/components/segmented-tabs";
import { StatusPill, type StatusTone } from "../src/components/status-pill";
import { StepList, type Step } from "../src/components/step-list";
import { Stepper } from "../src/components/stepper";
import { TabBar, type TabBarItem } from "../src/components/tab-bar";
import { TextField } from "../src/components/text-field";
import { TOGGLE_HIT_SLOP, Toggle } from "../src/components/toggle";
import { tokens, type ColorToken } from "../src/theme/theme";
import { contrastRatio } from "../../../tooling/checks/contrast";

/** Fixed metrics so useSafeAreaInsets resolves without a measured window. */
const METRICS: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function renderWithSafeArea(ui: ReactElement): void {
  render(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
}

/** The part of a rendered element the walk below needs: its props and its parent. */
type TreeNode = Readonly<{ parent: TreeNode | null; props: Readonly<Record<string, unknown>> }>;

/** The nearest ancestor that reserves a sized box around `element`. */
function sizedAncestorStyle(element: TreeNode): ViewStyle {
  for (let node = element.parent; node; node = node.parent) {
    const flat = StyleSheet.flatten(node.props.style as ViewStyle | undefined);
    if (flat?.minHeight !== undefined) return flat;
  }
  throw new Error("no sized touch area around the element");
}

/**
 * The Tailwind box-size scale from `tailwind.config.js`, keyed the same way and sourced from
 * the same tokens, so an assertion below names no pixel number of its own.
 */
const BOX = {
  touch: tokens.size.touchMin,
  control: tokens.size.controlMin,
  row: tokens.size.rowMin,
  tile: tokens.size.tileMin,
} as const;

type BoxKey = keyof typeof BOX;

/** The classes a rendered node actually carries. */
function classesOf(node: TreeNode): readonly string[] {
  return String(node.props.className ?? "")
    .split(/\s+/)
    .filter((part) => part.length > 0);
}

/**
 * The points a node reserves on each axis, read off what it RENDERED: its `w-`/`h-`/`min-w-`/
 * `min-h-` classes resolved through `BOX`, plus any inline static style.
 *
 * Phase 2's styling-correctness pass: these boxes used to live inside a Pressable `style`
 * callback, and NativeWind drops the `style` prop of any element that carries a `className`
 * without ever invoking it, so the box never rendered on device while a test that called the
 * callback itself still passed. Nothing here calls a style function. NativeWind's interop is
 * also inert under Jest (`wrap-jsx` skips registering the interop components when NODE_ENV is
 * "test"), so classes arrive as plain props and the scale has to be resolved here.
 */
function reservedBox(node: TreeNode): Readonly<{ x: number; y: number }> {
  const across: number[] = [0];
  const down: number[] = [0];
  for (const part of classesOf(node)) {
    const match = /^(?:min-)?([wh])-([a-z]+)$/.exec(part);
    const key = match?.[2];
    if (key === undefined || !(key in BOX)) continue;
    (match?.[1] === "w" ? across : down).push(BOX[key as BoxKey]);
  }
  const flat = StyleSheet.flatten(node.props.style as ViewStyle | undefined) ?? {};
  for (const value of [flat.width, flat.minWidth]) {
    if (typeof value === "number") across.push(value);
  }
  for (const value of [flat.height, flat.minHeight]) {
    if (typeof value === "number") down.push(value);
  }
  return { x: Math.max(...across), y: Math.max(...down) };
}

/** The element reserves at least the 44 pt minimum on both axes (Req 3.2). */
function expectSquareTouchBox(node: TreeNode): void {
  const box = reservedBox(node);
  expect(box.x).toBeGreaterThanOrEqual(tokens.size.touchMin);
  expect(box.y).toBeGreaterThanOrEqual(tokens.size.touchMin);
  expect(tokens.size.touchMin).toBeGreaterThanOrEqual(44);
}

/** The element reserves at least the 44 pt minimum in height; its width is the row's (Req 3.2). */
function expectTouchHeight(node: TreeNode): void {
  expect(reservedBox(node).y).toBeGreaterThanOrEqual(tokens.size.touchMin);
  expect(tokens.size.touchMin).toBeGreaterThanOrEqual(44);
}

const TAB_ITEMS: readonly TabBarItem[] = [
  { key: "home", label: "Home", icon: "home-outline", iconActive: "home" },
  { key: "play", label: "Play", icon: "game-controller-outline", iconActive: "game-controller" },
];

describe("Button", () => {
  it("calls onPress once when enabled", () => {
    const onPress = jest.fn();
    render(<Button label="Save" onPress={onPress} />);

    fireEvent.press(screen.getByRole("button", { name: "Save" }));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("exposes the disabled state and calls nothing while disabled", () => {
    const onPress = jest.fn();
    render(<Button label="Save" onPress={onPress} disabled />);

    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toBeDisabled();

    fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  // Phase 2 styling-correctness pass: the height, the dimming and the press tint are classes
  // the element renders, not a `style` callback NativeWind never invokes.
  it("renders its height, and dims only while disabled (Req 3.2, 2.8)", () => {
    render(<Button label="Save" onPress={jest.fn()} />);
    const enabled = screen.getByRole("button", { name: "Save" });
    expectTouchHeight(enabled);
    expect(classesOf(enabled)).toContain("active:bg-brand-pressed");
    expect(classesOf(enabled)).not.toContain("opacity-disabled");

    render(<Button label="Later" onPress={jest.fn()} disabled />);
    const off = screen.getByRole("button", { name: "Later" });
    expectTouchHeight(off);
    expect(classesOf(off)).toContain("opacity-disabled");
    // A disabled button cannot darken under a touch: no press tint is composed in at all.
    expect(classesOf(off).filter((part) => part.startsWith("active:"))).toEqual([]);
    expect(tokens.opacity.disabled).toBeLessThan(1);
  });
});

describe("Card", () => {
  // Phase 2 styling-correctness pass: the pressable card's minimum box and press tint became
  // classes, and `cardShadow` stayed an inline STATIC style, which NativeWind merges instead of
  // dropping. Both forms are asserted against what the element rendered.
  it("renders the shadow as a style and the box and tint as classes", () => {
    render(
      <Card testID="card" onPress={jest.fn()} accessibilityLabel="Xelulu, online">
        <AppText variant="body">body</AppText>
      </Card>,
    );

    const card = screen.getByTestId("card");
    expectTouchHeight(card);
    expect(classesOf(card)).toContain("active:bg-surface-beige");
    const flat = StyleSheet.flatten(card.props.style as ViewStyle | undefined) ?? {};
    expect(flat.shadowColor).toBe(tokens.shadow.color);
    expect(flat.shadowRadius).toBe(tokens.shadow.radius);
    expect(flat.elevation).toBe(tokens.shadow.elevation);
  });

  it("is not a button without onPress", () => {
    render(
      <Card testID="card">
        <AppText variant="body">body</AppText>
      </Card>,
    );

    expect(screen.queryByRole("button")).toBeNull();
    const flat = StyleSheet.flatten(screen.getByTestId("card").props.style as ViewStyle);
    expect(flat.shadowColor).toBe(tokens.shadow.color);
  });
});

describe("Toggle", () => {
  it.each([false, true])("calls onValueChange with the opposite of %s", (value) => {
    const onValueChange = jest.fn();
    render(<Toggle value={value} onValueChange={onValueChange} accessibilityLabel="Quiet hours" />);

    const toggle = screen.getByRole("switch", { name: "Quiet hours" });
    if (value) expect(toggle).toBeChecked();
    else expect(toggle).not.toBeChecked();

    fireEvent(toggle, "valueChange", !value);
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith(!value);
  });

  it("reserves a touch area of at least the minimum (Req 3.2)", () => {
    render(<Toggle value={false} onValueChange={jest.fn()} accessibilityLabel="Quiet hours" />);

    const toggle = screen.getByRole("switch", { name: "Quiet hours" });
    expect(toggle.props.hitSlop).toBe(TOGGLE_HIT_SLOP);
    expect(TOGGLE_HIT_SLOP).toBeGreaterThan(0);

    const area = sizedAncestorStyle(toggle);
    expect(area.minWidth).toBeGreaterThanOrEqual(tokens.size.touchMin);
    expect(area.minHeight).toBeGreaterThanOrEqual(tokens.size.touchMin);
    expect(tokens.size.touchMin).toBeGreaterThanOrEqual(44);
  });
});

describe("StatusPill", () => {
  const CASES: [StatusTone, string][] = [
    ["success", "Online"],
    ["warning", "Battery 15%"],
    ["danger", "Battery 8%"],
    ["neutral", "Offline"],
  ];

  it.each(CASES)("renders its label for the %s tone", (tone, label) => {
    render(<StatusPill tone={tone} label={label} />);
    expect(screen.getByText(label)).toBeOnTheScreen();
  });
});

describe("ListRow", () => {
  it("calls onPress once", () => {
    const onPress = jest.fn();
    render(<ListRow title="Quiet hours" subtitle="21:00 to 07:00" onPress={onPress} />);

    fireEvent.press(screen.getByRole("button", { name: "Quiet hours" }));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("is not a button without onPress", () => {
    render(<ListRow title="Firmware" subtitle="1.0.0" trailing="none" />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  // Phase 2 styling-correctness pass: the row's height and its press tint are rendered classes,
  // not a `style` callback NativeWind drops.
  it("reserves its row height whether or not it is pressable (Req 3.2)", () => {
    render(<ListRow title="Quiet hours" onPress={jest.fn()} testID="pressable" />);
    const pressable = screen.getByTestId("pressable");
    expectTouchHeight(pressable);
    expect(classesOf(pressable)).toContain("active:bg-surface-beige");
    expect(BOX.row).toBeGreaterThanOrEqual(tokens.size.touchMin);

    render(<ListRow title="Firmware" trailing="none" testID="static" />);
    const plain = screen.getByTestId("static");
    expectTouchHeight(plain);
    expect(classesOf(plain).filter((part) => part.startsWith("active:"))).toEqual([]);
  });

  it("joins trailingText to a pressable row's accessibility label", () => {
    render(<ListRow title="Morning" trailingText="07:00" onPress={jest.fn()} />);

    expect(screen.getByRole("button", { name: "Morning, 07:00" })).toBeOnTheScreen();
  });

  it("shows trailingText on a non-pressable row and exposes no label at all", () => {
    render(<ListRow title="Account" trailingText="Later phase" trailing="none" />);

    expect(screen.getByText("Later phase")).toBeOnTheScreen();
    expect(screen.queryByLabelText("Account")).toBeNull();
    expect(screen.queryByLabelText("Account, Later phase")).toBeNull();
  });

  it("renders `leading` in the icon slot, and `icon` wins when both are given", () => {
    render(<ListRow title="Dad" leading={<Avatar name="Dad" />} trailing="none" />);
    expect(screen.getByRole("image", { name: "Dad" })).toBeOnTheScreen();

    render(<ListRow title="Dad" icon="home" leading={<Avatar name="Dad" />} trailing="none" />);
    expect(screen.queryByRole("image", { name: "Dad" })).toBeNull();
  });

  it("tints the title for tone=danger and leaves the leading slot untouched", () => {
    render(
      <ListRow
        title="Delete all memories"
        tone="danger"
        trailingText="15 items"
        leading={<Avatar name="Dad" />}
        trailing="none"
      />,
    );

    expect(String(screen.getByText("Delete all memories").props.className)).toContain(
      "text-danger",
    );
    expect(String(screen.getByText("15 items").props.className)).toContain("text-danger");
    // The leading node renders exactly as it was passed in.
    expect(screen.getByRole("image", { name: "Dad" })).toBeOnTheScreen();
  });

  it("renders the default row unchanged when none of the three props is set", () => {
    render(<ListRow title="Firmware" subtitle="1.0.0" trailing="none" />);

    expect(screen.getByText("Firmware")).toBeOnTheScreen();
    expect(screen.getByText("1.0.0")).toBeOnTheScreen();
    expect(String(screen.getByText("Firmware").props.className)).not.toContain("text-danger");
  });
});

describe("TextField", () => {
  it("calls onChangeText with the typed text", () => {
    const onChangeText = jest.fn();
    render(<TextField label="Parent's name" value="" onChangeText={onChangeText} />);

    fireEvent.changeText(screen.getByLabelText("Parent's name"), "Mom");

    expect(onChangeText).toHaveBeenCalledTimes(1);
    expect(onChangeText).toHaveBeenCalledWith("Mom");
  });

  it("masks a secure field and reveals it on request", () => {
    render(<TextField label="Password" value="secret" onChangeText={jest.fn()} secure />);

    expect(screen.getByLabelText("Password").props.secureTextEntry).toBe(true);

    fireEvent.press(screen.getByRole("button", { name: "Show password" }));

    expect(screen.getByLabelText("Password").props.secureTextEntry).toBe(false);
    expect(screen.getByRole("button", { name: "Hide password" })).toBeOnTheScreen();
  });

  // Phase 2 styling-correctness pass: the reveal control's 44x44 pt box is a rendered class,
  // not a `style` callback NativeWind drops.
  it("gives the reveal control a 44x44 pt box (Req 3.2)", () => {
    render(<TextField label="Password" value="secret" onChangeText={jest.fn()} secure />);

    expectSquareTouchBox(screen.getByRole("button", { name: "Show password" }));
  });

  it("associates its error line with the input", () => {
    render(
      <TextField
        label="Date of birth"
        value="15-03-2020"
        onChangeText={jest.fn()}
        errorText="Use YYYY-MM-DD"
      />,
    );

    expect(screen.getByText("Use YYYY-MM-DD")).toBeOnTheScreen();
    expect(screen.getByLabelText("Date of birth").props.accessibilityHint).toBe("Use YYYY-MM-DD");
  });

  it("draws a decorative trailingIcon that is hidden and not pressable", () => {
    const hiddenCount = (): number =>
      screen.UNSAFE_queryAllByProps({ importantForAccessibility: "no-hide-descendants" }).length;

    render(<TextField label="Date of birth" value="" onChangeText={jest.fn()} />);
    expect(hiddenCount()).toBe(0);

    render(
      <TextField
        label="Date of birth"
        value=""
        onChangeText={jest.fn()}
        trailingIcon="calendar-outline"
      />,
    );
    expect(hiddenCount()).toBeGreaterThan(0);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("Chip", () => {
  it("calls onPress once and exposes the selected state", () => {
    const onPress = jest.fn();
    render(<Chip label="English" selected onPress={onPress} />);

    const chip = screen.getByRole("button", { name: "English" });
    expect(chip).toBeSelected();

    fireEvent.press(chip);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("names a removable chip after what the press does", () => {
    render(<Chip label="Animals" trailing="remove" onPress={jest.fn()} />);

    expect(screen.getByRole("button", { name: "Remove Animals" })).toBeOnTheScreen();
  });

  it("is not a button without onPress", () => {
    render(<Chip label="Space" />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Space")).toBeOnTheScreen();
  });

  // Phase 2 styling-correctness pass: the 44 pt minimum height is a rendered class on both the
  // pressable and the plain chip, and the press tint follows the selected fill.
  it.each([
    [true, "active:bg-brand-pressed"],
    [false, "active:bg-hairline"],
  ])("reserves its height when selected=%s (Req 3.2)", (selected, tint) => {
    render(<Chip testID="chip" label="English" selected={selected} onPress={jest.fn()} />);
    const chip = screen.getByTestId("chip");
    expectTouchHeight(chip);
    expect(classesOf(chip)).toContain(tint);

    render(<Chip testID="plain" label="Space" />);
    expectTouchHeight(screen.getByTestId("plain"));
  });
});

describe("Avatar", () => {
  it("falls back to the name's initial and carries the image role", () => {
    render(<Avatar name="aarav" />);

    expect(screen.getByRole("image", { name: "aarav" })).toBeOnTheScreen();
    expect(screen.getByText("A")).toBeOnTheScreen();
  });

  it("draws an Illustration instead of the initial when one is given", () => {
    render(<Avatar name="Grandma" illustration="person-figure" size="lg" />);

    expect(screen.getByRole("image", { name: "Grandma" })).toBeOnTheScreen();
    expect(screen.queryByText("G")).toBeNull();
  });
});

describe("StepList", () => {
  const STEPS: readonly Step[] = [
    { key: "power", title: "Power on Xelulu", icon: "power-outline" },
    { key: "bluetooth", title: "Connect via Bluetooth", icon: "bluetooth-outline" },
    { key: "wifi", title: "Join your Wi-Fi network", icon: "wifi-outline" },
  ];

  it("names each step's state in text, never by colour alone", () => {
    render(<StepList steps={STEPS} currentIndex={1} />);

    expect(screen.getByLabelText("Power on Xelulu, done")).toBeOnTheScreen();
    expect(screen.getByLabelText("Connect via Bluetooth, current step")).toBeOnTheScreen();
    expect(screen.getByLabelText("Join your Wi-Fi network, not started")).toBeOnTheScreen();
  });
});

describe("PageDots", () => {
  it("calls onSelect with the pressed dot and marks the current page", () => {
    const onSelect = jest.fn();
    render(<PageDots count={3} index={1} onSelect={onSelect} />);

    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(screen.getByRole("tab", { name: "Page 2 of 3" })).toBeSelected();

    fireEvent.press(screen.getByRole("tab", { name: "Page 3 of 3" }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it("is hidden from accessibility and not pressable without onSelect", () => {
    render(<PageDots count={3} index={0} />);

    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  it("centres each interactive dot in its own 44x44 pt box with no hitSlop (Req 2.6, 21.1)", () => {
    render(<PageDots count={3} index={1} onSelect={jest.fn()} />);

    for (const dot of screen.getAllByRole("tab")) {
      expectSquareTouchBox(dot);
      // Edge to edge: a hitSlop here would overlap both neighbours' centres.
      expect([0, undefined]).toContain(dot.props.hitSlop);
    }
  });
});

describe("Stepper", () => {
  const percent = (value: number): string => `${value}%`;

  it("steps in both directions and carries its value", () => {
    const onChange = jest.fn();
    render(
      <Stepper
        testID="volume"
        value={60}
        min={0}
        max={100}
        step={5}
        onChange={onChange}
        label="Volume"
        format={percent}
      />,
    );

    // The container is not marked `accessible`: that would collapse the minus and plus controls
    // into it. So the adjustable contract is read off the container's own props.
    const control = screen.getByTestId("volume");
    expect(control.props.accessibilityRole).toBe("adjustable");
    expect(control.props.accessibilityLabel).toBe("Volume");
    expect(control.props.accessibilityValue).toEqual({
      min: 0,
      max: 100,
      now: 60,
      text: "60%",
    });
    expect(screen.getByText("60%")).toBeOnTheScreen();

    fireEvent.press(screen.getByRole("button", { name: "Increase Volume" }));
    expect(onChange).toHaveBeenNthCalledWith(1, 65);

    fireEvent.press(screen.getByRole("button", { name: "Decrease Volume" }));
    expect(onChange).toHaveBeenNthCalledWith(2, 55);
  });

  it.each([
    [0, "Decrease Volume"],
    [100, "Increase Volume"],
  ])("disables the control at the %i bound and calls nothing", (value, name) => {
    const onChange = jest.fn();
    render(
      <Stepper
        value={value}
        min={0}
        max={100}
        step={5}
        onChange={onChange}
        label="Volume"
        format={percent}
      />,
    );

    const control = screen.getByRole("button", { name });
    expect(control).toBeDisabled();

    fireEvent.press(control);
    expect(onChange).not.toHaveBeenCalled();

    // Phase 2 styling-correctness pass: the bound's dimming is a rendered class, and the
    // control at a bound composes in no press tint.
    expect(classesOf(control)).toContain("opacity-disabled");
    expect(classesOf(control).filter((part) => part.startsWith("active:"))).toEqual([]);
  });

  // Phase 2 styling-correctness pass: the 44x44 pt box used to sit in a `style` callback, which
  // NativeWind never invokes on an element that carries a className, so it never rendered.
  it.each(["Decrease Volume", "Increase Volume"])("gives %s a 44x44 pt box (Req 3.2)", (name) => {
    render(
      <Stepper
        value={60}
        min={0}
        max={100}
        step={5}
        onChange={jest.fn()}
        label="Volume"
        format={percent}
      />,
    );

    const control = screen.getByRole("button", { name });
    expectSquareTouchBox(control);
    expect(classesOf(control)).toContain("active:bg-surface-beige");
  });
});

describe("MediaCard", () => {
  it("calls onPress once and names itself by its title and subtitle", () => {
    const onPress = jest.fn();
    render(
      <MediaCard
        title="Story Time"
        subtitle="12 stories"
        illustration="story-scene"
        onPress={onPress}
      />,
    );

    fireEvent.press(screen.getByRole("button", { name: "Story Time, 12 stories" }));

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Story Time")).toBeOnTheScreen();
  });
});

describe("MetricRow and MetricTile", () => {
  it("read a MetricRow as one element carrying its value and title", () => {
    render(
      <MetricRow
        icon="heart-outline"
        title="Language"
        subtitle="New words this week"
        value="+12"
        tone="info"
      />,
    );

    expect(screen.getByLabelText("+12 Language")).toBeOnTheScreen();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("read a MetricTile as one element carrying its value and label", () => {
    render(<MetricTile icon="book-outline" value="14" label="Stories" />);

    expect(screen.getByLabelText("14 Stories")).toBeOnTheScreen();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("CircleButton", () => {
  it("calls onPress once and keeps its label in text", () => {
    const onPress = jest.fn();
    render(<CircleButton icon="mic-outline" label="Mute" onPress={onPress} />);

    fireEvent.press(screen.getByRole("button", { name: "Mute" }));

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Mute")).toBeOnTheScreen();
  });

  it("keeps the danger tone's label in text", () => {
    render(<CircleButton icon="call" label="End Call" tone="danger" onPress={jest.fn()} />);

    expect(screen.getByRole("button", { name: "End Call" })).toBeOnTheScreen();
    expect(screen.getByText("End Call")).toBeOnTheScreen();
  });

  it("joins stateText to the name and shows it as text", () => {
    render(<CircleButton icon="volume-high" label="Speaker" stateText="On" onPress={jest.fn()} />);

    expect(screen.getByRole("button", { name: "Speaker, On" })).toBeOnTheScreen();
    expect(screen.getByText("On")).toBeOnTheScreen();
  });

  it("takes its name from accessibilityLabel and shows no text at the badge size", () => {
    render(
      <CircleButton
        icon="add"
        size="badge"
        accessibilityLabel="Add photo. Not available in this build."
        onPress={jest.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Add photo. Not available in this build." }),
    ).toBeOnTheScreen();
    expect(screen.queryByText("Add photo. Not available in this build.")).toBeNull();
  });

  // The clamp in `Math.max(0, (touchMin - disc) / 2)` is load-bearing: a negative hitSlop
  // shrinks the touch box of the disc, the label and the state line alike.
  it("gives the badge enough slop to clear the minimum and the lg default none", () => {
    render(<CircleButton icon="mic-outline" label="Mute" onPress={jest.fn()} />);
    // The lg disc already draws wider than the minimum, so it needs no slop at all.
    expect([0, undefined]).toContain(screen.getByRole("button", { name: "Mute" }).props.hitSlop);
    expect(DISC.lg).toBeGreaterThanOrEqual(tokens.size.touchMin);

    render(<CircleButton icon="add" size="badge" accessibilityLabel="Add" onPress={jest.fn()} />);
    const slop = screen.getByRole("button", { name: "Add" }).props.hitSlop as number;
    expect(DISC.badge).toBeLessThan(tokens.size.touchMin);
    expect(DISC.badge + 2 * slop).toBeGreaterThanOrEqual(tokens.size.touchMin);
  });
});

describe("ConfirmDialog", () => {
  const ACTIONS: readonly ConfirmAction[] = [
    { key: "delete", label: "Delete everything", tone: "danger" },
    { key: "export", label: "Export data" },
  ];

  function renderDialog(
    handlers: Readonly<{ onCancel: () => void; onAction: (k: string) => void }>,
  ) {
    render(
      <ConfirmDialog
        testID="confirm"
        visible
        title="Delete or export your data?"
        body="This build is a mock. Nothing leaves this device."
        cancelLabel="Cancel"
        actions={ACTIONS}
        onCancel={handlers.onCancel}
        onAction={handlers.onAction}
      />,
    );
  }

  it("exposes the alert role and the modal flag", () => {
    renderDialog({ onCancel: jest.fn(), onAction: jest.fn() });

    // Not marked `accessible`, so the dialog's own buttons stay reachable; the role and the
    // modal flag are read off the dialog wrapper's props.
    const alert = screen.getByTestId("confirm");
    expect(alert.props.accessibilityRole).toBe("alert");
    expect(alert.props.accessibilityLabel).toBe("Delete or export your data?");
    expect(alert.props.accessibilityViewIsModal).toBe(true);
    expect(screen.getByText("This build is a mock. Nothing leaves this device.")).toBeOnTheScreen();
  });

  it.each([
    ["Delete everything", "delete"],
    ["Export data", "export"],
  ])("calls onAction once for %s", (label, key) => {
    const onAction = jest.fn();
    renderDialog({ onCancel: jest.fn(), onAction });

    fireEvent.press(screen.getByRole("button", { name: label }));

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith(key);
  });

  it("calls onCancel once", () => {
    const onCancel = jest.fn();
    renderDialog({ onCancel, onAction: jest.fn() });

    fireEvent.press(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe("SegmentedTabs", () => {
  const OPTIONS = [
    { key: "all", label: "All" },
    { key: "games", label: "Games" },
    { key: "stories", label: "Stories" },
  ] as const;

  /** The classes the control actually rendered on one option and on its label. */
  function optionClasses(label: string): Readonly<{ box: string; text: string }> {
    return {
      box: String(screen.getByRole("tab", { name: label }).props.className),
      text: String(screen.getByText(label).props.className),
    };
  }

  // Phase 2 cleanup, fix 1: the selected option is the most prominent element, not the
  // lightest. Phase 2.1 put the `brand` fill in a Pressable `style` callback, which NativeWind
  // never invokes on an element that carries a className, so the fill never painted.
  it("fills the selected option and leaves the others unfilled", () => {
    render(
      <SegmentedTabs
        options={OPTIONS}
        value="games"
        onChange={jest.fn()}
        accessibilityLabel="Content filter"
      />,
    );

    // The unselected pair is asserted against `surface-beige`, so the container must actually
    // render that fill: without this the contrast case could assert a stale pair (review finding 3).
    expect(
      String(screen.getByLabelText("Content filter", { exact: true }).props.className),
    ).toContain(`bg-${SEGMENT_STATE.unselected.bgToken}`);

    const selected = optionClasses("Games");
    expect(selected.box).toContain(`bg-${SEGMENT_STATE.selected.bgToken}`);
    expect(selected.text).toContain(`text-${SEGMENT_STATE.selected.fgToken}`);

    for (const label of ["All", "Stories"]) {
      const quiet = optionClasses(label);
      expect(quiet.box).not.toContain(`bg-${SEGMENT_STATE.selected.bgToken}`);
      // No unmodified fill at all: `active:bg-…` is the press tint, not the resting state.
      expect(quiet.box).not.toMatch(/(?<![\w\-:])bg-/);
      expect(quiet.text).toContain(`text-${SEGMENT_STATE.unselected.fgToken}`);
      expect(quiet.text).not.toBe(selected.text);
    }
  });

  it("meets the text minimum on both the selected fill and the unselected well", () => {
    const selected = contrastRatio(
      tokens.color[SEGMENT_STATE.selected.fgToken],
      tokens.color[SEGMENT_STATE.selected.bgToken],
    );
    const unselected = contrastRatio(
      tokens.color[SEGMENT_STATE.unselected.fgToken],
      tokens.color[SEGMENT_STATE.unselected.bgToken],
    );

    expect(selected).toBeGreaterThanOrEqual(4.5);
    expect(unselected).toBeGreaterThanOrEqual(4.5);
    // Distinct fills, so the selected pill reads as a pill and not as more beige.
    expect(
      contrastRatio(
        tokens.color[SEGMENT_STATE.selected.bgToken],
        tokens.color[SEGMENT_STATE.unselected.bgToken],
      ),
    ).toBeGreaterThanOrEqual(3);
  });

  it("gives every option the minimum touch target (Req 3.2)", () => {
    render(
      <SegmentedTabs
        options={OPTIONS}
        value="all"
        onChange={jest.fn()}
        accessibilityLabel="Content filter"
      />,
    );

    for (const option of OPTIONS) {
      expectTouchHeight(screen.getByRole("tab", { name: option.label }));
    }
  });

  it("calls onChange with the pressed option's key", () => {
    const onChange = jest.fn();
    render(
      <SegmentedTabs
        options={OPTIONS}
        value="all"
        onChange={onChange}
        accessibilityLabel="Content filter"
      />,
    );

    fireEvent.press(screen.getByRole("tab", { name: "Stories" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("stories");
  });

  it("marks only the selected option as selected", () => {
    render(
      <SegmentedTabs
        options={OPTIONS}
        value="games"
        onChange={jest.fn()}
        accessibilityLabel="Content filter"
      />,
    );

    expect(screen.getAllByRole("tab", { selected: true })).toHaveLength(1);
    expect(screen.getByRole("tab", { name: "Games" })).toBeSelected();
  });
});

describe("IconTile", () => {
  /** Every colour the rendered glyph carries, resolved to its token value. */
  function glyphColors(): readonly string[] {
    return screen
      .UNSAFE_getAllByProps({ name: "heart-outline" })
      .map((node) => node.props.color)
      .filter((value): value is string => typeof value === "string" && value.startsWith("#"));
  }

  // Phase 2 cleanup, fix 3: a category tile carries its pastel fill and its matching glyph,
  // and the glyph clears the 3:1 graphic minimum on that fill. Beige stays the default.
  const TONES: [IconTileTone, ColorToken, ColorToken][] = [
    ["rose", "glyph-rose", "tile-rose"],
    ["sky", "glyph-sky", "tile-sky"],
    ["amber", "glyph-amber", "tile-amber"],
    ["mint", "glyph-mint", "tile-mint"],
    ["lavender", "glyph-lavender", "tile-lavender"],
  ];

  it.each(TONES)("draws the %s tone with its own glyph", (tone, glyphToken, tileToken) => {
    render(<IconTile icon="heart-outline" tone={tone} testID="tile" />);

    expect(String(screen.getByTestId("tile").props.className)).toContain(`bg-${tileToken}`);
    expect(glyphColors()).toContain(tokens.color[glyphToken]);
    expect(contrastRatio(tokens.color[glyphToken], tokens.color[tileToken])).toBeGreaterThanOrEqual(
      3,
    );
  });

  it("defaults to the beige tile with the brand glyph", () => {
    render(<IconTile icon="heart-outline" testID="tile" />);

    expect(String(screen.getByTestId("tile").props.className)).toContain("bg-surface-beige");
    expect(glyphColors()).toContain(tokens.color.brand);
  });
});

describe("TabBar", () => {
  it("calls onSelect with the pressed tab's key", () => {
    const onSelect = jest.fn();
    renderWithSafeArea(<TabBar items={TAB_ITEMS} activeKey="home" onSelect={onSelect} />);

    fireEvent.press(screen.getByRole("tab", { name: "Play" }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("play");
  });

  it("marks exactly the active tab as selected and shows every label", () => {
    renderWithSafeArea(<TabBar items={TAB_ITEMS} activeKey="home" onSelect={jest.fn()} />);

    expect(screen.getAllByRole("tab", { selected: true })).toHaveLength(1);
    expect(screen.getByRole("tab", { name: "Home" })).toBeSelected();
    for (const item of TAB_ITEMS) expect(screen.getByText(item.label)).toBeOnTheScreen();
  });

  // Phase 2 styling-correctness pass: each item's minimum box is a rendered class.
  it("gives every tab a 44x44 pt box (Req 3.2)", () => {
    renderWithSafeArea(<TabBar items={TAB_ITEMS} activeKey="home" onSelect={jest.fn()} />);

    for (const item of TAB_ITEMS) {
      expectSquareTouchBox(screen.getByRole("tab", { name: item.label }));
    }
  });
});

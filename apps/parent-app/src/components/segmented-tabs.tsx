// Horizontal segmented control ("All / Games / Stories / Learning"). The container is a
// `tablist`; each option is a `tab` and only the active one reports `selected` (Req 2.7).
//
// The selected option is the control's most prominent element, as the Reference draws it: a
// filled `brand` pill with `on-brand` text. The unselected options are quieter: no fill, and
// `text-secondary` on the container's beige well.
//
// Why the fill is a class and never a `style` callback: NativeWind takes over the `style` prop
// of any element that carries a `className`, so a Pressable's style-as-function is never
// invoked (nativewind issue 1105). Phase 2.1 put the `brand` fill in that callback, so the fill
// never painted and the white label sat on the beige container at about 1.2:1 — the selected
// option read as the lightest, lowest-contrast one instead of the strongest. Every fill and
// press state here is a class.

import { Pressable, View } from "react-native";

import { tokens, type ColorToken } from "../theme/theme";

import { AppText, type TextTone } from "./app-text";

export type SegmentedOption = Readonly<{ key: string; label: string }>;

/** The one sized box: every option clears the 44 pt minimum (Req 3.2). */
const SEGMENT_BOX = { minHeight: tokens.size.touchMin } as const;

/**
 * The colour pair each state draws, so a test can read what the control applies instead of
 * restating the classes. Both pairs are listed Contrast_Pairs: `on-brand` on `brand` at 4.5
 * and `text-secondary` on `surface-beige` at 4.5.
 */
export const SEGMENT_STATE = {
  selected: { fill: "bg-brand", fg: "on-brand", bgToken: "brand", fgToken: "on-brand" },
  unselected: {
    fill: "",
    fg: "secondary",
    bgToken: "surface-beige",
    fgToken: "text-secondary",
  },
} as const satisfies Readonly<
  Record<
    "selected" | "unselected",
    Readonly<{ fill: string; fg: TextTone; bgToken: ColorToken; fgToken: ColorToken }>
  >
>;

/** The option's classes: the shared box, then the state's fill and its press tint. */
function optionClasses(selected: boolean): string {
  const base = "flex-1 items-center justify-center rounded-pill px-3";
  return selected
    ? `${base} ${SEGMENT_STATE.selected.fill} active:bg-brand-pressed`
    : `${base} active:bg-hairline`;
}

export type SegmentedTabsProps = Readonly<{
  options: readonly SegmentedOption[];
  value: string;
  onChange: (key: string) => void;
  accessibilityLabel: string;
  testID?: string;
}>;

export function SegmentedTabs({
  options,
  value,
  onChange,
  accessibilityLabel,
  testID,
}: SegmentedTabsProps): React.JSX.Element {
  return (
    <View
      testID={testID}
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      className="flex-row rounded-pill border border-hairline bg-surface-beige p-1"
    >
      {options.map((option) => {
        const selected = option.key === value;
        const state = selected ? SEGMENT_STATE.selected : SEGMENT_STATE.unselected;
        return (
          <Pressable
            key={option.key}
            accessibilityRole="tab"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            onPress={() => onChange(option.key)}
            className={optionClasses(selected)}
            style={SEGMENT_BOX}
          >
            <AppText variant="label" tone={state.fg}>
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

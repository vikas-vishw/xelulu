// Page indicator with two modes. Decorative (no `onSelect`): dots in a row at the Reference's
// spacing, hidden from accessibility. Interactive (`onSelect` given): each dot is centred in its
// own 44x44 pt Pressable, edge to edge with no hitSlop, so no two hit areas overlap and a press
// is well defined (Req 2.6, 21.1).

import { Pressable, View } from "react-native";

import { color, tokens } from "../theme/theme";

import { KIT_STRINGS } from "./strings";

const DOT = 8;

export type PageDotsProps = Readonly<{
  count: number;
  /** Zero-based current page. */
  index: number;
  /** Omit to leave the dots decorative and hidden from accessibility. */
  onSelect?: (next: number) => void;
  accessibilityLabel?: string;
  testID?: string;
}>;

function dotStyle(current: boolean): Readonly<{
  width: number;
  height: number;
  borderRadius: number;
  backgroundColor: string;
}> {
  return {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    backgroundColor: current ? color.brand : color["control-off"],
  };
}

export function PageDots({
  count,
  index,
  onSelect,
  accessibilityLabel,
  testID,
}: PageDotsProps): React.JSX.Element {
  const pages = Array.from({ length: count }, (_unused, page) => page);

  if (onSelect === undefined) {
    return (
      <View
        testID={testID}
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        className="flex-row items-center"
        style={{ gap: tokens.spacing["2"] }}
      >
        {pages.map((page) => (
          <View key={page} style={dotStyle(page === index)} />
        ))}
      </View>
    );
  }

  return (
    <View
      testID={testID}
      accessibilityRole={accessibilityLabel === undefined ? undefined : "tablist"}
      accessibilityLabel={accessibilityLabel}
      className="flex-row items-center"
    >
      {pages.map((page) => (
        <Pressable
          key={page}
          accessibilityRole="tab"
          accessibilityLabel={KIT_STRINGS.pageLabel(page + 1, count)}
          accessibilityState={{ selected: page === index }}
          onPress={() => onSelect(page)}
          className="items-center justify-center"
          style={{ width: tokens.size.touchMin, height: tokens.size.touchMin }}
        >
          <View style={dotStyle(page === index)} />
        </Pressable>
      ))}
    </View>
  );
}

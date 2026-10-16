// Stepped numeric control: minus, the formatted value as text, plus. Built from two Pressables
// because this phase adds no slider dependency (D7, D19). The value is always visible as text,
// and `accessibilityValue` carries min, max and now (Req 2.7).
//
// Each +/- control's 44x44 pt box, its disabled dimming and its press tint are classes.
// NativeWind claims the `style` prop of an element that carries a `className`, so a `style`
// function is never invoked and nothing inside one renders (nativewind issue 1105). The press
// tint is composed in only when the control is enabled, so a control at a bound cannot darken.

import { Pressable, View } from "react-native";

import { AppText } from "./app-text";
import { Icon } from "./icon";
import { KIT_STRINGS } from "./strings";

export type StepperProps = Readonly<{
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (next: number) => void;
  /** The accessible name of the whole control, e.g. "Volume". */
  label: string;
  /** Renders the visible value and `accessibilityValue.text`, e.g. (n) => `${n}%`. */
  format: (value: number) => string;
  testID?: string;
}>;

/** The shared box of a +/- control: the 44 pt square, its border and its fill. */
const CONTROL =
  "h-touch w-touch items-center justify-center rounded-pill border border-hairline bg-surface";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** The control's classes: the shared box, then either the dimmed bound or the press tint. */
function controlClasses(atBound: boolean): string {
  return `${CONTROL} ${atBound ? "opacity-disabled" : "active:bg-surface-beige"}`;
}

export function Stepper({
  value,
  min,
  max,
  step,
  onChange,
  label,
  format,
  testID,
}: StepperProps): React.JSX.Element {
  const atMin = value <= min;
  const atMax = value >= max;

  return (
    <View
      testID={testID}
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min, max, now: value, text: format(value) }}
      className="flex-row items-center"
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={KIT_STRINGS.stepperDecrease(label)}
        accessibilityState={{ disabled: atMin }}
        disabled={atMin}
        onPress={() => onChange(clamp(value - step, min, max))}
        className={controlClasses(atMin)}
      >
        <Icon name="remove" size="md" color="brand" decorative />
      </Pressable>

      <View className="min-w-12 items-center px-3">
        <AppText variant="heading" tone="primary">
          {format(value)}
        </AppText>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={KIT_STRINGS.stepperIncrease(label)}
        accessibilityState={{ disabled: atMax }}
        disabled={atMax}
        onPress={() => onChange(clamp(value + step, min, max))}
        className={controlClasses(atMax)}
      >
        <Icon name="add" size="md" color="brand" decorative />
      </Pressable>
    </View>
  );
}

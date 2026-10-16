// Vertical checklist with done / current / pending steps. The three states differ by glyph
// shape as well as by colour, and the state is in each row's accessibility label, so it is
// never carried by colour alone (Req 2.5, 21.3). Rows are not pressable: the screen's button
// drives `currentIndex`.

import { View } from "react-native";

import { color, tokens } from "../theme/theme";

import { AppText } from "./app-text";
import { Icon, type IconName } from "./icon";
import { KIT_STRINGS } from "./strings";

const CIRCLE = 28;
const CONNECTOR_WIDTH = 2;
const RING_WIDTH = 2;

export type Step = Readonly<{ key: string; title: string; icon: IconName }>;

export type StepListProps = Readonly<{
  steps: readonly Step[];
  /** Zero-based index of the current step. Steps before it are done, after it pending. */
  currentIndex: number;
  testID?: string;
}>;

type StepState = "done" | "current" | "pending";

function stateOf(index: number, currentIndex: number): StepState {
  if (index < currentIndex) return "done";
  if (index === currentIndex) return "current";
  return "pending";
}

function Circle({
  state,
  icon,
}: Readonly<{ state: StepState; icon: IconName }>): React.JSX.Element {
  const size = { width: CIRCLE, height: CIRCLE, borderRadius: tokens.radius.pill } as const;

  if (state === "done") {
    return (
      <View className="items-center justify-center bg-brand" style={size}>
        <Icon name="checkmark" size="sm" color="on-brand" decorative />
      </View>
    );
  }

  const ringColor = state === "current" ? color.brand : color["control-off"];
  return (
    <View
      className="items-center justify-center"
      style={[size, { borderWidth: RING_WIDTH, borderColor: ringColor }]}
    >
      <Icon
        name={icon}
        size="sm"
        color={state === "current" ? "brand" : "control-off"}
        decorative
      />
    </View>
  );
}

export function StepList({ steps, currentIndex, testID }: StepListProps): React.JSX.Element {
  return (
    <View testID={testID}>
      {steps.map((step, index) => {
        const state = stateOf(index, currentIndex);
        const last = index === steps.length - 1;
        return (
          <View key={step.key} className="flex-row">
            <View className="items-center" style={{ width: CIRCLE }}>
              <Circle state={state} icon={step.icon} />
              {last ? null : (
                <View
                  style={{
                    width: CONNECTOR_WIDTH,
                    flex: 1,
                    minHeight: tokens.spacing["3"],
                    backgroundColor: color.hairline,
                  }}
                />
              )}
            </View>
            <View
              accessible
              accessibilityLabel={`${step.title}, ${KIT_STRINGS.stepState[state]}`}
              className="ml-3 flex-1 justify-center"
              style={{ minHeight: CIRCLE, paddingBottom: last ? 0 : tokens.spacing["4"] }}
            >
              <AppText variant="heading" tone="primary">
                {step.title}
              </AppText>
            </View>
          </View>
        );
      })}
    </View>
  );
}

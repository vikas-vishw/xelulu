// A coloured dot plus its label. The label is always rendered, so a state is never shown by
// colour alone (Req 2.5, C8).

import { View } from "react-native";

import { color, tokens } from "../theme/theme";

import { AppText } from "./app-text";

export type StatusTone = "success" | "warning" | "danger" | "neutral";

const DOT_COLOR: Readonly<Record<StatusTone, string>> = {
  success: color.success,
  warning: color.warning,
  danger: color.danger,
  neutral: color["text-muted"],
};

const DOT = 8;

export type StatusPillProps = Readonly<{
  tone: StatusTone;
  label: string;
  className?: string;
  testID?: string;
}>;

export function StatusPill({ tone, label, className, testID }: StatusPillProps): React.JSX.Element {
  const classes = [
    // Background stays `surface`: the dot colours are the Contrast_Pairs listed on `surface`.
    "flex-row items-center self-start border border-hairline bg-surface px-2 py-1",
    className ?? "",
  ]
    .filter((part) => part.length > 0)
    .join(" ");
  return (
    <View testID={testID} className={classes} style={{ borderRadius: tokens.radius.pill }}>
      <View
        className="mr-1"
        style={{ width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: DOT_COLOR[tone] }}
      />
      <AppText variant="label" tone="primary">
        {label}
      </AppText>
    </View>
  );
}

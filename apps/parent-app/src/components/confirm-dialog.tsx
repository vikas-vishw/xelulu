// Modal confirmation. No animation (D11): the Modal is transparent with `animationType="none"`
// and the scrim is a flat fill at the `scrim` opacity token. The dialog carries the `alert` role
// and moves accessibility focus to its title when it opens (Req 2.11, 21.8).

import { useEffect, useRef } from "react";
import { AccessibilityInfo, findNodeHandle, Modal, View } from "react-native";

import { color, tokens } from "../theme/theme";

import { AppText } from "./app-text";
import { Button } from "./button";
import { Card } from "./card";

export type ConfirmAction = Readonly<{
  key: string;
  label: string;
  tone?: "neutral" | "danger";
}>;

export type ConfirmDialogProps = Readonly<{
  visible: boolean;
  title: string;
  body: string;
  cancelLabel: string;
  actions: readonly ConfirmAction[];
  onCancel: () => void;
  onAction: (key: string) => void;
  testID?: string;
}>;

export function ConfirmDialog({
  visible,
  title,
  body,
  cancelLabel,
  actions,
  onCancel,
  onAction,
  testID,
}: ConfirmDialogProps): React.JSX.Element {
  const titleRef = useRef<View>(null);

  useEffect(() => {
    if (!visible) return;
    const handle = findNodeHandle(titleRef.current);
    // A null handle is a silent no-op: the `alert` role plus accessibilityViewIsModal is the
    // documented fallback (Req 21.8).
    if (typeof handle === "number") AccessibilityInfo.setAccessibilityFocus(handle);
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onCancel}>
      <View
        className="absolute inset-0"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ backgroundColor: color.scrim, opacity: tokens.opacity.scrim }}
      />
      <View className="flex-1 items-center justify-center px-5">
        {/* The modal flag and the `alert` role sit on this wrapper, not on the Card: Req 1.3
            bars adding props to an existing kit component, and the Card's prop union pairs
            `accessibilityLabel` with `onPress`. The wrapper is deliberately not `accessible`:
            marking it so would collapse the dialog into one element and hide its own buttons.
            `testID` names the dialog here rather than the Modal, for the same reason. */}
        <View
          testID={testID}
          className="w-full"
          accessibilityViewIsModal
          accessibilityRole="alert"
          accessibilityLabel={title}
        >
          <Card className="w-full">
            <View ref={titleRef}>
              <AppText variant="heading" tone="primary">
                {title}
              </AppText>
            </View>
            <AppText variant="body" tone="secondary" className="mt-2">
              {body}
            </AppText>
            {/* The kit has primary and secondary only, and Req 1.3 bars a third variant, so a
                danger action takes the filled primary and a neutral one the secondary. */}
            {actions.map((action) => (
              <Button
                key={action.key}
                className="mt-4"
                label={action.label}
                variant={action.tone === "danger" ? "primary" : "secondary"}
                onPress={() => onAction(action.key)}
              />
            ))}
            <Button className="mt-3" label={cancelLabel} variant="secondary" onPress={onCancel} />
          </Card>
        </View>
      </View>
    </Modal>
  );
}

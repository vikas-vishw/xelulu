// Labelled text input: a surface box with a hairline border, an optional leading glyph, and in
// the trailing slot either the reveal control (while `secure` is set) or a decorative glyph.
// No floating label and no animation (Req 2.2, 2.12, 21.7).
//
// The field's height, the input's padding and the reveal control's 44x44 pt box and press tint
// are classes. NativeWind claims the `style` prop of an element that carries a `className`, so
// a `style` function is never invoked and nothing inside one renders (nativewind issue 1105).

import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";

import { color } from "../theme/theme";

import { AppText } from "./app-text";
import { Icon, type IconName } from "./icon";
import { KIT_STRINGS } from "./strings";

export type TextFieldProps = Readonly<{
  value: string;
  onChangeText: (next: string) => void;
  label?: string;
  placeholder?: string;
  /** Leading glyph inside the field. */
  icon?: IconName;
  /** Decorative trailing glyph inside the field, at its right edge. Never pressable.
   *  Ignored when `secure` is set, because the reveal control owns that slot. */
  trailingIcon?: IconName;
  secure?: boolean;
  keyboardType?: "default" | "email-address" | "numeric";
  autoCapitalize?: "none" | "sentences" | "words";
  autoCorrect?: boolean;
  maxLength?: number;
  errorText?: string;
  editable?: boolean;
  testID?: string;
}>;

export function TextField({
  value,
  onChangeText,
  label,
  placeholder,
  icon,
  trailingIcon,
  secure = false,
  keyboardType = "default",
  autoCapitalize = "sentences",
  autoCorrect = true,
  maxLength,
  errorText,
  editable = true,
  testID,
}: TextFieldProps): React.JSX.Element {
  const [revealed, setRevealed] = useState(false);
  const masked = secure && !revealed;

  return (
    <View>
      {label === undefined ? null : (
        <AppText variant="label" tone="secondary" className="mb-1">
          {label}
        </AppText>
      )}
      <View className="min-h-control flex-row items-center rounded-md border border-hairline bg-surface px-3">
        {icon === undefined ? null : (
          <View className="mr-2">
            <Icon name={icon} size="md" color="text-muted" decorative />
          </View>
        )}
        <TextInput
          testID={testID}
          accessibilityLabel={label ?? placeholder}
          accessibilityHint={errorText}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={color["text-muted"]}
          secureTextEntry={masked}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoCorrect={autoCorrect}
          maxLength={maxLength}
          editable={editable}
          className="flex-1 py-2 text-body text-text-primary"
        />
        {secure ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={masked ? KIT_STRINGS.showPassword : KIT_STRINGS.hidePassword}
            onPress={() => setRevealed(!revealed)}
            className="h-touch w-touch items-center justify-center rounded-pill active:bg-surface-beige"
          >
            <Icon
              name={masked ? "eye-outline" : "eye-off-outline"}
              size="md"
              color="text-muted"
              decorative
            />
          </Pressable>
        ) : trailingIcon === undefined ? null : (
          <View
            className="ml-2"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <Icon name={trailingIcon} size="md" color="text-muted" decorative />
          </View>
        )}
      </View>
      {errorText === undefined ? null : (
        <AppText variant="caption" tone="muted" className="mt-1">
          {errorText}
        </AppText>
      )}
    </View>
  );
}

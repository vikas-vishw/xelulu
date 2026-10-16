// Screen 3 of the Reference: the parent account form. Local state only — no provider SDK, no
// network call, no URL literal and no navigation from a provider press (Req 6.1-6.7, D17).
//
// One notice slot, with the Req 6.5 precedence: a provider press sets the provider line and it
// replaces the fill-in line until a field changes; otherwise a blank field shows the fill-in
// line; with all three filled and no provider pressed, no line shows.

import { router } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { AppText } from "../../components/app-text";
import { Button } from "../../components/button";
import { Icon, type IconName } from "../../components/icon";
import { Screen } from "../../components/screen";
import { TextField } from "../../components/text-field";
import { isBlank } from "../../lib/text";
import { tokens } from "../../theme/theme";
import { ROUTE_PATH } from "../shell/routes";
import { ScreenTitle } from "../shell/screen-title";
import { SCREEN_HEADER_NAME, SHELL_STRINGS } from "../shell/strings";

import { SETUP_STRINGS } from "./strings";

const NAME_MAX = 40;
const EMAIL_MAX = 80;
const PASSWORD_MAX = 64;
const PROVIDER_ROW_GAP = { gap: tokens.spacing["3"] } as const;

const ACCOUNT = SETUP_STRINGS.account;

/** An inert mock of a provider sign-in control: it shows a line and goes nowhere (Req 6.5). */
function ProviderButton({
  icon,
  label,
  onPress,
}: Readonly<{ icon: IconName; label: string; onPress: () => void }>): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={ACCOUNT.providerA11y(label)}
      onPress={onPress}
      className="min-h-control flex-1 flex-row items-center justify-center rounded-md border border-hairline bg-surface active:bg-surface-beige"
    >
      <Icon name={icon} size="md" color="text-primary" decorative />
      <AppText variant="heading" tone="primary" className="ml-2">
        {label}
      </AppText>
    </Pressable>
  );
}

export function AccountScreen(): React.JSX.Element {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const incomplete = isBlank(name) || isBlank(email) || isBlank(password);
  const noticeLine = notice ?? (incomplete ? ACCOUNT.fillAllFields : null);

  /** Any field change clears a provider notice, so the fill-in line can return (Req 6.5). */
  const onChange =
    (set: (next: string) => void) =>
    (next: string): void => {
      setNotice(null);
      set(next);
    };

  return (
    <Screen scroll>
      <ScreenTitle back align="center" name={SCREEN_HEADER_NAME.auth}>
        <AppText variant="heading" tone="secondary">
          {ACCOUNT.welcomeTo}
        </AppText>
        <AppText variant="display" tone="brand">
          {SHELL_STRINGS.wordmark}
        </AppText>
      </ScreenTitle>

      <View className="mt-2 items-center">
        <AppText variant="body" tone="secondary">
          {ACCOUNT.createYourAccount}
        </AppText>
      </View>

      <View className="mt-6">
        <TextField
          value={name}
          onChangeText={onChange(setName)}
          placeholder={ACCOUNT.parentName}
          icon="person-outline"
          maxLength={NAME_MAX}
          autoCapitalize="words"
        />
      </View>
      <View className="mt-3">
        <TextField
          value={email}
          onChangeText={onChange(setEmail)}
          placeholder={ACCOUNT.emailAddress}
          icon="mail-outline"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={EMAIL_MAX}
        />
      </View>
      <View className="mt-3">
        <TextField
          value={password}
          onChangeText={onChange(setPassword)}
          placeholder={ACCOUNT.password}
          icon="lock-closed-outline"
          secure
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={PASSWORD_MAX}
        />
      </View>

      <View className="mt-5">
        <Button
          label={ACCOUNT.createAccount}
          disabled={incomplete}
          onPress={() => router.push(ROUTE_PATH["pair-device"])}
        />
      </View>

      {noticeLine === null ? null : (
        <View className="mt-2 items-center">
          <AppText variant="caption" tone="muted">
            {noticeLine}
          </AppText>
        </View>
      )}

      <View className="mt-5 flex-row items-center">
        <View className="flex-1 border-t border-hairline" />
        <AppText variant="caption" tone="muted" className="mx-3">
          {ACCOUNT.orContinueWith}
        </AppText>
        <View className="flex-1 border-t border-hairline" />
      </View>

      <View className="mt-4 flex-row" style={PROVIDER_ROW_GAP}>
        <ProviderButton
          icon="logo-google"
          label={ACCOUNT.google}
          onPress={() => setNotice(ACCOUNT.providerUnavailable(ACCOUNT.google))}
        />
        <ProviderButton
          icon="logo-apple"
          label={ACCOUNT.apple}
          onPress={() => setNotice(ACCOUNT.providerUnavailable(ACCOUNT.apple))}
        />
      </View>

      {/* Static text: no press handler, no link, no URL (Req 6.7, 22.7). */}
      <View className="mt-6 items-center">
        {ACCOUNT.terms.map((line) => (
          <AppText key={line} variant="caption" tone="muted">
            {line}
          </AppText>
        ))}
      </View>
    </Screen>
  );
}

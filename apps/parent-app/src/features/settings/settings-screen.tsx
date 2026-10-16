// Screen 16b: the Settings list. Founder-directed from the step brief, so it has no Reference
// cell of its own (Req 18.4). No network call, no environment read and no secret, token, key
// name or endpoint anywhere (Req 18.7, 22.1, 22.2).

import { router } from "expo-router";
import { View } from "react-native";

import { Card } from "../../components/card";
import { ListRow } from "../../components/list-row";
import { Screen } from "../../components/screen";
import { ScreenHeader } from "../../components/screen-header";
import { isStackRoute, ROUTE_PATH } from "../shell/routes";
import { SCREEN_HEADER_NAME } from "../shell/strings";

import { SETTINGS_ROWS, SETTINGS_STRINGS, type SettingsRouteKey } from "./strings";

// Tab routes are reached with navigate so the tabs group is not pushed twice; stack routes
// push. `/routines` is the only tab route among the five, and `app/_layout.tsx` is a root Stack
// with `(tabs)` as one screen, so pushing it would leave a back stack of
// `(tabs) -> /settings -> (tabs)`.
const open = (key: SettingsRouteKey): void =>
  isStackRoute(key) ? router.push(ROUTE_PATH[key]) : router.navigate(ROUTE_PATH[key]);

export function SettingsScreen(): React.JSX.Element {
  return (
    <Screen scroll>
      <ScreenHeader title={SCREEN_HEADER_NAME.settings} back />

      {/* One grouped Card with a hairline between the rows, as the other list screens draw. */}
      <Card className="mt-4" padded={false}>
        {SETTINGS_ROWS.map((row, index) => {
          const route = row.route;
          return (
            <View key={row.key} className={index === 0 ? undefined : "border-t border-hairline"}>
              {route === undefined ? (
                <ListRow
                  icon={row.icon}
                  title={row.title}
                  trailingText={SETTINGS_STRINGS.laterPhase}
                  trailing="none"
                />
              ) : (
                <ListRow icon={row.icon} title={row.title} onPress={() => open(route)} />
              )}
            </View>
          );
        })}
      </Card>
    </Screen>
  );
}

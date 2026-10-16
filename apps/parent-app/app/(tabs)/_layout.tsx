import { Tabs } from "expo-router";
import type { ComponentProps } from "react";

import type { IconName } from "../../src/components/icon";
import { TabBar, type TabBarItem } from "../../src/components/tab-bar";
import { TAB_KEYS, type TabKey } from "../../src/features/shell/routes";
import { TAB_LABEL } from "../../src/features/shell/strings";

/** Expo Router's `tabBar` callback argument, taken from Tabs so no navigation import is needed. */
type TabBarRenderProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

const TAB_ICON: Readonly<Record<TabKey, Readonly<{ icon: IconName; iconActive: IconName }>>> = {
  home: { icon: "home-outline", iconActive: "home" },
  play: { icon: "game-controller-outline", iconActive: "game-controller" },
  grow: { icon: "school-outline", iconActive: "school" },
  routines: { icon: "calendar-outline", iconActive: "calendar" },
  family: { icon: "people-outline", iconActive: "people" },
};

const ITEMS: readonly TabBarItem[] = TAB_KEYS.map((key) => ({
  key,
  label: TAB_LABEL[key],
  icon: TAB_ICON[key].icon,
  iconActive: TAB_ICON[key].iconActive,
}));

function isTabKey(name: string): name is TabKey {
  return (TAB_KEYS as readonly string[]).includes(name);
}

/** Adapts the kit's Tab_Bar to the navigator: active tab from the state, tabPress then navigate. */
function ShellTabBar({ state, navigation }: TabBarRenderProps) {
  const current = state.routes[state.index]?.name ?? TAB_KEYS[0];
  const activeKey: TabKey = isTabKey(current) ? current : TAB_KEYS[0];

  return (
    <TabBar
      items={ITEMS}
      activeKey={activeKey}
      onSelect={(key) => {
        const route = state.routes.find((candidate) => candidate.name === key);
        if (route === undefined) return;
        const event = navigation.emit({
          type: "tabPress",
          target: route.key,
          canPreventDefault: true,
        });
        if (!event.defaultPrevented) navigation.navigate(route.name);
      }}
    />
  );
}

// The five bottom tabs, declared in the Reference's order: Home, Play, Grow, Routines, Family.
export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <ShellTabBar {...props} />}>
      <Tabs.Screen name="home" />
      <Tabs.Screen name="play" />
      <Tabs.Screen name="grow" />
      <Tabs.Screen name="routines" />
      <Tabs.Screen name="family" />
    </Tabs>
  );
}

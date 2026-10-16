// Screen 11 of the Reference: the Device page.
//
// The robot's firmware decides what is physically safe and the app cannot override it
// (safety.md s.5): no movement while Xelulu is lifted, at an edge, charging or in quiet hours,
// motor limits in firmware, an e-stop independent of the AI. This screen therefore SENDS NO
// COMMAND OF ANY KIND (Req 14.9). Every control flips a local value over mock data, with no
// network call and no environment read (Req 22.1, 22.2).
//
// There is no camera in v1 (product.md v1 facts, D3), so the camera row is static text saying
// the model has none: no toggle, no switch, no press handler and no video view anywhere.
//
// Deviations from the frozen Reference, all reported: the Movement row carries the Toggle the
// Reference draws on the Camera (Privacy) row, because v1 removes that row's control (D24a,
// D3); the Volume slider becomes the kit Stepper (D7), which prints the percentage where the
// Reference prints it as the row's subtitle — once either way; and `/device` is a Stack_Route,
// so the tab bar the Reference draws is absent.

import { useState } from "react";
import { View, type DimensionValue } from "react-native";

import { CharacterPlaceholder } from "../../character/character-placeholder";
import { AppText } from "../../components/app-text";
import { Button } from "../../components/button";
import { Card } from "../../components/card";
import { IconTile } from "../../components/icon-tile";
import { ListRow } from "../../components/list-row";
import { Screen } from "../../components/screen";
import { StatusPill, type StatusTone } from "../../components/status-pill";
import { Stepper } from "../../components/stepper";
import { batteryTone } from "../../lib/battery";
import { color, tokens } from "../../theme/theme";
import { ScreenTitle } from "../shell/screen-title";
import { SCREEN_HEADER_NAME } from "../shell/strings";

import { MOCK_DEVICE, type DeviceData, type DevicePanelKey } from "./mock-device";
import { DEVICE_STRINGS } from "./strings";

/** The robot well and the drawing inside it. */
const WELL = { width: 150, height: 130 } as const;
const CHARACTER_SIZE = 110;

const VOLUME_MIN = 0;
const VOLUME_MAX = 100;
const VOLUME_STEP = 5;

/**
 * The battery bar's fill colour per tone. Each of the four is a listed Contrast_Pair on
 * `hairline`, the track colour: `success`, `warning` and `danger` at the 3:1 graphic minimum,
 * and the neutral tone's `text-muted` at the same minimum (4.40).
 */
const BAR_FILL: Readonly<Record<StatusTone, string>> = {
  success: color.success,
  warning: color.warning,
  danger: color.danger,
  neutral: color["text-muted"],
};

/** The battery bar's fill, so a test can read the tone the graphic draws (Req 14.7, 14.8). */
export const BATTERY_FILL_TEST_ID = "device-battery-fill";

/** The fill's share of the track, clamped so a stray mock value cannot overflow it. */
function barWidth(batteryPct: number): DimensionValue {
  const clamped = Math.min(100, Math.max(0, Math.round(batteryPct)));
  return `${clamped}%`;
}

export type DeviceScreenProps = Readonly<{ data?: DeviceData }>;

export function DeviceScreen({ data = MOCK_DEVICE }: DeviceScreenProps): React.JSX.Element {
  const [movement, setMovement] = useState(data.movement_enabled);
  const [volume, setVolume] = useState(data.volume_pct);
  /** One inline detail panel at a time; `null` is none open. */
  const [openPanel, setOpenPanel] = useState<DevicePanelKey | null>(null);

  const togglePanel = (key: DevicePanelKey): void => {
    setOpenPanel(openPanel === key ? null : key);
  };

  const tone = batteryTone(data.battery_pct);

  const panel = (key: DevicePanelKey): React.JSX.Element | null => {
    if (openPanel !== key) return null;
    return (
      <Card className="mt-2">
        {data.panels[key].map((line) => (
          <AppText key={line} variant="body" tone="secondary" className="mb-2">
            {line}
          </AppText>
        ))}
        <Button
          label={DEVICE_STRINGS.closePanel}
          variant="secondary"
          onPress={() => setOpenPanel(null)}
        />
      </Card>
    );
  };

  return (
    <Screen scroll>
      <ScreenTitle back name={SCREEN_HEADER_NAME.device}>
        <AppText variant="title" tone="primary">
          {data.display_name}
        </AppText>
      </ScreenTitle>
      <AppText variant="label" tone="muted" className="mt-1">
        {data.room_label}
      </AppText>

      {/* The robot well beside the online-and-battery card, as the Reference places them. */}
      <View className="mt-4 flex-row items-center">
        <View
          className="items-center justify-center bg-surface-beige"
          style={{ ...WELL, borderRadius: tokens.radius.xl }}
        >
          <CharacterPlaceholder size={CHARACTER_SIZE} />
        </View>
        <Card className="ml-3 flex-1">
          <StatusPill
            tone={data.online ? "success" : "neutral"}
            label={data.online ? DEVICE_STRINGS.online : DEVICE_STRINGS.offline}
          />
          <AppText variant="heading" tone="primary" className="mt-2">
            {DEVICE_STRINGS.batteryLabel(data.battery_pct)}
          </AppText>
          {/* A graphic only: the percentage above it carries the value (Req 21.3). */}
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            className="mt-2 h-2 w-full overflow-hidden bg-hairline"
            style={{ borderRadius: tokens.radius.pill }}
          >
            <View
              testID={BATTERY_FILL_TEST_ID}
              className="h-2"
              style={{ width: barWidth(data.battery_pct), backgroundColor: BAR_FILL[tone] }}
            />
          </View>
        </Card>
      </View>

      {/* The six setting rows: one Card each, with a gap between them, as the Reference draws
          them. The Movement switch is the screen's only switch.

          Tile rule for this screen, decided by sampling the magnified Reference: a row carries
          a pastel tone only where the Reference draws a distinct hue, and that is only the two
          green rows, Movement and Software & Health, both `mint`. Volume, Quiet Hours, Camera
          and Sleep / Wake are all neutral warm greys within a few percent of each other and of
          the card behind them, so all four keep the default beige. The sampled values and the
          reasoning are in docs/design-system.md. */}
      <Card className="mt-4" padded={false}>
        <ListRow
          icon="walk-outline"
          iconTone="mint"
          title={DEVICE_STRINGS.movement.title}
          subtitle={movement ? DEVICE_STRINGS.movement.enabled : DEVICE_STRINGS.movement.disabled}
          trailing={{
            toggle: {
              value: movement,
              onValueChange: setMovement,
              accessibilityLabel: DEVICE_STRINGS.movement.title,
            },
          }}
        />
      </Card>

      <Card className="mt-3">
        <View className="flex-row items-center">
          <IconTile icon="volume-high-outline" />
          {/* The percentage is printed once, by the Stepper: it is the control a parent acts
              on and the element carrying accessibilityValue (min, max, now). */}
          <View className="ml-3 flex-1">
            <AppText variant="heading" tone="primary">
              {DEVICE_STRINGS.volume.title}
            </AppText>
          </View>
          <Stepper
            value={volume}
            min={VOLUME_MIN}
            max={VOLUME_MAX}
            step={VOLUME_STEP}
            onChange={setVolume}
            label={DEVICE_STRINGS.volume.title}
            format={DEVICE_STRINGS.volume.value}
          />
        </View>
      </Card>

      <Card className="mt-3" padded={false}>
        <ListRow
          icon="moon-outline"
          title={DEVICE_STRINGS.quietHours.title}
          subtitle={data.quiet_hours_label}
          onPress={() => togglePanel("quiet-hours")}
        />
      </Card>
      {panel("quiet-hours")}

      {/* Static text, not a control: v1 has no lens (Req 14.4, D3). */}
      <Card className="mt-3" padded={false}>
        <ListRow
          icon="camera-outline"
          title={DEVICE_STRINGS.cameraRow.title}
          subtitle={DEVICE_STRINGS.cameraRow.subtitle}
          trailing="none"
        />
      </Card>

      <Card className="mt-3" padded={false}>
        <ListRow
          icon="bed-outline"
          title={DEVICE_STRINGS.sleepWake.title}
          subtitle={DEVICE_STRINGS.sleepWake.subtitle}
          onPress={() => togglePanel("sleep-wake")}
        />
      </Card>
      {panel("sleep-wake")}

      <Card className="mt-3" padded={false}>
        <ListRow
          icon="shield-checkmark-outline"
          iconTone="mint"
          title={DEVICE_STRINGS.software.title}
          subtitle={data.software_label}
          onPress={() => togglePanel("software")}
        />
      </Card>
      {panel("software")}
    </Screen>
  );
}

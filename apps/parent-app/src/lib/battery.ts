// The one place C05's charge-reminder thresholds live, so Home's status pill and the Device
// screen's battery readout cannot drift apart (D15). The percentage is always shown as text
// beside the tone, so a battery state is never carried by colour alone (Req 21.3).

import type { StatusTone } from "../components/status-pill";

/** 20 % and up success, 10-19 % warning, under 10 % danger (C05, D15). Never throws. */
export function batteryTone(batteryPct: number): StatusTone {
  if (batteryPct >= 20) return "success";
  if (batteryPct >= 10) return "warning";
  return "danger";
}

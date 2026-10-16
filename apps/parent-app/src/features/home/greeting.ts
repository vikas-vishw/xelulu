// Time-of-day greeting (C12). Pure: the caller injects the clock, so no test depends on the
// wall clock. Boundaries are local hours 05:00, 12:00 and 17:00.

import type { IconName } from "../../components/icon";

export type Greeting = Readonly<{
  text: "Good morning" | "Good afternoon" | "Good evening";
  icon: Extract<IconName, "sunny" | "partly-sunny" | "moon">;
}>;

const MORNING: Greeting = { text: "Good morning", icon: "sunny" };
const AFTERNOON: Greeting = { text: "Good afternoon", icon: "partly-sunny" };
const EVENING: Greeting = { text: "Good evening", icon: "moon" };

/** 05:00–11:59 morning, 12:00–16:59 afternoon, 17:00–04:59 evening. */
export function greetingFor(date: Date): Greeting {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return MORNING;
  if (hour >= 12 && hour < 17) return AFTERNOON;
  return EVENING;
}

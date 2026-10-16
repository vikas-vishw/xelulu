// Home Dashboard mock data (C12, C14). Nothing here comes from a network call, an environment
// variable or a device. The shared domain types are imported as types only (Req 8.3).

import type { ChildProfile, Device, User } from "@xelulu/shared";

import { MOCK_IDENTITY } from "../../lib/mock-identity";

export type HomeData = Readonly<{
  parent: Pick<User, "display_name">;
  child: Pick<ChildProfile, "child_id" | "display_name">;
  device: Pick<Device, "device_id" | "display_name"> &
    Readonly<{ online: boolean; battery_pct: number }>;
  /** C13: `mood_label` is a static label. No code computes, infers or stores a mood. */
  today: Readonly<{ activities: number; play_minutes: number; mood_label: string }>;
  last_activity: Readonly<{ title: string; subtitle: string; time_label: string }>;
}>;

export const MOCK_HOME: HomeData = {
  parent: { display_name: MOCK_IDENTITY.parent },
  child: { child_id: MOCK_IDENTITY.childId, display_name: MOCK_IDENTITY.child },
  device: {
    device_id: MOCK_IDENTITY.deviceId,
    display_name: MOCK_IDENTITY.device,
    online: true,
    battery_pct: 78,
  },
  today: { activities: 3, play_minutes: 25, mood_label: "Great Mood" },
  last_activity: { title: "Story Time", subtitle: "The Brave Elephant", time_label: "10:30 AM" },
};

// The names and identifiers every Mock_Module shares, so the same parent, child, second child,
// device and room appear with the same names on every screen (Req 19.6). Display names,
// identifiers and labels only: no child audio, no transcript and no raw value (Req 19.5).
//
// No household id: no Mock_Module in this phase renders or carries one, and an unused constant
// is one more thing to keep true. Phase 3 adds it when a real row needs it.

export const MOCK_IDENTITY = {
  parent: "Mom",
  otherParent: "Dad",
  child: "Aarav",
  secondChild: "Diya",
  grandparent: "Grandma",
  caregiver: "Meera",
  device: "Xelulu",
  room: "Living Room",
  childId: "child_mock_1",
  secondChildId: "child_mock_2",
  deviceId: "xlu_mock_1",
} as const;

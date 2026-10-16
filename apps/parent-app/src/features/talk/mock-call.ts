// Screen 7's mock session state (Req 19.1, 19.5). Two display labels, nothing else: no audio,
// no transcript, no stream handle and no duration timer (D18).

export type CallData = Readonly<{ status_label: string; duration_label: string }>;

export const MOCK_CALL: CallData = { status_label: "Connected", duration_label: "0:42" };

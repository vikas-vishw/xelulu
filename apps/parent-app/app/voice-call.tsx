import { LiveCallScreen } from "../src/features/talk/live-call-screen";

// C10 note: the live session is audio and status only. There is no video and no camera in v1,
// so no "Live View" ever shows a picture (product.md v1 facts). Screen:
// src/features/talk/live-call-screen.tsx.
export default function VoiceCallRoute() {
  return <LiveCallScreen />;
}

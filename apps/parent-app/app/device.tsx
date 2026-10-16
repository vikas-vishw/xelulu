import { DeviceScreen } from "../src/features/device/device-screen";

// Route pointer: the Camera row is static text, "Not included on this model" — v1 has no
// camera and no video view (product.md v1 facts, D3). Screen:
// src/features/device/device-screen.tsx.
export default function DeviceRoute() {
  return <DeviceScreen />;
}

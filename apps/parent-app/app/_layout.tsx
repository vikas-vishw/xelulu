import "../global.css";

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

// Root stack. Every header is hidden: each screen draws its own ScreenHeader (C10).
// Light theme only (C9), so the status bar is always dark-on-light.
export default function RootLayout() {
  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}

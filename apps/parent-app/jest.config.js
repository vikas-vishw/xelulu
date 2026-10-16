// Jest config for the parent app (Phase 2.1 C16). Smoke and key-interaction tests only,
// all example-based; no fast-check. Vitest's include list never covers apps/parent-app/test.
//
// NativeWind under Jest: the app's babel.config.js sets `jsxImportSource: "nativewind"`.
// A task 1.1 probe rendered `<Text className="text-body">hi</Text>` through the jest-expo
// preset with that config and it passed, so the design's Jest-only babel override (dropping
// `jsxImportSource` when running under Jest) is NOT needed. If the transform ever breaks,
// apply that override here and in babel.config.js.
//
// `app/_layout.tsx` imports `../global.css` (the NativeWind entry stylesheet). Metro compiles
// it; Jest has no CSS transform, so every `.css` import is mapped to an empty module. Class
// names still reach the tree as props, which is all these tests assert on.
module.exports = {
  preset: "jest-expo",
  testMatch: ["<rootDir>/test/**/*.test.{ts,tsx}"],
  moduleNameMapper: { "\\.css$": "<rootDir>/test/style-stub.ts" },
};

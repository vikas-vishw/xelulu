/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // Placeholder palette: single source, read by tooling/test/contrast.test.ts.
        placeholder: {
          bg: "#FFFFFF",
          title: "#1F2937",
          body: "#374151",
          "bg-dark": "#111827",
          "title-dark": "#F9FAFB",
          "body-dark": "#E5E7EB",
        },
      },
    },
  },
  plugins: [],
};

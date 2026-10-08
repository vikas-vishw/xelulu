import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Internal-only console: dev and preview servers bind to loopback only, on fixed ports.
export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true },
});

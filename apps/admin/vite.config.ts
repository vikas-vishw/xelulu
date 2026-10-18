import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

import {
  contentAdminMode,
  DEV_HOST,
  DEV_PORT,
  deviceControlMode,
  operatorProxy,
} from "./vite-proxy";

// The repo root holds the one `.env` (two levels up from apps/admin).
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

// The same non-secret local port `docker-compose.yml` defaults the Operator_Surface to. A root
// `.env` is optional now that Compose carries local defaults, so an absent or empty key means
// "the local Compose default", not "no proxy". A present but invalid value still turns the
// proxy off loudly below (Req 4.3).
const DEFAULT_OPERATOR_PORT = "8090";

// Internal-only console: dev and preview servers bind to loopback only, on fixed ports.
export default defineConfig(({ command, mode }) => {
  // The only environment access in this file (Req 4.6): one non-secret local port.
  const env = loadEnv(mode, REPO_ROOT, "GATEWAY_OPERATOR_PORT");
  const configured = env["GATEWAY_OPERATOR_PORT"];
  const unset = configured === undefined || configured === "";
  const rawPort = unset ? DEFAULT_OPERATOR_PORT : configured;
  // The write routes are forwarded only in content-admin mode, which comes from Vite's `mode`
  // and not from the environment (Phase 4 Req 18.2, 18.5).
  const contentAdmin = contentAdminMode(mode);
  // The one command route is forwarded only in device-control mode, its own mode and not the
  // content one: editing content and firing commands are different powers (Phase 6 Req 5.8).
  const deviceControl = deviceControlMode(mode);
  const proxy =
    command === "serve" ? operatorProxy(rawPort, { contentAdmin, deviceControl }) : null;

  if (command === "serve" && unset) {
    // The key name only, never a value.
    console.info(
      `admin dev proxy: GATEWAY_OPERATOR_PORT is unset, using the local Compose default ${DEFAULT_OPERATOR_PORT}`,
    );
  }

  if (command === "serve" && proxy === null) {
    // Req 4.3: one line, the key name only, never its value.
    console.warn("admin dev proxy off: GATEWAY_OPERATOR_PORT is missing or not a port 1-65535");
  }

  return {
    plugins: [react()],
    server: {
      host: DEV_HOST,
      port: DEV_PORT,
      strictPort: true,
      // Req 4.5: no CORS headers; Vite's default allowedHosts check stays on.
      cors: false,
      ...(proxy === null ? {} : { proxy }),
    },
    preview: { host: "127.0.0.1", port: 4173, strictPort: true },
  };
});

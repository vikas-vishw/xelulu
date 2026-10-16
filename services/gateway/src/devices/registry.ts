// One-device prototype registry (G5, Req 5.1–5.7, 9.2): the only Registered_Device is DEVICE_ID,
// with DEVICE_TOKEN as its token. Tokens are compared in constant time: both SHA-256 digests are
// always computed and compared with timingSafeEqual, so the time taken does not depend on where
// two strings differ or on their lengths. Only the token's digest and length are kept.
import { createHash, timingSafeEqual } from "node:crypto";

export interface Registry {
  isRegistered(deviceId: string): boolean;
  isAuthFailed(deviceId: string): boolean;
  /** Constant-time token check; marks or clears auth_failed. */
  checkHello(deviceId: string, auth: string): "ok" | "failed";
  /** Bearer token -> device id, constant-time against each registered token. */
  deviceForToken(token: string): string | null;
  helloSeen(deviceId: string): boolean;
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function createRegistry(device: {
  readonly deviceId: string;
  readonly token: string;
}): Registry {
  const deviceId = device.deviceId;
  const tokenDigest = sha256(device.token);
  const tokenLength = device.token.length;
  // In memory only, so every device starts unmarked (Req 5.7).
  const authFailed = new Set<string>();
  const hellos = new Set<string>();

  function matches(candidate: string): boolean {
    const same = timingSafeEqual(sha256(candidate), tokenDigest);
    return same && candidate.length === tokenLength;
  }

  return {
    isRegistered: (id) => id === deviceId,
    isAuthFailed: (id) => authFailed.has(id),
    checkHello(id, auth) {
      const ok = matches(auth);
      if (id !== deviceId) return "failed";
      hellos.add(id);
      if (ok) {
        authFailed.delete(id);
        return "ok";
      }
      authFailed.add(id);
      return "failed";
    },
    deviceForToken(token) {
      return matches(token) ? deviceId : null;
    },
    helloSeen: (id) => hellos.has(id),
  };
}

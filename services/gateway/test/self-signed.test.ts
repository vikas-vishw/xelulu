// Checks for the test-time certificate helper (test/support/self-signed.ts): the DER it builds
// parses as X.509, and each variant fails (or, for `valid`, passes) TLS verification for the
// reason it is named after, against a loopback TLS server. The client writes nothing until the
// handshake succeeds, so the server never sees application data from a failed attempt.
import { X509Certificate } from "node:crypto";
import type { AddressInfo } from "node:net";
import { connect, createServer, type Server } from "node:tls";
import { afterEach, describe, expect, it } from "vitest";

import {
  CERT_VARIANTS,
  oid,
  selfSignedCert,
  time,
  uint,
  WRONG_HOST_NAME,
} from "./support/self-signed.js";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

type Outcome = { ok: true } | { ok: false; code: string | undefined };

async function handshake(variant: (typeof CERT_VARIANTS)[number]): Promise<{
  outcome: Outcome;
  received: number;
}> {
  const { cert, key, ca } = selfSignedCert(variant);
  let received = 0;
  const server = createServer({ cert, key }, (socket) => {
    socket.on("data", (chunk: Buffer) => (received += chunk.byteLength));
    socket.on("error", () => undefined);
  });
  server.on("tlsClientError", () => undefined);
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;

  const outcome = await new Promise<Outcome>((resolve) => {
    const socket = connect({ host: "127.0.0.1", port, ca });
    socket.once("secureConnect", () => {
      socket.end();
      resolve({ ok: true });
    });
    socket.once("error", (err: Error & { code?: string }) => {
      resolve({ ok: false, code: err.code });
    });
  });
  await new Promise((r) => setTimeout(r, 50));
  return { outcome, received };
}

describe("self-signed certificate helper", () => {
  it("encodes DER primitives as X.690 requires", () => {
    expect(oid("1.2.840.10045.4.3.2").toString("hex")).toBe("06082a8648ce3d040302");
    expect(uint(Buffer.from([0x80])).toString("hex")).toBe("02020080");
    expect(uint(Buffer.from([0x00, 0x01])).toString("hex")).toBe("020101");
    expect(
      time(Date.UTC(2026, 9, 8, 1, 2, 3))
        .toString("ascii")
        .slice(2),
    ).toBe("261008010203Z");
    expect(
      time(Date.UTC(2050, 0, 1))
        .subarray(0, 1)
        .toString("hex"),
    ).toBe("18");
  });

  it.each(CERT_VARIANTS)("builds a parsable, self-signed %s certificate", (variant) => {
    const now = Date.now();
    const { cert, ca } = selfSignedCert(variant, now);
    const x509 = new X509Certificate(cert);
    expect(x509.verify(x509.publicKey)).toBe(true);
    expect(x509.ca).toBe(true);
    expect(cert === ca).toBe(variant !== "untrusted");
    if (variant === "wrong_host") {
      expect(x509.checkIP("127.0.0.1")).toBeUndefined();
      expect(x509.checkHost(WRONG_HOST_NAME)).toBe(WRONG_HOST_NAME);
    } else {
      expect(x509.checkIP("127.0.0.1")).toBe("127.0.0.1");
      expect(x509.checkHost("localhost")).toBe("localhost");
    }
    const expired = Date.parse(x509.validTo) < now;
    expect(expired).toBe(variant === "expired");
  });

  it("valid passes verification against its own trust anchor", async () => {
    const { outcome } = await handshake("valid");
    expect(outcome).toEqual({ ok: true });
  });

  it.each([
    ["untrusted", ["SELF_SIGNED_CERT_IN_CHAIN", "DEPTH_ZERO_SELF_SIGNED_CERT"]],
    ["expired", ["CERT_HAS_EXPIRED"]],
    ["wrong_host", ["ERR_TLS_CERT_ALTNAME_INVALID"]],
  ] as const)("%s fails verification and the server receives no data", async (variant, codes) => {
    const { outcome, received } = await handshake(variant);
    expect(outcome.ok).toBe(false);
    expect(codes).toContain(outcome.ok ? "" : outcome.code);
    expect(received).toBe(0);
  });
});

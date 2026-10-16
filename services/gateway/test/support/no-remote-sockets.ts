// Test helper (not a test): the socket guard of Req 22.8. The brain must reach no network at all —
// no vendor API, no fetch, no socket — so a brain test installs this guard and the test fails the
// moment anything tries to connect to a non-loopback address. The gateway's own listeners and the
// loopback sockets the harness opens are untouched, so an installed guard changes nothing about a
// passing test. Only the target address is read; no payload, header or body is ever inspected.
import net from "node:net";
import tls from "node:tls";

import { expect } from "vitest";

/**
 * A connect call this guard allows: a loopback name, the IPv6 loopback, the IPv4-mapped loopback,
 * or an unset host (`connect({ port })` resolves to loopback). The wildcard bind addresses
 * `0.0.0.0` and `::` are deliberately *not* here: they are addresses to listen on, not targets to
 * dial, so a connect naming one is treated as remote and refused.
 */
const LOOPBACK_HOSTS = new Set(["", "localhost", "::1", "::ffff:127.0.0.1"]);

/** True for a host a test may connect to: the loopback names, 127.0.0.0/8, or an unset host. */
export function isLoopbackHost(host: string | undefined): boolean {
  if (host === undefined) return true;
  const bare = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (LOOPBACK_HOSTS.has(bare)) return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(bare);
}

type ConnectOptions = { host?: unknown; port?: unknown; path?: unknown };

/**
 * The host of a `connect(...)` call: `(options)`, `(port, host?)`, `(path)`, or the normalised
 * `[options, callback]` array `net.connect` hands to `Socket.prototype.connect`.
 */
function hostOf(args: readonly unknown[]): string | undefined {
  const first = args[0];
  if (Array.isArray(first)) return hostOf(first as readonly unknown[]);
  if (typeof first === "object" && first !== null) {
    const options = first as ConnectOptions;
    if (typeof options.path === "string") return undefined; // a unix socket, not an address
    return typeof options.host === "string" ? options.host : undefined;
  }
  if (typeof first === "string") return undefined; // a pipe or unix socket path
  return typeof args[1] === "string" ? args[1] : undefined;
}

/** Every refused target this guard saw, newest last. Addresses only. */
export type RemoteAttempts = readonly string[];

export interface SocketGuard {
  /** The non-loopback targets refused so far, for an explicit end-of-test assertion. */
  attempts(): RemoteAttempts;
  /** Restores the real connect functions. Safe to call twice. */
  restore(): void;
}

/**
 * Wraps the socket constructors for the rest of the test. A connection to a non-loopback address
 * is refused before it is made, recorded, and failed through `expect` so the test cannot pass by
 * swallowing the error.
 */
export function installNoRemoteSockets(): SocketGuard {
  const attempts: string[] = [];
  const realSocketConnect = net.Socket.prototype.connect;
  const realTlsConnect = tls.connect;
  let restored = false;

  function refuse(host: string): never {
    attempts.push(host);
    expect(host, "a test opened a socket to a non-loopback address").toBe("127.0.0.1");
    throw new Error("remote socket refused");
  }

  const guardedSocketConnect = function (this: net.Socket, ...args: unknown[]): net.Socket {
    const host = hostOf(args);
    if (!isLoopbackHost(host)) refuse(host ?? "unknown");
    return (realSocketConnect as (...a: unknown[]) => net.Socket).apply(this, args);
  } as typeof net.Socket.prototype.connect;

  const guardedTlsConnect = function (...args: unknown[]): tls.TLSSocket {
    const host = hostOf(args);
    if (!isLoopbackHost(host)) refuse(host ?? "unknown");
    return (realTlsConnect as (...a: unknown[]) => tls.TLSSocket)(...args);
  } as typeof tls.connect;

  net.Socket.prototype.connect = guardedSocketConnect;
  tls.connect = guardedTlsConnect;

  return {
    attempts: () => [...attempts],
    restore() {
      if (restored) return;
      restored = true;
      net.Socket.prototype.connect = realSocketConnect;
      tls.connect = realTlsConnect;
    },
  };
}

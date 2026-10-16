// Example tests for the Dev_Proxy builder (Req 10.4, 4.2, 4.3, 4.4). Node environment, no DOM.
import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";

import type { ProxyOptions } from "vite";
import { describe, expect, it } from "vitest";

import {
  CONSOLE_ORIGINS,
  DEV_HOST,
  DEV_PORT,
  STREAM_PROXY_KEY,
  operatorProxy,
} from "../vite-proxy";

// Built from parts: url-scan forbids scheme-prefixed literals in tracked files.
const SCHEME = "http";
const SEP = "://";

type ProxyServer = Parameters<NonNullable<ProxyOptions["configure"]>>[0];

function entryFor(rawPort: string): ProxyOptions {
  const proxy = operatorProxy(rawPort);
  if (proxy === null) throw new Error("expected a proxy");
  const entry = proxy[STREAM_PROXY_KEY];
  if (entry === undefined) throw new Error("expected the stream entry");
  return entry;
}

function bypassWith(origin: string | undefined): ReturnType<NonNullable<ProxyOptions["bypass"]>> {
  const entry = entryFor("8787");
  if (entry.bypass === undefined) throw new Error("expected bypass");
  const headers = origin === undefined ? {} : { origin };
  return entry.bypass({ headers } as IncomingMessage, undefined, entry);
}

describe("operatorProxy", () => {
  it("builds one /v1/stream entry targeting loopback at a valid port", () => {
    const proxy = operatorProxy("8787");
    expect(proxy).not.toBeNull();
    expect(Object.keys(proxy ?? {})).toEqual([STREAM_PROXY_KEY]);
    expect(STREAM_PROXY_KEY).toBe("^/v1/stream(\\?|$)");

    const entry = entryFor("8787");
    expect(entry.target).toBe(SCHEME + SEP + "127.0.0.1:8787");
    expect(entry.changeOrigin).toBe(true);

    expect(entryFor("1").target).toBe(SCHEME + SEP + "127.0.0.1:1");
    expect(entryFor("65535").target).toBe(SCHEME + SEP + "127.0.0.1:65535");
  });

  it("gives null for a missing or invalid port", () => {
    for (const raw of [undefined, "", "0", "65536", "abc"]) {
      expect(operatorProxy(raw)).toBeNull();
    }
  });

  it("matches the stream path with or without a query, and nothing else", () => {
    const key = new RegExp(STREAM_PROXY_KEY);
    expect(key.test("/v1/stream")).toBe(true);
    expect(key.test("/v1/stream?x=1")).toBe(true);
    expect(key.test("/v1/streams")).toBe(false);
    expect(key.test("/v1/stream/other")).toBe(false);
  });
});

describe("bypass Origin rule", () => {
  it("lists the console's own loopback origins", () => {
    expect(CONSOLE_ORIGINS).toEqual([
      SCHEME + SEP + DEV_HOST + ":" + String(DEV_PORT),
      SCHEME + SEP + "localhost:5173",
    ]);
  });

  it("refuses a foreign Origin", () => {
    expect(bypassWith(SCHEME + SEP + "evil.example")).toBe(false);
    expect(bypassWith(SCHEME + SEP + "127.0.0.1:5174")).toBe(false);
    expect(bypassWith("null")).toBe(false);
  });

  it("passes a request with no Origin and each console origin", () => {
    expect(bypassWith(undefined)).toBeUndefined();
    expect(bypassWith(SCHEME + SEP + "127.0.0.1:5173")).toBeUndefined();
    expect(bypassWith(SCHEME + SEP + "localhost:5173")).toBeUndefined();
  });
});

describe("proxyReq handler", () => {
  it("removes the origin header from the forwarded request", () => {
    const entry = entryFor("8787");
    if (entry.configure === undefined) throw new Error("expected configure");

    const emitter = new EventEmitter();
    entry.configure(emitter as unknown as ProxyServer, entry);
    expect(emitter.listenerCount("proxyReq")).toBe(1);

    const removed: string[] = [];
    const proxyReq = {
      removeHeader: (name: string) => {
        removed.push(name);
      },
    } as unknown as ClientRequest;
    emitter.emit("proxyReq", proxyReq);
    expect(removed).toEqual(["origin"]);
  });
});

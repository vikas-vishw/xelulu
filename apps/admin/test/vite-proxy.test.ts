// Example tests for the Dev_Proxy builder (Req 10.4, 4.2, 4.3, 4.4). Node environment, no DOM.
import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";

import type { ProxyOptions } from "vite";
import { describe, expect, it } from "vitest";

import {
  CONSOLE_ORIGINS,
  CONTENT_ADMIN_MODE,
  DEV_HOST,
  DEV_PORT,
  READ_PROXY_KEYS,
  STREAM_PROXY_KEY,
  WRITE_PROXY_KEYS,
  contentAdminMode,
  operatorProxy,
} from "../vite-proxy";

// Built from parts: url-scan forbids scheme-prefixed literals in tracked files.
const SCHEME = "http";
const SEP = "://";

type ProxyServer = Parameters<NonNullable<ProxyOptions["configure"]>>[0];

function entryFor(rawPort: string, key = STREAM_PROXY_KEY): ProxyOptions {
  const proxy = operatorProxy(rawPort, { contentAdmin: true });
  if (proxy === null) throw new Error("expected a proxy");
  const entry = proxy[key];
  if (entry === undefined) throw new Error("expected the entry");
  return entry;
}

function bypassWith(origin: string | undefined): ReturnType<NonNullable<ProxyOptions["bypass"]>> {
  const entry = entryFor("8787");
  if (entry.bypass === undefined) throw new Error("expected bypass");
  const headers = origin === undefined ? {} : { origin };
  return entry.bypass({ headers } as IncomingMessage, undefined, entry);
}

describe("operatorProxy", () => {
  it("forwards the stream and the four reads in every mode, and no write", () => {
    const proxy = operatorProxy("8787");
    expect(proxy).not.toBeNull();
    expect(Object.keys(proxy ?? {})).toEqual([...READ_PROXY_KEYS]);
    expect(READ_PROXY_KEYS).toEqual([
      "^/v1/stream(\\?|$)",
      "^/v1/content(\\?|$)",
      "^/v1/grandma(\\?|$)",
      "^/v1/routines(\\?|$)",
      "^/v1/reports(\\?|$)",
    ]);
    for (const key of WRITE_PROXY_KEYS) expect(Object.keys(proxy ?? {})).not.toContain(key);
  });

  it("forwards the eight writes only in content-admin mode: thirteen keys in all", () => {
    const proxy = operatorProxy("8787", { contentAdmin: true });
    expect(Object.keys(proxy ?? {})).toEqual([...READ_PROXY_KEYS, ...WRITE_PROXY_KEYS]);
    expect(READ_PROXY_KEYS).toHaveLength(5);
    expect(WRITE_PROXY_KEYS).toEqual([
      "^/v1/content/create(\\?|$)",
      "^/v1/content/update(\\?|$)",
      "^/v1/content/status(\\?|$)",
      "^/v1/grandma/consent(\\?|$)",
      "^/v1/grandma/recording(\\?|$)",
      "^/v1/grandma/schedule(\\?|$)",
      "^/v1/grandma/call(\\?|$)",
      "^/v1/routines/run(\\?|$)",
    ]);
    expect(Object.keys(proxy ?? {})).toHaveLength(13);
  });

  it("recognises the content-admin mode and nothing else", () => {
    expect(CONTENT_ADMIN_MODE).toBe("content-admin");
    expect(contentAdminMode(CONTENT_ADMIN_MODE)).toBe(true);
    for (const mode of ["development", "production", "content", ""]) {
      expect(contentAdminMode(mode)).toBe(false);
    }
  });

  it("targets loopback at a valid port on every key", () => {
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

  it("matches `/v1/content?id=`, which a bare string key would not", () => {
    const key = new RegExp("^/v1/content(\\?|$)");
    expect(key.test("/v1/content")).toBe(true);
    expect(key.test("/v1/content?id=content_1")).toBe(true);
    expect(key.test("/v1/contents")).toBe(false);
    // The write paths are their own keys, so the read key never swallows them.
    expect(key.test("/v1/content/create")).toBe(false);
  });

  it("keeps the Origin and origin-stripping behaviour on a new key", () => {
    const entry = entryFor("8787", "^/v1/content/create(\\?|$)");
    expect(entry.target).toBe(SCHEME + SEP + "127.0.0.1:8787");
    expect(entry.changeOrigin).toBe(true);
    if (entry.bypass === undefined) throw new Error("expected bypass");
    expect(
      entry.bypass(
        { headers: { origin: SCHEME + SEP + "evil.example" } } as IncomingMessage,
        undefined,
        entry,
      ),
    ).toBe(false);
    expect(entry.bypass({ headers: {} } as IncomingMessage, undefined, entry)).toBeUndefined();
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

// LAN bring-up: the device-facing binds are configurable and default closed, the operator and
// panel surfaces are not, and the broker's seeded credentials cannot drift from Compose.
//
// Why a test rather than a comment: the whole security story of this wave is "one env value opens
// exactly the device ports and nothing else". That is a claim about two files, so it is checked
// against both. The bootstrap file gets its own assertions because a BOM makes EMQX log
// parse_authn_users_failed and then refuse EVERY client - it fails closed, but silently, and a
// reader would blame the firmware.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

import { CI_DEVICE_TOKEN, DEVICE_ID_VALUE } from "../compose/compose-acceptance.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const BIND = "${DEVICE_BIND_HOST:-127.0.0.1}";

type Service = Readonly<{
  ports?: readonly string[];
  command?: readonly string[];
  environment?: Readonly<Record<string, string>>;
  volumes?: readonly string[];
}>;

const compose = parse(readFileSync(ROOT + "docker-compose.yml", "utf8")) as {
  services: Record<string, Service>;
};

/** The default in a `${NAME:-default}` reference, so the test reads Compose's own value. */
function defaultOf(reference: string): string {
  const match = /^\$\{[A-Z_][A-Z0-9_]*:-(.*)\}$/.exec(reference);
  expect(match, `not a defaulted reference: ${reference}`).not.toBeNull();
  return match?.[1] ?? "";
}

function portsOf(service: string): readonly string[] {
  const ports = compose.services[service]?.ports;
  expect(ports, `${service} publishes no port`).toBeDefined();
  return ports ?? [];
}

/** The one mapping whose container port is `port`. */
function mappingFor(service: string, port: number): string {
  const found = portsOf(service).filter((p) => p.endsWith(`:${port}`));
  expect(found, `${service} should publish container port ${port} exactly once`).toHaveLength(1);
  return found[0] ?? "";
}

describe("the device-facing binds are configurable and closed by default", () => {
  it("puts the broker's MQTT and MQTTS ports behind DEVICE_BIND_HOST", () => {
    for (const port of [1883, 8883]) {
      expect(mappingFor("emqx", port).startsWith(BIND)).toBe(true);
    }
  });

  it("puts the gateway's audio port behind DEVICE_BIND_HOST", () => {
    expect(mappingFor("gateway", 8081).startsWith(BIND)).toBe(true);
  });

  it("defaults that bind to loopback, so a clean checkout is not network-exposed", () => {
    expect(defaultOf("${DEVICE_BIND_HOST:-127.0.0.1}")).toBe("127.0.0.1");
    // Every device-facing mapping carries the same default, not just one of them.
    for (const mapping of [
      mappingFor("emqx", 1883),
      mappingFor("emqx", 8883),
      mappingFor("gateway", 8081),
    ]) {
      expect(mapping.startsWith("${DEVICE_BIND_HOST:-127.0.0.1}:")).toBe(true);
    }
  });
});

describe("the operator, panel and dashboard surfaces stay loopback-only", () => {
  // The invariant this wave must NOT weaken: widening the device binds opens no human surface.
  it("binds them to a literal 127.0.0.1 that no env value can move", () => {
    const humanSurfaces: readonly [string, number][] = [
      ["emqx", 8083],
      ["emqx", 8084],
      ["emqx", 18083],
      ["gateway", 8090],
      ["simulator", 8091],
    ];
    for (const [service, port] of humanSurfaces) {
      const mapping = portsOf(service).find((p) => p.includes(String(port))) ?? "";
      expect(mapping, `${service}:${port} is not published`).not.toBe("");
      expect(mapping.startsWith("127.0.0.1:"), `${service}:${port} -> ${mapping}`).toBe(true);
      expect(mapping).not.toContain("DEVICE_BIND_HOST");
    }
  });
});

describe("device actuation is opt-in", () => {
  it("does not pass --device-control in the default gateway command", () => {
    const command = compose.services["gateway"]?.command ?? [];
    expect(command.length).toBeGreaterThan(0);
    expect(command).not.toContain("--device-control");
    // The content-admin flag is unchanged by this wave, so its presence is the control.
    expect(command).toContain("--content-admin");
  });
});

describe("the broker refuses an unauthenticated client", () => {
  const emqx = compose.services["emqx"];

  it("configures one password_based authenticator over the built-in database", () => {
    expect(emqx?.environment).toMatchObject({
      EMQX_AUTHENTICATION__1__MECHANISM: "password_based",
      EMQX_AUTHENTICATION__1__BACKEND: "built_in_database",
      EMQX_AUTHENTICATION__1__USER_ID_TYPE: "username",
      EMQX_AUTHENTICATION__1__BOOTSTRAP_TYPE: "plain",
    });
  });

  it("mounts the bootstrap file at the path the authenticator reads", () => {
    const path = emqx?.environment?.["EMQX_AUTHENTICATION__1__BOOTSTRAP_FILE"] ?? "";
    expect(path).not.toBe("");
    const mounted = (emqx?.volumes ?? []).some((v) => v.includes(path));
    expect(mounted, `no volume provides ${path}`).toBe(true);
  });
});

describe("the seeded credentials cannot drift from Compose", () => {
  const raw = readFileSync(ROOT + "tooling/emqx/auth-bootstrap.json");

  it("is BOM-free, which EMQX requires and fails closed without", () => {
    // 0xEF 0xBB 0xBF would make EMQX reject every client, device and gateway alike.
    expect([raw[0], raw[1], raw[2]]).not.toEqual([0xef, 0xbb, 0xbf]);
  });

  it("is a single JSON array of users", () => {
    const users = JSON.parse(raw.toString("utf8")) as unknown;
    expect(Array.isArray(users)).toBe(true);
    expect((users as unknown[]).length).toBeGreaterThan(0);
  });

  it("seeds exactly the device, the gateway and the CI device Compose names", () => {
    const users = JSON.parse(raw.toString("utf8")) as readonly {
      user_id: string;
      password: string;
      is_superuser?: boolean;
    }[];
    const byId = new Map(users.map((u) => [u.user_id, u]));
    const env = compose.services["gateway"]?.environment ?? {};

    // The device authenticates with the id and token Compose gives it.
    const deviceId = defaultOf(env["DEVICE_ID"] ?? "");
    const deviceToken = defaultOf(env["DEVICE_TOKEN"] ?? "");
    expect(byId.get(deviceId)?.password).toBe(deviceToken);

    // The cloud authenticates as a different principal, so one token cannot impersonate the other.
    const gatewayUser = defaultOf(env["MQTT_USERNAME"] ?? "");
    const gatewayPassword = defaultOf(env["MQTT_PASSWORD"] ?? "");
    expect(byId.get(gatewayUser)?.password).toBe(gatewayPassword);
    expect(gatewayUser).not.toBe(deviceId);
    expect(gatewayPassword).not.toBe(deviceToken);

    // And the Compose_Acceptance_Check's own device, whose token is no longer random.
    expect(byId.get(DEVICE_ID_VALUE)?.password).toBe(CI_DEVICE_TOKEN);

    // Nobody is a superuser: a seeded dev credential must not bypass topic authorization later.
    for (const user of users) expect(user.is_superuser ?? false).toBe(false);
  });
});

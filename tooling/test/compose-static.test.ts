// Static checks for the local Compose stack (Req 10.1, 10.2, 10.3, 10.4, 10.5, 10.11, 10.12, 10.13;
// Phase 1.3 Req 3.3, 3.4, 9.1).
// Parses `docker-compose.yml` with `yaml` (the raw text is kept for the credentials comment) and
// reads the gateway and simulator Dockerfiles' FROM lines to check the Node major against `.nvmrc`.
//
// It also pins `.env.local.example`, the tracked dev-only copy of the same Local_Mode values, to
// the Compose defaults below. Secret_Check allows those nine keys to carry a value in exactly
// those two files, so this is where what the values ARE is checked: a real credential pasted
// into either file fails here.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const COMPOSE_PATH = join(ROOT, "docker-compose.yml");
const LOCAL_ENV_PATH = join(ROOT, ".env.local.example");

const EXPECTED_SERVICES = ["emqx", "gateway", "simulator"];
const EMQX_PORTS = [1883, 8883, 8083, 8084, 18083];
const NODE_SERVICES = ["gateway", "simulator"] as const;
/** The one host reference the device-facing publishes may use. Its default keeps them closed. */
const BIND_REFERENCE = "${DEVICE_BIND_HOST:-127.0.0.1}";
// Phase 1.3 Req 3.3 and 3.4 (C8, C9), as amended by the LAN bring-up wave: each Node service's
// exact publishes, as raw YAML text before interpolation. The human surfaces keep their literal
// loopback host; the gateway also publishes the device-facing audio socket behind BIND_REFERENCE.
const NODE_SERVICE_PORTS: Record<(typeof NODE_SERVICES)[number], readonly string[]> = {
  gateway: [
    "127.0.0.1:${GATEWAY_OPERATOR_PORT:-8090}:${GATEWAY_OPERATOR_PORT:-8090}",
    BIND_REFERENCE + ":8081:8081",
  ],
  simulator: ["127.0.0.1:${SIMULATOR_PANEL_PORT:-8091}:${SIMULATOR_PANEL_PORT:-8091}"],
};
// Req 21.7: each service's exact `command`. The gateway also carries the Transcripts_Argument, so
// the local stack's operator channel shows transcript text, the Content_Admin_Argument, so the
// Content page's writes are accepted (both Local_Mode only); the simulator takes neither. The
// Phase 6 Device_Control_Argument is deliberately NOT here: the LAN bring-up wave made device
// actuation opt-in, so firing a command needs pnpm dev:admin:device or an explicit edit.
const NODE_SERVICE_COMMAND: Record<(typeof NODE_SERVICES)[number], readonly string[]> = {
  gateway: [
    "node",
    "dist/index.js",
    "--listen-all-interfaces",
    "--operator-transcripts",
    "--content-admin",
  ],
  simulator: ["node", "dist/index.js", "--listen-all-interfaces"],
};

// Each service's `environment:` block, as [G3 key, local default] in file order. `null` means the
// bare `${KEY}` form with no default: Compose must never supply a broker credential, and empty is
// the correct Local_Mode value. Written as tuples rather than a literal map so no line in this
// test file is a Panel_Key assignment (Secret_Check scans it).
type EnvEntry = readonly [key: string, fallback: string | null];
const DEVICE_TOKEN_DEFAULT = "dev_local_only_not_a_secret";
const SHARED_SERVICE_ENV: readonly EnvEntry[] = [
  ["APP_ENV", "local"],
  ["MQTT_BROKER_URL", "mqtt://emqx:1883"],
  ["AUDIO_WSS_URL", "ws://gateway:8081"],
  ["DEVICE_ID", "xlu_000123"],
  ["DEVICE_TOKEN", DEVICE_TOKEN_DEFAULT],
];
// The broker credential is the one key the two services must NOT share. Anonymous access is off,
// so the gateway carries its own default; the simulator keeps the bare form, and a null (unset or
// empty) credential is exactly what makes it authenticate as the device with DEVICE_ID and
// DEVICE_TOKEN. Giving the simulator the cloud default would let the device impersonate the cloud.
const GATEWAY_BROKER_ENV: readonly EnvEntry[] = [
  ["MQTT_USERNAME", "xelulu_gateway_dev"],
  ["MQTT_PASSWORD", "dev_gateway_only_not_a_secret"],
];
const DEVICE_BROKER_ENV: readonly EnvEntry[] = [
  ["MQTT_USERNAME", null],
  ["MQTT_PASSWORD", null],
];
const NODE_SERVICE_ENV: Record<(typeof NODE_SERVICES)[number], readonly EnvEntry[]> = {
  gateway: [
    SHARED_SERVICE_ENV[0] as EnvEntry,
    SHARED_SERVICE_ENV[1] as EnvEntry,
    ...GATEWAY_BROKER_ENV,
    ...SHARED_SERVICE_ENV.slice(2),
    ["GATEWAY_OPERATOR_PORT", "8090"],
  ],
  simulator: [
    SHARED_SERVICE_ENV[0] as EnvEntry,
    SHARED_SERVICE_ENV[1] as EnvEntry,
    ...DEVICE_BROKER_ENV,
    ...SHARED_SERVICE_ENV.slice(2),
    ["SIMULATOR_PANEL_PORT", "8091"],
  ],
};

/** `${KEY:-default}`, or the bare `${KEY}` when there is no default. */
function envRef([key, fallback]: EnvEntry): string {
  return fallback === null ? "${" + key + "}" : "${" + key + ":-" + fallback + "}";
}

/** The raw, pre-interpolation `environment` mapping the file must carry for a service. */
function expectedEnvironment(name: (typeof NODE_SERVICES)[number]): Record<string, string> {
  return Object.fromEntries(NODE_SERVICE_ENV[name].map((e) => [e[0], envRef(e)]));
}

/**
 * What `.env.local.example` must assign: every key both services declare, with the Compose
 * default as its value (the bare-reference keys mean no value, so empty). Derived from the same
 * tuples the Compose assertions use, so the two files cannot drift apart.
 */
function expectedLocalEnv(): ReadonlyMap<string, string> {
  const expected = new Map<string, string>();
  // DEVICE_BIND_HOST first: it is interpolated into `ports:`, not into any service environment,
  // so the service tuples never mention it, but a copied example must still carry it - closed.
  expected.set("DEVICE_BIND_HOST", "127.0.0.1");
  for (const name of NODE_SERVICES) {
    // The gateway is iterated first and the simulator second, so where the two disagree the
    // DEVICE value wins. That is deliberate: copying this file must not hand the simulator the
    // cloud credential, so the example carries the empty broker credential, not the gateway one.
    for (const [key, fallback] of NODE_SERVICE_ENV[name]) expected.set(key, fallback ?? "");
  }
  return expected;
}

/**
 * `KEY=value` lines of a dotenv file, in order. Blank and comment lines are skipped; any other
 * line that is not an assignment fails the parse, so nothing can hide in this file.
 */
function parseEnvFile(text: string): readonly (readonly [string, string])[] {
  const out: (readonly [string, string])[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (match?.[1] === undefined) {
      throw new Error(`.env.local.example line ${i + 1} is neither a comment nor an assignment`);
    }
    out.push([match[1], (match[2] ?? "").trim()]);
  }
  return out;
}

// Each service's own CLI over loopback: no curl, no wget, no added dependency.
const NODE_SERVICE_HEALTHCHECK: Record<(typeof NODE_SERVICES)[number], unknown> = {
  gateway: {
    test: ["CMD", "node", "dist/cli.js", "devices"],
    interval: "10s",
    timeout: "10s",
    retries: 6,
    start_period: "60s",
  },
  simulator: {
    test: ["CMD", "node", "dist/cli.js", "state"],
    interval: "10s",
    timeout: "10s",
    retries: 6,
    start_period: "60s",
  },
};

/** Every key a Node service may carry, sorted. Each one is pinned by its own assertion below. */
const NODE_SERVICE_KEYS: readonly string[] = [
  "build",
  "command",
  "depends_on",
  "env_file",
  "environment",
  "healthcheck",
  "ports",
  "restart",
];

const HEALTHY = { condition: "service_healthy" };
// The simulator waits for a healthy gateway, so the gateway is subscribed before the hello.
const NODE_SERVICE_DEPENDS_ON: Record<(typeof NODE_SERVICES)[number], unknown> = {
  gateway: { emqx: HEALTHY },
  simulator: { emqx: HEALTHY, gateway: HEALTHY },
};

type ComposeService = Record<string, unknown>;

interface ComposeFile {
  [key: string]: unknown;
  services: Record<string, ComposeService>;
}

const rawCompose = readFileSync(COMPOSE_PATH, "utf8");
const compose = parse(rawCompose) as ComposeFile;

function service(name: string): ComposeService {
  const svc = compose.services[name];
  if (svc === undefined) throw new Error(`service "${name}" is missing from docker-compose.yml`);
  return svc;
}

function nvmrcMajor(): number {
  const text = readFileSync(join(ROOT, ".nvmrc"), "utf8").trim();
  const match = /^v?(\d+)/.exec(text);
  if (match?.[1] === undefined) throw new Error(`.nvmrc has no leading integer: "${text}"`);
  return Number(match[1]);
}

function fromLines(dockerfilePath: string): string[] {
  return readFileSync(dockerfilePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^FROM\s/i.test(line));
}

describe("docker-compose.yml (static)", () => {
  it("defines exactly the emqx, gateway and simulator services", () => {
    expect(Object.keys(compose.services).sort()).toEqual(EXPECTED_SERVICES);
  });

  it("has no top-level version key", () => {
    expect(Object.keys(compose)).not.toContain("version");
  });

  it("pins EMQX to an exact major.minor.patch tag", () => {
    expect(service("emqx").image).toMatch(/^emqx\/emqx:\d+\.\d+\.\d+$/);
  });

  // The LAN bring-up wave split these: the two device-facing broker ports moved behind
  // DEVICE_BIND_HOST (default loopback) so a physical robot can reach them; the dashboard and the
  // WebSocket ports are human surfaces and stay on a literal 127.0.0.1 that no env value moves.
  it("publishes exactly the five EMQX ports, device-facing ones behind the bind host", () => {
    const ports = service("emqx").ports;
    expect(Array.isArray(ports)).toBe(true);
    const expected = EMQX_PORTS.map((p) =>
      p === 1883 || p === 8883 ? `${BIND_REFERENCE}:${p}:${p}` : `127.0.0.1:${p}:${p}`,
    );
    expect([...(ports as unknown[])].map(String).sort()).toEqual([...expected].sort());
  });

  it("publishes every port on host 127.0.0.1, never on 0.0.0.0 or without a host IP", () => {
    for (const [name, svc] of Object.entries(compose.services)) {
      if (svc.ports === undefined) continue;
      expect(Array.isArray(svc.ports), `service ${name} ports`).toBe(true);
      for (const entry of svc.ports as unknown[]) {
        const text = typeof entry === "string" ? entry : JSON.stringify(entry);
        // Either a literal loopback publish, or the one bind reference whose default is
        // loopback. Nothing may publish bare, and no literal 0.0.0.0 may be committed.
        const loopback = text.startsWith("127.0.0.1:");
        const behindBind = text.startsWith(`${BIND_REFERENCE}:`);
        expect(loopback || behindBind, `service ${name} port "${text}"`).toBe(true);
        expect(text.replace(BIND_REFERENCE, ""), `service ${name} port "${text}"`).not.toContain(
          "0.0.0.0",
        );
      }
    }
  });

  it("has an environment block on all three services", () => {
    // EMQX gained one when anonymous access was turned off: the authenticator is configured
    // entirely through EMQX_AUTHENTICATION__1__* env vars. Three blocks, so no fourth can slip in.
    expect(service("emqx"), "service emqx").toHaveProperty("environment");
    expect(rawCompose.match(/^\s*environment\s*:/gm) ?? []).toHaveLength(3);
  });

  it("carries a comment saying the default dashboard credentials are for local development only", () => {
    const comments = rawCompose
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("#"));
    const found = comments.some(
      (line) => /credentials/i.test(line) && /local development only/i.test(line),
    );
    expect(found).toBe(true);
  });

  describe.each(NODE_SERVICES)("%s service", (name) => {
    it("builds from the repo root with its own Dockerfile", () => {
      expect(service(name).build).toEqual({
        context: ".",
        dockerfile: `services/${name}/Dockerfile`,
      });
    });

    it("loads ./.env as an optional env_file", () => {
      expect(service(name).env_file).toEqual([{ path: "./.env", required: false }]);
    });

    it('uses restart "no"', () => {
      expect(service(name).restart).toBe("no");
    });

    it("publishes exactly its pinned ports, human ones on literal loopback", () => {
      const ports = service(name).ports;
      expect(ports).toEqual(NODE_SERVICE_PORTS[name]);
      for (const entry of ports as unknown[]) {
        const text = String(entry);
        const human = text.startsWith("127.0.0.1:");
        const device = text.startsWith(BIND_REFERENCE + ":");
        expect(human || device, `port "${text}"`).toBe(true);
      }
    });

    it("runs the image's default command plus its own listen arguments", () => {
      expect(service(name).command).toEqual(NODE_SERVICE_COMMAND[name]);
    });

    it("uses no Compose secrets", () => {
      expect(service(name)).not.toHaveProperty("secrets");
    });

    // Every key below is pinned exactly by the assertions in this block, so pinning the key SET
    // closes the file off: a `volumes`, `labels` or `extra_hosts` entry — any new key at all,
    // credential text or not — fails here until it is reviewed and added deliberately.
    it("carries exactly these eight keys and no other", () => {
      expect(Object.keys(service(name)).sort()).toEqual(NODE_SERVICE_KEYS);
    });

    it("carries exactly its own eight G3 keys as local defaults, in order", () => {
      const env = service(name).environment;
      expect(env).toEqual(expectedEnvironment(name));
      expect(Object.keys(env as Record<string, string>)).toEqual(
        NODE_SERVICE_ENV[name].map((e) => e[0]),
      );
    });

    it("writes every value as a reference to its own key, so no literal is pasted in", () => {
      const env = service(name).environment as Record<string, string>;
      for (const [key, value] of Object.entries(env)) {
        // `${KEY}` or `${KEY:-default}`, and never some other key's name.
        expect(value, `${name}.environment.${key}`).toMatch(
          new RegExp(`^\\$\\{${key}(?::-[^}]*)?\\}$`),
        );
      }
    });

    // The gateway must carry a credential (anonymous access is off) and the simulator must not
    // (a null credential is what makes it authenticate as the device). Both halves are pinned.
    it("supplies a broker credential only where the principal is the cloud", () => {
      const env = service(name).environment as Record<string, string>;
      const expectedEnv = expectedEnvironment(name);
      for (const key of ["MQTT_USERNAME", "MQTT_PASSWORD"]) {
        expect(env[key], `${name}.environment.${key}`).toBe(expectedEnv[key]);
      }
      const bare = env["MQTT_USERNAME"] === "${MQTT_USERNAME}";
      expect(bare, `${name} broker credential`).toBe(name === "simulator");
    });

    it("defaults the device token to an unmistakable dev placeholder", () => {
      const env = service(name).environment as Record<string, string>;
      expect(env["DEVICE_TOKEN"]).toBe("${DEVICE_TOKEN:-" + DEVICE_TOKEN_DEFAULT + "}");
      expect(DEVICE_TOKEN_DEFAULT).toMatch(/dev/);
      expect(DEVICE_TOKEN_DEFAULT).toMatch(/not_a_secret/);
    });

    it("health-checks itself with its own CLI over loopback", () => {
      expect(service(name).healthcheck).toEqual(NODE_SERVICE_HEALTHCHECK[name]);
    });

    it("waits for the services it needs to be healthy", () => {
      expect(service(name).depends_on).toEqual(NODE_SERVICE_DEPENDS_ON[name]);
    });

    it("uses a Node base image whose major matches .nvmrc", () => {
      const lines = fromLines(join(ROOT, "services", name, "Dockerfile"));
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        const match = /^FROM\s+node:(\d+)[.\-\w]*/i.exec(line);
        expect(match, `FROM line "${line}"`).not.toBeNull();
        expect(Number(match?.[1])).toBe(nvmrcMajor());
      }
    });
  });
});

describe(".env.local.example (static)", () => {
  const rawLocalEnv = readFileSync(LOCAL_ENV_PATH, "utf8");
  const entries = parseEnvFile(rawLocalEnv);
  const values = new Map(entries);

  it("is marked dev-only, and says the one guarded panel is .env.example", () => {
    const comments = rawLocalEnv
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("#"));
    expect(comments.some((line) => /dev-only/i.test(line))).toBe(true);
    expect(comments.some((line) => line.includes(".env.example"))).toBe(true);
  });

  it("assigns exactly the ten Local_Mode keys, once each", () => {
    expect(entries.map(([key]) => key).sort()).toEqual([...expectedLocalEnv().keys()].sort());
    expect(values.size).toBe(entries.length);
  });

  it("carries the same value for every key as the Compose default", () => {
    for (const [key, expected] of expectedLocalEnv()) {
      expect(values.get(key), `.env.local.example ${key}`).toBe(expected);
    }
  });

  it("supplies no broker credential: both MQTT credential keys are empty", () => {
    for (const key of ["MQTT_USERNAME", "MQTT_PASSWORD"]) {
      expect(values.get(key), `.env.local.example ${key}`).toBe("");
    }
  });

  it("holds an unmistakable dev placeholder, not a real token", () => {
    expect(values.get("DEVICE_TOKEN")).toBe(DEVICE_TOKEN_DEFAULT);
    expect(DEVICE_TOKEN_DEFAULT).toMatch(/dev/);
    expect(DEVICE_TOKEN_DEFAULT).toMatch(/not_a_secret/);
  });
});

// Static checks for the local Compose stack (Req 10.1, 10.2, 10.3, 10.4, 10.5, 10.11, 10.12, 10.13).
// Parses `docker-compose.yml` with `yaml` (the raw text is kept for the credentials comment) and
// reads the gateway and simulator Dockerfiles' FROM lines to check the Node major against `.nvmrc`.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const COMPOSE_PATH = join(ROOT, "docker-compose.yml");

const EXPECTED_SERVICES = ["emqx", "gateway", "simulator"];
const EMQX_PORTS = [1883, 8883, 8083, 8084, 18083];
const NODE_SERVICES = ["gateway", "simulator"] as const;

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

  it("publishes exactly the five EMQX ports, each bound to 127.0.0.1", () => {
    const ports = service("emqx").ports;
    expect(Array.isArray(ports)).toBe(true);
    const expected = EMQX_PORTS.map((p) => `127.0.0.1:${p}:${p}`);
    expect([...(ports as unknown[])].map(String).sort()).toEqual([...expected].sort());
  });

  it("has no environment entries on any service", () => {
    for (const [name, svc] of Object.entries(compose.services)) {
      expect(svc, `service ${name}`).not.toHaveProperty("environment");
    }
    expect(rawCompose).not.toMatch(/^\s*environment\s*:/m);
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

    it("publishes no ports and carries no environment or credentials", () => {
      const svc = service(name);
      expect(svc).not.toHaveProperty("ports");
      expect(svc).not.toHaveProperty("environment");
      expect(svc).not.toHaveProperty("secrets");
      expect(JSON.stringify(svc)).not.toMatch(/password|passwd|secret|token|credential/i);
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

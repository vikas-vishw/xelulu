// Root README checks (design: tooling/test/readme.test.ts).
// Real-repo checks for Req 14.1–14.8.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface Manifest {
  packageManager?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
}

function readManifest(relPath: string): Manifest {
  return JSON.parse(readFileSync(resolve(ROOT, relPath), "utf8")) as Manifest;
}

const readme = readFileSync(resolve(ROOT, "README.md"), "utf8").replace(/\r\n/g, "\n");
const readmeLower = readme.toLowerCase();
const rootManifest = readManifest("package.json");
const parentAppManifest = readManifest("apps/parent-app/package.json");
const nvmrc = readFileSync(resolve(ROOT, ".nvmrc"), "utf8").trim();

/** The EMQX ports that must be bound to loopback (Req 14.6). */
const EMQX_PORTS = ["1883", "8883", "8083", "8084", "18083"] as const;

/** pnpm subcommands that are built in, not Root_Manifest scripts. */
const BUILTIN_PNPM_COMMANDS = new Set(["install", "exec", "dlx"]);

/** Text inside inline code spans and fenced code blocks: where commands live. */
function codeText(markdown: string): string[] {
  const parts: string[] = [];
  const withoutFences = markdown.replace(/```[^\n]*\n([\s\S]*?)```/g, (_match, body: string) => {
    parts.push(body);
    return "";
  });
  for (const match of withoutFences.matchAll(/`([^`\n]+)`/g)) {
    if (match[1] !== undefined) parts.push(match[1]);
  }
  return parts;
}

/** Script names from every `pnpm <name>` command in code, skipping leading flags. */
function pnpmCommandNames(markdown: string): string[] {
  const names: string[] = [];
  for (const code of codeText(markdown)) {
    for (const match of code.matchAll(
      /(?:^|[\s;&|(])pnpm((?:\s+--?[a-z][a-z-]*)*)\s+([^\s`]+)/gm,
    )) {
      if (match[2] !== undefined) names.push(match[2]);
    }
  }
  return names;
}

/** The README table row whose first cell is the given command. */
function tableRow(command: string): string {
  const row = readme.split("\n").find((line) => line.startsWith(`| \`${command}\``));
  if (row === undefined) throw new Error(`README has no table row for \`${command}\``);
  return row;
}

describe("root README (Req 14)", () => {
  describe("prerequisites (Req 14.1)", () => {
    it("names .nvmrc as the Node source and matches its version", () => {
      expect(readme).toContain(".nvmrc");
      expect(readme).toContain(nvmrc);
    });

    it("gives the exact pnpm version from packageManager and the Corepack command", () => {
      const pm = rootManifest.packageManager ?? "";
      const match = /^pnpm@(\d+\.\d+\.\d+)$/.exec(pm);
      expect(match, `root packageManager is "${pm}"`).not.toBeNull();
      const version = match?.[1] ?? "";
      expect(readme).toContain(`pnpm ${version}`);
      // Every pnpm version the README mentions must be the pinned one.
      const mentioned = [...readme.matchAll(/pnpm[@ ](\d+\.\d+\.\d+)/g)].map((m) => m[1]);
      expect(mentioned.length).toBeGreaterThan(0);
      for (const v of mentioned) expect(v).toBe(version);
      expect(readme).toContain("corepack enable");
    });

    it("names Docker with the docker compose command", () => {
      expect(readmeLower).toContain("docker compose");
    });

    it("names Expo Go and the Expo SDK major used by the parent app", () => {
      expect(readme).toContain("Expo Go");
      const expoSpec = parentAppManifest.dependencies?.["expo"] ?? "";
      const major = /^(\d+)\./.exec(expoSpec)?.[1];
      expect(major, `parent-app expo dependency is "${expoSpec}"`).toBeDefined();
      const sdkNumbers = [...readme.matchAll(/Expo SDK (\d+)/g)].map((m) => m[1]);
      expect(sdkNumbers.length).toBeGreaterThan(0);
      for (const n of sdkNumbers) expect(n).toBe(major);
    });
  });

  describe("commands (Req 14.2, 14.3)", () => {
    it("gives install, build, lint, format check, test and every start command", () => {
      const names = new Set(pnpmCommandNames(readme));
      for (const name of [
        "install",
        "build",
        "lint",
        "format:check",
        "test",
        "start:app",
        "dev:admin",
        "start:gateway",
        "start:simulator",
      ]) {
        expect(names, `README is missing \`pnpm ${name}\``).toContain(name);
      }
      expect(readme).toContain("`docker compose up`");
    });

    it("names only pnpm scripts that exist in the root manifest", () => {
      const scripts = rootManifest.scripts ?? {};
      const missing = pnpmCommandNames(readme).filter(
        (name) => !BUILTIN_PNPM_COMMANDS.has(name) && !Object.hasOwn(scripts, name),
      );
      expect(missing, `README names unknown scripts: ${missing.join(", ")}`).toEqual([]);
    });
  });

  describe("connection panel copy (Req 14.4)", () => {
    it("gives both the PowerShell and the POSIX copy command", () => {
      expect(readme).toContain("Copy-Item .env.example .env");
      expect(readme).toContain("cp .env.example .env");
    });

    it("says .env is git-ignored, never committed and optional for Compose", () => {
      expect(readmeLower).toMatch(/ignored by git|git-ignored|gitignored/);
      expect(readmeLower).toContain("never be committed");
      expect(readmeLower).toContain("optional");
    });
  });

  describe("admin console (Req 14.5)", () => {
    it("is internal only, never shipped to consumers and localhost only", () => {
      expect(readmeLower).toContain("internal only");
      expect(readmeLower).toContain("never shipped to consumers");
      expect(readmeLower).toContain("localhost only");
    });
  });

  describe("EMQX (Req 14.6)", () => {
    it("says the default credentials are for local development only", () => {
      expect(readmeLower).toContain("local development only");
    });

    it("lists the five ports bound to 127.0.0.1", () => {
      for (const port of EMQX_PORTS) {
        expect(readme, `README is missing EMQX port ${port}`).toMatch(new RegExp(`\\b${port}\\b`));
      }
      expect(readme).toContain("127.0.0.1");
    });
  });

  // Phase 6 Req 6.6: the Intern_Guide is linked from the README in one line.
  describe("intern integration guide (Phase 6 Req 6.6)", () => {
    const GUIDE_PATH = "docs/intern-integration-guide.md";

    it("links the guide, and the guide exists", () => {
      const line = readme.split("\n").find((l) => l.includes(GUIDE_PATH));
      expect(line, `README has no link to ${GUIDE_PATH}`).toBeDefined();
      expect(line).toContain(`](${GUIDE_PATH})`);
      expect(() => readFileSync(resolve(ROOT, GUIDE_PATH), "utf8")).not.toThrow();
    });
  });

  describe("gateway contract note (Phase 1 Req 17.6, 17.8)", () => {
    it("says the contract folder holds Document B v2 at proto_ver 2, copied from the docx", () => {
      const line = readme
        .split("\n")
        .find((l) => l.includes("packages/shared/src/gateway-contract/"));
      expect(line, "README line about gateway-contract").toBeDefined();
      expect(line).toContain("Document B v2");
      expect(line).toContain("`proto_ver` 2");
      expect(line).toContain("docs/B-gateway-and-hardware-seam.docx");
    });

    it("no longer says the folder is empty on purpose", () => {
      expect(readmeLower).not.toContain("empty on purpose");
    });
  });

  describe("expected results (Req 14.8)", () => {
    // Phase 2.1 Req 10.4: the app now opens on the Home dashboard, not the Phase 0 placeholder.
    it("parent app: Expo Go shows the Home dashboard", () => {
      const row = tableRow("pnpm start:app").toLowerCase();
      expect(row).toContain("expo go");
      expect(row).toContain("home dashboard");
    });

    // Phase 2.1 Req 9.4: the deep-link note for every screen other than Home.
    it("explains the deep-link prefix for a stack route", () => {
      expect(readme).toContain("/--/");
    });

    // Phase 1.3 Req 9.4: the console now shows live data, not the Phase 0 placeholder.
    it("admin console: a loopback URL shows the live console", () => {
      const row = tableRow("pnpm dev:admin");
      expect(row).toMatch(/https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/);
      expect(row.toLowerCase()).toContain("live console");
    });

    it.each(["pnpm start:gateway", "pnpm start:simulator"])("%s keeps running", (command) => {
      expect(tableRow(command)).toContain("keeps running");
    });

    it("compose: the EMQX, gateway and simulator containers start", () => {
      const row = tableRow("docker compose up").toLowerCase();
      for (const word of ["emqx", "gateway", "simulator", "containers start"]) {
        expect(row).toContain(word);
      }
    });
  });
});

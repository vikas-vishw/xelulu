// Parent-app, admin and boundary source checks (Phase 0 Req 4.9, 4.10, 5.4, 5.6, 5.8, 5.10, 6.6,
// 7.4; Phase 2.1 Req 10.2 for the parent-app block). Static source checks on the parent-app
// design system and shell, the admin placeholder, the built admin bundle, and the
// gateway/simulator sources. Everything is read with fs from the repo root; nothing is executed.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { findEnvReads } from "../checks/env-reads.js";
import { parsePanel } from "../checks/panel.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const EXCLUDED_DIRS = new Set(["node_modules", ".expo", "dist"]);
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

function toRepoPath(abs: string): string {
  return relative(ROOT, abs).split(sep).join("/");
}

function read(repoPath: string): string {
  return readFileSync(join(ROOT, repoPath), "utf8");
}

/** Recursively lists files under `dir`, skipping excluded directories unless `includeAll`. */
function walk(dir: string, includeAll = false): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (includeAll || !EXCLUDED_DIRS.has(entry.name)) out.push(...walk(abs, includeAll));
    } else if (entry.isFile()) {
      out.push(abs);
    }
  }
  return out;
}

function sourceFiles(repoDir: string): string[] {
  return walk(join(ROOT, repoDir)).filter((abs) => SOURCE_EXTENSIONS.has(extname(abs)));
}

/** Opening `<Text ...>` tags (not `<TextInput>` etc.); attributes may span lines. */
function textOpenTags(source: string): string[] {
  return [...source.matchAll(/<Text(?![\w.])([^>]*)>/g)].map((m) => m[1] ?? "");
}

/** Every `className="..."` / `className={'...'}` / template string literal value. */
function classNameValues(source: string): string[] {
  return [...source.matchAll(/className\s*=\s*\{?\s*(["'`])([^"'`]*)\1/g)].map((m) => m[2] ?? "");
}

/** Module specifiers from import/export-from/dynamic import/require. */
function moduleSpecifiers(source: string): string[] {
  const re = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)(["'`])([^"'`]+)\1/g;
  return [...source.matchAll(re)].map((m) => m[2] ?? "");
}

/**
 * One pass over a TypeScript source, splitting it into the code with comment text removed and
 * the value of every string, template and single-quoted literal.
 *
 * Two of the Phase 2.2 scans need this rather than a plain regex over the whole file. The route
 * literal ban is about *literals*, and several screens name their own route in a prose comment
 * such as "`/device` is a Stack_Route". The mock-payload ban is about *payload*, and a mock
 * module's header comment legitimately says which fields it refuses to carry ("no audio, no
 * transcript"). Scanning the raw text would fail on both, for the opposite of the reason the
 * check exists.
 *
 * Regular-expression literals are not parsed: `/` is only ever read as the start of a comment.
 * No file under the parent app's `app/` or `src/` holds a regex literal, and the parent-app
 * block is the only caller.
 */
function scanSource(source: string): Readonly<{ code: string; strings: readonly string[] }> {
  let code = "";
  const strings: string[] = [];
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    if (char === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
    } else if (char === "/" && source[i + 1] === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] === "\n") code += "\n";
        i += 1;
      }
      i += 2;
    } else if (char === '"' || char === "'" || char === "`") {
      const quote = char;
      let value = "";
      i += 1;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === "\\") {
          i += 2;
          continue;
        }
        value += source[i];
        i += 1;
      }
      i += 1;
      strings.push(value);
      code += `${quote}${value}${quote}`;
    } else {
      code += char;
      i += 1;
    }
  }
  return { code, strings };
}

const NETWORK_MODULE_RE = /^(?:(?:node:)?(?:net|http|https|http2|dgram|tls)|(?:ws|mqtt)(?:\/.*)?)$/;

/** The only folders in each service `src` tree allowed to import network modules (Req 22.2). */
const TRANSPORT_DIRS: Readonly<Record<string, readonly string[]>> = {
  "services/gateway/src": [
    "services/gateway/src/mqtt/transport",
    "services/gateway/src/audio/transport",
    "services/gateway/src/operator/transport",
  ],
  "services/simulator/src": [
    "services/simulator/src/mqtt/transport",
    "services/simulator/src/audio/transport",
    "services/simulator/src/control/transport",
  ],
};

function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function panelKeys(): string[] {
  return parsePanel(read("tooling/fixtures/approved-panel.txt")).flatMap((l) =>
    l.kind === "decl" ? [l.key] : [],
  );
}

describe("placeholder screens and package boundaries", () => {
  describe("detector sanity", () => {
    it("finds Text tags, class names and network imports in known samples", () => {
      const sample = `import net from "node:net";\nconst ws = require('ws');\nexport * from "mqtt/x";\nimport("http");\n<Text a="1">x</Text><TextInput /><Text className="text-sm">y</Text>`;
      expect(textOpenTags(sample)).toHaveLength(2);
      expect(classNameValues(sample)).toEqual(["text-sm"]);
      expect(moduleSpecifiers(sample).filter((s) => NETWORK_MODULE_RE.test(s))).toEqual([
        "node:net",
        "ws",
        "mqtt/x",
        "http",
      ]);
      expect(NETWORK_MODULE_RE.test("react-native")).toBe(false);
      expect(NETWORK_MODULE_RE.test("wsx")).toBe(false);
    });

    it("separates comment prose from string literals", () => {
      const sample = [
        "// opens `/device` and holds no audio",
        '/* a block mentioning "/privacy" */',
        'const a = "/device";',
        "const b = `tpl ${x} /privacy`;",
        "const c = 'it\\'s fine';",
      ].join("\n");
      const { code, strings } = scanSource(sample);
      expect(strings).toEqual(["/device", "tpl ${x} /privacy", "its fine"]);
      expect(code).not.toContain("opens");
      expect(code).not.toContain("a block mentioning");
      expect(code).toContain('"/device"');
    });
  });

  // Phase 2.1 Req 10.2: the parent app is now a built design system, a navigation shell and the
  // Home Dashboard, so these checks guard Req 1.4, 1.7, 3.4, 8.1, 8.2, 8.3, 8.4 and 8.6 instead
  // of the Phase 0 placeholder screen.
  describe("parent app", () => {
    /** The Token_Source: the one file allowed to hold a raw colour value (Req 1.4). */
    const TOKEN_SOURCE = "apps/parent-app/src/theme/tokens.json";

    /** The app's config files, in Property 1's scope alongside `app/` and `src/` (Req 1.2). */
    const CONFIG_FILES = [
      "apps/parent-app/app.json",
      "apps/parent-app/babel.config.js",
      "apps/parent-app/global.css",
      "apps/parent-app/jest.config.js",
      "apps/parent-app/metro.config.js",
      "apps/parent-app/nativewind-env.d.ts",
      "apps/parent-app/tailwind.config.js",
      "apps/parent-app/tsconfig.json",
    ] as const;

    /** AppText plus the three Dense_Components: the only files that may cap font scaling. */
    const FONT_CAP_FILES: ReadonlySet<string> = new Set([
      "apps/parent-app/src/components/app-text.tsx",
      "apps/parent-app/src/components/quick-action-tile.tsx",
      "apps/parent-app/src/components/stat-tile.tsx",
      "apps/parent-app/src/components/tab-bar.tsx",
    ]);

    const COLOUR_LITERAL = /#[0-9A-Fa-f]{3,8}\b|(?<![\w-])(?:rgba?|hsla?)\s*\(/;

    /** Every source file under `app/` and `src/`. */
    const sourcePaths = [
      ...sourceFiles("apps/parent-app/app"),
      ...sourceFiles("apps/parent-app/src"),
    ]
      .map(toRepoPath)
      .sort();

    /** Property 1's scope: every file under `app/` and `src/` plus the configs, less the tokens. */
    const tokenScopePaths = [
      ...walk(join(ROOT, "apps/parent-app/app")),
      ...walk(join(ROOT, "apps/parent-app/src")),
    ]
      .map(toRepoPath)
      .concat(CONFIG_FILES)
      .filter((path) => path !== TOKEN_SOURCE)
      .sort();

    it("the scans cover the app's files, its configs and the Token_Source", () => {
      expect(sourcePaths).toEqual(expect.arrayContaining(["apps/parent-app/app/index.tsx"]));
      expect(sourcePaths.length).toBeGreaterThan(20);
      expect(tokenScopePaths).toEqual(expect.arrayContaining([...CONFIG_FILES]));
      expect(tokenScopePaths).not.toContain(TOKEN_SOURCE);
      // The Token_Source exists and does hold colour literals, so excluding it is not vacuous.
      expect(read(TOKEN_SOURCE)).toMatch(COLOUR_LITERAL);
    });

    // Property 1: Single token source (Req 1.2, 1.4, 1.7).
    it("holds no colour literal outside the Token_Source, no dark: class and no text-[Npx]", () => {
      expect(tokenScopePaths.length).toBeGreaterThan(20);
      for (const path of tokenScopePaths) {
        const src = read(path);
        expect(src, `${path} holds a colour literal`).not.toMatch(COLOUR_LITERAL);
        expect(src, `${path} holds a dark: class`).not.toMatch(/(?<![\w-])dark:/);
        expect(src, `${path} holds an arbitrary text size`).not.toMatch(
          /(?<![\w-])text-\[\d+(?:\.\d+)?px\]/,
        );
      }
    });

    // Property 5: Font scaling stays on outside Dense_Components (Req 3.4).
    it("never disables font scaling and caps it only in AppText and the Dense_Components", () => {
      expect(sourcePaths.length).toBeGreaterThan(20);
      const capped: string[] = [];
      for (const path of sourcePaths) {
        const src = read(path);
        expect(src, `${path} overrides font scaling`).not.toMatch(/\ballowFontScaling\b/);
        const caps = /\bmaxFontSizeMultiplier\b/.test(src) || /\bdense\b/.test(src);
        if (caps) capped.push(path);
        if (!FONT_CAP_FILES.has(path)) {
          expect(src, `${path} caps font scaling outside a Dense_Component`).not.toMatch(
            /\bmaxFontSizeMultiplier\b|\bdense\b/,
          );
        }
      }
      expect(capped.sort()).toEqual([...FONT_CAP_FILES].sort());
    });

    it("has no animation API, no animation library import and no animation class (Req 8.4)", () => {
      expect(sourcePaths.length).toBeGreaterThan(20);
      for (const path of sourcePaths) {
        const src = read(path);
        expect(src, path).not.toMatch(/\bAnimated\b/);
        expect(
          moduleSpecifiers(src).filter((s) =>
            /^(?:react-native-reanimated|moti)(?:\/.*)?$/.test(s),
          ),
          path,
        ).toEqual([]);
        for (const value of classNameValues(src)) {
          expect(value, path).not.toMatch(
            /(?<![\w-])(?:animate-[\w-]+|transition(?:-[\w-]+)?)(?![\w-])/,
          );
        }
        expect(src, path).not.toMatch(/(?<![\w-])(?:animate|transition)-[a-z0-9[]/);
      }
    });

    it("makes no network call and imports no backend client (Req 8.1)", () => {
      expect(sourcePaths.length).toBeGreaterThan(20);
      for (const path of sourcePaths) {
        const src = read(path);
        expect(src, path).not.toMatch(/\bfetch\s*\(/);
        expect(src, path).not.toMatch(/\bXMLHttpRequest\b/);
        expect(src, path).not.toMatch(/\bWebSocket\b/);
        expect(src, path).not.toMatch(/\bEventSource\b/);
        expect(
          moduleSpecifiers(src).filter(
            (s) => s.startsWith("@supabase/") || /^(?:mqtt|ws)(?:\/.*)?$/.test(s),
          ),
          path,
        ).toEqual([]);
      }
    });

    it("reads no environment variable (Req 8.2)", () => {
      expect(sourcePaths.length).toBeGreaterThan(20);
      for (const path of sourcePaths) {
        expect(findEnvReads(read(path)), path).toEqual([]);
      }
    });

    /**
     * The In_App_Store modules: the only app files allowed to import a runtime VALUE from
     * `@xelulu/shared` (Phase 4 Req 19.7, C27). Every other file in the app keeps `import type`,
     * which is erased at compile time; these four are what pull the package — and `zod` with it —
     * into the Metro bundle and the Jest module graph, which is why the allow-list is named here
     * rather than left to a convention.
     */
    const IN_APP_STORE_FILES: ReadonlySet<string> = new Set([
      "apps/parent-app/src/lib/stores/content-store.ts",
      "apps/parent-app/src/lib/stores/mock-activity.ts",
      "apps/parent-app/src/lib/stores/report-store.ts",
      "apps/parent-app/src/lib/stores/routine-store.ts",
    ]);

    /** The runtime names those files may import: the Starter_Content and the report arithmetic. */
    const IN_APP_STORE_VALUE_NAMES: ReadonlySet<string> = new Set([
      "CONTENT_CATEGORIES",
      "createStarterContent",
      "createStarterRoutines",
      "reportWindow",
      "summariseActivity",
    ]);

    /** The names of a `{ a, b as c }` import clause, with any `type` specifier dropped. */
    function namedImports(clause: string): string[] {
      const braces = /\{([^}]*)\}/.exec(clause);
      return (braces?.[1] ?? "")
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0 && !/^type\s/.test(part))
        .map((part) => (part.split(/\s+as\s+/)[0] ?? part).trim());
    }

    it("imports @xelulu/shared as a value only in the In_App_Stores (Req 8.3, 19.7)", () => {
      expect(sourcePaths.length).toBeGreaterThan(20);
      // Every allow-listed file exists, so the list cannot go stale unnoticed.
      expect(sourcePaths).toEqual(expect.arrayContaining([...IN_APP_STORE_FILES]));

      const typeClauses: string[] = [];
      const valueFiles = new Set<string>();
      for (const path of sourcePaths) {
        const src = read(path);
        for (const match of src.matchAll(
          /\bimport\s+([\s\S]*?)\bfrom\s*(["'`])@xelulu\/shared(?:\/[^"'`]*)?\2/g,
        )) {
          const clause = (match[1] ?? "").trim();
          if (/^type\b/.test(clause)) {
            typeClauses.push(`${path}: ${clause}`);
            continue;
          }
          expect(
            IN_APP_STORE_FILES.has(path),
            `${path} imports @xelulu/shared as a value outside the In_App_Stores`,
          ).toBe(true);
          valueFiles.add(path);
          for (const name of namedImports(clause)) {
            expect(
              IN_APP_STORE_VALUE_NAMES.has(name),
              `${path} imports the runtime name ${name}, which is not on the store allow-list`,
            ).toBe(true);
          }
        }
      }
      // Both halves are non-vacuous: type-only imports exist, and so does a store value import.
      expect(typeClauses.length).toBeGreaterThan(0);
      expect(valueFiles.size).toBeGreaterThan(0);
    });

    /**
     * Phase 2.2 D3: v1 has no camera at all, so the Device page carries a static row saying so.
     * These two files are the only ones allowed to hold that label, as non-pressable text; the
     * module-import ban and the element bans below stay global and are widened, not narrowed.
     */
    const CAMERA_LABEL_FILES: ReadonlySet<string> = new Set([
      "apps/parent-app/src/features/device/strings.ts",
      "apps/parent-app/src/features/device/device-screen.tsx",
    ]);

    const DEVICE_STRINGS_FILE = "apps/parent-app/src/features/device/strings.ts";
    const DEVICE_SCREEN_FILE = "apps/parent-app/src/features/device/device-screen.tsx";

    /**
     * Every camera, video, picker and persistence module the app may not import.
     *
     * The `["'`]Video` ban below is on an opening quote or backtick, so it also catches a
     * back-quoted mention inside a comment. That is deliberate and it binds: the Reference's
     * original screen-13 row name is written down in the phase's `design.md` and nowhere in the
     * app, and the grandma feature's comments name the built row instead (D5).
     */
    const BANNED_MODULE =
      /^(?:expo-(?:camera|video|av|image-picker|media-library|secure-store|file-system)|react-native-vision-camera|@react-native-async-storage\/async-storage)(?:\/.*)?$/;

    it("has no camera or video feature, and the Camera label only in the device feature (Req 8.6)", () => {
      expect(sourcePaths.length).toBeGreaterThan(20);
      const cameraLabelFiles: string[] = [];
      for (const path of sourcePaths) {
        const src = read(path);
        expect(
          moduleSpecifiers(src).filter((s) => BANNED_MODULE.test(s)),
          path,
        ).toEqual([]);
        expect(src, path).not.toMatch(/<Camera(?![\w.])/);
        expect(src, path).not.toMatch(/<Video(?![\w.])/);
        expect(src, path).not.toMatch(/\bVideoView\b/);
        expect(src, path).not.toMatch(/["'`]Video/);
        if (/["'`]Camera/.test(src)) cameraLabelFiles.push(path);
      }
      for (const path of cameraLabelFiles) {
        expect(CAMERA_LABEL_FILES.has(path), `${path} holds a 'Camera' string literal`).toBe(true);
      }
      // At most the two allow-listed files, which holds only because no string outside the
      // device feature begins with that word (screen 5's photo strings are pinned for it).
      expect(cameraLabelFiles.length).toBeLessThanOrEqual(CAMERA_LABEL_FILES.size);
    });

    // The two compensating assertions for the narrowing above (Req 14.4, D3). Neither scans
    // `device-screen.tsx` for the bare word `Toggle`: the Movement row legitimately renders one
    // through ListRow's trailing object form.
    it("the device feature holds the camera row's static text, so the allow-list is not vacuous", () => {
      expect(sourcePaths).toEqual(
        expect.arrayContaining([DEVICE_STRINGS_FILE, DEVICE_SCREEN_FILE]),
      );
      const src = read(DEVICE_STRINGS_FILE);
      expect(src).toContain('"Camera"');
      expect(src).toContain('"Not included on this model"');
    });

    it("the Device screen's camera row is static text and no control (Req 14.4)", () => {
      const src = read(DEVICE_SCREEN_FILE);
      expect(src).not.toMatch(/<Switch(?![\w.])/);
      expect(src).not.toMatch(/accessibilityRole\s*=\s*\{?\s*["'`]switch/);

      const row = /<ListRow\s+icon="camera-outline"([\s\S]*?)\/>/.exec(src);
      expect(row, "the camera row element in device-screen.tsx").not.toBeNull();
      const props = row?.[1] ?? "";
      expect(props.length).toBeGreaterThan(0);
      expect(props).toContain('trailing="none"');
      expect(props).not.toMatch(/\bonPress\b/);
      expect(props).not.toMatch(/trailing=\{\{\s*toggle/);
    });

    /** The Route_Table: the one file allowed to write a route path (Phase 2.2 Req 22.9, C10). */
    const ROUTE_TABLE = "apps/parent-app/src/features/shell/routes.ts";

    /** The sixteen route paths, read off the Route_Table itself so the list cannot drift. */
    const routePaths: readonly string[] = [
      ...new Set(scanSource(read(ROUTE_TABLE)).strings.filter((s) => /^\/[a-z][a-z-]*$/.test(s))),
    ].sort();

    // Property 15: the boundaries hold, statically (Req 22.9, 3.1).
    it("writes a route path only in the Route_Table", () => {
      expect(routePaths).toHaveLength(16);
      expect(routePaths).toEqual(expect.arrayContaining(["/home", "/grandma-mode"]));
      const routeSet: ReadonlySet<string> = new Set(routePaths);
      const offenders: string[] = [];
      for (const path of sourcePaths) {
        if (path === ROUTE_TABLE) continue;
        const hits = scanSource(read(path)).strings.filter((s) => routeSet.has(s));
        if (hits.length > 0) offenders.push(`${path}: ${[...new Set(hits)].join(", ")}`);
      }
      expect(
        offenders,
        `route paths written outside the Route_Table:\n${offenders.join("\n")}`,
      ).toEqual([]);
    });

    /** Every `mock-*.ts` Mock_Module: the app's whole mock world. */
    const mockModulePaths = sourcePaths.filter((path) => /\/mock-[\w-]+\.ts$/.test(path));

    /**
     * Fields and shapes a Mock_Module may never carry (Req 19.5, safety.md s.1 and s.7): anything
     * the child said, anywhere a recording could be found, a raw sensor reading, an email address,
     * a phone number or a price.
     */
    const MOCK_PAYLOAD_BAN = /\b(?:transcript|audio|storage_path|confidence|duration_s)\b/i;
    const MEDIA_FILE = /\.(?:mp3|wav|opus)\b/i;
    const CURRENCY = /[$\u20B9\u20AC\u00A3\u00A5]/;

    it("the Mock_Modules carry no transcript, audio, file, address, number or price (Req 19.5)", () => {
      expect(mockModulePaths.length).toBeGreaterThanOrEqual(10);
      for (const path of mockModulePaths) {
        const src = read(path);
        const { code, strings } = scanSource(src);
        expect(code, `${path} names a banned payload field`).not.toMatch(MOCK_PAYLOAD_BAN);
        expect(code, `${path} names a media file`).not.toMatch(MEDIA_FILE);
        expect(code, `${path} holds a ten-digit run`).not.toMatch(/\d{10}/);
        // Module specifiers are excluded: `@xelulu/shared` is an import, not a payload. Inside a
        // template literal `${` is interpolation, not a price.
        const specifiers: ReadonlySet<string> = new Set(moduleSpecifiers(src));
        for (const value of strings) {
          if (specifiers.has(value)) continue;
          expect(value, `${path} holds an email address`).not.toContain("@");
          expect(value.replace(/\$\{/g, ""), `${path} holds a currency symbol`).not.toMatch(
            CURRENCY,
          );
        }
      }
    });

    /** The two Expo Router layout files: the only route files that compose anything (C10). */
    const LAYOUT_ROUTE_FILES: ReadonlySet<string> = new Set([
      "apps/parent-app/app/_layout.tsx",
      "apps/parent-app/app/(tabs)/_layout.tsx",
    ]);

    // Property 17: every route file is thin (Req 22.1, 22.2, 22.7, 3.1). A route file renders its
    // feature screen and nothing else, so a screen can be tested without the router.
    it("every non-layout route file renders exactly one element", () => {
      const routeFiles = sourceFiles("apps/parent-app/app")
        .map(toRepoPath)
        .filter((path) => path.endsWith(".tsx"))
        .sort();
      expect(routeFiles).toHaveLength(19);
      expect(routeFiles).toEqual(expect.arrayContaining([...LAYOUT_ROUTE_FILES]));
      for (const path of routeFiles) {
        if (LAYOUT_ROUTE_FILES.has(path)) continue;
        const elements = read(path).match(/<[A-Z]/g) ?? [];
        expect(elements, `${path} composes ${elements.length} elements, not 1`).toHaveLength(1);
      }
    });

    // Req 20.2, 20.3: every picture in the app is an original in-repo SVG, and no raster or
    // third-party art file ships. These two scans are the only checks behind that pair of SHALLs.
    it("every Illustration carries its licence line and the app ships no raster art", () => {
      const art = sourceFiles("apps/parent-app/src/illustrations");
      expect(art.length).toBeGreaterThanOrEqual(5);
      for (const abs of art) {
        expect(read(toRepoPath(abs)), toRepoPath(abs)).toContain("Original work, Xelulu-owned");
      }

      const RASTER = /\.(?:png|jpe?g|gif|webp|bmp|riv|lottie)$/i;
      const files = walk(join(ROOT, "apps/parent-app")).map(toRepoPath);
      expect(files.length).toBeGreaterThan(20);
      expect(files.filter((path) => RASTER.test(path))).toEqual([]);
    });
  });

  describe("admin console", () => {
    const srcFiles = walk(join(ROOT, "apps/admin/src"));
    const indexHtml = read("apps/admin/index.html");

    it("has exactly one h1, in app.tsx, and none elsewhere in src", () => {
      expect(read("apps/admin/src/app.tsx").match(/<h1\b/g) ?? []).toHaveLength(1);
      for (const abs of srcFiles.filter((f) => !f.endsWith(`${sep}app.tsx`))) {
        expect(readFileSync(abs, "utf8"), toRepoPath(abs)).not.toMatch(/<h1\b/);
      }
    });

    it('index.html declares lang="en" and loads no external resources', () => {
      expect(indexHtml).toMatch(/<html\b[^>]*\blang\s*=\s*["']en["']/);
      expect(indexHtml).not.toMatch(/\b(?:src|href)\s*=\s*["']?\s*(?:https?:)?\/\//i);
      expect(indexHtml).not.toMatch(/\bhttps?:\/\//i);
    });

    it("src has no import.meta.env reads", () => {
      expect(srcFiles.length).toBeGreaterThan(0);
      for (const abs of srcFiles) {
        expect(readFileSync(abs, "utf8"), toRepoPath(abs)).not.toMatch(/import\.meta\.env\b/);
      }
    });

    it("styles have no animation, transition or keyframes", () => {
      const cssFiles = srcFiles.filter((abs) => extname(abs) === ".css");
      expect(cssFiles.map(toRepoPath)).toContain("apps/admin/src/styles.css");
      for (const abs of cssFiles) {
        const css = stripCssComments(readFileSync(abs, "utf8"));
        expect(css, toRepoPath(abs)).not.toMatch(/\b(?:animation|transition)\b/i);
        expect(css, toRepoPath(abs)).not.toMatch(/@(?:-[a-z]+-)?keyframes\b/i);
      }
    });

    /**
     * The Operator_Stream route, the twelve Operator_Content_Routes (Phase 4 Req 17.7, 20.4) and
     * the one Device_Control_Route (Phase 6 C10, Req 7.5). Restated here rather than imported,
     * because `tooling/` reads the repo with fs and the list is the point of the check: the
     * console may request these fourteen paths and nothing else.
     */
    const CONSOLE_REQUEST_PATHS: ReadonlySet<string> = new Set([
      "/v1/stream",
      "/v1/content",
      "/v1/grandma",
      "/v1/routines",
      "/v1/reports",
      "/v1/content/create",
      "/v1/content/update",
      "/v1/content/status",
      "/v1/grandma/consent",
      "/v1/grandma/recording",
      "/v1/grandma/schedule",
      "/v1/grandma/call",
      "/v1/routines/run",
      "/v1/device-control",
    ]);

    /**
     * The only modules allowed a `fetch` call site; `use-console-stream.ts` opens an EventSource.
     * Phase 6 adds the second one for the Device_Control_Route, and no third is permitted.
     */
    const CONSOLE_FETCH_FILES: readonly string[] = [
      "apps/admin/src/content/content-client.ts",
      "apps/admin/src/control/control-client.ts",
    ];

    // Phase 4 C23: before this phase the console's only request was the stream and nothing
    // statically forbade a second one. It now calls `fetch` twelve ways, so the rule needs a real
    // enforcer rather than a sentence in a requirement.
    it("requests only the stream, the content routes and device control, from two modules", () => {
      const tsFiles = srcFiles.filter((abs) => [".ts", ".tsx"].includes(extname(abs)));
      expect(tsFiles.map(toRepoPath)).toEqual(expect.arrayContaining([...CONSOLE_FETCH_FILES]));

      const seen = new Set<string>();
      const fetchFiles: string[] = [];
      for (const abs of tsFiles) {
        const where = toRepoPath(abs);
        const { code, strings } = scanSource(readFileSync(abs, "utf8"));
        for (const value of strings) {
          if (!/^\/[A-Za-z0-9]/.test(value)) continue;
          expect(
            CONSOLE_REQUEST_PATHS.has(value),
            `${where} holds the request path ${value}, which is not the stream or a content route`,
          ).toBe(true);
          seen.add(value);
        }
        if (/(?<![\w$.])fetch\s*\(/.test(code)) fetchFiles.push(where);
      }

      // Not vacuous: the fourteen paths are all written down, in the client modules only.
      expect([...seen].sort()).toEqual([...CONSOLE_REQUEST_PATHS].sort());
      expect([...fetchFiles].sort()).toEqual([...CONSOLE_FETCH_FILES].sort());
    });

    it("the built bundle in apps/admin/dist contains no Panel_Key name", () => {
      const distDir = join(ROOT, "apps/admin/dist");
      expect(
        existsSync(distDir) && statSync(distDir).isDirectory(),
        "apps/admin/dist is missing: run `pnpm build` first (root `pnpm test` builds before testing)",
      ).toBe(true);

      const keys = panelKeys();
      expect(keys.length).toBeGreaterThan(0);

      const distFiles = walk(distDir, true);
      expect(distFiles.map(toRepoPath)).toContain("apps/admin/dist/index.html");

      const leaks: string[] = [];
      for (const abs of distFiles) {
        const text = readFileSync(abs, "utf8");
        for (const key of keys) if (text.includes(key)) leaks.push(`${toRepoPath(abs)} ${key}`);
      }
      expect(leaks, `Panel_Key names found in the admin bundle:\n${leaks.join("\n")}`).toEqual([]);
    });
  });

  describe("boundaries", () => {
    it("the parent app never references the admin console", () => {
      const files = walk(join(ROOT, "apps/parent-app"));
      expect(files.map(toRepoPath)).toContain("apps/parent-app/package.json");
      for (const abs of files) {
        const text = readFileSync(abs, "utf8");
        const where = toRepoPath(abs);
        expect(text, where).not.toContain("apps/admin");
        expect(text, where).not.toContain("@xelulu/admin");
        expect(text, where).not.toMatch(/["'`](?:\.\.\/)+admin(?:["'`/])/);
      }
    });

    it.each(Object.keys(TRANSPORT_DIRS))(
      "%s imports network modules only in its transport folders",
      (dir) => {
        const transportDirs = TRANSPORT_DIRS[dir] ?? [];
        expect(transportDirs).toHaveLength(3);

        // Each allowed folder exists and holds at least one .ts file, so the allowance is real.
        for (const transportDir of transportDirs) {
          const abs = join(ROOT, transportDir);
          expect(existsSync(abs) && statSync(abs).isDirectory(), transportDir).toBe(true);
          const tsFiles = walk(abs).filter((f) => extname(f) === ".ts");
          expect(tsFiles.length, `${transportDir} has no .ts file`).toBeGreaterThan(0);
        }

        const files = sourceFiles(dir);
        expect(files.length).toBeGreaterThan(0);
        for (const abs of files) {
          const where = toRepoPath(abs);
          if (transportDirs.some((t) => where.startsWith(`${t}/`))) continue;
          const bad = moduleSpecifiers(readFileSync(abs, "utf8")).filter((s) =>
            NETWORK_MODULE_RE.test(s),
          );
          expect(bad, `${where} imports a network module outside a transport folder`).toEqual([]);
        }
      },
    );
  });
});

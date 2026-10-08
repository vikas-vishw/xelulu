// Placeholder palette contrast checks (Req 4.7, 5.5; design: tooling/test/contrast.test.ts).
// Known-value checks of `contrastRatio`, then every title/body-on-background pair of the
// parent-app palette (tailwind.config.js) and the admin palette (styles.css custom properties)
// must reach at least 4.5:1 in both light and dark mode.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { contrastRatio } from "../checks/contrast.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const TAILWIND_CONFIG = join(ROOT, "apps/parent-app/tailwind.config.js");
const ADMIN_CSS = join(ROOT, "apps/admin/src/styles.css");

const MIN_RATIO = 4.5;
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

type Palette = { bg: string; title: string; body: string };
type ModePalettes = { light: Palette; dark: Palette };

function asHex(value: unknown, label: string): string {
  if (typeof value !== "string" || !HEX.test(value)) {
    throw new Error(`${label} is not a #RGB/#RRGGBB colour: ${JSON.stringify(value)}`);
  }
  return value;
}

/** Loads the CommonJS tailwind config and returns `theme.extend.colors.placeholder`. */
function loadParentAppPalette(): ModePalettes {
  const requireCjs = createRequire(import.meta.url);
  const config = requireCjs(TAILWIND_CONFIG) as {
    theme?: { extend?: { colors?: { placeholder?: Record<string, unknown> } } };
  };
  const p = config.theme?.extend?.colors?.placeholder;
  if (!p) throw new Error("tailwind.config.js has no theme.extend.colors.placeholder");
  return {
    light: {
      bg: asHex(p["bg"], "placeholder.bg"),
      title: asHex(p["title"], "placeholder.title"),
      body: asHex(p["body"], "placeholder.body"),
    },
    dark: {
      bg: asHex(p["bg-dark"], "placeholder.bg-dark"),
      title: asHex(p["title-dark"], "placeholder.title-dark"),
      body: asHex(p["body-dark"], "placeholder.body-dark"),
    },
  };
}

/** Reads `--xl-bg`, `--xl-title` and `--xl-body` from the first `:root { … }` block in `css`. */
function rootVars(css: string, label: string): Palette {
  const block = /:root\s*\{([^}]*)\}/.exec(css)?.[1];
  if (block === undefined) throw new Error(`${label}: no :root block found`);
  const vars = new Map<string, string>();
  for (const m of block.matchAll(/--xl-(bg|title|body)\s*:\s*([^;]+);/g)) {
    vars.set(m[1] ?? "", (m[2] ?? "").trim());
  }
  return {
    bg: asHex(vars.get("bg"), `${label} --xl-bg`),
    title: asHex(vars.get("title"), `${label} --xl-title`),
    body: asHex(vars.get("body"), `${label} --xl-body`),
  };
}

/** Light values from the top-level `:root`, dark values from the `prefers-color-scheme: dark` block. */
function loadAdminPalette(): ModePalettes {
  const css = readFileSync(ADMIN_CSS, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const media = /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{/.exec(css);
  if (!media) throw new Error("styles.css has no @media (prefers-color-scheme: dark) block");
  const light = rootVars(css.slice(0, media.index), "styles.css light");
  const dark = rootVars(css.slice(media.index + media[0].length), "styles.css dark");
  return { light, dark };
}

describe("contrastRatio known values", () => {
  it("black on white is 21:1", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 10);
  });

  it("a colour on itself is 1:1", () => {
    for (const c of ["#000000", "#ffffff", "#1f2937", "#E5E7EB"]) {
      expect(contrastRatio(c, c)).toBeCloseTo(1, 10);
    }
  });

  it("is symmetric in its arguments", () => {
    const pairs: [string, string][] = [
      ["#1f2937", "#ffffff"],
      ["#f9fafb", "#111827"],
      ["#767676", "#ffffff"],
    ];
    for (const [a, b] of pairs) {
      expect(contrastRatio(a, b)).toBe(contrastRatio(b, a));
    }
  });

  it("treats #RGB as #RRGGBB and ignores case", () => {
    expect(contrastRatio("#fff", "#000")).toBe(contrastRatio("#ffffff", "#000000"));
    expect(contrastRatio("#1a3", "#fff")).toBe(contrastRatio("#11aa33", "#ffffff"));
    expect(contrastRatio("#ABCDEF", "#FFF")).toBe(contrastRatio("#abcdef", "#fff"));
  });

  it("matches the WCAG reference value for #767676 on white (about 4.54:1)", () => {
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
  });

  it.each(["", "fff", "#ff", "#ffff", "#12345", "#1234567", "#ggg", "rgb(0, 0, 0)", " #fff"])(
    "throws on invalid input %j",
    (bad) => {
      expect(() => contrastRatio(bad, "#ffffff")).toThrow();
      expect(() => contrastRatio("#ffffff", bad)).toThrow();
    },
  );
});

describe.each([
  ["parent app (tailwind.config.js)", loadParentAppPalette],
  ["admin console (styles.css)", loadAdminPalette],
] as const)("%s placeholder palette", (_label, load) => {
  const palettes = load();

  it("defines a light and a dark palette (non-vacuous)", () => {
    for (const mode of ["light", "dark"] as const) {
      expect(palettes[mode].bg).toMatch(HEX);
      expect(palettes[mode].title).toMatch(HEX);
      expect(palettes[mode].body).toMatch(HEX);
    }
    expect(palettes.light.bg.toLowerCase()).not.toBe(palettes.dark.bg.toLowerCase());
  });

  it.each(["light", "dark"] as const)(
    "%s: title and body on background are at least 4.5:1",
    (mode) => {
      const { bg, title, body } = palettes[mode];
      expect(contrastRatio(title, bg), `${mode} title ${title} on ${bg}`).toBeGreaterThanOrEqual(
        MIN_RATIO,
      );
      expect(contrastRatio(body, bg), `${mode} body ${body} on ${bg}`).toBeGreaterThanOrEqual(
        MIN_RATIO,
      );
    },
  );
});

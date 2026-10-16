// Contrast checks (Phase 0 Req 5.5; Phase 2.1 Req 1.5, 1.6, 10.3).
// Known-value checks of `contrastRatio`, then:
//   - the parent app's Contrast_Pairs in apps/parent-app/src/theme/tokens.json (Property 2),
//   - the admin palette (styles.css custom properties) in both light and dark mode.
// The Phase 0 parent-app placeholder palette is gone with the placeholder screen (C9).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { contrastRatio } from "../checks/contrast.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const TOKENS_JSON = join(ROOT, "apps/parent-app/src/theme/tokens.json");
const ADMIN_CSS = join(ROOT, "apps/admin/src/styles.css");

const MIN_RATIO = 4.5;
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** The smallest typography size the token source may define (Req 1.5). */
const MIN_FONT_SIZE = 12;

/** Non-vacuity floor for the pair list (Req 1.6). */
const MIN_PAIR_COUNT = 20;

type Palette = { bg: string; title: string; body: string };
type ModePalettes = { light: Palette; dark: Palette };

type TypeStyle = { size: number; lineHeight: number; weight: string };
type ContrastPair = { fg: string; bg: string; min: number; use: string };
type Tokens = {
  color: Record<string, string>;
  typography: Record<string, TypeStyle>;
  contrastPairs: ContrastPair[];
};

function asHex(value: unknown, label: string): string {
  if (typeof value !== "string" || !HEX.test(value)) {
    throw new Error(`${label} is not a #RGB/#RRGGBB colour: ${JSON.stringify(value)}`);
  }
  return value;
}

function loadTokens(): Tokens {
  return JSON.parse(readFileSync(TOKENS_JSON, "utf8")) as Tokens;
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

describe("parent app design tokens (src/theme/tokens.json)", () => {
  const tokens = loadTokens();

  it(`lists at least ${MIN_PAIR_COUNT} Contrast_Pairs (non-vacuous)`, () => {
    expect(Array.isArray(tokens.contrastPairs)).toBe(true);
    expect(tokens.contrastPairs.length).toBeGreaterThanOrEqual(MIN_PAIR_COUNT);
  });

  it("gives every colour token a #RGB/#RRGGBB value", () => {
    const names = Object.keys(tokens.color);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) asHex(tokens.color[name], `color.${name}`);
  });

  // Feature: phase-2-1-parent-app-shell, Property 2: Every listed pair meets its minimum
  // Validates: Requirements 1.5, 1.6
  it("meets every Contrast_Pair's minimum, with both tokens defined and a stated use", () => {
    const failures: string[] = [];
    for (const pair of tokens.contrastPairs) {
      expect([3, 4.5], `pair ${pair.fg}/${pair.bg} min`).toContain(pair.min);
      expect(String(pair.use ?? "").length, `pair ${pair.fg}/${pair.bg} use`).toBeGreaterThan(0);
      const fg = asHex(tokens.color[pair.fg], `color.${pair.fg} (pair foreground)`);
      const bg = asHex(tokens.color[pair.bg], `color.${pair.bg} (pair background)`);
      const ratio = contrastRatio(fg, bg);
      if (ratio < pair.min) {
        failures.push(`${pair.fg} on ${pair.bg} = ${ratio.toFixed(2)} (min ${pair.min})`);
      }
    }
    expect(failures, `Contrast_Pairs below their minimum:\n${failures.join("\n")}`).toEqual([]);
  });

  it("uses every text-* colour as a Contrast_Pair foreground", () => {
    const foregrounds = new Set(tokens.contrastPairs.map((p) => p.fg));
    const textColors = Object.keys(tokens.color).filter((name) => name.startsWith("text-"));
    expect(textColors.length).toBeGreaterThan(0);
    const missing = textColors.filter((name) => !foregrounds.has(name));
    expect(missing, `text-* colours never checked as a foreground: ${missing.join(", ")}`).toEqual(
      [],
    );
  });

  it(`gives every typography token a size of at least ${MIN_FONT_SIZE} pt`, () => {
    const names = Object.keys(tokens.typography);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const style = tokens.typography[name];
      expect(typeof style?.size, `typography.${name}.size`).toBe("number");
      expect(style?.size ?? 0, `typography.${name}.size`).toBeGreaterThanOrEqual(MIN_FONT_SIZE);
      expect(style?.lineHeight ?? 0, `typography.${name}.lineHeight`).toBeGreaterThanOrEqual(
        style?.size ?? 0,
      );
    }
  });
});

describe("admin console (styles.css) placeholder palette", () => {
  const palettes = loadAdminPalette();

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

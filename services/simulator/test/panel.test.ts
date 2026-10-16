// Static checks of the simulator's web panel (Req 20.3): every input and select has a visible
// <label for> naming it, every button has visible text (a button is labelled by its own text,
// including the zone buttons panel.js builds), nothing is loaded from another origin, nothing
// animates or transitions, there is a :focus-visible rule with an outline of at least 2 px, and
// no tabindex is positive. Keyboard order and focus visibility also get a manual check in review;
// full WCAG validation needs manual testing with assistive technologies.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (name: string): string =>
  readFileSync(new URL("../panel/" + name, import.meta.url), "utf8");

const html = read("index.html");
const css = read("panel.css");
const js = read("panel.js");

type Tag = { readonly name: string; readonly attrs: ReadonlyMap<string, string> };

/** Opening tags with their attributes (lower-cased names; values unquoted). */
function tags(source: string, name: string): Tag[] {
  const out: Tag[] = [];
  const re = new RegExp(`<${name}\\b([^>]*)>`, "gi");
  for (const m of source.matchAll(re)) {
    const attrs = new Map<string, string>();
    for (const a of (m[1] ?? "").matchAll(
      /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g,
    )) {
      const raw = a[2] ?? "";
      attrs.set((a[1] ?? "").toLowerCase(), raw.replace(/^["']|["']$/g, ""));
    }
    out.push({ name, attrs });
  }
  return out;
}

/** The visible text of an element's content: tags removed, whitespace collapsed. */
function visibleText(inner: string): string {
  return inner
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The `<label for=id>` elements of the page, by their `for` value, with their text. */
function labels(): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of html.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label\s*>/gi)) {
    const forAttr = /\bfor\s*=\s*"([^"]*)"/i.exec(m[1] ?? "");
    if (forAttr?.[1] !== undefined) out.set(forAttr[1], visibleText(m[2] ?? ""));
  }
  return out;
}

describe("simulator panel", () => {
  it("gives every input and select a visible <label for>", () => {
    const controls = [...tags(html, "input"), ...tags(html, "select")];
    expect(controls.length).toBeGreaterThan(0);
    const byFor = labels();
    for (const control of controls) {
      const id = control.attrs.get("id");
      expect(id, control.name).toBeDefined();
      expect(control.attrs.get("type")).not.toBe("hidden");
      expect(byFor.get(id ?? "")?.length ?? 0, id).toBeGreaterThan(0);
    }
    // Every label points at a control that exists.
    const ids = new Set(controls.map((c) => c.attrs.get("id")));
    for (const target of byFor.keys()) expect(ids.has(target), target).toBe(true);
    // Ids are unique.
    const allIds = [...html.matchAll(/\bid\s*=\s*"([^"]*)"/gi)].map((m) => m[1]);
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it("offers the Test_Utterances in a labelled select beside the audio-turn button (Req 19.6)", () => {
    const form = /<form id="audio-form"[\s\S]*?<\/form\s*>/i.exec(html)?.[0] ?? "";
    expect(form).not.toBe("");
    expect(labels().get("utterance")).toBe("Utterance");
    expect(tags(form, "select").map((t) => t.attrs.get("id"))).toEqual(["utterance"]);
    // One static option with an empty value, so the default button keeps the synthetic upload.
    expect(tags(form, "option").map((t) => t.attrs.get("value"))).toEqual([""]);
    expect(form).toMatch(/<button type="submit">/);
    // The names themselves come from /api/state, never from the page.
    expect(js).toContain('fillSelect(document.getElementById("utterance"), choices.utterances)');
    expect(js).toMatch(/utterance === "" \? \{\} : \{ utterance \}/);
  });

  it("gives every button visible text, including the zone buttons built by panel.js", () => {
    const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button\s*>/gi)];
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) expect(visibleText(b[2] ?? "").length).toBeGreaterThan(0);
    expect(tags(html, "button")).toHaveLength(buttons.length);
    // panel.js builds buttons only with a text label of their own.
    const created = js.match(/createElement\("button"\)/g) ?? [];
    expect(created.length).toBeGreaterThan(0);
    expect((js.match(/button\.textContent\s*=/g) ?? []).length).toBe(created.length);
    expect(js).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/);
  });

  it("loads nothing from another origin", () => {
    for (const attr of ["src", "href", "action", "formaction", "srcset", "poster", "data"]) {
      for (const m of html.matchAll(new RegExp(`\\b${attr}\\s*=\\s*"([^"]*)"`, "gi"))) {
        const value = m[1] ?? "";
        expect(value, attr).not.toMatch(/^[a-z][a-z0-9+.-]*:/i);
        expect(value, attr).not.toMatch(/^\/\//);
      }
    }
    for (const source of [html, css, js]) {
      expect(source).not.toMatch(/:\/\//);
      expect(source).not.toMatch(/@import/i);
    }
    expect(css).not.toMatch(/url\s*\(/i);
    // panel.js fetches only same-origin, relative /api/ paths.
    expect(js).toMatch(/const API = "\/api\/";/);
    for (const m of js.matchAll(/fetch\(([^,)]*)/g)) expect(m[1]?.trim()).toMatch(/^API \+/);
  });

  it("has no animation, transition or flashing", () => {
    for (const source of [html, css, js]) {
      expect(source).not.toMatch(/@keyframes/i);
      expect(source).not.toMatch(/\banimation(-[a-z]+)?\s*:/i);
      expect(source).not.toMatch(/\btransition(-[a-z]+)?\s*:/i);
    }
    expect(js).not.toMatch(/\.animate\(|requestAnimationFrame|setInterval|style\./);
    expect(html).not.toMatch(/<(marquee|blink|video|audio|img|canvas|iframe)\b/i);
  });

  it("has a :focus-visible rule with an outline of at least 2 px", () => {
    const rules = [...css.matchAll(/([^{}]*:focus-visible[^{}]*)\{([^}]*)\}/g)];
    expect(rules.length).toBeGreaterThan(0);
    const widths = rules.flatMap((r) =>
      [...(r[2] ?? "").matchAll(/outline\s*:\s*(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1])),
    );
    expect(widths.length).toBeGreaterThan(0);
    for (const w of widths) expect(w).toBeGreaterThanOrEqual(2);
    expect(css).not.toMatch(/outline\s*:\s*(none|0)\b/);
  });

  it("never uses a positive tabindex", () => {
    for (const m of html.matchAll(/tabindex\s*=\s*"?(-?\d+)/gi)) {
      expect(Number(m[1])).toBeLessThanOrEqual(0);
    }
    for (const m of js.matchAll(/tabIndex\s*=\s*(-?\d+)/g))
      expect(Number(m[1])).toBeLessThanOrEqual(0);
    expect(js).not.toMatch(/setAttribute\(\s*"tabindex"/i);
  });

  it("announces results in a polite live region", () => {
    expect(html).toMatch(/<output\b[^>]*aria-live="polite"/);
  });
});

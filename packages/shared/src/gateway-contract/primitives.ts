// Internal field schemas for the Document B v2 contract. Not re-exported from the contract index.
// No defaults, transforms, coercion, catch or passthrough anywhere (D3), so a parsed value is
// always JSON-equal to its input.
import { z } from "zod";

import { PROTO_VER } from "./constants.js";

// Anchored, flag-free patterns: ASCII-only classes, and `$` never matches before a trailing newline.

/** BCP-47-like language tag: `en`, `en-IN`, `hi-Deva-IN`, `es-419` (C5). */
export const LANG_RE = /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-(?:[A-Z]{2}|[0-9]{3}))?$/;
/** 24-hour `HH:MM`, 00:00 to 23:59 (ruling 2). */
export const HHMM_RE = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;
/** `#RRGGBB` (ruling 2). */
export const COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

/**
 * True only for an absolute https URL with a host. The raw lowercase prefix check rules out
 * `http:`, `wss:`, relative paths, `""`, and WHATWG's lenient forms such as `https:localhost`
 * or a leading space. Never throws: `URL.parse` returns null instead.
 */
export function isAbsoluteHttpsUrl(s: string): boolean {
  if (!s.startsWith("https://")) return false;
  const url = URL.parse(s);
  return url !== null && url.protocol === "https:" && url.hostname !== "";
}

export const protoVer = z.literal(PROTO_VER);
/** Unix seconds: a non-negative safe integer. Back-dated values are valid. */
export const unixSeconds = z.int().min(0).max(Number.MAX_SAFE_INTEGER);
/** Identifiers, `card_id` and open-vocabulary fields. */
export const nonEmpty = z.string().min(1);
/** Error `code` and `detail` (ruling 3, empty allowed) and `fault` items. */
export const anyString = z.string();
/** Zod 4 numbers already reject NaN and ±Infinity. */
export const finite = z.number();
/** `duration_s`, `max_dist_mm`, `linear_mms`, `angular_mrad_s` (no upper bound, ruling 3). */
export const nonNegFinite = z.number().min(0);
/** Wake `dir_deg` (ruling 3). */
export const degInt = z.int().min(0).max(359);
/** `duration_hint_ms`. */
export const nonNegInt = z.int().min(0);
/** `battery_pct`, volume `level`, config `volume`, LED `brightness`. */
export const pct = z.int().min(0).max(100);
/** `wifi_rssi`. */
export const int = z.int();
/** `confidence`. */
export const unit = z.number().min(0).max(1);
export const lang = z.string().regex(LANG_RE);
export const hhmm = z.string().regex(HHMM_RE);
export const hexColor = z.string().regex(COLOR_RE);
/** Ota `manifest_url`. */
export const httpsUrl = z
  .string()
  .refine(isAbsoluteHttpsUrl, { params: { kind: "invalid_https_url" } });
/** Strict empty object: the only accepted value is `{}` (C6). */
export const emptyData = z.strictObject({});

/** Exact, case-sensitive match against a frozen closed list. */
export function enumOf<const T extends readonly string[]>(list: T) {
  return z.enum(list);
}

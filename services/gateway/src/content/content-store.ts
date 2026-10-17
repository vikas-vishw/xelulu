// The Content_Store (Phase 4 C1, C7, C23, Req 2): the curated library the Gateway reads, and the
// one choke point through which an item can become `active`.
//
// Three rules make this module the safety boundary it is meant to be:
//
//  1. `create` and `update` ALWAYS produce a `draft`, whatever the Content_Gate said (Req 2.4a).
//     Only `setStatus` can ever produce `active`, and it runs the gate first. So the worst a
//     reachable write can do is add a draft that cannot be activated.
//  2. Every field cap of Req 2.8 is checked BEFORE the gate (Req 2.10). `checkOutput` re-folds and
//     re-tokenises whatever it is handed, so bounding the text first is the one mitigation of
//     safety.md §9 item 6 available to this phase; the guard itself is not changed here.
//  3. The seed path runs the SAME validation and the SAME gate as the route path (Req 2.11). It is
//     deliberately not `create`: it is the store's own construction, and it is the one path that
//     may land an item `active` without a `setStatus` call (Req 2.5).
//
// Everything is in memory (Req 2.6): no file, no network, no database, and the whole library is
// gone on restart. A refusal names the offending field PATH and never echoes its value.
import {
  AGE_STAGES,
  CONTENT_CATEGORIES,
  CONTENT_SOURCES,
  SUPPORTED_LANGS,
  type AgeStage,
  type ContentItem,
  type ContentItemBase,
  type ContentKind,
  type ContentStatus,
  type ContentStep,
  type SupportedLang,
} from "@xelulu/shared";

import { isoAt, type Clock } from "../clock.js";
import type { GatewayLog } from "../log/gateway-log.js";
import { gateItem, type GateVerdict } from "./content-gate.js";

// ---------------------------------------------------------------------------------------------
// The caps (Req 2.8, 2.9). Every one of them is checked before the Content_Gate.

/** The library's capacity. A create past it is refused rather than evicting an existing item. */
export const CONTENT_MAX_ITEMS = 500;
export const CONTENT_MAX_STEPS_PER_ITEM = 24;
export const CONTENT_MAX_TITLE_CODE_POINTS = 80;
/** Per step, per language. Checked BEFORE the gate, so the guard never scans an unbounded text. */
export const CONTENT_MAX_STEP_CODE_POINTS = 240;
export const CONTENT_MAX_CHOICES_PER_STEP = 3;
export const CONTENT_MAX_PROMPT_CODE_POINTS = 120;
export const CONTENT_MAX_MATCH_TERMS_PER_CHOICE = 8;
export const CONTENT_MAX_MATCH_TERM_CODE_POINTS = 32;
export const CONTENT_MAX_LICENCE_NOTE_CODE_POINTS = 160;
/**
 * A route-submitted draft is smaller than a seeded one, and the reason is the transport: the
 * Operator_Surface caps a request body at 8 KiB and a 24-step bilingual item does not fit, since
 * Devanagari costs three UTF-8 bytes a code point. The ROUTE enforces this one; the seed path,
 * which creates in-process and sends no HTTP, keeps `CONTENT_MAX_STEPS_PER_ITEM`.
 */
export const CONTENT_MAX_DRAFT_STEPS = 6;

// ---------------------------------------------------------------------------------------------
// The interface

export type ContentFilter = Readonly<{
  kind?: ContentKind;
  category?: string;
  status?: ContentStatus;
  lang?: SupportedLang;
  ageStage?: AgeStage;
}>;

export type ContentWriteRefusal = Readonly<{
  /**
   * STORE-level codes. `invalid_field` is singular here and is mapped by the route onto the one
   * existing wire code `invalid_fields` (Req 16.4a): no new wire code is added for a field
   * refusal, and no route ever answers `invalid_field`.
   */
  code: "invalid_field" | "at_capacity" | "unknown_content" | "gate_refused";
  /** The dotted field path, for `invalid_field`. NEVER the submitted value. */
  field: string | null;
  verdict: GateVerdict | null;
}>;

/** A whole item without the fields the store owns. `status` is deliberately not submittable. */
export type ContentDraft = Readonly<
  Omit<ContentItemBase, "status" | "created_at" | "updated_at"> & { household_id?: null }
>;

/**
 * A partial edit. Every key optional; `status` is deliberately ABSENT, so the only route to
 * `active` is `setStatus` and C7's choke point stays one function rather than two.
 */
export type ContentPatch = Readonly<
  Partial<Omit<ContentItemBase, "content_id" | "status" | "created_at" | "updated_at">>
>;

export type ContentWriteResult =
  | { readonly ok: true; readonly item: ContentItem; readonly verdict: GateVerdict }
  | { readonly ok: false; readonly refusal: ContentWriteRefusal };

export interface ContentStore {
  /** Ordered by `created_at` then `content_id`: a total order, stable across calls (Req 2.7). */
  list(filter?: ContentFilter): readonly ContentItem[];
  get(contentId: string): ContentItem | null;
  /** The last Gate_Verdict recorded for an item, so a draft explains itself (Req 2.3). */
  verdict(contentId: string): GateVerdict | null;
  create(draft: ContentDraft): ContentWriteResult;
  update(contentId: string, patch: ContentPatch): ContentWriteResult;
  /** The ONLY way to reach `active`, and it runs the gate first (Req 2.4). */
  setStatus(contentId: string, status: ContentStatus): ContentWriteResult;
}

// ---------------------------------------------------------------------------------------------
// Validation (Req 2.8, 2.10, 2.11)
//
// Written defensively against `unknown`-shaped data rather than trusting the declared types: the
// route path hands this module parsed JSON, so a field the types promise is a string may be a
// number, an object or missing. A refusal names the path and nothing else.

type FieldRefusal = Readonly<{ field: string }>;

function codePoints(text: string): number {
  return [...text].length;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

/** A frozen member test over a closed list, for the subset rules of Req 2.8. */
function memberOf(list: readonly string[], value: unknown): boolean {
  return typeof value === "string" && list.includes(value);
}

function bad(field: string): FieldRefusal {
  return { field };
}

/** Every declared language of an item, narrowed to the supported ones. */
function declaredLangs(item: ContentItemBase): readonly SupportedLang[] {
  return item.languages.filter((lang): lang is SupportedLang =>
    (SUPPORTED_LANGS as readonly string[]).includes(lang),
  );
}

function validateChoices(
  step: ContentStep,
  stepPath: string,
  langs: readonly SupportedLang[],
  stepIds: ReadonlySet<string>,
): FieldRefusal | null {
  const choices: unknown = step.choices;
  if (!Array.isArray(choices)) return bad(`${stepPath}.choices`);
  if (choices.length > CONTENT_MAX_CHOICES_PER_STEP) return bad(`${stepPath}.choices`);
  for (let j = 0; j < step.choices.length; j += 1) {
    const choice = step.choices[j];
    const path = `${stepPath}.choices.${String(j)}`;
    if (choice === undefined) return bad(path);
    if (!isNonEmptyString(choice.choice_id)) return bad(`${path}.choice_id`);
    if (!isNonEmptyString(choice.next_step_id) || !stepIds.has(choice.next_step_id)) {
      return bad(`${path}.next_step_id`);
    }
    for (const lang of langs) {
      const prompt: unknown = choice.prompt?.[lang];
      if (!isNonEmptyString(prompt)) return bad(`${path}.prompt.${lang}`);
      if (codePoints(prompt) > CONTENT_MAX_PROMPT_CODE_POINTS) return bad(`${path}.prompt.${lang}`);
      const terms: unknown = choice.match_terms?.[lang];
      if (!isStringArray(terms) || terms.length === 0) return bad(`${path}.match_terms.${lang}`);
      if (terms.length > CONTENT_MAX_MATCH_TERMS_PER_CHOICE) {
        return bad(`${path}.match_terms.${lang}`);
      }
      for (const term of terms) {
        if (!isNonEmptyString(term) || codePoints(term) > CONTENT_MAX_MATCH_TERM_CODE_POINTS) {
          return bad(`${path}.match_terms.${lang}`);
        }
      }
    }
  }
  return null;
}

/**
 * The step graph of Req 1.8: every `next_step_id` resolves inside the item, every step is
 * reachable from the first, and at least one reachable path ends with no choices and a null
 * `next_step_id`.
 */
function validateGraph(item: ContentItemBase): FieldRefusal | null {
  const first = item.steps[0];
  if (first === undefined) return bad("steps");
  const byId = new Map(item.steps.map((step) => [step.step_id, step]));
  const seen = new Set<string>();
  const queue = [first.step_id];
  let terminal = false;
  for (;;) {
    const id = queue.shift();
    if (id === undefined) break;
    if (seen.has(id)) continue;
    seen.add(id);
    const step = byId.get(id);
    if (step === undefined) return bad("steps");
    if (step.choices.length > 0) {
      for (const choice of step.choices) queue.push(choice.next_step_id);
      continue;
    }
    if (step.next_step_id === null) {
      terminal = true;
      continue;
    }
    queue.push(step.next_step_id);
  }
  if (!terminal) return bad("steps");
  for (const step of item.steps) if (!seen.has(step.step_id)) return bad("steps");
  return null;
}

/** Every Req 2.8 field check, in a fixed order, before the gate ever runs. */
export function validateItem(item: ContentItemBase): FieldRefusal | null {
  if (!isNonEmptyString(item.content_id)) return bad("content_id");
  if (!isNonEmptyString(item.title)) return bad("title");
  if (codePoints(item.title) > CONTENT_MAX_TITLE_CODE_POINTS) return bad("title");
  if (!memberOf(CONTENT_SOURCES, item.source)) return bad("source");
  if (!isNonEmptyString(item.licence_note)) return bad("licence_note");
  if (codePoints(item.licence_note) > CONTENT_MAX_LICENCE_NOTE_CODE_POINTS) {
    return bad("licence_note");
  }
  if (!isStringArray(item.languages) || item.languages.length === 0) return bad("languages");
  for (const lang of item.languages) if (!memberOf(SUPPORTED_LANGS, lang)) return bad("languages");
  if (!isStringArray(item.age_stages) || item.age_stages.length === 0) return bad("age_stages");
  for (const stage of item.age_stages) if (!memberOf(AGE_STAGES, stage)) return bad("age_stages");
  if (!isStringArray(item.categories) || item.categories.length === 0) return bad("categories");
  for (const category of item.categories) {
    if (!memberOf(CONTENT_CATEGORIES, category)) return bad("categories");
  }

  const steps: unknown = item.steps;
  if (!Array.isArray(steps) || steps.length === 0) return bad("steps");
  if (steps.length > CONTENT_MAX_STEPS_PER_ITEM) return bad("steps");

  const langs = declaredLangs(item);
  const stepIds = new Set<string>();
  for (const step of item.steps) {
    if (!isNonEmptyString(step.step_id) || stepIds.has(step.step_id)) return bad("steps");
    stepIds.add(step.step_id);
  }
  for (let i = 0; i < item.steps.length; i += 1) {
    const step = item.steps[i];
    const path = `steps.${String(i)}`;
    if (step === undefined) return bad(path);
    for (const lang of langs) {
      const text: unknown = step.text?.[lang];
      if (!isNonEmptyString(text)) return bad(`${path}.text.${lang}`);
      if (codePoints(text) > CONTENT_MAX_STEP_CODE_POINTS) return bad(`${path}.text.${lang}`);
    }
    if (step.next_step_id !== null && !isNonEmptyString(step.next_step_id)) {
      return bad(`${path}.next_step_id`);
    }
    if (step.next_step_id !== null && !stepIds.has(step.next_step_id)) {
      return bad(`${path}.next_step_id`);
    }
    const choices = validateChoices(step, path, langs, stepIds);
    if (choices !== null) return choices;
  }
  return validateGraph(item);
}

// ---------------------------------------------------------------------------------------------
// The in-memory implementation

/** Copies and freezes every level, so no caller can change a stored item (as the log does). */
function frozenCopy<T>(value: T): T {
  if (Array.isArray(value)) return Object.freeze(value.map((v: unknown) => frozenCopy(v))) as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = frozenCopy(v);
    return Object.freeze(out) as T;
  }
  return value;
}

type Row = { item: ContentItem; verdict: GateVerdict | null };

/** `created_at` then `content_id`: a total order, so two list calls agree exactly (Req 2.7). */
function compareRows(a: ContentItem, b: ContentItem): number {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  if (a.content_id !== b.content_id) return a.content_id < b.content_id ? -1 : 1;
  return 0;
}

function matches(item: ContentItem, filter: ContentFilter): boolean {
  if (filter.kind !== undefined && item.kind !== filter.kind) return false;
  if (filter.status !== undefined && item.status !== filter.status) return false;
  if (filter.category !== undefined && !item.categories.includes(filter.category)) return false;
  if (filter.lang !== undefined && !item.languages.includes(filter.lang)) return false;
  if (filter.ageStage !== undefined && !item.age_stages.includes(filter.ageStage)) return false;
  return true;
}

/** Copies only the keys a patch actually carries, so an explicit `undefined` cannot blank one. */
function applyPatch(item: ContentItem, patch: ContentPatch): ContentItem {
  const merged: Record<string, unknown> = { ...item };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) merged[key] = value;
  }
  return merged as unknown as ContentItem;
}

export function createContentStore(
  deps: Readonly<{
    clock: Clock;
    log: Pick<GatewayLog, "add">;
    /** Defaults to the Starter_Content at the composition root; `[]` gives an empty library. */
    seed?: readonly ContentItem[];
  }>,
): ContentStore {
  const rows = new Map<string, Row>();

  function logGate(
    contentId: string,
    action: "seed" | "create" | "update" | "activate",
    verdict: GateVerdict | null,
  ): void {
    deps.log.add({
      kind: "content_gate",
      content_id: contentId,
      action,
      outcome: verdict !== null && verdict.ok ? "passed" : "refused",
      rule: verdict !== null && !verdict.ok ? verdict.rule : null,
      age_stage: verdict !== null && !verdict.ok ? verdict.age_stage : null,
      lang: verdict !== null && !verdict.ok ? verdict.lang : null,
    });
  }

  /**
   * The seed path (Req 2.5). Same validation, same gate: a passing item is held `active`, a
   * refused one `draft` with its verdict, and an item the validation cannot even read is not held
   * at all — logged as a refusal with a null `rule`, because no Safety_Rule applies to a
   * structurally broken row and inventing one would misreport it.
   */
  for (const seeded of deps.seed ?? []) {
    if (rows.has(seeded.content_id)) continue;
    if (validateItem(seeded) !== null) {
      logGate(seeded.content_id, "seed", null);
      continue;
    }
    const verdict = gateItem(seeded);
    rows.set(seeded.content_id, {
      item: frozenCopy({ ...seeded, status: verdict.ok ? "active" : "draft" }),
      verdict,
    });
    logGate(seeded.content_id, "seed", verdict);
  }

  /** Builds the stored row for a write, always as a `draft` (Req 2.4a). */
  function write(candidate: ContentItem, action: "create" | "update"): ContentWriteResult {
    const invalid = validateItem(candidate);
    if (invalid !== null) {
      return { ok: false, refusal: { code: "invalid_field", field: invalid.field, verdict: null } };
    }
    const verdict = gateItem(candidate);
    const item = frozenCopy({ ...candidate, status: "draft" as ContentStatus });
    rows.set(item.content_id, { item, verdict });
    logGate(item.content_id, action, verdict);
    // The draft is kept either way, so an operator can read its verdict and fix the text; what a
    // refusal denies is activation, which only `setStatus` can grant (Req 2.3, 2.4a, C23).
    return verdict.ok
      ? { ok: true, item, verdict }
      : { ok: false, refusal: { code: "gate_refused", field: null, verdict } };
  }

  return {
    list(filter) {
      const all = [...rows.values()].map((row) => row.item);
      const picked = filter === undefined ? all : all.filter((item) => matches(item, filter));
      return picked.sort(compareRows);
    },

    get: (contentId) => rows.get(contentId)?.item ?? null,

    verdict: (contentId) => rows.get(contentId)?.verdict ?? null,

    create(draft) {
      if (!isNonEmptyString(draft.content_id)) {
        return {
          ok: false,
          refusal: { code: "invalid_field", field: "content_id", verdict: null },
        };
      }
      if (rows.has(draft.content_id)) {
        return {
          ok: false,
          refusal: { code: "invalid_field", field: "content_id", verdict: null },
        };
      }
      if (rows.size >= CONTENT_MAX_ITEMS) {
        return { ok: false, refusal: { code: "at_capacity", field: null, verdict: null } };
      }
      const at = isoAt(deps.clock.now());
      return write(
        {
          ...draft,
          household_id: null,
          status: "draft",
          created_at: at,
          updated_at: at,
        } as ContentItem,
        "create",
      );
    },

    update(contentId, patch) {
      const row = rows.get(contentId);
      if (row === undefined) {
        return { ok: false, refusal: { code: "unknown_content", field: null, verdict: null } };
      }
      return write(
        {
          ...applyPatch(row.item, patch),
          content_id: row.item.content_id,
          household_id: null,
          status: "draft",
          created_at: row.item.created_at,
          updated_at: isoAt(deps.clock.now()),
        } as ContentItem,
        "update",
      );
    },

    setStatus(contentId, status) {
      const row = rows.get(contentId);
      if (row === undefined) {
        return { ok: false, refusal: { code: "unknown_content", field: null, verdict: null } };
      }
      if (status === "draft") {
        // Withdrawing an item is always allowed: a draft is spoken to nobody. The gate still runs
        // so the recorded verdict stays the truth about the text, but NO `content_gate` entry is
        // written, because withdrawing is not a gate decision.
        const verdict = gateItem(row.item);
        const item = frozenCopy({ ...row.item, status, updated_at: isoAt(deps.clock.now()) });
        rows.set(contentId, { item, verdict });
        return { ok: true, item, verdict };
      }
      // The one path to `active`, and the gate runs first (Req 2.4).
      const invalid = validateItem(row.item);
      if (invalid !== null) {
        return {
          ok: false,
          refusal: { code: "invalid_field", field: invalid.field, verdict: null },
        };
      }
      const verdict = gateItem(row.item);
      logGate(contentId, "activate", verdict);
      if (!verdict.ok) {
        rows.set(contentId, { item: row.item, verdict });
        return { ok: false, refusal: { code: "gate_refused", field: null, verdict } };
      }
      const item = frozenCopy({ ...row.item, status, updated_at: isoAt(deps.clock.now()) });
      rows.set(contentId, { item, verdict });
      return { ok: true, item, verdict };
    },
  };
}

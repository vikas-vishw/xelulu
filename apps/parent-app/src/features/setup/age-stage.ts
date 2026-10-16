// The age stage behind screen 5's caption line (Req 8.6-8.9, D6). Pure string-and-integer
// arithmetic: no clock, no time zone, no environment, and it never throws.
//
// `packages/shared/src/domain/age-stage.ts` is the authority for these semantics; its
// `deriveAgeStage` has the same boundaries and the same leap-day rule. The app cannot call it,
// because Req 22.3 and the Repo_Check allow `@xelulu/shared` by `import type` only, so this is
// a deliberate mirror. Phase 3 deletes this file the moment value imports are allowed.

import type { AgeStage } from "@xelulu/shared";

/** Named `AgeStageLookup`, not `AgeStageResult`: `packages/shared` already exports that name
 *  with a different shape, and two types with one name would confuse Phase 3's deletion. */
export type AgeStageLookup =
  Readonly<{ ok: true; stage: AgeStage }> | Readonly<{ ok: false; reason: "invalid" | "future" }>;

type CalendarDay = Readonly<{ y: number; m: number; d: number }>;

/** Anchored and flag-free: `\d` is ASCII-only and `$` does not match before a trailing newline. */
const ISO_DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isLeap(y: number): boolean {
  return y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
}

function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeap(y) ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

/** Parses `YYYY-MM-DD` as a real calendar day; `null` for anything else. */
function parseIsoDay(value: string): CalendarDay | null {
  const match = ISO_DAY_RE.exec(value);
  if (match === null) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (y < 1 || m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

/** Negative when `a` is before `b`, zero when equal, positive when after. */
function compareDays(a: CalendarDay, b: CalendarDay): number {
  return a.y * 10000 + a.m * 100 + a.d - (b.y * 10000 + b.m * 100 + b.d);
}

/**
 * The child's age stage on the `reference` day, both arguments `YYYY-MM-DD`. Completed years:
 * 0-2 `tiny`, 3-5 `little`, 6-8 `explorer`, 9 and over `maker`. A 29 February birthday counts
 * as reached on 1 March in a common year.
 */
export function ageStageFor(dateOfBirth: string, reference: string): AgeStageLookup {
  const birth = parseIsoDay(dateOfBirth);
  const ref = parseIsoDay(reference);
  if (birth === null || ref === null) return { ok: false, reason: "invalid" };
  if (compareDays(ref, birth) < 0) return { ok: false, reason: "future" };

  // This year's birthday, with 29 February moved to 1 March when the reference year is common.
  const leapDayInCommonYear = birth.m === 2 && birth.d === 29 && !isLeap(ref.y);
  const birthdayM = leapDayInCommonYear ? 3 : birth.m;
  const birthdayD = leapDayInCommonYear ? 1 : birth.d;

  let years = ref.y - birth.y;
  if (ref.m < birthdayM || (ref.m === birthdayM && ref.d < birthdayD)) years -= 1;

  const stage: AgeStage =
    years < 3 ? "tiny" : years < 6 ? "little" : years < 9 ? "explorer" : "maker";
  return { ok: true, stage };
}

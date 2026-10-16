// Age-stage derivation from a date of birth (Requirement 16).
// Pure string-and-integer arithmetic only: no clock, no time zone, no environment.

export const AGE_STAGES = Object.freeze(["tiny", "little", "explorer", "maker"] as const);
export type AgeStage = (typeof AGE_STAGES)[number];

export type AgeStageError = {
  readonly kind: "invalid_date_of_birth" | "invalid_reference_date" | "reference_before_birth";
};

export type AgeStageResult =
  | { readonly ok: true; readonly value: AgeStage }
  | { readonly ok: false; readonly error: AgeStageError };

type CalendarDay = { readonly y: number; readonly m: number; readonly d: number };

// Anchored, flag-free: `\d` is ASCII-only and `$` does not match before a trailing newline.
const ISO_DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isLeap(y: number): boolean {
  return y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
}

function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeap(y) ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

/** Parses `YYYY-MM-DD` as a proleptic Gregorian day in years 0001–9999; `null` otherwise. */
function parseIsoDay(s: unknown): CalendarDay | null {
  if (typeof s !== "string") return null;
  const match = ISO_DAY_RE.exec(s);
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

function fail(kind: AgeStageError["kind"]): AgeStageResult {
  return { ok: false, error: { kind } };
}

/**
 * Derives the child's age stage from `dateOfBirth` on the `reference` day, both `YYYY-MM-DD`.
 * Completed years: under 3 `tiny`, 3–5 `little`, 6–8 `explorer`, 9 or more `maker`.
 * A 29 February birthday counts as reached on 1 March in non-leap years. Never throws.
 */
export function deriveAgeStage(dateOfBirth: string, reference: string): AgeStageResult {
  const birth = parseIsoDay(dateOfBirth);
  if (birth === null) return fail("invalid_date_of_birth");
  const ref = parseIsoDay(reference);
  if (ref === null) return fail("invalid_reference_date");
  if (compareDays(ref, birth) < 0) return fail("reference_before_birth");

  // This year's birthday, with 29 February moved to 1 March when the reference year is not leap.
  const leapDayInCommonYear = birth.m === 2 && birth.d === 29 && !isLeap(ref.y);
  const birthdayM = leapDayInCommonYear ? 3 : birth.m;
  const birthdayD = leapDayInCommonYear ? 1 : birth.d;

  let age = ref.y - birth.y;
  if (ref.m < birthdayM || (ref.m === birthdayM && ref.d < birthdayD)) age -= 1;

  const value: AgeStage = age < 3 ? "tiny" : age < 6 ? "little" : age < 9 ? "explorer" : "maker";
  return { ok: true, value };
}

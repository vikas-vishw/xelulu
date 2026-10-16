// Small text helpers shared by the form screens. D10 keeps validation to emptiness checking
// only, so this is the whole of it.

/** True when `value` is empty or only whitespace. */
export function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

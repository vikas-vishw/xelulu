// Component-kit strings (Req 8.7, Req 22.8). The shell re-exports `back` as BACK_LABEL so the
// literal lives in one place only.

export const KIT_STRINGS = {
  /** Accessibility label of the back control in ScreenHeader. */
  back: "Back",
  /** TextField reveal control, while the text is masked. */
  showPassword: "Show password",
  /** TextField reveal control, while the text is visible. */
  hidePassword: "Hide password",
  /** StepList state, appended to each row's accessibility label (Req 2.5). */
  stepState: {
    done: "done",
    current: "current step",
    pending: "not started",
  },
  /** PageDots accessibility label, one-based for the reader. */
  pageLabel: (index: number, count: number): string => `Page ${index} of ${count}`,
  /** Stepper minus control, named after the value it adjusts. */
  stepperDecrease: (label: string): string => `Decrease ${label}`,
  /** Stepper plus control, named after the value it adjusts. */
  stepperIncrease: (label: string): string => `Increase ${label}`,
  /** Default accessible name of an Avatar, including its initial-letter fallback: the person's
   *  name. A builder so the wording stays here with the rest of the kit strings. */
  avatarLabel: (name: string): string => name,
  /** A removable Chip's accessible name, so the press's effect is in the name. */
  removeLabel: (label: string): string => `Remove ${label}`,
  /** Confirm_Dialog default cancel label. */
  cancel: "Cancel",
} as const;

// Every user-facing string of the four Setup_Flow screens — 2 Onboarding, 3 Parent Account,
// 4 Pair Xelulu and 5 Child Profile (Req 22.8). English only; `src/lib/i18n` replaces this
// module later.
//
// The visible headings live here rather than in `SCREEN_HEADER_NAME`, because on all four
// screens the Reference's visible wording differs from the accessible header name.

export const SETUP_STRINGS = {
  /** Screen 2 — Onboarding / Value. */
  onboarding: {
    heading: "A friend to play, learn and grow with.",
    getStarted: "Get Started",
    /** The three value rows, one per carousel page (Req 5.1). */
    values: {
      plays: "Plays and moves around your home",
      talks: "Understands and talks",
      teaches: "Teaches, explores and grows with your child",
    },
  },

  /** Screen 3 — Parent Account. The wordmark comes from the shell, which already owns it. */
  account: {
    welcomeTo: "Welcome to",
    createYourAccount: "Create your account",
    parentName: "Parent's name",
    emailAddress: "Email address",
    password: "Password",
    createAccount: "Create Account",
    /** The one notice line while a field is still blank (Req 6.3). */
    fillAllFields: "Enter your name, email address and a password to continue.",
    orContinueWith: "or continue with",
    google: "Google",
    apple: "Apple",
    /** The one notice line after a provider press; it replaces the fill-in line (Req 6.5). */
    providerUnavailable: (provider: string): string =>
      `Sign in with ${provider} is not available in this build.`,
    /** The provider control's accessible name, which says so too (Req 6.6). */
    providerA11y: (provider: string): string =>
      `Continue with ${provider}. Not available in this build.`,
    /** Static text, two lines, no press handler and no link (Req 6.7, 22.7). */
    terms: ["By continuing, you agree to our", "Terms & Privacy Policy."],
  },

  /** Screen 4 — Pair Xelulu. No radio, network or permission API is behind any of this. */
  pair: {
    heading: "Let's set up your Xelulu",
    subheading: "Connect via Bluetooth and Wi-Fi",
    startPairing: "Start Pairing",
    steps: {
      power: "Power on Xelulu",
      bluetooth: "Connect via Bluetooth",
      wifi: "Join your Wi-Fi network",
      complete: "Complete setup",
    },
  },

  /** Screen 5 — Child Profile. */
  childProfile: {
    heading: "Tell us about your child",
    /**
     * Both photo strings are pinned verbatim: the Repo_Check bans any string literal that opens
     * with the capitalised word for a lens outside the device feature, and these two sit closest
     * to it. The control opens nothing and imports no media module (D8, Req 8.2).
     */
    photoUnavailable: "Adding a photo is not available in this build.",
    addPhotoA11y: "Add photo. Not available in this build.",
    childName: "Child's name",
    dateOfBirth: "Date of birth",
    /** Shown instead of the stage line when the typed date is not a usable day (Req 8.7). */
    dobFormat: "Enter the date of birth as YYYY-MM-DD",
    /** "Age stage: little" (Req 8.6). */
    ageStageLine: (stage: string): string => `Age stage: ${stage}`,
    genderLabel: "Gender",
    /** Display only: the selection feeds no derivation and no payload (Req 8.3). */
    genderOptions: ["Boy", "Girl", "Prefer not to say"],
    languagesLabel: "Languages",
    interestsLabel: "Interests (optional)",
    /** The two add chips. The Reference's leading "+" is the `add` glyph, so the name is the
     *  words alone. */
    addChip: "Add",
    addMoreChip: "Add more",
    newLanguage: "New language",
    newInterest: "New interest",
    confirmAddLanguage: "Add language",
    confirmAddInterest: "Add interest",
    continueLabel: "Continue",
  },
} as const;

// Every user-facing string of screen 12, Family (Req 22.8). English only; `src/lib/i18n`
// replaces this module later.
//
// The header text is not here: the visible heading equals the accessible header name, so it
// lives once in `SCREEN_HEADER_NAME.family`.

export const FAMILY_STRINGS = {
  subheader: "People who share Xelulu",
  /** The `tablist`'s accessible name, and the scope every segment assertion resolves against. */
  segmentsLabel: "Family groups",
  segments: {
    children: "Children",
    caregivers: "Caregivers",
    grandparents: "Grandparents",
  },
  grandparentsAndCaregivers: "Grandparents & Caregivers",
  /** The Reference's leading "+" is the `add` glyph, so each name is the words alone. */
  addChild: "Add Child",
  inviteCaregiver: "Invite Caregiver",
  /** The two inline add forms. */
  childName: "Child's name",
  caregiverName: "Name",
  confirmAddChild: "Add child",
  confirmInvite: "Invite",
  cancel: "Cancel",
  /** A locally added child has no date of birth or language yet, and `FamilyChild` needs both
   *  labels, so these two stand in until Phase 3 holds a real row. */
  ageNotSet: "Age not set",
  languagesNotSet: "Languages not set",
  roles: {
    parent: "Parent",
    caregiver: "Caregiver",
    storyteller: "Storyteller",
  },
  /**
   * The permission lines, rendered per member and never per panel (Req 15.3): `caregivers`
   * holds a parent (Dad) and a caregiver (Meera), and the two roles may do different things.
   * The wording is `product.md`'s roles.
   */
  parentPermission: "Full access to devices, children, reports and privacy.",
  caregiverPermission:
    "Can start games and routines, and see the battery. Cannot see reports or change controls.",
  grandparentPermission: "Can record stories and make calls only.",
  /** The Reference's child subtitles: "4 years • English, Hindi". */
  children: {
    aarav: { ageLabel: "4 years", languagesLabel: "English, Hindi" },
    diya: { ageLabel: "7 years", languagesLabel: "English" },
  },
} as const;

/** "4 years • English, Hindi" */
export function childLine(ageLabel: string, languagesLabel: string): string {
  return `${ageLabel} • ${languagesLabel}`;
}

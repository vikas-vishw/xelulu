// Screen 12's mock household (Req 19.1, 19.5, 19.6). Display names, role enums, role labels,
// permission lines and age and language labels only: no email address, no phone number and no
// URL appears anywhere (Req 15.8, D13).

import type { UserRole } from "@xelulu/shared";

import { MOCK_IDENTITY } from "../../lib/mock-identity";

import { FAMILY_STRINGS } from "./strings";

export type FamilyChild = Readonly<{
  child_id: string;
  display_name: string;
  age_label: string;
  languages_label: string;
}>;

export type FamilyMember = Readonly<{
  user_id: string;
  display_name: string;
  role: UserRole;
  role_label: string;
  /** Rendered as this member's own line, never a per-panel constant: `caregivers` holds a
   *  parent (Dad) and a caregiver (Meera), and the two roles may do different things. */
  permission_line: string;
}>;

export type FamilyData = Readonly<{
  children: readonly FamilyChild[];
  /** Exactly two members, in this order: Dad (role "parent") and Meera (role "caregiver"). */
  caregivers: readonly FamilyMember[];
  grandparents: readonly FamilyMember[];
}>;

const CHILDREN = FAMILY_STRINGS.children;

export const MOCK_FAMILY: FamilyData = {
  children: [
    {
      child_id: MOCK_IDENTITY.childId,
      display_name: MOCK_IDENTITY.child,
      age_label: CHILDREN.aarav.ageLabel,
      languages_label: CHILDREN.aarav.languagesLabel,
    },
    {
      child_id: MOCK_IDENTITY.secondChildId,
      display_name: MOCK_IDENTITY.secondChild,
      age_label: CHILDREN.diya.ageLabel,
      languages_label: CHILDREN.diya.languagesLabel,
    },
  ],
  caregivers: [
    {
      user_id: "user_mock_dad",
      display_name: MOCK_IDENTITY.otherParent,
      role: "parent",
      role_label: FAMILY_STRINGS.roles.parent,
      permission_line: FAMILY_STRINGS.parentPermission,
    },
    {
      user_id: "user_mock_meera",
      display_name: MOCK_IDENTITY.caregiver,
      role: "caregiver",
      role_label: FAMILY_STRINGS.roles.caregiver,
      permission_line: FAMILY_STRINGS.caregiverPermission,
    },
  ],
  grandparents: [
    {
      user_id: "user_mock_grandma",
      display_name: MOCK_IDENTITY.grandparent,
      role: "grandma",
      role_label: FAMILY_STRINGS.roles.storyteller,
      permission_line: FAMILY_STRINGS.grandparentPermission,
    },
  ],
};

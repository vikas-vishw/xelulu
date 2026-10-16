// The Output_Guard (Req 6, 10.3): ours, pure, synchronous, and run on every reply before any
// text-to-speech call, whatever the provider returned (safety.md §4). The LLM is not trusted to
// police itself: a reply that breaks one of these rules is dropped whole and a Safe_Redirect is
// spoken instead, so no part of a bad reply is ever heard (C19, Req 6.2).
//
// One text and one Child_Context give exactly one Safety_Decision with exactly one Safety_Rule,
// in this precedence, highest first (Property 6):
//
//   1. url              5. romantic      9. financial
//   2. contact_detail   6. frightening  10. length
//   3. price            7. medical      11. uncertain
//   4. brand            8. legal        12. none -> allow
//
// The forbidden spans come first because they are the ones that reach outside the house: a URL, a
// phone number, a price or a brand is the open internet arriving by voice (safety.md §3). Then
// the content classes, then the Age_Stage's sentence and word limits, then the refusal the guard
// makes when it cannot read the text at all.
//
// Nothing here returns, keeps or logs any part of the reply, or any part of a forbidden span. The
// verdict is three closed enum values (Omar ruling 1).
import { type SafetyDecisionName, type SafetyRule } from "@xelulu/shared";

import { withinAgeShape } from "./age-shape.js";
import { containsTerm, firstForbidden, isUnreadable } from "./forbidden-spans.js";
import type { GuardContext, SafetyVerdict } from "./input-guard.js";

/** The content classes of Req 6.3, each a Safety_Rule code and a word list. */
export type OutputContentRule = "romantic" | "frightening" | "medical" | "legal" | "financial";

/**
 * The word lists for the five refused content classes, in both supported languages. A match
 * refuses the reply: Xelulu gives no romantic, frightening, medical, legal or financial content
 * to a child (safety.md §4). A false positive costs a Safe_Redirect, which is the cheap side.
 */
export const OUTPUT_CONTENT_TERMS: Readonly<Record<OutputContentRule, readonly string[]>> =
  Object.freeze({
    romantic: Object.freeze([
      "romance",
      "romantic",
      "kiss",
      "kisses",
      "boyfriend",
      "girlfriend",
      "dating",
      "marry me",
      "sexy",
      "प्रेमी",
      "प्रेमिका",
      "चुम्बन",
    ]),
    frightening: Object.freeze([
      "monster",
      "monsters",
      "ghost",
      "ghosts",
      "zombie",
      "witch",
      "nightmare",
      "blood",
      "kill",
      "kills",
      "murder",
      "भूत",
      "राक्षस",
      "चुड़ैल",
      "खून",
      "डरावना",
      "डरावनी",
    ]),
    medical: Object.freeze([
      "medicine",
      "medicines",
      "tablet",
      "tablets",
      "injection",
      "doctor",
      "fever",
      "hospital",
      "symptom",
      "symptoms",
      "दवा",
      "दवाई",
      "डॉक्टर",
      "बुखार",
      "अस्पताल",
      "इंजेक्शन",
    ]),
    legal: Object.freeze([
      "lawyer",
      "police",
      // Compounds, not inflections: suffix removal cannot reach either from `police`, so both
      // are listed (group-5 review pass 4, finding 2).
      "policeman",
      "policemen",
      "court",
      "jail",
      "arrest",
      "arrested",
      "वकील",
      "पुलिस",
      "अदालत",
      "जेल",
      "कानून",
    ]),
    financial: Object.freeze([
      "bank",
      "banks",
      "loan",
      "loans",
      "invest",
      "investment",
      "salary",
      "credit card",
      "interest rate",
      "बैंक",
      "कर्ज़",
      "कर्ज",
      "निवेश",
      "उधार",
    ]),
  });

/** The order the content classes are tested in, so one reply always gives one rule. */
export const OUTPUT_CONTENT_RULE_ORDER: readonly OutputContentRule[] = Object.freeze([
  "romantic",
  "frightening",
  "medical",
  "legal",
  "financial",
]);

function verdict(decision: SafetyDecisionName, rule: SafetyRule): SafetyVerdict {
  return { decision, rule, topic: null };
}

/** The first content class the reply matches, or null. */
function contentRule(text: string): OutputContentRule | null {
  for (const rule of OUTPUT_CONTENT_RULE_ORDER) {
    const terms = OUTPUT_CONTENT_TERMS[rule];
    if (terms.some((term) => containsTerm(text, term))) return rule;
  }
  return null;
}

/**
 * Exactly one verdict for any reply text (Property 6). Precedence, highest first: url,
 * contact_detail, price, brand, romantic, frightening, medical, legal, financial, length,
 * uncertain, allow. Every refusal uses the decision `refuse`, so the Turn_Pipeline has one
 * answer to give: drop the reply and speak the Safe_Redirect for this stage and language.
 *
 * Of the GuardContext only `ageStage` is read. Every word list here carries both supported
 * languages, so `lang` is not consulted, and the parent's content categories gate the input
 * stage: a reply is held to these twelve rules whatever topic the turn was about.
 */
export function checkOutput(text: string, ctx: GuardContext): SafetyVerdict {
  const forbidden = firstForbidden(text);
  if (forbidden !== null) return verdict("refuse", forbidden);
  const content = contentRule(text);
  if (content !== null) return verdict("refuse", content);
  if (!withinAgeShape(text, ctx.ageStage)) return verdict("refuse", "length");
  if (isUnreadable(text)) return verdict("refuse", "uncertain");
  return verdict("allow", "none");
}

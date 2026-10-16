---
inclusion: always
---
# Xelulu: Child safety & privacy (non-negotiable)

These rules override convenience, feature requests and performance. If a task conflicts with them, stop and flag it.

## 1. No raw child audio stored
- Child audio is streamed in memory through the gateway to STT, then discarded.
- Never write it to disk, Storage, logs, analytics or crash reports.
- Configure STT/LLM/TTS providers for zero retention and no training wherever offered. Record the setting in the provider adapter.
- Cry detection runs on the device. Only `confidence` and `duration_s` leave the robot.
- Transcripts are text only. They are retained 30 days by default, then deleted automatically. Parents can view, delete or export them at any time, and "delete all" really deletes.
- Exception: Grandma recordings and voice-clone samples are adult-provided content. They are stored only with a recorded consent statement, and they are never child audio.

## 2. Verifiable parental consent
- Consent is collected at setup, before any child profile, voice or memory is processed, and stored as a `Consent` record (who, what, when, version).
- Follow India's DPDP Act 2023 and DPDP Rules 2025:
  - Verifiable consent from an identifiable adult parent (e.g. reliable identity details or a virtual token).
  - A clear notice in plain language.
  - Withdrawal is as easy as giving consent.
  - Erasure on withdrawal or when the purpose ends.
  - Breach notification duties.
- The Grandma cloned voice (P1) needs its own consent statement and a 3–5 minute reading. The voice is locked to the household and used for stories, rhymes and lullabies only.
- No tracking, profiling, behavioural monitoring or targeted advertising of children (DPDP s.9).
  - Reports are parent-requested summaries for care and learning. They are not used for ads, product analytics or third parties.
  - Legal review of reports and cry alerts against s.9 is pending (see open items).

## 3. No open internet for the child
- The LLM gets no browsing, search, URL fetching or code execution. It can only call allow-listed internal tools: content library, routines, memory, device actions.
- Never speak URLs, phone numbers, prices or brand links. No purchases, ads, sign-ups or contact with strangers.
- Stories, songs and media come only from the curated content library.
- Before anything is sent, deleted, shared or bought, confirm with the parent in the app.

## 4. Age-appropriate guardrails (on every reply)
- Guardrails run on the input before the LLM and on the output after it, regardless of provider.
- Replies follow the active child's `age_stage` (tiny/little/explorer/maker): vocabulary, length (1–3 sentences), tone, and the topics allowed by the parent's content categories.
- Deferral topics (death, body, violence, religion, family conflict, plus any parent-added `defer_topics`):
  - Give a short, gentle answer, then "let's ask Amma/Appa together".
  - Surface the topic in the app as a deferred question.
- Distress or disclosure of harm: comfort, encourage telling a trusted grown-up, and alert the parent. The final crisis protocol needs expert sign-off before launch.
- No romantic, frightening, medical, legal or financial advice content. Homework help gives hints, never final answers (P1).
- If the safety layer is unsure, the reply is refused and replaced with a safe redirect.

## 5. Physical safety: the device decides
The cloud can never override these:
- No movement while the robot is lifted, at an edge, charging or in quiet hours.
- Motor speed and torque are capped in firmware.
- An e-stop works independently of the AI.
- Wake word and cry detection stay on the device.
- An offline fallback is always available.

The cloud's side of this:
- Treat ack `reason` values (`picked_up`, `at_edge`, `charging`, `quiet_hours`, `low_battery`, `unsafe`, `busy`, `unknown_action`) as final. Don't retry around them.
- Respect quiet hours, play limits and the movement toggle before sending commands at all.

## 6. Photosensitivity
- Nothing may flash at 3–30 Hz. This covers face animations (Rive/Lottie), LED `effect`s and app animations.
- Firmware enforces it, but the cloud and app must never request it.
- Check every character asset before adding it.

## 7. Data security
- Every table has Row Level Security scoped by `household_id` and role:
  - Parent: full access.
  - Caregiver: no reports or controls.
  - Grandma: recordings and calls only.
- PII is encrypted at rest. TLS is used for every hop (HTTPS, MQTTS, WSS).
- No secret is hard-coded or committed.
  - `SUPABASE_SERVICE_KEY`, `DEVICE_PROVISION_SECRET` and the provider keys exist only in backend env.
  - The app ships only `EXPO_PUBLIC_*` values.
- Logs carry IDs only, never names, transcripts, audio or tokens.
- A `device_id` is bound to one household. Unbinding wipes the robot's household data.
- OTA images are signed, with automatic rollback.

## 8. When in doubt
Pick the more private and more conservative option, then flag it for Omar.

## 9. Safety Hardening — must close before any real STT/LLM/TTS provider is wired

Phase 3A's Safety_Layer is verified on its structure: both guards are total functions with the precedence design.md specifies, the deferral and comfort wording exists at every age-stage-and-language cell, no child text ever reaches a Log_Entry, and no raw audio is written anywhere. Group 5 was accepted on that basis (spec flag F6).

What is **not** finished is term **coverage**. The guards classify by word lists, and a word list's reach is a different question from a guard's correctness. None of the items below is reachable in Phase 3A, because every utterance is a fixed Simulator constant and every reply is a constant in `safe-text.ts` or the Mock_Llm's in-source table, both scanned by the suite. All of them become reachable the moment a real provider is wired, so every one of them is a release blocker for that phase.

1. **Term coverage against morphology.** `services/gateway/src/brain/safety/forbidden-spans.ts` matches a term by comparing a small set of inflection candidates, which removes one common English suffix (`-s`, `-es`, `-ed`, `-ing`, with the doubled-consonant and silent-`e` forms). That covers `hurts`, `bleeds`, `hitting`, `kissed`, `murdered`, `banking`, `loaning`. It does not cover irregular forms (`feel`/`felt` is listed explicitly instead), `-y`/`-ies` (`cry`/`cries`), compounds (`police`/`policeman`, listed explicitly instead), or any Devanagari inflection — Hindi morphology is richer than suffix removal reaches, and half-solving it would read as coverage it does not have. *Why it matters:* a child's word, or a provider's reply, in a form no list carries decides `allow`.

2. **Unicode and lexical evasion.** A forbidden span written apart (`y o u t u b e`), spelled out in words (`nine eight seven six five`), or split by a joiner (`you\u200dtube`) is not matched. The third is the price of supporting Hindi: ZWJ and ZWNJ are word characters because Hindi words need them, so an injected joiner splits a Latin brand without making the text unreadable. *Why it matters:* a model that has learned to evade a filter will produce exactly these shapes.

3. **Third-party harm disclosure scope.** Detection in `input-guard.ts` is first-person: harm *to the child* is caught, while `daddy hurt mummy`, `my brother hit my sister` and `मम्मी को मारा` reach the model as ordinary turns. safety.md §4's "disclosure of harm" reads wider than the list implements. The narrow scope is deliberate — a generic "X hurt Y" rule comforts and alerts on every retold fable — but it is a decision awaiting a ruling, not a finished rule. Two related consequences are already live and recorded: adding the `my` possessive to the injury anchors means `my brother hurt the deer` now comforts, which widens this scope as a side effect in the conservative direction; and `it hurts` / `that hurts` stay `allow`, because an unanchored `it` would comfort on `it hurt the deer`. *Why it matters:* a child disclosing violence between adults is exactly the case a parent alert exists for.

4. **Quiet hours versus a comforting reply — an OPEN PRODUCT DECISION, not a defect.** The device-action gate in `services/gateway/src/brain/tools/device-action.ts` refuses all five discretionary actions during quiet hours, on the conservative reading that a talking robot is not quiet either (safety.md §5 names movement only). The consequence is deliberate but unresolved: **as it stands, a distress or harm-disclosure reply would also be refused at night**, so a frightened child at 2 a.m. gets silence from the robot while the parent alert is still raised. Three options, none chosen: let the comfort path bypass quiet hours; let it speak at a reduced volume; or keep the silence and rely on the parent alert alone. This needs Omar's ruling and belongs with the crisis-protocol sign-off (F3), because the right answer depends on what the escalation promises. Until then the gate stays as built.

5. **Output_Guard fail-closed bias.** Its `uncertain` rule currently refuses text it cannot *read*. The ruling in the Phase 3 design defers hardening it so that a reply the detectors cannot *place* is also refused rather than allowed. *Why it matters:* the Output_Guard is the one layer that holds whatever a vendor returns, so its default on the unknown case is the whole safety argument for using a third-party model at all.

6. **Unbounded guard cost before the length checks.** Every term scan re-folds and re-tokenises the whole text, and both precedence lists run the scans before the length rules, so cost grows with input size unbounded: measured at 266 ms for 20,000 code points on the input side, and 4.1 s for 200,000 on the output side. The gateway is single-threaded, `checkInput`'s 400-code-point ceiling is enforced *after* the scans, and `checkOutput` has no ceiling at all because reply length is the provider's choice. *Why it matters:* one long reply stalls every other child's turn, and 20,000 code points already spends a quarter of the 1.0 s latency budget inside the guard. *Fix direction:* fold and tokenise once per guard call and share the token array with the detectors and list matchers, and bound the transcript and the reply in the Turn_Pipeline before the guard sees them.

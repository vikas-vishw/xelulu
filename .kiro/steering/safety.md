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
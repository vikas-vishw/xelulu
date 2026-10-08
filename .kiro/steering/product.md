---
inclusion: always
---
# Xelulu: Product

## What it is
Xelulu is a screen-free AI companion robot for children aged 1–12. It rolls on the floor, talks, listens, reacts to touch and expresses itself through a hidden face (eyes and mouth only) plus glowing ears, cheeks and belly. It is India-first: English plus 10 Indian languages, including code-mixed speech.

It is the first product in a family that shares one platform: Xelulu (1–12), Sathi/WithU (12–20), Parth (20–45) and Sarthi (45+). Build shared pieces (auth, devices, voice pipeline, safety, content) so they can be reused, but only ship Xelulu features.

The face is a 2.8" IPS panel behind smoked plastic. It shows no video, apps, text or scrolling, "just a face".

## Who it is for
- Children, in four age stages: `tiny` (1–2), `little` (3–5), `explorer` (6–8), `maker` (9–12). These age ranges are an assumption; the docs name the stages only.
- Parent: full control of the household, devices, children, reports and privacy.
- Caregiver: can start games and routines and see battery. Cannot see reports or change controls.
- Grandma/grandparent: can record content and make live calls only.

## Product principles
1. Screen-free for the child. The parent app is for grown-ups only.
2. Short, warm, curious replies: 1–3 sentences that end in a question or invitation.
3. On-device safety comes first. The robot's hardware and firmware decide what is physically safe, and the cloud cannot override them.
4. Privacy by default:
   - No raw child audio is stored.
   - The robot's listening state is always visible.
   - Nothing is recorded in secret.
   - Parents can view, delete and export everything.
5. Works offline: core play, comfort and routines work without the cloud.
6. Grown-ups stay in the loop:
   - Sensitive topics are deferred to parents.
   - The robot confirms before anything is sent, deleted or shared.
   - There are no purchases, ads or open internet.

## v1 hardware facts that override the feature catalogue
- An IPS face replaces the 8x8 LED eyes.
- No camera in v1. Remove or disable every camera feature and the "Camera (Privacy)" control.
- No dock in v1. Charging uses a magnetic cable and contacts. Remove "Dock" from the app.
- NFC is fitted, so story cards and code cards are supported.
- 7 touch zones (Document B): head, left_ear, right_ear, belly, back, left_hand, right_hand.

## Launch features (P0)
**Voice (V)**
- V01: wake word "Hey Lulu", plus touch-to-talk (hold belly or head).
- V02: short replies.
- V03: multilingual and bilingual mode.
- V04: why-chains with real-world tests.
- V05: ask-a-grown-up deferral.
- V06: correct name pronunciation.
- V07: copycat voice.
- V08: toddler talk for `tiny`.

**Grandma & stories (G)**
- G01: storyteller. Panchatantra, Jataka, Tenali Raman, Akbar-Birbal, regional tales and fables, all retold originally.
- G02: interactive branching stories.
- G04: real grandparent recordings, with scheduling.
- G05: live Grandma voice call.
- G07: mother-tongue word of the day.

**Touch (T)**
- T01: 7-zone touch.
- T02: touch reactions.
- T03: hug detection.
- T04: motion reactions (pickup, shake, upside-down, drop, tilt).
- T05: wheels stop when picked up.
- T06: gentle response to rough play.

**Movement (M)**
- M01: "come to me" (up to 2 m, stops at 30 cm).
- M03: 20 dances.
- M04: freeze dance.
- M05: Xelulu Says.
- M07: treasure hunt using cards.
- M10: cliff sensors.
- M11: bounded roaming within 3 m.

**Learning (L)**
- L02: hunts.
- L03: animals.
- L04: maths.
- L07: our world.
- L08: feelings coach and breathing.
- L09: manners.
- L01 ("What is this?") is out: it needs a camera.

**Care (C)**
- C01: cry detection (more than 5 s), comfort and a parent alert. No audio is kept.
- C02: routines.
- C03: walkie-talkie.
- C05: charge reminders at 20% and 10%.
- C06: quiet hours.
- C07: play limits that end with a graceful "nap".
- C08: daily and weekly reports.

**Later (P1/P2, design for but don't build yet)**
- G03: make-a-story.
- G06: consented, cloned, household-locked Grandma voice.
- G08: festivals.
- M02: follow me.
- M06: chase and hide.
- M08: remote play.
- M09: yoga.
- L05: reading.
- L06: science.
- L10: NFC code cards.
- L11: homework hints (never the final answer).
- L12: adaptive learning.
- C04: announcements.
- C09: questions for the parent.

## Parent app areas
**Screens** (the Experience Board): splash, onboarding, home, play, grow, routines, family.

**Functional areas:**
- Setup: pairing, Wi-Fi, child profiles, Grandma, members and roles.
- Home: battery, online status, play time, last activity.
- Parental controls.
- Grandma.
- Reports.
- Talk.
- Play: start games, story-card manager.
- Content.
- Privacy: memory review/delete, export, consent records.
- Device: connection status.
- Support.

## Latency target
- Wake: a listening face and sound appear immediately, on the device.
- From the end of the child's speech to the first audio: 1.0 s typical, 1.6 s worst case.
- ElatoAI's baseline is 2–3 s, so this gap must be closed during the voice-loop phase.

## How we work
- Omar (founder) approves everything.
- Claude is CTO/PM.
- The intern owns firmware and hardware.
- Kiro is the implementation engineer.
- One spec at a time. No code before its spec is approved. Follow phases 0–7 of the Master Build Guide.
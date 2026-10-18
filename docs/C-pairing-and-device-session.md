# Document C: Pairing and Device Session

**Version 1.0 · Status: frozen · Additive to Document B v2 (`proto_ver` 2)**

This is a contract the firmware obeys. Where it and Document B disagree, Document B wins.

## Status and scope

Document C adds **no topic, no message, no field, no enum value and no transport**. Everything below
rides what Document B v2 already defines: the four MQTT topics
(`xelulu/{device_id}/status`, `/event`, `/cmd`, `/ack`) and the per-turn audio WebSocket at
`AUDIO_WSS_URL`. If a reading of this document seems to need a new wire field, that reading is
wrong — a new field is a `proto_ver` bump and needs sign-off from both the software and the
hardware sides.

Document C is in two parts.

- **Part 1 — BLE / Wi-Fi provisioning: reserved, not yet specified.** Getting Wi-Fi credentials
  onto the device is device-local and happens *before* any MQTT connection exists, so nothing in
  Part 2 depends on it. It is named here because `.kiro/steering/tech.md` places pairing in
  Document C; it will be specified when the provisioning radio path is designed.
- **Part 2 — MQTT pairing and the Device_Session: specified below, and frozen.** Everything from
  the first MQTT connection onwards.

Part 2 assumes the device already has Wi-Fi, a cloud-issued `device_id`, its token, and the broker
and audio endpoints. Those four values are carried by the env keys
`DEVICE_ID`, `DEVICE_TOKEN`, `MQTT_BROKER_URL` and `AUDIO_WSS_URL`.

---

# Part 1 — BLE / Wi-Fi provisioning (reserved)

Not yet specified. Device-local, before any MQTT connection. No cloud surface, no MQTT topic and no
Document B message is involved, so no part of this document is blocked on it.

---

# Part 2 — MQTT pairing and the Device_Session

## 2.1 Pairing is the `hello` that already exists

Pairing is **recognition**, not a new handshake. On every MQTT connection the device:

1. Connects to `MQTT_BROKER_URL` over TLS (MQTTS).
2. Subscribes to `xelulu/{device_id}/cmd`.
3. Publishes one `hello` on `xelulu/{device_id}/status`.

`hello` carries exactly the Document B fields: `proto_ver`, `ts`, `type`, `device_id`, `fw_ver`,
`auth` and `proto`. The cloud compares `device_id` and `auth` against the cloud-issued device id and
token — `auth` in constant time — and records the result as the existing `auth` Log_Entry outcome,
`ok` or `failed`.

Rules:

- A `hello` whose `device_id` does not match its own topic is rejected before `auth` is compared.
- A failed match is a **refused device, not a retry loop**. The cloud drops every later message
  from that device until a `hello` with a matching token arrives, and the firmware must not
  reconnect-and-retry in a tight loop: fix the token.
- `fw_ver` is non-secret and must be the firmware's real version string. It is never put in a
  Log_Entry, and the cloud uses it only for the Pairing_Code below.
- `hello` is republished on every reconnect, including after a Silence_Window (§2.4).

## 2.2 The Pairing_Code

The console shows a **6-character Pairing_Code** so an operator can confirm, out loud, that the
device on the bench is the device on the screen.

- It is **derived in the cloud** from `device_id` and `fw_ver`, which an accepted `hello` already
  carries. It is **never sent on the wire** and **never derived from `auth`, a token, a password or
  any other secret**.
- It uses Crockford base32 without the vowels (`0123456789BCDFGHJKLMNPQRSTVWXYZ`), so no code reads
  as a word.
- It is a **confirmation, not a credential**. It hides nothing and grants nothing. Two devices with
  the same `device_id` and `fw_ver` have the same code, by design.
- Same `device_id` plus same `fw_ver` always gives the same code. New firmware gives a new code.

**What the firmware must do:** nothing on the wire. To let the operator compare, print the same
code — or simply the `device_id` and `fw_ver` it sent — on the serial console at boot.

## 2.3 The Device_Session

The cloud holds one **Device_Session** per registered device. Its value is one of six states.
The session is **cloud-owned and derived**: every input below is a Document B message the cloud
already parses, or the existing presence timer. Firmware reports no session state and receives
none.

| State | What it means |
|---|---|
| `unpaired` | No accepted `hello` has been seen since the cloud started. |
| `connected` | A `hello` was accepted. The device is known and paired. |
| `idle` | A `status` Heartbeat was accepted. The device is alive and not in a turn. |
| `in_turn` | An audio turn is open. |
| `error` | An `auth` failure, a rejected message, or an `error` event. |
| `offline` | The 45 s Silence_Window expired. |

Transitions. The first row that matches, top to bottom, wins.

| From | Input (the Document B message that causes it) | To |
|---|---|---|
| any | `hello` on `status`, `auth` matched | `connected` |
| any | `hello` on `status`, `auth` failed | `error` |
| `unpaired` | anything else | `unpaired` |
| `connected`, `idle`, `in_turn`, `error` | `status` Heartbeat accepted | `idle` |
| `offline` | `status` Heartbeat accepted | `offline` (see below) |
| `connected`, `idle` | `audio_start` accepted on the audio WebSocket | `in_turn` |
| `in_turn` | the turn's `audio_end`, an aborted turn, or an accepted `interrupt` event | `idle` |
| `connected`, `idle`, `in_turn`, `error`, `offline` | accepted `error` event, or a rejected message on any of the device's topics | `error` |
| `connected`, `idle`, `in_turn`, `error` | 45 s with no Heartbeat | `offline` |

Two consequences are deliberate:

- **`unpaired` absorbs everything but a `hello`.** A device the cloud has never authenticated is
  not in `error`; it is simply not here yet.
- **A bare Heartbeat does not clear `offline`.** Document B requires a `hello` on connect, so a
  device that resumes after a Silence_Window announces itself again. A session that stays `offline`
  while `status` messages arrive means the firmware skipped its `hello` — which is exactly the
  conformance failure this makes visible. A device that goes `offline` and then sends an accepted
  `hello` returns to `connected` **with its Pairing_Code unchanged**.

The session is shown in the console. It is **not** a Log_Entry: it is derivable from entries the
Gateway_Log already carries, so adding one would be duplication.

## 2.4 Connect, disconnect and heartbeat — the existing rules

These are Document B's rules, restated here because the session depends on them. None of them is new.

- **Heartbeat:** the device publishes `status` on `xelulu/{device_id}/status` **every 15 s**.
- **Offline:** a device is considered offline after **45 s** of silence. That is the only thing
  that moves a session to `offline`.
- **Disconnect:** MQTT carries no goodbye in this contract. A disconnect is observed as silence and
  becomes `offline` when the 45 s window expires; there is nothing for the firmware to send.
- **Reconnect:** subscribe to `cmd`, then publish `hello`, then resume the 15 s Heartbeat.
- **Envelope:** every message carries `proto_ver`; every upstream message carries `ts`
  (unix seconds) and `type`; every event carries `event_id`; every command carries `cmd_id`.
- **QoS:** commands use 1; telemetry uses 0 or 1.
- **`proto_ver` mismatch:** the device keeps its last-known-good state and reports the mismatch. It
  does not act on the message.

## 2.5 Acks are final

Every `ack` on `xelulu/{device_id}/ack` carries a `status`
(`accepted` | `done` | `rejected` | `failed`), a `cmd_id` and a `reason`.

- **Every ack `status` and `reason` is final.** The cloud records it and **never retries around
  it** — not a resend, not a reworded command, not a fallback action. The hardware's refusal is
  the hardware's truth (`picked_up`, `at_edge`, `charging`, `quiet_hours`, `low_battery`, `unsafe`,
  `busy`, `unknown_action`).
- Commands are idempotent and identified by `cmd_id`; the cloud may see the same ack twice and
  treats a repeat as a duplicate, not a new outcome.
- The console shows the device's **last ack** — its action, outcome and `reason` — as part of the
  device's row. Nothing on the wire changes to make that possible.

## 2.6 Conformance

The firmware-to-Document-B conformance checklist — every message the firmware must send, every
message it must accept, every ack it must return, and the envelope rules — lives in the Intern
Integration Guide (`docs/intern-integration-guide.md`, delivered with the console's test matrix).
One list, not two.

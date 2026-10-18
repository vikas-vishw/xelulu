# Xelulu intern integration guide

**For the hardware engineer bringing up the ESP32-S3.** Everything here is run from a terminal or
clicked in a browser. You write no code and edit no file in this repository. If a step seems to
need a change to the app, the gateway or the contract, it is a bug in this guide — say so rather
than editing anything.

What you end with: the whole Xelulu cloud running on your machine, a device paired and visible in
the developer console, and a 28-row test matrix walked to green — first against the simulator,
then against your firmware.

Three documents stand behind this one. [Document B](B-gateway-and-hardware-seam.docx) is the wire
contract and is **frozen** at `proto_ver` 2: the firmware is built to match it, never the reverse.
[Document C](C-pairing-and-device-session.md) adds MQTT pairing and the device session on top of
it, with no new topic, message or field. This guide adds no contract of its own; §9 is a checklist
drawn from those two.

---

## 1. Read this first: the stack is closed until you open it

The device-facing ports are bound to `127.0.0.1` by default, so a clean checkout is not exposed to
your network. One env value opens them, and it opens **only** those ports:

Set `DEVICE_BIND_HOST` to `0.0.0.0` in the root `.env`. The key ships empty in `.env.example`, and `.env.local.example` ships it closed at `127.0.0.1`.

Put that in the root `.env`, then `docker compose up --build`. What it moves:

| Surface | Closed (default) | With `DEVICE_BIND_HOST=0.0.0.0` |
| --- | --- | --- |
| MQTT broker, 1883 and 8883 | `127.0.0.1` only | reachable on your LAN IP |
| Gateway audio socket, 8081 | `127.0.0.1` only | reachable on your LAN IP |

What it does **not** move, ever: the developer console (8090), the simulator panel (8091), the
EMQX dashboard (18083) and the MQTT-over-WebSocket ports (8083, 8084). Those stay on `127.0.0.1`
whatever you set, and a test in `tooling/test/lan-bind.test.ts` fails the build if that changes.

**Opening the bind does not open the door.** Anonymous broker access is off. Every client must
present a username and password that EMQX knows before it may publish or subscribe on any topic:

- your **device** presents its `DEVICE_ID` as the username and its `DEVICE_TOKEN` as the password;
- the **gateway** presents `MQTT_USERNAME` and `MQTT_PASSWORD`, a different principal, so a leaked
  device token cannot impersonate the cloud.

A device on the Wi-Fi with no token, a wrong token, or an unknown id is refused at the broker and
never reaches a Document B topic. The gateway then checks the token a second time, at `hello`: a
session whose `auth` does not match is marked and its `status`, `event` and `ack` messages are
dropped until a matching `hello` arrives. Two independent checks, and the refusal is logged as ids
and enums only, never as text.

**Device actuation is a separate switch.** The Device control tab needs the gateway started with
`--device-control`, which local Compose does **not** pass by default. Bring it up with
`pnpm dev:admin:device`, or add the flag to the gateway `command` yourself. Reading the Devices tab
and the Test Matrix needs no flag.

**This is a dev-LAN setup, not an internet-facing one.** Plain MQTT on 1883 is unencrypted; 8883
carries the local TLS the stack already ships. Do not port-forward any of this to the internet, and
do not treat the dev placeholders in `.env.local.example` as secrets.

---
## 2. Run the stack

From a clean checkout, in the repository root. The root `README.md` section **"Local run: from a
clean checkout to watching a turn"** is the authoritative copy-paste; it is not repeated here.
The short form:

```sh
docker compose up --build -d
docker compose ps
```

Three containers reach `Up (healthy)`: EMQX, the gateway and the simulator. Allow up to a minute —
the healthcheck interval is 10 s for the gateway and the simulator, 5 s for EMQX.

**No `.env` is needed.** `docker-compose.yml` carries a local default for every value the gateway
and simulator read. A root `.env` still wins if you make one; see the README's "Gateway and
simulator locally".

What is listening, once the stack is up:

| Surface | Address | Published to the host? |
| --- | --- | --- |
| MQTT (EMQX) | `1883` plain, `8883` TLS | yes, on `DEVICE_BIND_HOST` (loopback by default) |
| Gateway audio WebSocket | `8081` | yes, on `DEVICE_BIND_HOST` (loopback by default) |
| EMQX dashboard | `127.0.0.1:18083` | yes, loopback only, always |
| Gateway operator surface | `127.0.0.1:8090` | yes, loopback only, always |
| Simulator control panel | `127.0.0.1:8091` | yes, loopback only, always |
| MQTT over WebSocket | `127.0.0.1:8083` and `:8084` | yes, loopback only, always |

Both local surfaces are unauthenticated and internal. Use `127.0.0.1` in the browser, never
`localhost`: `localhost` can resolve to `::1`, which a loopback-only publish does not serve.

## 3. Open the developer console

In a second terminal, with the repository's pinned Node first on `PATH` (the README's
prerequisites say how):

```sh
pnpm install
pnpm build
pnpm dev:admin:device
```

Open `http://127.0.0.1:5173`. The header reads **Stream: Live**. The left nav has the three pages
this guide uses: **Devices**, **Test matrix** and **Device control**.

Three dev-server modes exist, and each grants exactly one power:

| Command | What the console may do |
| --- | --- |
| `pnpm dev:admin` | read the live stream and the content reads. Nothing is written, nothing is sent. |
| `pnpm dev:admin:content` | the same, plus the content write routes. |
| `pnpm dev:admin:device` | the same reads, plus **sending commands to the device**. Use this one. |

**Two switches, both required.** Firing a command needs the console's device-control mode *and*
the gateway's own device-control argument. The local Compose stack passes that argument to the
gateway already, so `pnpm dev:admin:device` is the only switch you have to think about. With only
one of the two on, a send answers `device_control_disabled` or `proxy_disabled` and **nothing
reaches the robot** — that is the gate working, not a broken page.

Note, for the record: because the local Compose stack ships that argument on, anything that can
reach the gateway container's operator port on the Compose network can fire the five allow-listed
commands. The surface is published on host loopback only and the argument has effect in local mode
only, which is what bounds it.

## 4. Find your host's LAN IP

You need this only when the FLAG in §1 is resolved and real firmware can dial the host. The
robot cannot use `127.0.0.1` — that is its own loopback.

| OS | Command | What to look for |
| --- | --- | --- |
| Windows | `ipconfig` | the **IPv4 Address** of your active adapter (Wi-Fi or Ethernet) |
| macOS | `ipconfig getifaddr en0` | the address printed. Try `en1` if `en0` is empty |
| Linux | `hostname -I` or `ip -4 addr show` | the first address, or the `inet` line of your active interface |

Pick the address on the same subnet as the robot — typically `192.168.x.y` or `10.x.y.z`. If your
machine has a VPN or Docker bridge adapter, ignore those addresses.

## 5. Which endpoints the firmware points at

Four keys from the connection panel (`.env.example`) carry the firmware's endpoints and identity.
**No new key is needed for any of this**, and none of these is set by you in this repository:

| Key | What the firmware does with it | Local Compose default |
| --- | --- | --- |
| `MQTT_BROKER_URL` | the broker it connects to, scheme and port included | the `emqx` service on port 1883, plain `mqtt` scheme (local mode only) |
| `AUDIO_WSS_URL` | the per-turn audio WebSocket it dials | the `gateway` service on port 8081, plain `ws` scheme (local mode only) |
| `DEVICE_ID` | its own cloud-issued id, in the topic names and in `hello` | `xlu_000123` |
| `DEVICE_TOKEN` | the prototype token it puts in `hello`'s `auth`, and in the audio `Authorization` header | an obvious dev placeholder |

Production uses `mqtts` and `wss` with a per-device certificate and key in ESP32-S3 secure
storage. The prototype token is for this loopback-only stack and nothing else.

Two more keys exist only for the local surfaces, and the firmware never sees them:
`GATEWAY_OPERATOR_PORT` (the console's stream and routes, default 8090) and
`SIMULATOR_PANEL_PORT` (the simulator panel, default 8091).

Substitution, when the FLAG is resolved: replace the Compose service host in `MQTT_BROKER_URL` and
`AUDIO_WSS_URL` with the LAN IP from §4, keeping the same ports. Those service names resolve on
the Compose network only.

## 6. Pair the device, on the Devices tab

Pairing is **recognition, not a handshake**. There is no pairing message and no pairing code on the
wire. On every connection the device does three things, in this order (Document C 2.1):

1. connects to the broker, with its `device_id` as the MQTT client id;
2. subscribes to `xelulu/{device_id}/cmd` at QoS 1;
3. publishes one `hello` on `xelulu/{device_id}/status` at QoS 1.

The cloud compares the `device_id` and the `auth` token against what it was issued. That is the
whole pairing.

**Walk it:**

1. Open `http://127.0.0.1:5173/#/devices`. One row appears per registered device.
2. Read the **Pairing code** cell — six characters, for example `RZHGKR`.
3. Compare it with what the firmware prints on its serial console at boot. The code is **derived
   in the cloud** from the `device_id` and `fw_ver` that `hello` already carries, so the firmware
   need print nothing new: printing its own `device_id` and `fw_ver` is enough to compare by hand.
   Same pair, same code, always. New firmware version, new code.
4. The code is a **confirmation you read out loud**, never a credential. It hides nothing and
   grants nothing. Two devices with the same id and firmware version share a code, by design.
5. Read the **Session** cell and check it against the table below.

**Session states** (Document C 2.3). The cloud owns the session and derives it from messages it
already parses; the firmware reports none of it and receives none of it.

| State | Shown as | What it means | What moved it there |
| --- | --- | --- | --- |
| `unpaired` | Unpaired | the cloud has never authenticated this device since it started | nothing: this state absorbs everything but a `hello` |
| `connected` | Connected | paired. The `hello` matched | an accepted `hello` |
| `idle` | Idle | alive, and not in a turn | an accepted `status` heartbeat |
| `in_turn` | In turn | an audio turn is open | `audio_start` on the audio WebSocket |
| `error` | Error | the auth failed, a message was rejected, or the device reported an `error` event | any of those three |
| `offline` | Offline | 45 s passed with no heartbeat | the silence window expiring |

Two readings worth knowing:

- **Presence and session are different facts.** Presence is Document B's 45 s silence rule.
  A device whose presence reads Online while its session still reads Offline or Unpaired resumed
  its heartbeat **without republishing `hello`** — a Document C 2.3 conformance failure. The page
  shows it rather than hiding it. Fix the firmware's reconnect path.
- **An auth failure is a refused device, not a retry loop.** The cloud drops every later message
  from that device until a `hello` with a matching token arrives. Do not reconnect in a tight
  loop; fix the token.

## 7. Walk the test matrix

Open `http://127.0.0.1:5173/#/matrix`. The page builds its rows from Document B at load time —
one per command action, one per event kind, one per touch zone, plus two whole-feature rows. 28
rows today. Add an action to Document B and its row appears here with nobody editing the console.

The run lives in the page only: **reload and it starts again**. The totals line at the top counts
passed, failed, running and pending.

### 7.1 Before you start: set the active child

With no active child the gateway applies its most restrictive context, which has movement off, so
the `gesture` row refuses with `movement_off`. Set a mock child first, from a terminal:

```sh
docker compose exec gateway node dist/cli.js send xlu_000123 config '{"active_child_id":"child_mock_1"}'
```

That child's quiet hours are 22:00–07:00 in the gateway container's local time (UTC under
Compose). **Run the matrix during that child's waking window**, or all five allow-listed commands
refuse with `quiet_hours` — which is the gate working, exactly as designed, and not a failure of
your firmware.

### 7.2 Cloud to device — the console fires these (11 rows)

One row per Document B command action. Press **Run** and the console posts to the gateway's
device-control route, which puts the Phase 3 device-action gate between the button and the wire.

| Rows | Expected | Passes when |
| --- | --- | --- |
| `say`, `animate`, `gesture`, `led`, `play` | Ack done or accepted | the device acks. These are the five the gate allows |
| `move` | Refusal | the gate refuses it. **Movement is never sent from the console** — the body controller owns its own hard limits |
| `set_mode`, `volume`, `config`, `stop_audio`, `ota` | Refusal | the gate refuses them. They are operator and pipeline concerns, not console ones |

A refusal on the six is a **pass**: the row expects it. A refusal on the five is a fail, and the
Evidence cell names why — `quiet_hours`, `play_limit`, `movement_off` or `action_not_allowed`.

The data each command carries is a minimal bring-up probe built from the contract's own
vocabularies. The LED probe uses the solid effect, so nothing flashes (safety.md §6).

### 7.3 Device to cloud — you fire these at the device (17 rows)

These rows have **no run control, on purpose**. They originate at the device. The console watches
the operator stream and marks a row green when the matching message arrives; it cannot cause them
and must not try — the console sends no request to any origin but its own. There is no button to
press here and none is coming.

| Rows | Fire it during bring-up | Fire it on the real robot |
| --- | --- | --- |
| `touch`, and one row per touch zone: `head`, `left_ear`, `right_ear`, `belly`, `back`, `left_hand`, `right_hand` | the simulator panel's **Touch** zone buttons, one per zone | touch that zone on the robot |
| `wake` | panel → **Any event** → `wake` | say "Hey Lulu", or hold the belly |
| `cry` | panel → **Any event** → `cry` | a cry the on-device detector catches for more than 5 s |
| `motion` | panel → **Any event** → `motion` | pick the robot up, shake it, tilt it |
| `button` | panel → **Any event** → `button` | press the belly talk button |
| `nfc` | panel → **Any event** → `nfc` | tap a story card |
| `interrupt` | panel → **Any event** → `interrupt` | speak over the robot while it is replying |
| `error` | panel → **Any event** → `error` | whatever fault the firmware reports |
| `audio_turn` (one complete turn) | panel → **Audio turn** → pick an utterance → **Start audio turn** | hold the belly and speak one sentence |
| `safety_refusal` (the device's own refusal reaching the cloud) | panel → **Ack policy** → scope `all actions`, override `reject`, a reason such as `picked_up` → **Set override**, then Run any allow-listed row from §7.2. Clear the override afterwards | lift the robot, then Run `gesture`: the firmware must reject it |

The simulator panel is at `http://127.0.0.1:8091`. Every list on it comes from the contract, so you
cannot fire a value Document B does not have.

The **Any event** form fills omitted `data` fields with defaults, so the event kind alone is
usually enough. The whole matrix goes green from the panel in a few minutes.

### 7.4 What counts as evidence

Each row's Evidence cell holds ids, closed enums, counts and times — a `cmd_id`, a `turn_id`, an
ack outcome and reason, a stream sequence number, a timestamp. **Never any text from a turn.** The
console shows what happened without showing what anyone said.

## 8. The Device control tab

Open `http://127.0.0.1:5173/#/control`. Same five allow-listed commands as §7.2, fired by hand,
one row per attempt showing the `cmd_id` the route minted and then the ack's outcome and reason off
the stream. Pick the target device from the selector.

This is for bring-up and debugging: send a `led`, watch the ears; send a `gesture`, watch the
servo; lift the robot and send it again, and read the refusal the firmware gave.

There is no `move` control, and there will not be one. Movement is refused by the gate whoever
asks, so the page does not offer a button that cannot work.

**Every ack reason is final.** Nothing on this page retries, and nothing in the cloud retries
around a refusal. If the firmware answers `picked_up`, the cloud records `picked_up` and stops.

## 9. Firmware conformance checklist, from Documents B and C

Every message carries `proto_ver` 2. Topics are exactly four, all under `xelulu/{device_id}/`.
Pairing (Bluetooth and Wi-Fi provisioning) is Document C Part 1 and is not yet specified; nothing
below depends on it.

### 9.1 Messages the firmware must send

| Message | Topic | QoS | When | Fields |
| --- | --- | --- | --- | --- |
| `hello` | `status` | 1 | on every connection, after the `cmd` SUBACK and before anything else | `proto_ver`, `ts`, `type`, `device_id`, `fw_ver`, `auth`, `proto` |
| `status` | `status` | 0 or 1 | every 15 s, starting right after the `hello` | `proto_ver`, `ts`, `type`, `battery_pct`, `charging`, `mode`, `wifi_rssi`, `fault`, `active_child_id`, `temp_c` |
| `ack` | `ack` | 1 | once per command received, see §9.3 | `proto_ver`, `ts`, `type`, `cmd_id`, `status`, `reason` |

Events, all on the `event` topic at QoS 1, each with `proto_ver`, `ts`, `type`, `event_id`, `event`,
an optional `time_uncertain` boolean, and `data`:

| `event` | `data` |
| --- | --- |
| `touch` | `zone` (one of 7: `head`, `left_ear`, `right_ear`, `belly`, `back`, `left_hand`, `right_hand`), `gesture` (`tap`, `double_tap`, `hold`, `pat`) |
| `wake` | `source` (`hey_lulu`, `touch`), optional `dir_deg` (integer 0–359) |
| `cry` | `confidence` (0–1), `duration_s`. **Nothing else leaves the robot** |
| `motion` | `event` (`pickup`, `shake`, `upside_down`, `drop`, `tilt`), `value` |
| `button` | `button` (`belly_talk`), `action` (`press`, `release`) |
| `nfc` | `card_id` |
| `interrupt` | `{}` — empty. This is barge-in |
| `error` | `code`, `detail` |

`mode` on `status`, and `set_mode`, share one list: `idle`, `play`, `story`, `quiet`, `sleep`.

### 9.2 Messages the firmware must accept

Commands arrive on `cmd`, each with `proto_ver`, `cmd_id`, `action` and `data`. Commands carry no
`ts` and no `type`. Every command is idempotent: the same `cmd_id` twice means re-send the acks
already sent and apply nothing again.

| `action` | `data` |
| --- | --- |
| `say` | `expression`, `lang`, `voice` (`xelulu`, `grandma`), `duration_hint_ms`. **The audio itself comes down the WebSocket, never as a URL** |
| `animate` | `expression`, `eyes`, `loop` |
| `gesture` | `name` |
| `move` | `cmd` (`come`, `turn`, `stop`), `linear_mms`, `angular_mrad_s`, `max_dist_mm`. Speeds are required on `come` and `turn`, optional on `stop`. No upper bound on the wire: **firmware caps speed and torque** |
| `play` | `content_id`, `source` (`stream`, `cache`) |
| `set_mode` | `mode` |
| `led` | `target` (`ears`, `cheeks`, `belly`), `color` (hex), `effect` (`solid`, `pulse`, `rainbow`), `brightness` (0–100) |
| `volume` | `level` (0–100) |
| `config` | at least one of `volume`, `quiet_hours` (`start`, `end` as `HH:MM`), `movement_on`, `language`, `active_child_id` |
| `stop_audio` | `{}` — empty |
| `ota` | `manifest_url` (https). **There is no OTA topic**: `ota` is a command and is acked like any other |

Audio turn frames, on the per-turn WebSocket at `AUDIO_WSS_URL`:

1. Open the socket with `Authorization: Bearer <device token>`. Any path is accepted; a missing or
   unknown token gets `401` and the socket is closed. Plain HTTP on that port gets `426`.
2. Send a text frame `audio_start` carrying `proto_ver`, `ts`, `type` and `turn_id`.
3. Send binary Opus frames: 16 kHz mono, 20 ms. No compression extension, and no message over
   65,536 bytes.
4. Send a text frame `audio_end` with the same `turn_id`.
5. **Accept** the reply: binary Opus frames down the same socket, then a text `audio_end` carrying
   that same `turn_id`. There is no downstream `audio_start`.
6. Barge-in: the device sends an `interrupt` event; the cloud answers with `audio_end` for the
   current turn and then a `stop_audio` command. **There is no WebSocket cancel frame.**

### 9.3 Acks the firmware must return

Every command gets an `ack` on the `ack` topic at QoS 1, carrying the command's own `cmd_id`.

- `status` is one of `accepted`, `done`, `rejected`, `failed`.
- `reason` is either the empty string or one of eight values: `picked_up`, `at_edge`, `charging`,
  `quiet_hours`, `low_battery`, `unsafe`, `busy`, `unknown_action`.
- **A `rejected` ack must name a reason.** An empty reason on a `rejected` ack is a contract
  violation and the message is refused.
- An ack `reason` is the hardware's truth. The cloud records it and never retries around it.
- Timing: the cloud records `timed_out` with cause `no_ack` if no ack arrives within 10 s of
  publishing, and with cause `no_completion` if no terminal ack (`done`, `rejected`, `failed`)
  arrives within 60 s. `accepted` followed later by `done` is the normal shape for slow work.
- An unknown action gets `rejected` with reason `unknown_action`.
- A command refused by the device's own hard safety limits gets `rejected` with the reason that
  says why: `picked_up`, `at_edge`, `charging`, `quiet_hours`, `low_battery` or `unsafe`.

### 9.4 Envelope and connection rules

- `proto_ver` is on **every** message, upstream and downstream, and is `2`.
- `ts` is unix **seconds**, on every upstream message, along with `type`.
- Every event carries a unique `event_id`. The cloud dedupes by it, including back-dated events
  that arrive after the robot was offline — set `time_uncertain` true on those.
- Every command carries a `cmd_id`, and every ack echoes it. Commands are idempotent.
- QoS: commands 1, acks 1, events 1, telemetry 0 or 1.
- The MQTT client id is the `device_id`. MQTT 5, clean start, TLS in anything but the local stack.
- Heartbeat every **15 s**. A device is offline after **45 s** of silence.
- There is **no goodbye message**. A disconnect is observed as silence; nothing is sent for it.
- Reconnect order, every time: subscribe to `cmd`, publish `hello`, resume the heartbeat. Skipping
  the `hello` leaves the session Offline while status messages arrive — visible on the Devices tab.
- On a `proto_ver` mismatch the device keeps its last-known-good state, reports the mismatch, and
  **does not act on the message**.
- Subscribe to the `cmd` topic and nothing else. Publish only on `status`, `event` and `ack`.
- No message invents a field, renames an enum value or "improves" the format. A change to any of
  that is a `proto_ver` bump with sign-off from both the software and hardware sides.

### 9.5 Two facts about this phase

- **No raw child audio is stored anywhere.** Frames stream through the gateway in memory to
  speech-to-text and are discarded. Nothing writes them to disk, storage, a log line, analytics or
  a crash report. Cry detection runs on the device, and only `confidence` and `duration_s` leave
  the robot. Log entries carry ids, closed enums, counts and times only.
- **The voice brain runs on mock providers.** No real speech-to-text, language model or
  text-to-speech is wired in this phase. A turn you drive from the simulator or the robot goes
  through the real safety layer and the real tool router, with mocked vendors behind them. That is
  deliberate: safety.md §9 lists what must close before any real provider is connected.

## 10. Known limits of the console

None of these affects the gate, the contract or your firmware. They are page-level facts worth
knowing before you read a cell as gospel:

- **A reload is a fresh run.** The matrix and the control page hold their results in page memory.
  Nothing is persisted, by design: a checklist that remembers a pass from yesterday is a lie.
- **The Ack cell on the Device control page is re-derived from the live window**, which holds the
  most recent 500 stream entries and empties on a reconnect. A row that showed `done` can fall
  back to "Waiting for ack" after a long session or a reconnect. The matrix does not do this — it
  latches each row once.
- **The Action column on the Device control page is the action you requested**, not the action the
  ack named. A device acking a different action than it was sent would not stand out there; the
  Devices tab's Last ack cell shows the acked action.
- **The matrix sends to the first device on the stream.** With one robot on the bench that is the
  robot. The Device control page has an explicit selector; use it when two devices are connected.
- **Two page-memory lists grow while a page stays open** (the matrix's seen-entry set, the control
  page's attempt list). Reload if a long bring-up session feels heavy.

## 11. When something does not match

If your firmware and this guide disagree, Document B wins, then Document C, then this guide. If
Document B itself looks wrong, stop and raise it: a contract change is a `proto_ver` bump with
sign-off from both sides, never a quiet fix on either side of the wire.

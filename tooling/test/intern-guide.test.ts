// The Intern_Guide is drawn from the contract, not written from memory (Phase 6 Req 6.1–6.6).
//
// Requirement 6.6 says the guide names every message the firmware must send, every message it
// must accept and every ack it must return. A prose document cannot be type-checked, so this is
// the static half: every member of every CLOSED Document B list, and every Document C session
// state, must appear somewhere in the guide. A list that gains a member fails this check until
// the guide covers it, which is the same drift rule the Test_Matrix is held to.
//
// Nothing about the contract is restated here. The list NAMES are named (a name is not a wire
// value), and the members come from the built Shared_Package, exactly as `matrix-derivation.
// test.ts` and `contract-use.test.ts` do. Every list is asserted to be a real, non-empty list
// before its members are looked for, so the coverage check can never pass vacuously.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import * as shared from "../../packages/shared/dist/index.js";
import { parsePanel } from "../checks/panel.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const GUIDE_PATH = "docs/intern-integration-guide.md";

function read(repoPath: string): string {
  return readFileSync(join(ROOT, repoPath), "utf8").replace(/\r\n/g, "\n");
}

const guide = read(GUIDE_PATH);
const guideLower = guide.toLowerCase();

/**
 * The closed Document B lists the firmware is held to, by their Shared_Package export name, plus
 * the Document C session states. Open vocabularies (`KNOWN_*`) are deliberately absent: Document B
 * accepts any non-empty string there, so naming every known value is not a conformance duty.
 */
const COVERED_LISTS = [
  "CMD_ACTIONS",
  "EVENT_KINDS",
  "TOUCH_ZONES",
  "TOUCH_GESTURES",
  "WAKE_SOURCES",
  "MOTION_KINDS",
  "BUTTONS",
  "BUTTON_ACTIONS",
  "MODES",
  "MOVE_COMMANDS",
  "PLAY_SOURCES",
  "LED_TARGETS",
  "LED_EFFECTS",
  "SAY_VOICES",
  "ACK_STATUSES",
  "ACK_REASONS",
  "DEVICE_SESSION_STATES",
] as const;

/**
 * Whether the guide names `member` in its own right, rather than only inside a longer wire value
 * or an English word. `tap` inside `double_tap`, `turn` inside `audio_turn`, `stop` inside
 * `stop_audio` and `play` inside `play_limit` all have to fail this, or a member the guide never
 * covers could pass on another member's prose.
 */
function namesMember(member: string): boolean {
  const escaped = member.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`).test(guide);
}

/** The members of one exported list, or null when the export is not a list of strings. */
function listMembers(name: string): readonly string[] | null {
  const value: unknown = (shared as Record<string, unknown>)[name];
  if (!Array.isArray(value) || value.length === 0) return null;
  return value.every((member) => typeof member === "string") ? (value as readonly string[]) : null;
}

/** The Panel_Keys, from the approved fixture, never a hard-coded list. */
function panelKeys(): ReadonlySet<string> {
  const text = readFileSync(join(ROOT, "tooling", "fixtures", "approved-panel.txt"), "utf8");
  return new Set(parsePanel(text).flatMap((line) => (line.kind === "decl" ? [line.key] : [])));
}

describe("the Intern_Guide covers the contract (Req 6.6)", () => {
  it("exists, and names the three documents it is drawn from", () => {
    expect(guide.length).toBeGreaterThan(2000);
    expect(guide).toContain("B-gateway-and-hardware-seam.docx");
    expect(guide).toContain("C-pairing-and-device-session.md");
    // The frozen contract version, so the guide cannot quietly describe another protocol.
    expect(guide).toContain("`proto_ver` 2");
  });

  it.each(COVERED_LISTS)("names every member of %s", (name) => {
    const members = listMembers(name);
    // Non-vacuity: the export really is a non-empty list of strings in the built package.
    expect(members, `${name} must be a non-empty string list in @xelulu/shared`).not.toBeNull();
    // Non-vacuity per member: an empty member would be found in any text at all.
    const empty = (members ?? []).filter((member) => member.length === 0);
    expect(empty, `${name} must hold no empty member`).toEqual([]);
    const missing = (members ?? []).filter((member) => !namesMember(member));
    expect(missing, `${GUIDE_PATH} does not name ${name} members: ${missing.join(", ")}`).toEqual(
      [],
    );
  });

  it("names the four upstream and downstream message types by name", () => {
    for (const type of ["hello", "status", "ack", "audio_start", "audio_end"]) {
      expect(guide, `${GUIDE_PATH} must name the ${type} message`).toContain(`\`${type}\``);
    }
  });

  it("names the four topics, each built on the device id", () => {
    expect(guide).toContain("xelulu/{device_id}/");
    for (const topic of ["cmd", "event", "ack", "status"]) {
      expect(guide).toContain(`\`${topic}\``);
    }
  });

  it("gives the envelope and connection rules with their numbers", () => {
    for (const field of ["proto_ver", "ts", "cmd_id", "event_id", "time_uncertain"]) {
      expect(guide, `${GUIDE_PATH} must name ${field}`).toContain(`\`${field}\``);
    }
    expect(guideLower).toContain("qos");
    // The 15 s Heartbeat and the 45 s Silence_Window, in words.
    expect(guide).toMatch(/15 s/);
    expect(guide).toMatch(/45 s/);
    expect(guideLower).toContain("mismatch");
  });
});

describe("the Intern_Guide's endpoints and flags (Req 6.2, 6.3)", () => {
  it("names exactly the four firmware Panel_Keys, and each is a real Panel_Key", () => {
    const keys = panelKeys();
    for (const key of ["MQTT_BROKER_URL", "AUDIO_WSS_URL", "DEVICE_ID", "DEVICE_TOKEN"]) {
      expect(keys.has(key), `${key} must be a Panel_Key`).toBe(true);
      expect(guide, `${GUIDE_PATH} must name ${key}`).toContain(key);
    }
  });

  it("says no new key is needed and that Compose works with no .env", () => {
    expect(guideLower).toContain("no new key is needed");
    expect(guideLower).toContain("no `.env` is needed");
    expect(guide).toContain("docker compose up");
  });

  it("gives a host LAN IP command for Windows, macOS and Linux", () => {
    for (const command of ["ipconfig", "ipconfig getifaddr", "hostname -I"]) {
      expect(guide, `${GUIDE_PATH} must give \`${command}\``).toContain(command);
    }
    for (const os of ["Windows", "macOS", "Linux"]) {
      expect(guide, `${GUIDE_PATH} must name ${os}`).toContain(os);
    }
  });

  // The LAN bring-up wave closed FLAG C17, so the guide no longer defers the question: it has to
  // name the one value that opens the device ports, say that opening them opens nothing human,
  // and say that an unauthenticated device is still refused.
  it("tells the reader how to open the LAN bind and what it does not open", () => {
    expect(guide).toContain("DEVICE_BIND_HOST");
    expect(guideLower).toContain("loopback");
    expect(guideLower).toContain("simulator");
    // The console, panel and dashboard stay shut whatever the bind says.
    expect(guideLower).toContain("loopback only, always");
    // And the bind is not the door: a token is.
    expect(guide).toContain("DEVICE_TOKEN");
    expect(guideLower).toContain("anonymous broker access is off");
    expect(guideLower).toContain("refused");
    // Actuation is opt-in, not implied by pairing.
    expect(guide).toContain("--device-control");
    // The stale blocker wording must be gone, not merely supplemented.
    expect(guide).not.toContain("C17");
    expect(guideLower).not.toContain("cannot reach the local gateway");
  });
});

describe("the Intern_Guide's safety statements (Req 6.5, 6.6)", () => {
  it("says the observed matrix rows cannot be driven from the console", () => {
    expect(guideLower).toContain("originate at the device");
    expect(guideLower).toContain("no run control");
  });

  it("says no raw child audio is stored and the brain runs on mock providers", () => {
    expect(guideLower).toContain("no raw child audio is stored");
    expect(guideLower).toContain("mock providers");
  });

  it("says movement is never sent from the console and an ack reason is final", () => {
    expect(guideLower).toContain("movement is never sent from the console");
    expect(guideLower).toContain("final");
  });
});

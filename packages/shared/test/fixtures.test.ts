// Golden fixture checks (Requirements 11.4, 13.1–13.8; design "Golden fixtures").
// Fixtures are test data in src/gateway-contract/fixtures/, never compiled or exported, so they
// are read from disk here. Runtime contract code comes from the built entry (design D5).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  parseAckMessage,
  parseAnimateCmdMessage,
  parseAudioControlMessage,
  parseAudioEndMessage,
  parseAudioStartMessage,
  parseButtonEventMessage,
  parseCmdMessage,
  parseConfigCmdMessage,
  parseCryEventMessage,
  parseDeviceMessage,
  parseErrorEventMessage,
  parseEventMessage,
  parseGestureCmdMessage,
  parseHelloMessage,
  parseInterruptEventMessage,
  parseLedCmdMessage,
  parseMotionEventMessage,
  parseMoveCmdMessage,
  parseNfcEventMessage,
  parseOtaCmdMessage,
  parsePlayCmdMessage,
  parseSayCmdMessage,
  parseSetModeCmdMessage,
  parseStatusMessage,
  parseStatusTopicMessage,
  parseStopAudioCmdMessage,
  parseTouchEventMessage,
  parseVolumeCmdMessage,
  parseWakeEventMessage,
  serialiseAckMessage,
  serialiseAnimateCmdMessage,
  serialiseAudioEndMessage,
  serialiseAudioStartMessage,
  serialiseButtonEventMessage,
  serialiseConfigCmdMessage,
  serialiseCryEventMessage,
  serialiseErrorEventMessage,
  serialiseGestureCmdMessage,
  serialiseHelloMessage,
  serialiseInterruptEventMessage,
  serialiseLedCmdMessage,
  serialiseMotionEventMessage,
  serialiseMoveCmdMessage,
  serialiseNfcEventMessage,
  serialiseOtaCmdMessage,
  serialisePlayCmdMessage,
  serialiseSayCmdMessage,
  serialiseSetModeCmdMessage,
  serialiseStatusMessage,
  serialiseStopAudioCmdMessage,
  serialiseTouchEventMessage,
  serialiseVolumeCmdMessage,
  serialiseWakeEventMessage,
} from "../dist/index.js";
import type {
  AckMessage,
  AnimateCmdMessage,
  AudioEndMessage,
  AudioStartMessage,
  ButtonEventMessage,
  ConfigCmdMessage,
  CryEventMessage,
  ErrorEventMessage,
  GestureCmdMessage,
  HelloMessage,
  InterruptEventMessage,
  LedCmdMessage,
  MotionEventMessage,
  MoveCmdMessage,
  NfcEventMessage,
  OtaCmdMessage,
  ParseResult,
  PlayCmdMessage,
  SayCmdMessage,
  SetModeCmdMessage,
  StatusMessage,
  StopAudioCmdMessage,
  TopicSuffix,
  TouchEventMessage,
  VolumeCmdMessage,
  WakeEventMessage,
} from "../dist/index.js";

const FIXTURE_DIR = fileURLToPath(new URL("../src/gateway-contract/fixtures/", import.meta.url));
const MANIFEST_FILE = "manifest.json";
const KEBAB_JSON = /^[a-z0-9]+(?:-[a-z0-9]+)*\.json$/;

type JsonObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readText(file: string): string {
  return readFileSync(`${FIXTURE_DIR}${file}`, "utf8");
}

// Every directory entry, so that a non-JSON or badly named file fails the naming check.
const DIR_ENTRIES = readdirSync(FIXTURE_DIR).sort();
const FIXTURE_FILES = DIR_ENTRIES.filter((name) => name !== MANIFEST_FILE);

// ---------------------------------------------------------------------------------------------
// Variant table. A variant is identified by its Discriminator values: `type` for hello, status,
// ack and the audio markers; `event:<kind>` for events; `cmd:<action>` for commands.

type VariantCodec = {
  parse: (text: string) => ParseResult<unknown>;
  serialise: (message: unknown) => string;
  union: (text: string) => ParseResult<unknown>;
  topic: TopicSuffix | null; // device topic for parseDeviceMessage; null for commands and audio
};

const VARIANTS: Record<string, VariantCodec> = {
  hello: {
    parse: parseHelloMessage,
    serialise: (m) => serialiseHelloMessage(m as HelloMessage),
    union: parseStatusTopicMessage,
    topic: "status",
  },
  status: {
    parse: parseStatusMessage,
    serialise: (m) => serialiseStatusMessage(m as StatusMessage),
    union: parseStatusTopicMessage,
    topic: "status",
  },
  "event:touch": {
    parse: parseTouchEventMessage,
    serialise: (m) => serialiseTouchEventMessage(m as TouchEventMessage),
    union: parseEventMessage,
    topic: "event",
  },
  "event:wake": {
    parse: parseWakeEventMessage,
    serialise: (m) => serialiseWakeEventMessage(m as WakeEventMessage),
    union: parseEventMessage,
    topic: "event",
  },
  "event:cry": {
    parse: parseCryEventMessage,
    serialise: (m) => serialiseCryEventMessage(m as CryEventMessage),
    union: parseEventMessage,
    topic: "event",
  },
  "event:motion": {
    parse: parseMotionEventMessage,
    serialise: (m) => serialiseMotionEventMessage(m as MotionEventMessage),
    union: parseEventMessage,
    topic: "event",
  },
  "event:button": {
    parse: parseButtonEventMessage,
    serialise: (m) => serialiseButtonEventMessage(m as ButtonEventMessage),
    union: parseEventMessage,
    topic: "event",
  },
  "event:nfc": {
    parse: parseNfcEventMessage,
    serialise: (m) => serialiseNfcEventMessage(m as NfcEventMessage),
    union: parseEventMessage,
    topic: "event",
  },
  "event:interrupt": {
    parse: parseInterruptEventMessage,
    serialise: (m) => serialiseInterruptEventMessage(m as InterruptEventMessage),
    union: parseEventMessage,
    topic: "event",
  },
  "event:error": {
    parse: parseErrorEventMessage,
    serialise: (m) => serialiseErrorEventMessage(m as ErrorEventMessage),
    union: parseEventMessage,
    topic: "event",
  },
  audio_start: {
    parse: parseAudioStartMessage,
    serialise: (m) => serialiseAudioStartMessage(m as AudioStartMessage),
    union: parseAudioControlMessage,
    topic: null,
  },
  audio_end: {
    parse: parseAudioEndMessage,
    serialise: (m) => serialiseAudioEndMessage(m as AudioEndMessage),
    union: parseAudioControlMessage,
    topic: null,
  },
  ack: {
    parse: parseAckMessage,
    serialise: (m) => serialiseAckMessage(m as AckMessage),
    // The ack variant parser is also the ack topic parser (design, codec.ts).
    union: parseAckMessage,
    topic: "ack",
  },
  "cmd:say": {
    parse: parseSayCmdMessage,
    serialise: (m) => serialiseSayCmdMessage(m as SayCmdMessage),
    union: parseCmdMessage,
    topic: null,
  },
  "cmd:animate": {
    parse: parseAnimateCmdMessage,
    serialise: (m) => serialiseAnimateCmdMessage(m as AnimateCmdMessage),
    union: parseCmdMessage,
    topic: null,
  },
  "cmd:gesture": {
    parse: parseGestureCmdMessage,
    serialise: (m) => serialiseGestureCmdMessage(m as GestureCmdMessage),
    union: parseCmdMessage,
    topic: null,
  },
  "cmd:move": {
    parse: parseMoveCmdMessage,
    serialise: (m) => serialiseMoveCmdMessage(m as MoveCmdMessage),
    union: parseCmdMessage,
    topic: null,
  },
  "cmd:play": {
    parse: parsePlayCmdMessage,
    serialise: (m) => serialisePlayCmdMessage(m as PlayCmdMessage),
    union: parseCmdMessage,
    topic: null,
  },
  "cmd:set_mode": {
    parse: parseSetModeCmdMessage,
    serialise: (m) => serialiseSetModeCmdMessage(m as SetModeCmdMessage),
    union: parseCmdMessage,
    topic: null,
  },
  "cmd:led": {
    parse: parseLedCmdMessage,
    serialise: (m) => serialiseLedCmdMessage(m as LedCmdMessage),
    union: parseCmdMessage,
    topic: null,
  },
  "cmd:volume": {
    parse: parseVolumeCmdMessage,
    serialise: (m) => serialiseVolumeCmdMessage(m as VolumeCmdMessage),
    union: parseCmdMessage,
    topic: null,
  },
  "cmd:config": {
    parse: parseConfigCmdMessage,
    serialise: (m) => serialiseConfigCmdMessage(m as ConfigCmdMessage),
    union: parseCmdMessage,
    topic: null,
  },
  "cmd:stop_audio": {
    parse: parseStopAudioCmdMessage,
    serialise: (m) => serialiseStopAudioCmdMessage(m as StopAudioCmdMessage),
    union: parseCmdMessage,
    topic: null,
  },
  "cmd:ota": {
    parse: parseOtaCmdMessage,
    serialise: (m) => serialiseOtaCmdMessage(m as OtaCmdMessage),
    union: parseCmdMessage,
    topic: null,
  },
};

/** The 24 Message_Variants, written out independently of the table above. */
const EXPECTED_VARIANT_KEYS = [
  "hello",
  "status",
  "event:touch",
  "event:wake",
  "event:cry",
  "event:motion",
  "event:button",
  "event:nfc",
  "event:interrupt",
  "event:error",
  "audio_start",
  "audio_end",
  "ack",
  "cmd:say",
  "cmd:animate",
  "cmd:gesture",
  "cmd:move",
  "cmd:play",
  "cmd:set_mode",
  "cmd:led",
  "cmd:volume",
  "cmd:config",
  "cmd:stop_audio",
  "cmd:ota",
];

/** Variant key from a message's Discriminator values, or undefined if it names none. */
function variantKeyOf(message: JsonObject): string | undefined {
  const { type, event, action } = message;
  if (type === "event") return typeof event === "string" ? `event:${event}` : undefined;
  if (typeof type === "string") return type;
  if (typeof action === "string") return `cmd:${action}`;
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Expected Document B v2 examples (design "Derived" table). Five verbatim; hello and ack add
// only `ts` after `proto_ver` (ruling 1).

const DERIVED: Record<string, { source: string; note: string; expected: JsonObject }> = {
  "hello.json": {
    source: "Document B v2 §3.1",
    note: "v2 example + ts added per envelope rule (ruling 1)",
    expected: {
      proto_ver: 2,
      ts: 1733400000,
      type: "hello",
      device_id: "xlu_000123",
      fw_ver: "0.1.0",
      auth: "<device token>",
      proto: 2,
    },
  },
  "status.json": {
    source: "Document B v2 §3.2",
    note: "copied verbatim from Document B v2 §3.2",
    expected: {
      proto_ver: 2,
      ts: 1733400000,
      type: "status",
      battery_pct: 72,
      charging: false,
      mode: "idle",
      wifi_rssi: -58,
      fault: [],
      active_child_id: "c_01",
      temp_c: 31,
    },
  },
  "event-touch.json": {
    source: "Document B v2 §3.3",
    note: "copied verbatim from Document B v2 §3.3",
    expected: {
      proto_ver: 2,
      ts: 1733400001,
      type: "event",
      event_id: "ev_7f3a",
      event: "touch",
      time_uncertain: false,
      data: { zone: "belly", gesture: "double_tap" },
    },
  },
  "audio-start.json": {
    source: "Document B v2 §3.4",
    note: "copied verbatim from Document B v2 §3.4",
    expected: { proto_ver: 2, ts: 1733400001, type: "audio_start", turn_id: "t_9f" },
  },
  "audio-end.json": {
    source: "Document B v2 §3.4",
    note: "copied verbatim from Document B v2 §3.4",
    expected: { proto_ver: 2, ts: 1733400004, type: "audio_end", turn_id: "t_9f" },
  },
  "cmd-say.json": {
    source: "Document B v2 §4.1",
    note: "copied verbatim from Document B v2 §4.1",
    expected: {
      proto_ver: 2,
      cmd_id: "9f2c",
      action: "say",
      data: { expression: "happy", lang: "en-IN", voice: "xelulu", duration_hint_ms: 2200 },
    },
  },
  "ack.json": {
    source: "Document B v2 §5",
    note: "v2 example + ts added per envelope rule (ruling 1)",
    expected: {
      proto_ver: 2,
      ts: 1733400005,
      cmd_id: "9f2c",
      type: "ack",
      status: "done",
      reason: "",
    },
  },
};

const CONSTRUCTED_NOTE = "constructed from Document B field tables; not verbatim";
const OTA_SOURCE = "Document B v2 §4.2 (shape; placeholder host replaced)";

// ---------------------------------------------------------------------------------------------
// Manifest.

type ManifestEntry = { file: string; source: string; provenance: string; note: string };

function readManifest(): ManifestEntry[] {
  const raw: unknown = JSON.parse(readText(MANIFEST_FILE));
  expect(isPlainObject(raw), "manifest is a JSON object").toBe(true);
  const { fixtures } = raw as JsonObject;
  expect(Array.isArray(fixtures), "manifest.fixtures is an array").toBe(true);
  const entries = fixtures as unknown[];
  for (const entry of entries) {
    expect(isPlainObject(entry), "manifest entry is an object").toBe(true);
    const e = entry as JsonObject;
    expect(Object.keys(e).sort()).toEqual(["file", "note", "provenance", "source"]);
    for (const key of ["file", "source", "provenance", "note"]) {
      expect(typeof e[key], `manifest entry ${key} is a string`).toBe("string");
    }
  }
  return entries as ManifestEntry[];
}

const MANIFEST = readManifest();

function manifestEntry(file: string): ManifestEntry {
  const entry = MANIFEST.find((e) => e.file === file);
  if (entry === undefined) throw new Error(`manifest has no entry for ${file}`);
  return entry;
}

// ---------------------------------------------------------------------------------------------

describe("golden fixture files (Req 13.7)", () => {
  it("the fixture folder holds the manifest and at least one fixture", () => {
    expect(DIR_ENTRIES).toContain(MANIFEST_FILE);
    expect(FIXTURE_FILES.length).toBeGreaterThan(0);
  });

  it.each(DIR_ENTRIES)("%s is a kebab-case .json file", (name) => {
    expect(name).toMatch(KEBAB_JSON);
    expect(statSync(`${FIXTURE_DIR}${name}`).isFile()).toBe(true);
  });

  it.each(FIXTURE_FILES)("%s holds exactly one top-level JSON object", (file) => {
    const value: unknown = JSON.parse(readText(file));
    expect(isPlainObject(value)).toBe(true);
  });
});

describe("fixture manifest (Req 13.5, 13.6)", () => {
  it("lists every fixture file exactly once and no missing or extra file", () => {
    const listed = MANIFEST.map((e) => e.file);
    expect(new Set(listed).size, "no duplicate entries").toBe(listed.length);
    expect(listed).not.toContain(MANIFEST_FILE);
    expect([...listed].sort()).toEqual(FIXTURE_FILES);
  });

  it("records the seven Document B v2 examples as derived, with their exact source and note", () => {
    for (const [file, { source, note }] of Object.entries(DERIVED)) {
      expect(FIXTURE_FILES, `${file} exists`).toContain(file);
      const entry = manifestEntry(file);
      expect(entry.provenance, `${file} provenance`).toBe("derived");
      expect(entry.source, `${file} source`).toBe(source);
      expect(entry.note, `${file} note`).toBe(note);
    }
  });

  it("records every other fixture as constructed from a Document B v2 section", () => {
    for (const entry of MANIFEST.filter((e) => !(e.file in DERIVED))) {
      expect(entry.provenance, `${entry.file} provenance`).toBe("constructed");
      expect(entry.note, `${entry.file} note`).toBe(CONSTRUCTED_NOTE);
      expect(entry.source.startsWith("Document B v2 §"), `${entry.file} source`).toBe(true);
    }
  });

  it("records the ota fixture's source as the §4.2 shape with the placeholder host replaced", () => {
    expect(manifestEntry("cmd-ota.json").source).toBe(OTA_SOURCE);
  });
});

describe("variant coverage (Req 13.4, 13.6)", () => {
  it("every fixture names a known Message_Variant by its Discriminator values", () => {
    for (const file of FIXTURE_FILES) {
      const key = variantKeyOf(JSON.parse(readText(file)) as JsonObject);
      expect(EXPECTED_VARIANT_KEYS, `${file} variant`).toContain(key);
    }
  });

  it("every Message_Variant has at least one golden fixture", () => {
    const covered = new Set(
      FIXTURE_FILES.map((file) => variantKeyOf(JSON.parse(readText(file)) as JsonObject)),
    );
    expect(Object.keys(VARIANTS).sort()).toEqual([...EXPECTED_VARIANT_KEYS].sort());
    for (const key of EXPECTED_VARIANT_KEYS) {
      expect(covered.has(key), `fixture for ${key}`).toBe(true);
    }
  });

  it("the ota fixture follows the §4.2 shape with a localhost manifest_url", () => {
    expect(JSON.parse(readText("cmd-ota.json"))).toStrictEqual({
      proto_ver: 2,
      cmd_id: "a1b2",
      action: "ota",
      data: { manifest_url: "https://localhost/ota/manifest.json" },
    });
  });
});

describe("derived fixtures match the Document B v2 examples (Req 13.1–13.3)", () => {
  it.each(Object.keys(DERIVED))("%s equals its example, keys in example order", (file) => {
    const { expected } = DERIVED[file]!;
    const actual = JSON.parse(readText(file)) as JsonObject;
    expect(actual).toStrictEqual(expected);
    // Verbatim copy keeps the example's key order; hello and ack carry `ts` right after proto_ver.
    expect(Object.keys(actual)).toEqual(Object.keys(expected));
    if (isPlainObject(expected["data"])) {
      expect(Object.keys(actual["data"] as JsonObject)).toEqual(Object.keys(expected["data"]));
    }
  });
});

describe("fixtures hold no secrets and only localhost URLs (Req 13.8)", () => {
  it.each(FIXTURE_FILES)("%s uses localhost for every URL", (file) => {
    const urls = readText(file).match(/[a-z][a-z0-9+.-]*:\/\/[^\s"]*/gi) ?? [];
    for (const url of urls) {
      expect(URL.parse(url)?.hostname, "URL host").toBe("localhost");
    }
  });

  it("the hello fixture's auth is Document B's literal placeholder, not a token", () => {
    expect((JSON.parse(readText("hello.json")) as JsonObject)["auth"]).toBe("<device token>");
  });
});

describe("fixtures parse and round-trip (Req 11.4)", () => {
  it.each(FIXTURE_FILES)(
    "%s parses with its variant and union parsers and survives serialise → parse",
    (file) => {
      const text = readText(file);
      const json = JSON.parse(text) as JsonObject;
      const key = variantKeyOf(json);
      const codec = key === undefined ? undefined : VARIANTS[key];
      if (codec === undefined) throw new Error(`${file} names no known variant`);

      const first = codec.parse(text);
      expect(first.ok, `${file} variant parse`).toBe(true);
      if (!first.ok) return;
      expect(first.value).toStrictEqual(json);

      const viaUnion = codec.union(text);
      expect(viaUnion.ok, `${file} union parse`).toBe(true);
      if (viaUnion.ok) expect(viaUnion.value).toStrictEqual(json);

      if (codec.topic !== null) {
        const viaDevice = parseDeviceMessage(codec.topic, text);
        expect(viaDevice.ok, `${file} parseDeviceMessage("${codec.topic}")`).toBe(true);
        if (viaDevice.ok) expect(viaDevice.value).toStrictEqual(json);
      }

      const again = codec.parse(codec.serialise(first.value));
      expect(again.ok, `${file} serialise → parse`).toBe(true);
      if (!again.ok) return;
      expect(again.value).toStrictEqual(first.value);
      expect(again.value).toStrictEqual(json);
    },
  );
});

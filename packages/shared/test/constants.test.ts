// Contract constants, closed lists and open vocabularies.
// Requirements 1.1, 1.2, 1.8, 7.6, 9.1, 9.2, 9.3 and 9.4.
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  ACK_REASONS,
  ACK_STATUSES,
  AUDIO_FORMAT,
  BUTTONS,
  BUTTON_ACTIONS,
  CMD_ACTIONS,
  EVENT_KINDS,
  KNOWN_EXPRESSIONS,
  KNOWN_EYES,
  KNOWN_GESTURE_NAMES,
  LED_EFFECTS,
  LED_TARGETS,
  MODES,
  MOTION_KINDS,
  MOVE_COMMANDS,
  PLAY_SOURCES,
  PROTO_VER,
  SAY_VOICES,
  TOPIC_PREFIX,
  TOPIC_SUFFIXES,
  TOUCH_GESTURES,
  TOUCH_ZONES,
  WAKE_SOURCES,
} from "../dist/index.js";

// Expected values, written out from Document B v2 and requirements.md (not from src).
const EXPECTED_LISTS: readonly (readonly [string, readonly string[], readonly string[]])[] = [
  [
    "TOUCH_ZONES",
    TOUCH_ZONES,
    ["head", "left_ear", "right_ear", "belly", "back", "left_hand", "right_hand"],
  ],
  ["TOUCH_GESTURES", TOUCH_GESTURES, ["tap", "double_tap", "hold", "pat"]],
  ["WAKE_SOURCES", WAKE_SOURCES, ["hey_lulu", "touch"]],
  ["MOTION_KINDS", MOTION_KINDS, ["pickup", "shake", "upside_down", "drop", "tilt"]],
  ["BUTTONS", BUTTONS, ["belly_talk"]],
  ["BUTTON_ACTIONS", BUTTON_ACTIONS, ["press", "release"]],
  ["MODES", MODES, ["idle", "play", "story", "quiet", "sleep"]],
  ["MOVE_COMMANDS", MOVE_COMMANDS, ["come", "stop", "turn"]],
  ["PLAY_SOURCES", PLAY_SOURCES, ["stream", "cache"]],
  ["LED_TARGETS", LED_TARGETS, ["ears", "cheeks", "belly"]],
  ["LED_EFFECTS", LED_EFFECTS, ["solid", "pulse", "rainbow"]],
  ["SAY_VOICES", SAY_VOICES, ["xelulu", "grandma"]],
  ["ACK_STATUSES", ACK_STATUSES, ["accepted", "done", "rejected", "failed"]],
  [
    "ACK_REASONS",
    ACK_REASONS,
    [
      "picked_up",
      "at_edge",
      "charging",
      "quiet_hours",
      "low_battery",
      "unsafe",
      "busy",
      "unknown_action",
    ],
  ],
  [
    "EVENT_KINDS",
    EVENT_KINDS,
    ["touch", "wake", "cry", "motion", "button", "nfc", "interrupt", "error"],
  ],
  [
    "CMD_ACTIONS",
    CMD_ACTIONS,
    [
      "say",
      "animate",
      "gesture",
      "move",
      "play",
      "set_mode",
      "led",
      "volume",
      "config",
      "stop_audio",
      "ota",
    ],
  ],
  [
    "KNOWN_EXPRESSIONS",
    KNOWN_EXPRESSIONS,
    ["happy", "love", "sleepy", "curious", "sad", "listening"],
  ],
  ["KNOWN_EYES", KNOWN_EYES, ["blink", "hearts"]],
  [
    "KNOWN_GESTURE_NAMES",
    KNOWN_GESTURE_NAMES,
    ["wave", "high_five", "hug", "clap", "point_left", "nod", "shake"],
  ],
  ["TOPIC_SUFFIXES", TOPIC_SUFFIXES, ["status", "event", "cmd", "ack"]],
];

describe("protocol constants (Req 1.1, 1.2, 1.8)", () => {
  it("PROTO_VER is the number 2", () => {
    expect(PROTO_VER).toBe(2);
    expect(typeof PROTO_VER).toBe("number");
    expectTypeOf(PROTO_VER).toEqualTypeOf<2>();
  });

  it("the topic prefix is xelulu and there are exactly four suffixes, none of them ota", () => {
    expect(TOPIC_PREFIX).toBe("xelulu");
    expect([...TOPIC_SUFFIXES]).toEqual(["status", "event", "cmd", "ack"]);
    expect(TOPIC_SUFFIXES).not.toContain("ota");
  });

  it("AUDIO_FORMAT is opus, 16 kHz, mono, 20 ms frames, and frozen", () => {
    expect({ ...AUDIO_FORMAT }).toEqual({
      codec: "opus",
      sample_rate_hz: 16000,
      channels: 1,
      frame_duration_ms: 20,
    });
    expect(Object.isFrozen(AUDIO_FORMAT)).toBe(true);
    expectTypeOf(AUDIO_FORMAT).toEqualTypeOf<{
      readonly codec: "opus";
      readonly sample_rate_hz: 16000;
      readonly channels: 1;
      readonly frame_duration_ms: 20;
    }>();
  });
});

describe("closed lists and open vocabularies (Req 7.6, 9.1–9.3)", () => {
  it.each(EXPECTED_LISTS)(
    "%s holds exactly the stated values in order",
    (_name, list, expected) => {
      expect([...list]).toEqual([...expected]);
    },
  );

  it("ACK_REASONS does not include the empty reason", () => {
    expect(ACK_REASONS).not.toContain("");
  });

  it("every list is typed as a read-only tuple of its exact values", () => {
    // Compile-time only: tsc -p tsconfig.test.json fails if any type drifts or loses readonly.
    expectTypeOf(TOUCH_ZONES).toEqualTypeOf<
      readonly ["head", "left_ear", "right_ear", "belly", "back", "left_hand", "right_hand"]
    >();
    expectTypeOf(TOUCH_GESTURES).toEqualTypeOf<readonly ["tap", "double_tap", "hold", "pat"]>();
    expectTypeOf(WAKE_SOURCES).toEqualTypeOf<readonly ["hey_lulu", "touch"]>();
    expectTypeOf(MOTION_KINDS).toEqualTypeOf<
      readonly ["pickup", "shake", "upside_down", "drop", "tilt"]
    >();
    expectTypeOf(BUTTONS).toEqualTypeOf<readonly ["belly_talk"]>();
    expectTypeOf(BUTTON_ACTIONS).toEqualTypeOf<readonly ["press", "release"]>();
    expectTypeOf(MODES).toEqualTypeOf<readonly ["idle", "play", "story", "quiet", "sleep"]>();
    expectTypeOf(MOVE_COMMANDS).toEqualTypeOf<readonly ["come", "stop", "turn"]>();
    expectTypeOf(PLAY_SOURCES).toEqualTypeOf<readonly ["stream", "cache"]>();
    expectTypeOf(LED_TARGETS).toEqualTypeOf<readonly ["ears", "cheeks", "belly"]>();
    expectTypeOf(LED_EFFECTS).toEqualTypeOf<readonly ["solid", "pulse", "rainbow"]>();
    expectTypeOf(SAY_VOICES).toEqualTypeOf<readonly ["xelulu", "grandma"]>();
    expectTypeOf(ACK_STATUSES).toEqualTypeOf<readonly ["accepted", "done", "rejected", "failed"]>();
    expectTypeOf(ACK_REASONS).toEqualTypeOf<
      readonly [
        "picked_up",
        "at_edge",
        "charging",
        "quiet_hours",
        "low_battery",
        "unsafe",
        "busy",
        "unknown_action",
      ]
    >();
    expectTypeOf(EVENT_KINDS).toEqualTypeOf<
      readonly ["touch", "wake", "cry", "motion", "button", "nfc", "interrupt", "error"]
    >();
    expectTypeOf(CMD_ACTIONS).toEqualTypeOf<
      readonly [
        "say",
        "animate",
        "gesture",
        "move",
        "play",
        "set_mode",
        "led",
        "volume",
        "config",
        "stop_audio",
        "ota",
      ]
    >();
    expectTypeOf(KNOWN_EXPRESSIONS).toEqualTypeOf<
      readonly ["happy", "love", "sleepy", "curious", "sad", "listening"]
    >();
    expectTypeOf(KNOWN_EYES).toEqualTypeOf<readonly ["blink", "hearts"]>();
    expectTypeOf(KNOWN_GESTURE_NAMES).toEqualTypeOf<
      readonly ["wave", "high_five", "hug", "clap", "point_left", "nod", "shake"]
    >();
    expectTypeOf(TOPIC_SUFFIXES).toEqualTypeOf<readonly ["status", "event", "cmd", "ack"]>();
  });
});

describe("constants are frozen and read-only (Req 9.4)", () => {
  it.each(EXPECTED_LISTS)("%s is frozen at runtime", (_name, list) => {
    expect(Object.isFrozen(list)).toBe(true);
  });

  // Each assignment is a compile error (checked by @ts-expect-error under tsconfig.test.json)
  // and, in strict-mode ESM, throws a TypeError at runtime without changing the contents.
  const ELEMENT_WRITES: readonly (readonly [string, readonly unknown[], () => void])[] = [
    [
      "TOUCH_ZONES",
      TOUCH_ZONES,
      () => {
        // @ts-expect-error read-only tuple
        TOUCH_ZONES[0] = "back";
      },
    ],
    [
      "TOUCH_GESTURES",
      TOUCH_GESTURES,
      () => {
        // @ts-expect-error read-only tuple
        TOUCH_GESTURES[0] = "pat";
      },
    ],
    [
      "WAKE_SOURCES",
      WAKE_SOURCES,
      () => {
        // @ts-expect-error read-only tuple
        WAKE_SOURCES[0] = "touch";
      },
    ],
    [
      "MOTION_KINDS",
      MOTION_KINDS,
      () => {
        // @ts-expect-error read-only tuple
        MOTION_KINDS[0] = "tilt";
      },
    ],
    [
      "BUTTONS",
      BUTTONS,
      () => {
        // @ts-expect-error read-only tuple
        BUTTONS[0] = "zz_button";
      },
    ],
    [
      "BUTTON_ACTIONS",
      BUTTON_ACTIONS,
      () => {
        // @ts-expect-error read-only tuple
        BUTTON_ACTIONS[0] = "release";
      },
    ],
    [
      "MODES",
      MODES,
      () => {
        // @ts-expect-error read-only tuple
        MODES[0] = "sleep";
      },
    ],
    [
      "MOVE_COMMANDS",
      MOVE_COMMANDS,
      () => {
        // @ts-expect-error read-only tuple
        MOVE_COMMANDS[0] = "turn";
      },
    ],
    [
      "PLAY_SOURCES",
      PLAY_SOURCES,
      () => {
        // @ts-expect-error read-only tuple
        PLAY_SOURCES[0] = "cache";
      },
    ],
    [
      "LED_TARGETS",
      LED_TARGETS,
      () => {
        // @ts-expect-error read-only tuple
        LED_TARGETS[0] = "belly";
      },
    ],
    [
      "LED_EFFECTS",
      LED_EFFECTS,
      () => {
        // @ts-expect-error read-only tuple
        LED_EFFECTS[0] = "rainbow";
      },
    ],
    [
      "SAY_VOICES",
      SAY_VOICES,
      () => {
        // @ts-expect-error read-only tuple
        SAY_VOICES[0] = "grandma";
      },
    ],
    [
      "ACK_STATUSES",
      ACK_STATUSES,
      () => {
        // @ts-expect-error read-only tuple
        ACK_STATUSES[0] = "failed";
      },
    ],
    [
      "ACK_REASONS",
      ACK_REASONS,
      () => {
        // @ts-expect-error read-only tuple
        ACK_REASONS[0] = "busy";
      },
    ],
    [
      "EVENT_KINDS",
      EVENT_KINDS,
      () => {
        // @ts-expect-error read-only tuple
        EVENT_KINDS[0] = "error";
      },
    ],
    [
      "CMD_ACTIONS",
      CMD_ACTIONS,
      () => {
        // @ts-expect-error read-only tuple
        CMD_ACTIONS[0] = "ota";
      },
    ],
    [
      "KNOWN_EXPRESSIONS",
      KNOWN_EXPRESSIONS,
      () => {
        // @ts-expect-error read-only tuple
        KNOWN_EXPRESSIONS[0] = "sad";
      },
    ],
    [
      "KNOWN_EYES",
      KNOWN_EYES,
      () => {
        // @ts-expect-error read-only tuple
        KNOWN_EYES[0] = "hearts";
      },
    ],
    [
      "KNOWN_GESTURE_NAMES",
      KNOWN_GESTURE_NAMES,
      () => {
        // @ts-expect-error read-only tuple
        KNOWN_GESTURE_NAMES[0] = "shake";
      },
    ],
    [
      "TOPIC_SUFFIXES",
      TOPIC_SUFFIXES,
      () => {
        // @ts-expect-error read-only tuple
        TOPIC_SUFFIXES[0] = "ack";
      },
    ],
  ];

  it("ELEMENT_WRITES covers every list", () => {
    expect(ELEMENT_WRITES.map(([name]) => name)).toEqual(EXPECTED_LISTS.map(([name]) => name));
  });

  it.each(ELEMENT_WRITES)(
    "assigning to an element of %s throws and leaves it unchanged",
    (_name, list, write) => {
      const before = [...list];
      expect(write).toThrow(TypeError);
      expect([...list]).toEqual(before);
    },
  );

  it("pushing onto a list throws and leaves it unchanged", () => {
    const before = [...TOUCH_ZONES];
    expect(() => {
      // @ts-expect-error read-only tuple has no push
      TOUCH_ZONES.push("tail");
    }).toThrow(TypeError);
    expect([...TOUCH_ZONES]).toEqual(before);
  });

  it("assigning to an AUDIO_FORMAT field throws and leaves it unchanged", () => {
    expect(() => {
      // @ts-expect-error read-only property
      AUDIO_FORMAT.sample_rate_hz = 48000;
    }).toThrow(TypeError);
    expect(AUDIO_FORMAT.sample_rate_hz).toBe(16000);
  });
});

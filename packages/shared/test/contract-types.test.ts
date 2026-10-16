// Compile-time contract checks (Requirements 5.10, 8.16, 10.9, design D4).
// Every hand-written wire type must equal the output type of its Zod schema, so drift between
// the readable Document B mirror and the runtime schema fails the test type-check.
// `expectTypeOf` only fails under `tsc -p tsconfig.test.json`; the runtime `it`s keep each
// group visible in the Vitest report.
import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";

import {
  AckMessageSchema,
  AnimateCmdMessageSchema,
  AudioControlMessageSchema,
  AudioEndMessageSchema,
  AudioStartMessageSchema,
  ButtonEventMessageSchema,
  CmdMessageSchema,
  ConfigCmdMessageSchema,
  CryEventMessageSchema,
  ErrorEventMessageSchema,
  EventMessageSchema,
  GestureCmdMessageSchema,
  HelloMessageSchema,
  InterruptEventMessageSchema,
  LedCmdMessageSchema,
  MotionEventMessageSchema,
  MoveCmdMessageSchema,
  NfcEventMessageSchema,
  OtaCmdMessageSchema,
  PlayCmdMessageSchema,
  SayCmdMessageSchema,
  SetModeCmdMessageSchema,
  StatusMessageSchema,
  StatusTopicMessageSchema,
  StopAudioCmdMessageSchema,
  TouchEventMessageSchema,
  VolumeCmdMessageSchema,
  WakeEventMessageSchema,
} from "../dist/index.js";
import type {
  AckMessage,
  AnimateCmdMessage,
  AudioControlMessage,
  AudioEndMessage,
  AudioStartMessage,
  ButtonEventMessage,
  CmdMessage,
  ConfigCmdMessage,
  CryEventMessage,
  ErrorEventMessage,
  EventMessage,
  GestureCmdMessage,
  HelloMessage,
  InterruptEventMessage,
  LedCmdMessage,
  MotionEventMessage,
  MoveCmdData,
  MoveCmdMessage,
  NfcEventMessage,
  OtaCmdMessage,
  PlayCmdMessage,
  SayCmdMessage,
  SetModeCmdMessage,
  StatusMessage,
  StatusTopicMessage,
  StopAudioCmdMessage,
  TouchEventMessage,
  VolumeCmdMessage,
  WakeEventMessage,
} from "../dist/index.js";

describe("device → cloud variant types equal their schema output", () => {
  it("type-checks hello, status, audio and ack", () => {
    expectTypeOf<HelloMessage>().toEqualTypeOf<z.output<typeof HelloMessageSchema>>();
    expectTypeOf<StatusMessage>().toEqualTypeOf<z.output<typeof StatusMessageSchema>>();
    expectTypeOf<AudioStartMessage>().toEqualTypeOf<z.output<typeof AudioStartMessageSchema>>();
    expectTypeOf<AudioEndMessage>().toEqualTypeOf<z.output<typeof AudioEndMessageSchema>>();
    expectTypeOf<AckMessage>().toEqualTypeOf<z.output<typeof AckMessageSchema>>();
    expect(HelloMessageSchema).toBeDefined();
  });
});

describe("event variant types equal their schema output", () => {
  it("type-checks all eight event kinds", () => {
    expectTypeOf<TouchEventMessage>().toEqualTypeOf<z.output<typeof TouchEventMessageSchema>>();
    expectTypeOf<WakeEventMessage>().toEqualTypeOf<z.output<typeof WakeEventMessageSchema>>();
    expectTypeOf<CryEventMessage>().toEqualTypeOf<z.output<typeof CryEventMessageSchema>>();
    expectTypeOf<MotionEventMessage>().toEqualTypeOf<z.output<typeof MotionEventMessageSchema>>();
    expectTypeOf<ButtonEventMessage>().toEqualTypeOf<z.output<typeof ButtonEventMessageSchema>>();
    expectTypeOf<NfcEventMessage>().toEqualTypeOf<z.output<typeof NfcEventMessageSchema>>();
    expectTypeOf<InterruptEventMessage>().toEqualTypeOf<
      z.output<typeof InterruptEventMessageSchema>
    >();
    expectTypeOf<ErrorEventMessage>().toEqualTypeOf<z.output<typeof ErrorEventMessageSchema>>();
    expect(EventMessageSchema).toBeDefined();
  });
});

describe("command variant types equal their schema output", () => {
  it("type-checks all eleven actions", () => {
    expectTypeOf<SayCmdMessage>().toEqualTypeOf<z.output<typeof SayCmdMessageSchema>>();
    expectTypeOf<AnimateCmdMessage>().toEqualTypeOf<z.output<typeof AnimateCmdMessageSchema>>();
    expectTypeOf<GestureCmdMessage>().toEqualTypeOf<z.output<typeof GestureCmdMessageSchema>>();
    expectTypeOf<MoveCmdMessage>().toEqualTypeOf<z.output<typeof MoveCmdMessageSchema>>();
    expectTypeOf<PlayCmdMessage>().toEqualTypeOf<z.output<typeof PlayCmdMessageSchema>>();
    expectTypeOf<SetModeCmdMessage>().toEqualTypeOf<z.output<typeof SetModeCmdMessageSchema>>();
    expectTypeOf<LedCmdMessage>().toEqualTypeOf<z.output<typeof LedCmdMessageSchema>>();
    expectTypeOf<VolumeCmdMessage>().toEqualTypeOf<z.output<typeof VolumeCmdMessageSchema>>();
    expectTypeOf<ConfigCmdMessage>().toEqualTypeOf<z.output<typeof ConfigCmdMessageSchema>>();
    expectTypeOf<StopAudioCmdMessage>().toEqualTypeOf<z.output<typeof StopAudioCmdMessageSchema>>();
    expectTypeOf<OtaCmdMessage>().toEqualTypeOf<z.output<typeof OtaCmdMessageSchema>>();
    expect(CmdMessageSchema).toBeDefined();
  });

  it("MoveCmdData equals the move data union output", () => {
    expectTypeOf<MoveCmdData>().toEqualTypeOf<z.output<typeof MoveCmdMessageSchema>["data"]>();
    expectTypeOf<MoveCmdMessage["data"]>().toEqualTypeOf<MoveCmdData>();
    expect(MoveCmdMessageSchema).toBeDefined();
  });
});

describe("union types equal their schema output", () => {
  it("type-checks the status topic, event, audio control and cmd unions", () => {
    expectTypeOf<StatusTopicMessage>().toEqualTypeOf<z.output<typeof StatusTopicMessageSchema>>();
    expectTypeOf<EventMessage>().toEqualTypeOf<z.output<typeof EventMessageSchema>>();
    expectTypeOf<AudioControlMessage>().toEqualTypeOf<z.output<typeof AudioControlMessageSchema>>();
    expectTypeOf<CmdMessage>().toEqualTypeOf<z.output<typeof CmdMessageSchema>>();
    expect(AudioControlMessageSchema).toBeDefined();
    expect(StatusTopicMessageSchema).toBeDefined();
  });
});

describe("discriminators narrow the unions", () => {
  it("narrows EventMessage by event", () => {
    expectTypeOf<Extract<EventMessage, { event: "cry" }>>().toEqualTypeOf<CryEventMessage>();
    expectTypeOf<Extract<EventMessage, { event: "cry" }>["data"]>().toEqualTypeOf<{
      confidence: number;
      duration_s: number;
    }>();
    expectTypeOf<Extract<EventMessage, { event: "touch" }>>().toEqualTypeOf<TouchEventMessage>();
    expectTypeOf<Extract<EventMessage, { event: "wake" }>["data"]["dir_deg"]>().toEqualTypeOf<
      number | undefined
    >();
    expectTypeOf<EventMessage["event"]>().toEqualTypeOf<
      "touch" | "wake" | "cry" | "motion" | "button" | "nfc" | "interrupt" | "error"
    >();

    const narrowEvent = (m: EventMessage): number | undefined => {
      if (m.event === "cry") {
        expectTypeOf(m).toEqualTypeOf<CryEventMessage>();
        return m.data.duration_s;
      }
      return undefined;
    };
    expect(narrowEvent).toBeTypeOf("function");
  });

  it("narrows CmdMessage by action", () => {
    expectTypeOf<Extract<CmdMessage, { action: "move" }>>().toEqualTypeOf<MoveCmdMessage>();
    expectTypeOf<Extract<CmdMessage, { action: "ota" }>>().toEqualTypeOf<OtaCmdMessage>();
    expectTypeOf<Extract<CmdMessage, { action: "say" }>["data"]>().not.toHaveProperty("audio");
    expectTypeOf<CmdMessage["action"]>().toEqualTypeOf<
      | "say"
      | "animate"
      | "gesture"
      | "move"
      | "play"
      | "set_mode"
      | "led"
      | "volume"
      | "config"
      | "stop_audio"
      | "ota"
    >();
    expectTypeOf<CmdMessage>().not.toHaveProperty("ts");
    expectTypeOf<CmdMessage>().not.toHaveProperty("type");

    const narrowCmd = (m: CmdMessage): string | undefined => {
      if (m.action === "ota") {
        expectTypeOf(m).toEqualTypeOf<OtaCmdMessage>();
        return m.data.manifest_url;
      }
      return undefined;
    };
    expect(narrowCmd).toBeTypeOf("function");
  });

  it("narrows move data by cmd (speeds optional only on stop)", () => {
    type Stop = Extract<MoveCmdData, { cmd: "stop" }>;
    type Come = Extract<MoveCmdData, { cmd: "come" }>;
    type Turn = Extract<MoveCmdData, { cmd: "turn" }>;

    expectTypeOf<Stop["linear_mms"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<Stop["angular_mrad_s"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<Stop["max_dist_mm"]>().toEqualTypeOf<number>();
    expectTypeOf<Come["linear_mms"]>().toEqualTypeOf<number>();
    expectTypeOf<Come["angular_mrad_s"]>().toEqualTypeOf<number>();
    expectTypeOf<Come["max_dist_mm"]>().toEqualTypeOf<number>();
    expectTypeOf<Turn["linear_mms"]>().toEqualTypeOf<number>();
    expectTypeOf<Turn["angular_mrad_s"]>().toEqualTypeOf<number>();
    expectTypeOf<Turn["max_dist_mm"]>().toEqualTypeOf<number>();
    expectTypeOf<MoveCmdData["cmd"]>().toEqualTypeOf<"come" | "stop" | "turn">();

    const speed = (d: MoveCmdData): number => {
      if (d.cmd === "stop") {
        expectTypeOf(d.linear_mms).toEqualTypeOf<number | undefined>();
        return d.linear_mms ?? 0;
      }
      expectTypeOf(d.linear_mms).toEqualTypeOf<number>();
      expectTypeOf(d.angular_mrad_s).toEqualTypeOf<number>();
      return d.linear_mms;
    };
    expect(speed({ cmd: "stop", max_dist_mm: 0 })).toBe(0);
    expect(speed({ cmd: "come", linear_mms: 150, angular_mrad_s: 0, max_dist_mm: 2000 })).toBe(150);
  });
});

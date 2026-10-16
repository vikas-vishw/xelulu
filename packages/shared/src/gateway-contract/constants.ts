// Document B v2 contract constants (proto_ver 2). Requirements 1.1 and 1.8.

/** The protocol version every Document B v2 message carries. */
export const PROTO_VER = 2 as const;

/** Audio format for both directions of a per-turn audio WebSocket. */
export const AUDIO_FORMAT = Object.freeze({
  codec: "opus",
  sample_rate_hz: 16000,
  channels: 1,
  frame_duration_ms: 20,
} as const);

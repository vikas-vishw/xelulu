// Mock_Audio_Codec (Phase 3 C6).
//
// NOT the Document B contract. It is not covered by `proto_ver`, no field of it appears on the
// wire contract, it carries its own MOCK_AUDIO_VERSION, and the whole folder is deleted when a
// real codec (Opus) arrives. It lives in the Shared_Package only because the Simulator writes
// these frames and the Gateway's Mock_Stt reads them, and services may not import each other:
// the Simulator stays a wire-level peer of the robot, and Document B's audio turn has no text
// field, so a test utterance can travel only inside the turn's binary frames.
//
// Frame layout, ASCII apart from the chunk's UTF-8 bytes:
//   MA1\0<lang>\0<index>\0<total>\0<utf8 chunk>
// `index` is 1-based and `total` is the frame count, both zero-padded to three digits, so every
// frame is self-describing: a decoder needs no side channel and a missing frame is detectable.
import { SUPPORTED_LANGS, type SupportedLang } from "../domain/language.js";

/** Bump when the frame layout changes. Independent of proto_ver and GATEWAY_LOG_VERSION. */
export const MOCK_AUDIO_VERSION = 1 as const;

/** Well under the contract's 1,500-byte frame cap, so a frame is always contract-valid. */
export const MOCK_FRAME_MAX_BYTES = 512;

/** The magic prefix, tied to MOCK_AUDIO_VERSION. */
const MAGIC = "MA1";

/** The most frames one utterance may encode to. */
const MAX_FRAMES = 64;

/** UTF-8 bytes of text per frame. Leaves ample room for the header inside the frame cap. */
const CHUNK_BYTES = 256;

/** The separator byte between header parts. */
const SEPARATOR = 0x00;

/** Header parts before the chunk: the magic, the lang, the index and the total. */
const HEADER_PARTS = 4;

const encoder = new TextEncoder();
/** Fatal, so malformed bytes are a decode failure rather than silent replacement characters. */
const decoder = new TextDecoder("utf-8", { fatal: true });

export type UtteranceFrames = Readonly<{ lang: SupportedLang; frames: readonly Uint8Array[] }>;

export type DecodedUtterance =
  | { readonly ok: true; readonly text: string; readonly lang: SupportedLang }
  | { readonly ok: false; readonly reason: "not_mock_audio" | "incomplete" | "bad_frame" };

function isSupportedLang(value: string): value is SupportedLang {
  return (SUPPORTED_LANGS as readonly string[]).includes(value);
}

/** Splits `text` into UTF-8 chunks of at most `limit` bytes, never splitting a code point. */
function chunkUtf8(text: string, limit: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  let pending = "";
  for (const char of text) {
    const next = pending + char;
    if (encoder.encode(next).byteLength > limit) {
      if (pending !== "") out.push(encoder.encode(pending));
      pending = char;
    } else {
      pending = next;
    }
  }
  if (pending !== "") out.push(encoder.encode(pending));
  return out;
}

/**
 * Splits `text` into frames: `MA1\0<lang>\0<index>\0<total>\0<utf8 chunk>`. Each frame is
 * self-describing, so a decoder needs no side channel and a lost frame is detectable.
 * Throws on an empty text or an over-long one (more than 64 frames), so no caller can build an
 * unbounded upload.
 */
export function encodeUtteranceFrames(text: string, lang: SupportedLang): UtteranceFrames {
  const chunks = chunkUtf8(text, CHUNK_BYTES);
  if (chunks.length === 0) throw new Error("mock audio: empty utterance");
  if (chunks.length > MAX_FRAMES) throw new Error("mock audio: utterance too long");
  const total = chunks.length;
  const totalText = String(total).padStart(3, "0");
  const frames = chunks.map((chunk, at) => {
    const indexText = String(at + 1).padStart(3, "0");
    const header = encoder.encode(`${MAGIC}\0${lang}\0${indexText}\0${totalText}\0`);
    const frame = new Uint8Array(header.byteLength + chunk.byteLength);
    frame.set(header, 0);
    frame.set(chunk, header.byteLength);
    if (frame.byteLength > MOCK_FRAME_MAX_BYTES) throw new Error("mock audio: frame over the cap");
    return frame;
  });
  return { lang, frames };
}

type ParsedFrame = Readonly<{
  lang: SupportedLang;
  index: number;
  total: number;
  chunk: Uint8Array;
}>;

/** Parses one frame, or null when it is not a well-formed Utterance_Frame. */
function parseFrame(frame: Uint8Array): ParsedFrame | null {
  if (frame.byteLength > MOCK_FRAME_MAX_BYTES) return null;
  const stops: number[] = [];
  for (let at = 0; at < frame.byteLength && stops.length < HEADER_PARTS; at += 1) {
    if (frame[at] === SEPARATOR) stops.push(at);
  }
  const [afterMagic, afterLang, afterIndex, afterTotal] = stops;
  if (
    afterMagic === undefined ||
    afterLang === undefined ||
    afterIndex === undefined ||
    afterTotal === undefined
  ) {
    return null;
  }
  let lang: string;
  let indexText: string;
  let totalText: string;
  try {
    if (decoder.decode(frame.subarray(0, afterMagic)) !== MAGIC) return null;
    lang = decoder.decode(frame.subarray(afterMagic + 1, afterLang));
    indexText = decoder.decode(frame.subarray(afterLang + 1, afterIndex));
    totalText = decoder.decode(frame.subarray(afterIndex + 1, afterTotal));
  } catch {
    return null;
  }
  if (!isSupportedLang(lang)) return null;
  if (!/^\d{3}$/.test(indexText) || !/^\d{3}$/.test(totalText)) return null;
  const index = Number(indexText);
  const total = Number(totalText);
  if (total < 1 || total > MAX_FRAMES) return null;
  if (index < 1 || index > total) return null;
  return { lang, index, total, chunk: frame.subarray(afterTotal + 1) };
}

/**
 * Decodes frames in arrival order. `not_mock_audio` when the first frame is no Utterance_Frame at
 * all (a Phase 1.2 synthetic frame, for instance), `bad_frame` when a later frame is malformed or
 * disagrees with the first, and `incomplete` when a frame of the set is missing.
 */
export function decodeUtteranceFrames(frames: readonly Uint8Array[]): DecodedUtterance {
  const head = frames[0];
  if (head === undefined) return { ok: false, reason: "not_mock_audio" };
  const first = parseFrame(head);
  if (first === null) return { ok: false, reason: "not_mock_audio" };

  const chunks: (Uint8Array | undefined)[] = new Array<Uint8Array | undefined>(first.total);
  for (const raw of frames) {
    const parsed = parseFrame(raw);
    if (parsed === null) return { ok: false, reason: "bad_frame" };
    if (parsed.lang !== first.lang || parsed.total !== first.total) {
      return { ok: false, reason: "bad_frame" };
    }
    chunks[parsed.index - 1] = parsed.chunk;
  }

  const parts: Uint8Array[] = [];
  let size = 0;
  for (const chunk of chunks) {
    if (chunk === undefined) return { ok: false, reason: "incomplete" };
    parts.push(chunk);
    size += chunk.byteLength;
  }
  const joined = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    joined.set(part, at);
    at += part.byteLength;
  }
  try {
    return { ok: true, text: decoder.decode(joined), lang: first.lang };
  } catch {
    return { ok: false, reason: "bad_frame" };
  }
}

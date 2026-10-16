// The Synthetic_Frame (Req 10.4, G17): one fixed 40-byte ASCII pattern, about 16 kbps at 20 ms.
// It is not decodable speech and is never built from an inbound frame, a file or recorded audio.

const PATTERN = "XLU-SYNTHETIC-PLACEHOLDER-FRAME-NOTAUDIO";
const BYTES: Uint8Array = new TextEncoder().encode(PATTERN);

export const SYNTHETIC_FRAME_BYTES = 40;

/** A fresh copy of the pattern for every call, so no caller can change the constant. */
export function syntheticFrame(): Uint8Array {
  return BYTES.slice();
}

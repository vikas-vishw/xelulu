// Audio client transport interface (types only, design "Audio turn client"). The `ws` client in
// transport/ implements it; pure modules depend on this file, never on `ws`. A reply frame reaches
// the core as the event "binary" only: its bytes are dropped in the transport's handler, so no
// reference to them outlives it (Req 18.3, 21.2).

export type ClientAudioInbound =
  | { readonly kind: "text"; readonly text: string }
  /** A binary message; its bytes are never passed in. */
  | { readonly kind: "binary" }
  | { readonly kind: "closed" };

export interface ClientAudioSocket {
  sendText(text: string): void;
  sendBinary(frame: Uint8Array): void;
  close(): void;
  onInbound(fn: (message: ClientAudioInbound) => void): void;
}

/** Why a socket could not be opened (Req 18.6). */
export type AudioOpenFailure = "upgrade_refused" | "connect_failed";

/**
 * Opens one socket to `url` with `Authorization: Bearer <token>`. Rejects with the
 * AudioOpenFailure string itself: `upgrade_refused` when the server answers the upgrade with
 * anything but 101, `connect_failed` for every other failure. No other detail is given.
 */
export type OpenAudioSocket = (url: string, token: string) => Promise<ClientAudioSocket>;

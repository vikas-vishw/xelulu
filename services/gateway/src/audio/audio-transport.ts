// Audio transport interface (types only, design D6, D7). The `ws` listener in transport/
// implements it; pure modules depend on this file, never on `ws` or `node:http`. A binary frame
// reaches the core as its byte length and its bytes, which the Audio_Turn hands to that turn's
// Stt_Session inside the handler that received them and of which it keeps no reference itself
// (Req 14.2, superseding Phase 1.2's "the frame's bytes are never passed in"). Nothing else sees
// them: no file write, and no byte in any Log_Entry, stdout line, response or error (Req 14.1).

export type AudioInbound =
  | { readonly kind: "text"; readonly text: string; readonly byteLength: number }
  /**
   * The frame's bytes, valid only for the duration of the handler. The core passes them to the
   * turn's Stt_Session inside that handler and keeps no reference of its own (Req 14.2).
   */
  | { readonly kind: "binary"; readonly bytes: Uint8Array; readonly byteLength: number }
  /** Any message over the 65,536-byte `ws` maxPayload, text or binary (D7, G53). */
  | { readonly kind: "too_large" }
  | { readonly kind: "closed" };

/** 1000 normal, 1001 going away (replaced), 1008 policy (protocol), 1009 message too big. */
export type AudioCloseCode = 1000 | 1001 | 1008 | 1009;

export interface AudioSocket {
  sendText(text: string): void;
  sendBinary(frame: Uint8Array): void;
  /** The transport calls terminate() 1,000 ms later if the socket is still open (Req 9.8). */
  close(code: AudioCloseCode): void;
  onInbound(fn: (message: AudioInbound) => void): void;
}

export type AudioListen = (opts: {
  readonly host: string;
  readonly port: number;
  /** The `Authorization` header of the upgrade; returns the device id or null. */
  authenticate(authorization: string | undefined): string | null;
  onAuthFailed(): void;
  onTurn(deviceId: string, socket: AudioSocket): void;
}) => Promise<{ readonly port: number; close(): Promise<void> }>;

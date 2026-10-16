// Text-to-speech seam (Req 1.1, 11.4). Text in, encoded audio frames out, in play order. The
// pipeline stops pulling when the turn stops, so no frame outlives its turn and no frame is ever
// written to a file. Vendor SDKs and vendor types never leak past this interface.
import type { ProviderId, SupportedLang } from "@xelulu/shared";

import type { DataHandlingDeclaration } from "./provider-declaration.js";

export type TtsInput = Readonly<{
  deviceId: string;
  turnId: string;
  text: string;
  lang: SupportedLang;
}>;

export interface TtsProvider {
  readonly id: ProviderId;
  readonly dataHandling: DataHandlingDeclaration;
  /** Frames in play order. The pipeline stops pulling when the turn stops. */
  synthesise(input: TtsInput): AsyncIterable<Uint8Array>;
}

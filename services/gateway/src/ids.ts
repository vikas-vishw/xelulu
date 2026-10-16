// Random URL-safe identifiers (G16, Req 8.1). node:crypto is not a network module.
import { randomBytes } from "node:crypto";

export interface IdSource {
  next(prefix: "" | "ev_" | "t_"): string;
}

/** Every id this process has issued, so a (2^-128) collision draws again. */
const issued = new Set<string>();

/** `prefix` + 16 random bytes as base64url: 22 URL-safe characters after the prefix. */
export const randomIds: IdSource = {
  next(prefix) {
    for (;;) {
      const id = prefix + randomBytes(16).toString("base64url");
      if (!issued.has(id)) {
        issued.add(id);
        return id;
      }
    }
  },
};

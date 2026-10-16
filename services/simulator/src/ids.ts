// Random URL-safe identifiers (G16, Req 16.3, 18.2): `ev_` for event_id, `t_` for turn_id.
// A copy of the gateway's module (services never import each other). node:crypto is not a
// network module.
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

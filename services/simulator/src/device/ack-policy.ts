// Ack_Policy (Req 17.1–17.7, G28, G47). Overrides are set per action or for all actions until
// cleared; a per-action override beats an all-actions one. The plan for a command is fixed when
// it is received: `reject` applies nothing and sends one `rejected <reason>`; `fail`,
// `accept_only` and `silent` still apply the command. Every list of valid values comes from the
// contract constants (`ACK_REASONS`, `CMD_ACTIONS`), never restated here.
import {
  ACK_REASONS,
  CMD_ACTIONS,
  type AckReason,
  type AckStatus,
  type CmdAction,
} from "@xelulu/shared";

export type AckOverride =
  | { readonly mode: "reject"; readonly reason: AckReason }
  | { readonly mode: "fail"; readonly reason: "" | AckReason }
  | { readonly mode: "accept_only" }
  | { readonly mode: "silent" };

export type AckPolicy = Readonly<{
  all: AckOverride | null;
  byAction: Readonly<Partial<Record<CmdAction, AckOverride>>>;
}>;

export type AckScope = "all" | CmdAction;

export type PlannedAck = Readonly<{ status: AckStatus; reason: "" | AckReason }>;

export type AckPlan = Readonly<{ apply: boolean; acks: readonly PlannedAck[] }>;

/** No override anywhere: every command is answered `accepted ""` then `done ""`. */
export const EMPTY_ACK_POLICY: AckPolicy = Object.freeze({
  all: null,
  byAction: Object.freeze({}),
});

/** `byAction[action] ?? all ?? null` (G47). */
export function resolveOverride(policy: AckPolicy, action: CmdAction): AckOverride | null {
  return policy.byAction[action] ?? policy.all ?? null;
}

const ACCEPTED: PlannedAck = Object.freeze({ status: "accepted", reason: "" });
const DONE: PlannedAck = Object.freeze({ status: "done", reason: "" });

/** The design's Ack_Policy table. */
export function ackPlan(o: AckOverride | null): AckPlan {
  if (o === null) return Object.freeze({ apply: true, acks: Object.freeze([ACCEPTED, DONE]) });
  switch (o.mode) {
    case "reject":
      return Object.freeze({
        apply: false,
        acks: Object.freeze([Object.freeze({ status: "rejected" as const, reason: o.reason })]),
      });
    case "fail":
      return Object.freeze({
        apply: true,
        acks: Object.freeze([
          ACCEPTED,
          Object.freeze({ status: "failed" as const, reason: o.reason }),
        ]),
      });
    case "accept_only":
      return Object.freeze({ apply: true, acks: Object.freeze([ACCEPTED]) });
    case "silent":
      return Object.freeze({ apply: true, acks: Object.freeze([]) });
  }
}

export function isAckReason(value: unknown): value is AckReason {
  return typeof value === "string" && (ACK_REASONS as readonly string[]).includes(value);
}

export function isCmdAction(value: unknown): value is CmdAction {
  return typeof value === "string" && (CMD_ACTIONS as readonly string[]).includes(value);
}

/** `"all"` or one of `CMD_ACTIONS`, else null. */
export function parseAckScope(value: unknown): AckScope | null {
  if (value === "all") return "all";
  return isCmdAction(value) ? value : null;
}

/** Why an override was refused. The submitted value is never echoed. */
export type OverrideRefusal = "invalid_override" | "reason_required" | "invalid_reason";

export type OverrideCheck =
  | { readonly ok: true; readonly override: AckOverride }
  | { readonly ok: false; readonly code: OverrideRefusal };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function onlyKeys(obj: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(obj).every((k) => allowed.includes(k));
}

/**
 * Validates an override from an untrusted request (Req 17.7, 20.6): `reject` needs a reason from
 * `ACK_REASONS`; `fail` needs `""` or one of them; `accept_only` and `silent` take no reason.
 * Any other shape, mode or extra key is `invalid_override`.
 */
export function parseAckOverride(value: unknown): OverrideCheck {
  if (!isPlainObject(value)) return { ok: false, code: "invalid_override" };
  const mode = value["mode"];
  switch (mode) {
    case "reject":
    case "fail": {
      if (!onlyKeys(value, ["mode", "reason"])) return { ok: false, code: "invalid_override" };
      if (!Object.hasOwn(value, "reason")) return { ok: false, code: "reason_required" };
      const reason = value["reason"];
      if (mode === "reject") {
        if (reason === "") return { ok: false, code: "reason_required" };
        if (!isAckReason(reason)) return { ok: false, code: "invalid_reason" };
        return { ok: true, override: Object.freeze({ mode, reason }) };
      }
      if (reason !== "" && !isAckReason(reason)) return { ok: false, code: "invalid_reason" };
      return { ok: true, override: Object.freeze({ mode, reason }) };
    }
    case "accept_only":
    case "silent":
      if (!onlyKeys(value, ["mode"])) return { ok: false, code: "invalid_override" };
      return { ok: true, override: Object.freeze({ mode }) };
    default:
      return { ok: false, code: "invalid_override" };
  }
}

/** A new frozen policy with `override` set for `scope`. */
export function setOverride(policy: AckPolicy, scope: AckScope, override: AckOverride): AckPolicy {
  if (scope === "all") return Object.freeze({ all: override, byAction: policy.byAction });
  return Object.freeze({
    all: policy.all,
    byAction: Object.freeze({ ...policy.byAction, [scope]: override }),
  });
}

/** A new frozen policy with the override for `scope` removed. */
export function clearOverride(policy: AckPolicy, scope: AckScope): AckPolicy {
  if (scope === "all") return Object.freeze({ all: null, byAction: policy.byAction });
  const byAction: Partial<Record<CmdAction, AckOverride>> = { ...policy.byAction };
  delete byAction[scope];
  return Object.freeze({ all: policy.all, byAction: Object.freeze(byAction) });
}

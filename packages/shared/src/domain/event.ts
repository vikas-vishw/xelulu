import type { EventDataFor, EventKind } from "../gateway-contract/index.js";
import type { IsoDateTime } from "./common.js";

/** A stored device event. `Event<"cry">` ties `data` to the cry event data shape. */
export interface Event<K extends EventKind = EventKind> {
  event_id: string;
  device_id: string;
  household_id: string;
  event: K;
  /** Device unix seconds, a non-negative integer. */
  ts: number;
  received_at: IsoDateTime;
  /** Required here; absent on the wire means `false`. */
  time_uncertain: boolean;
  data: EventDataFor<K>;
}

// Projects an event's `data` to its Closed_Enum keys for the Gateway_Log (Req 12.4): touch
// `zone`/`gesture`, wake `source`, motion `event`, button `button`/`action`, and `{}` for every
// other kind. Open_Vocabulary and free-text values (`card_id`, `code`, `detail`, numbers) never
// reach a log entry.
import type { EventMessage, LoggedEvent } from "@xelulu/shared";

export function toLoggedEvent(message: EventMessage): LoggedEvent {
  switch (message.event) {
    case "touch":
      return {
        event: "touch",
        data: { zone: message.data.zone, gesture: message.data.gesture },
      };
    case "wake":
      return { event: "wake", data: { source: message.data.source } };
    case "motion":
      return { event: "motion", data: { event: message.data.event } };
    case "button":
      return {
        event: "button",
        data: { button: message.data.button, action: message.data.action },
      };
    default:
      return { event: message.event, data: {} };
  }
}

// React wiring for the Operator_Stream (Req 7.1, 7.3, 7.4): a Stream_Client feeds the pure
// console reducer, and the effect's cleanup stops the client, which closes the stream and
// cancels any pending reconnect (page closed, reloaded or unmounted). No env read.
import { useEffect, useReducer, useRef } from "react";

import { consoleReducer } from "./console-state";
import type { ConsoleState } from "./console-state";
import { createStreamClient } from "./stream-client";
import type { EventSourceLike } from "./stream-client";

/** Builds the source for one connection attempt (a fake in tests). */
export type CreateSource = (url: string) => EventSourceLike;

/** The browser's own EventSource, at the console's own origin. */
export const browserEventSource: CreateSource = (url) => new EventSource(url);

/** Before the first connection attempt: no data, nothing stale. */
export const INITIAL_CONSOLE_STATE: ConsoleState = Object.freeze({
  connection: "connecting",
  devices: null,
  entries: Object.freeze([]),
  turns: null,
  stale: false,
});

export function useConsoleStream(createSource: CreateSource = browserEventSource): ConsoleState {
  const [state, dispatch] = useReducer(consoleReducer, INITIAL_CONSOLE_STATE);

  // The latest factory is read at each connection attempt, so a new function identity on
  // re-render does not tear the stream down.
  const sourceRef = useRef(createSource);
  useEffect(() => {
    sourceRef.current = createSource;
  });

  useEffect(() => {
    const client = createStreamClient({
      createSource: (url) => sourceRef.current(url),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      onState: (next) => dispatch({ type: "state", state: next }),
      onOpen: () => dispatch({ type: "reset" }),
      onDevices: (payload) => dispatch({ type: "devices", devices: payload.devices }),
      onEntry: (entry) => dispatch({ type: "entry", entry }),
      onTurn: (view) => dispatch({ type: "turn", view }),
    });
    return () => client.stop();
  }, []);

  return state;
}

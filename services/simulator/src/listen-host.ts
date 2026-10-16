// The listen-host decision for the Control_Surface (Phase 1.3 C8, Req 3.2). A copy of the
// gateway's src/listen-host.ts: services never import each other. The surface binds every
// container interface only in Local_Mode and with the Listen_All_Argument, which Compose adds
// through the service's `command`; in every other case it binds 127.0.0.1 only.

/** The argument Compose adds to bind the local surface on every container interface (C8). */
export const LISTEN_ALL_ARGUMENT = "--listen-all-interfaces";

/** True when the process arguments (without node and the script) include the Listen_All_Argument. */
export function hasListenAllArgument(argv: readonly string[]): boolean {
  return argv.includes(LISTEN_ALL_ARGUMENT);
}

/** 0.0.0.0 only with Local_Mode and the argument; 127.0.0.1 in every other case. */
export function localSurfaceHost(localMode: boolean, listenAll: boolean): "127.0.0.1" | "0.0.0.0" {
  return localMode && listenAll ? "0.0.0.0" : "127.0.0.1";
}

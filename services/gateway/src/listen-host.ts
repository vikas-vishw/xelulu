// The bind host of the gateway's local surface (Req 3.1, C8). Compose starts the gateway with
// `--listen-all-interfaces` so a port published to the host's loopback reaches the process inside
// its container; that argument counts only in Local_Mode. Without it (`pnpm start:*`, the image's
// default CMD, every test harness) the surface stays on 127.0.0.1. The simulator keeps a copy of
// this file, because services never import each other.

/** The argument Compose adds to bind the local surface on every container interface (C8). */
export const LISTEN_ALL_ARGUMENT = "--listen-all-interfaces";

export function hasListenAllArgument(argv: readonly string[]): boolean {
  return argv.includes(LISTEN_ALL_ARGUMENT);
}

/**
 * The argument that lets the operator channel carry transcript text (Phase 3 C4). Off by
 * default, and deliberately an argument rather than a Panel_Key: it is a local-surface switch on
 * the C8 precedent, not an address or a secret.
 */
export const TRANSCRIPTS_ARGUMENT = "--operator-transcripts";

/**
 * Whether transcript text may travel on the operator channel: Local_Mode AND the argument, and
 * nothing else. Outside Local_Mode the argument is ignored entirely, so a hosted gateway cannot
 * be made to emit a child's words by adding a flag to its command line (Omar's ruling).
 */
export function operatorTranscriptsEnabled(localMode: boolean, argv: readonly string[]): boolean {
  return localMode && argv.includes(TRANSCRIPTS_ARGUMENT);
}

/**
 * The argument that opens the Admin_Console's write path on the Operator_Surface (Phase 4 C23).
 * Off by default, and an argument rather than a Panel_Key for the same reason as the two above:
 * it is a local-surface switch, not an address or a secret.
 */
export const CONTENT_ADMIN_ARGUMENT = "--content-admin";

/**
 * Whether the Operator_Content_Routes may be written to: Local_Mode AND the argument, and
 * nothing else. Outside Local_Mode the argument is ignored entirely, so a hosted gateway cannot
 * be given a content editor by adding a flag to its command line.
 */
export function contentAdminEnabled(localMode: boolean, argv: readonly string[]): boolean {
  return localMode && argv.includes(CONTENT_ADMIN_ARGUMENT);
}

/**
 * The argument that opens the Device_Control_Route on the Operator_Surface (Phase 6 C11). Off by
 * default, and deliberately NOT the Content_Admin_Argument: editing content and firing commands
 * at a robot are different powers, so they are different switches.
 */
export const DEVICE_CONTROL_ARGUMENT = "--device-control";

/**
 * Whether the Device_Control_Route may send: Local_Mode AND the argument, and nothing else.
 * Outside Local_Mode the argument is ignored entirely, so a hosted gateway cannot be given a
 * command console by adding a flag to its command line.
 */
export function deviceControlEnabled(localMode: boolean, argv: readonly string[]): boolean {
  return localMode && argv.includes(DEVICE_CONTROL_ARGUMENT);
}

/** 0.0.0.0 only with Local_Mode and the argument; 127.0.0.1 in every other case. */
export function localSurfaceHost(localMode: boolean, listenAll: boolean): "127.0.0.1" | "0.0.0.0" {
  return localMode && listenAll ? "0.0.0.0" : "127.0.0.1";
}

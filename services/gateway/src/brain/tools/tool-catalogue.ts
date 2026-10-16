// The catalogue a provider is told about (Req 9.1, C18).
//
// It is exactly `ALLOW_LISTED_TOOLS` and nothing else: the list the model is offered and the list
// the Tool_Router enforces are the same list, so the two cannot drift apart. Re-exported through
// its own module so the pipeline can hand a provider the catalogue without importing the router,
// which keeps the prompt side free of the gate's types.
import { ALLOW_LISTED_TOOLS, type AllowListedTool } from "@xelulu/shared";

/** The five tools, as offered to a provider. */
export const ALLOW_LISTED_TOOLS_FOR_PROMPT: readonly AllowListedTool[] = ALLOW_LISTED_TOOLS;

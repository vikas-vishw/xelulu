// Language-model seam (Req 1.1, 9.1). The provider is given the turn's transcript text, the
// active child's shape and the Allow_Listed_Tool catalogue, and nothing else: no browsing, no
// search, no URL fetching, no code execution (safety.md §3). `ToolRequest.name` is a plain string
// on purpose, because a provider may ask for anything; the Tool_Router is what refuses it.
import type { AgeStage, AllowListedTool, ProviderId, SupportedLang } from "@xelulu/shared";

import type { DataHandlingDeclaration } from "./provider-declaration.js";

export type ToolRequest = Readonly<{ name: string; args: Readonly<Record<string, unknown>> }>;

export type LlmTurnInput = Readonly<{
  deviceId: string;
  turnId: string;
  transcript: string;
  lang: SupportedLang;
  ageStage: AgeStage;
  allowedCategories: readonly string[];
  deferTopics: readonly string[];
  /** Exactly ALLOW_LISTED_TOOLS; the catalogue the provider may ask for (Req 9). */
  tools: readonly AllowListedTool[];
  /** Results of the tool calls already made this turn, in order. */
  toolResults: readonly Readonly<{ name: string; text: string }>[];
}>;

export type LlmReply =
  | { readonly ok: true; readonly text: string; readonly toolRequests: readonly ToolRequest[] }
  | { readonly ok: false; readonly reason: "provider_error" | "refused" };

export interface LlmProvider {
  readonly id: ProviderId;
  readonly dataHandling: DataHandlingDeclaration;
  reply(input: LlmTurnInput): Promise<LlmReply>;
}

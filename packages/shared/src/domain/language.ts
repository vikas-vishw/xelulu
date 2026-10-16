// The languages Phase 3 carries end to end (C13). Not part of the frozen Document B contract:
// `say.data.lang` stays a free-form BCP-47-like string, and each tag here satisfies the
// contract's LANG_RE, so adding a language needs no proto_ver bump.

/** The language tags Phase 3 supports end to end (C13). Each satisfies the contract's LANG_RE. */
export const SUPPORTED_LANGS = Object.freeze(["en-IN", "hi-IN"] as const);
export type SupportedLang = (typeof SUPPORTED_LANGS)[number];

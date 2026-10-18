// The Pairing_Code (Document C Part 2; Phase 6 C4, Req 2.1). Six characters derived from the
// `device_id` and `fw_ver` a `hello` already carries, so nothing new goes on the wire and no
// proto_ver bump is needed. It is a confirmation the operator reads aloud and compares with what
// the firmware logs, NOT a credential: FNV-1a is a hash, not a cipher, it hides nothing and is
// not meant to.
//
// This module takes exactly two arguments and imports nothing, so no `auth` value, DEVICE_TOKEN,
// MQTT_PASSWORD or other env value is reachable from it. Pure and total: the same pair always
// gives the same code, and only a changed pair can change it.

/** Crockford base32 without the vowels, so no code can read as a word. 31 characters. */
export const PAIRING_CODE_ALPHABET = "0123456789BCDFGHJKLMNPQRSTVWXYZ";
export const PAIRING_CODE_LENGTH = 6;

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** FNV-1a over the string's UTF-16 code units, one byte at a time, as an unsigned 32-bit value. */
function fnv1a(text: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    for (const byte of [unit & 0xff, (unit >>> 8) & 0xff]) {
      hash = (hash ^ byte) >>> 0;
      hash = Math.imul(hash, FNV_PRIME) >>> 0;
    }
  }
  return hash;
}

/**
 * The device's six-character Pairing_Code. The two inputs are joined with a NUL, which no
 * `device_id` or `fw_ver` contains, so no two different pairs share one hashed string.
 */
export function pairingCode(deviceId: string, fwVer: string): string {
  let hash = fnv1a(`${deviceId}\u0000${fwVer}`);
  let code = "";
  for (let i = 0; i < PAIRING_CODE_LENGTH; i += 1) {
    code += PAIRING_CODE_ALPHABET.charAt(hash % PAIRING_CODE_ALPHABET.length);
    // Re-hash between characters so the later ones are not just the high bits of the first.
    hash = fnv1a(`${hash}`);
  }
  return code;
}

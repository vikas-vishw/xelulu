// Test helper (not a test): throwaway self-signed X.509 v3 certificates, built at test time with
// node:crypto (an ECDSA P-256 key from generateKeyPairSync) and the minimal DER encoder below.
// Nothing is written to disk or committed. Copied from the gateway's test support (services and
// their tests never import each other). Variants for the TLS tests (Req 1.6, 1.9):
//   valid      - for 127.0.0.1 and localhost, in date; `ca` is the certificate itself
//   untrusted  - like valid, but `ca` is an unrelated certificate, so the issuer is not trusted
//   expired    - for 127.0.0.1 and localhost, ended a day ago; `ca` is the certificate itself
//   wrong_host - in date, but names only another host; `ca` is the certificate itself
// `ca` is what the client is given as an extra trust anchor (the trust hook); it never weakens
// verification.
import { generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";

export const CERT_VARIANTS = Object.freeze([
  "valid",
  "untrusted",
  "expired",
  "wrong_host",
] as const);
export type CertVariant = (typeof CERT_VARIANTS)[number];

export type TestCert = Readonly<{
  /** The server's certificate (PEM). */
  cert: string;
  /** The server's private key (PKCS #8 PEM). */
  key: string;
  /** The trust anchor to give the client (PEM). */
  ca: string;
}>;

/** The only name a wrong_host certificate carries. Not a URL; never resolved. */
export const WRONG_HOST_NAME = "wrong-host.invalid";

const DAY_MS = 86_400_000;

// --- Minimal DER encoder ---------------------------------------------------------------------

function length(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v % 256);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

export function tlv(tag: number, content: Uint8Array): Buffer {
  return Buffer.concat([Buffer.from([tag]), length(content.length), content]);
}

const seq = (...items: Uint8Array[]): Buffer => tlv(0x30, Buffer.concat(items));
const set = (...items: Uint8Array[]): Buffer => tlv(0x31, Buffer.concat(items));
const explicit = (n: number, inner: Uint8Array): Buffer => tlv(0xa0 + n, inner);
const bool = (v: boolean): Buffer => tlv(0x01, Buffer.from([v ? 0xff : 0x00]));
const octets = (content: Uint8Array): Buffer => tlv(0x04, content);
const bits = (content: Uint8Array, unused = 0): Buffer =>
  tlv(0x03, Buffer.concat([Buffer.from([unused]), content]));
const utf8 = (s: string): Buffer => tlv(0x0c, Buffer.from(s, "utf8"));

/** A non-negative INTEGER from big-endian bytes (a 0x00 is added if the top bit is set). */
export function uint(bytes: Uint8Array): Buffer {
  let b = Buffer.from(bytes);
  while (b.length > 1 && b[0] === 0 && ((b[1] ?? 0) & 0x80) === 0) b = b.subarray(1);
  return tlv(0x02, ((b[0] ?? 0) & 0x80) !== 0 ? Buffer.concat([Buffer.from([0]), b]) : b);
}

export function oid(dotted: string): Buffer {
  const [a = 0, b = 0, ...rest] = dotted.split(".").map(Number);
  const out = [40 * a + b];
  for (const n of rest) {
    const chunk: number[] = [n & 0x7f];
    for (let v = Math.floor(n / 128); v > 0; v = Math.floor(v / 128))
      chunk.unshift(0x80 | (v & 0x7f));
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
}

/** UTCTime for 1950–2049, GeneralizedTime otherwise (RFC 5280 §4.1.2.5). */
export function time(ms: number): Buffer {
  const iso = new Date(Math.floor(ms / 1000) * 1000).toISOString();
  const digits = iso.slice(0, 19).replace(/[-:T]/g, "");
  const year = Number(iso.slice(0, 4));
  return year >= 1950 && year < 2050
    ? tlv(0x17, Buffer.from(digits.slice(2) + "Z", "ascii"))
    : tlv(0x18, Buffer.from(digits + "Z", "ascii"));
}

// --- Certificate -----------------------------------------------------------------------------

const OID_ECDSA_SHA256 = "1.2.840.10045.4.3.2";
const OID_COMMON_NAME = "2.5.4.3";
const OID_BASIC_CONSTRAINTS = "2.5.29.19";
const OID_KEY_USAGE = "2.5.29.15";
const OID_SUBJECT_ALT_NAME = "2.5.29.17";

type SanName = { readonly dns: string } | { readonly ip: readonly number[] };

function san(names: readonly SanName[]): Buffer {
  return seq(
    ...names.map((n) =>
      "dns" in n ? tlv(0x82, Buffer.from(n.dns, "ascii")) : tlv(0x87, Buffer.from(n.ip)),
    ),
  );
}

function extension(id: string, critical: boolean, value: Uint8Array): Buffer {
  return critical ? seq(oid(id), bool(true), octets(value)) : seq(oid(id), octets(value));
}

function pem(label: string, der: Uint8Array): string {
  const lines =
    Buffer.from(der)
      .toString("base64")
      .match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

type CertSpec = Readonly<{
  commonName: string;
  names: readonly SanName[];
  notBefore: number;
  notAfter: number;
}>;

function buildCert(spec: CertSpec): { cert: string; key: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const algorithm = seq(oid(OID_ECDSA_SHA256));
  const name = seq(set(seq(oid(OID_COMMON_NAME), utf8(spec.commonName))));
  const serial = randomBytes(16);
  serial[0] = ((serial[0] ?? 0) & 0x7f) | 0x01;

  const tbs = seq(
    explicit(0, uint(Buffer.from([2]))), // v3
    uint(serial),
    algorithm,
    name,
    seq(time(spec.notBefore), time(spec.notAfter)),
    name,
    (publicKey as KeyObject).export({ type: "spki", format: "der" }),
    explicit(
      3,
      seq(
        extension(OID_BASIC_CONSTRAINTS, true, seq(bool(true))),
        // digitalSignature (bit 0) and keyCertSign (bit 5).
        extension(OID_KEY_USAGE, true, bits(Buffer.from([0x84]), 2)),
        extension(OID_SUBJECT_ALT_NAME, false, san(spec.names)),
      ),
    ),
  );
  const signature = sign("sha256", tbs, privateKey);
  return {
    cert: pem("CERTIFICATE", seq(tbs, algorithm, bits(signature))),
    key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

const LOCAL_NAMES: readonly SanName[] = [{ dns: "localhost" }, { ip: [127, 0, 0, 1] }];

/** A fresh certificate and key for the variant; `now` defaults to the current time. */
export function selfSignedCert(variant: CertVariant, now: number = Date.now()): TestCert {
  const inDate = { notBefore: now - DAY_MS, notAfter: now + DAY_MS };
  switch (variant) {
    case "valid": {
      const c = buildCert({ commonName: "xelulu-test-valid", names: LOCAL_NAMES, ...inDate });
      return { ...c, ca: c.cert };
    }
    case "untrusted": {
      const c = buildCert({ commonName: "xelulu-test-untrusted", names: LOCAL_NAMES, ...inDate });
      const other = buildCert({ commonName: "xelulu-test-other", names: LOCAL_NAMES, ...inDate });
      return { ...c, ca: other.cert };
    }
    case "expired": {
      const c = buildCert({
        commonName: "xelulu-test-expired",
        names: LOCAL_NAMES,
        notBefore: now - 2 * DAY_MS,
        notAfter: now - DAY_MS,
      });
      return { ...c, ca: c.cert };
    }
    case "wrong_host": {
      const c = buildCert({
        commonName: WRONG_HOST_NAME,
        names: [{ dns: WRONG_HOST_NAME }],
        ...inDate,
      });
      return { ...c, ca: c.cert };
    }
  }
}

import { createHmac } from "crypto";

// Base32 alphabet defined in RFC 4648.
// Each character represents 5 bits. No digits 0, 1, 8, 9 — chosen to
// avoid visual confusion with O, I, B, g on small screens.
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

// Converts a base32 string (as found in otpauth:// URIs) into raw bytes.
// The authenticator app stores the secret in this form; we decode it
// before every HMAC computation.
export function base32Decode(input: string): Buffer {
  // Normalise: uppercase, strip padding and whitespace.
  const s = input.toUpperCase().replace(/=+$/, "").replace(/\s/g, "");

  let bits = 0;   // how many bits are sitting in the accumulator
  let value = 0;  // the accumulator
  const out: number[] = [];

  for (const char of s) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error(`Invalid base32 character: '${char}'`);

    // Shift the accumulator left by 5 and OR in the new 5-bit chunk.
    value = (value << 5) | idx;
    bits += 5;

    // Once we have at least 8 bits, peel off the top byte.
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(out);
}

// Converts raw bytes to a base32 string (used when building the
// otpauth:// URI for the QR code).
export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    // Drain 5 bits at a time into base32 characters.
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }

  // If bits aren't a multiple of 5, the remaining bits are left-padded
  // with zeros to form the last character.
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }

  // RFC 4648 requires padding to a multiple of 8 characters.
  while (out.length % 8 !== 0) out += "=";
  return out;
}

// Returns floor(unixTimeSeconds / 30) as an 8-byte big-endian Buffer.
//
// This "counter" is what HMAC is applied to. It advances by 1 every
// 30 seconds — two codes generated in the same 30-second window produce
// the same counter, and therefore the same TOTP code.
//
// Must be 8 bytes (RFC 4226 §5.2). BigInt handles timestamps beyond
// 2038 without overflow.
export function computeCounter(unixTimeSeconds: number): Buffer {
  const counter = BigInt(Math.floor(unixTimeSeconds / 30));
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(counter);
  return buf;
}

// HOTP (RFC 4226): the core one-time password algorithm.
//
// 1. HMAC-SHA1(secret, counter) → 20-byte digest
// 2. Dynamic truncation: offset = low 4 bits of last byte
//    → pick 4 bytes starting at offset
//    → mask top bit of first byte (ensures positive number)
// 3. code % 10^digits → zero-padded string
//
// `digits` defaults to 6 (production). Pass 8 to match the RFC 6238
// Appendix B test vectors, which use 8-digit codes.
export function hotp(
  secretBytes: Buffer,
  counter: Buffer,
  digits = 6,
): string {
  const hmac = createHmac("sha1", secretBytes).update(counter).digest();

  // offset is in [0, 15] — always a valid starting index for a 4-byte
  // window within the 20-byte HMAC output.
  const offset = hmac[hmac.length - 1] & 0x0f;

  // & 0x7f on the first byte masks the sign bit so the result is a
  // positive 31-bit integer regardless of the HMAC bytes.
  // & 0xff on the remaining bytes is a no-op for Buffer (values are
  // already 0–255) but matches the RFC reference implementation exactly.
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(code % Math.pow(10, digits)).padStart(digits, "0");
}

// TOTP (RFC 6238): time-based wrapper around HOTP.
// Converts the current wall-clock time into a counter, then delegates.
//
// `unixTimeSeconds` can be overridden in tests or when checking drift
// windows (T-1, T, T+1). Defaults to now.
export function totp(
  secretBytes: Buffer,
  unixTimeSeconds = Math.floor(Date.now() / 1000),
  digits = 6,
): string {
  return hotp(secretBytes, computeCounter(unixTimeSeconds), digits);
}

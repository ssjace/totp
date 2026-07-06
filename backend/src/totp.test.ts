import { describe, it, expect } from "vitest";
import {
  base32Decode,
  base32Encode,
  computeCounter,
  hotp,
  totp,
} from "./totp.js";

// ─── RFC 4226 / RFC 6238 shared test secret ───────────────────────────────
// Both RFCs use the ASCII bytes of "12345678901234567890" directly as the
// secret in their test vectors — NOT base32-encoded. We pass raw bytes
// straight to hotp/totp to match that.
const RFC_SECRET = Buffer.from("12345678901234567890", "ascii");

// ─── base32Decode / base32Encode ──────────────────────────────────────────
describe("base32Decode", () => {
  it("round-trips through encode → decode", () => {
    const original = Buffer.from([0x00, 0x11, 0x22, 0x33, 0x44, 0xff]);
    expect(base32Decode(base32Encode(original))).toEqual(original);
  });

  it("is case-insensitive and strips padding", () => {
    const bytes = Buffer.from("hello", "ascii");
    const upper = base32Encode(bytes);
    const lower = upper.toLowerCase();
    const noPad = upper.replace(/=+$/, "");
    expect(base32Decode(lower)).toEqual(bytes);
    expect(base32Decode(noPad)).toEqual(bytes);
  });

  it("throws on characters outside the base32 alphabet", () => {
    expect(() => base32Decode("INVALID!")).toThrow("Invalid base32 character");
  });
});

// ─── computeCounter ───────────────────────────────────────────────────────
describe("computeCounter", () => {
  it("returns an 8-byte Buffer", () => {
    expect(computeCounter(0).length).toBe(8);
  });

  // RFC 6238 §4.2 example: T=59 → counter=1 (floor(59/30) = 1)
  it("T=59 → counter 1", () => {
    expect(computeCounter(59).readBigUInt64BE()).toBe(1n);
  });

  // T=60 is the start of the NEXT window (floor(60/30) = 2).
  it("T=60 → counter 2 (new window)", () => {
    expect(computeCounter(60).readBigUInt64BE()).toBe(2n);
  });

  // Hex counter values from RFC 6238 Appendix B table.
  it("matches RFC 6238 Appendix B hex counter values", () => {
    expect(computeCounter(1111111109).readBigUInt64BE()).toBe(0x23523ECn);
    expect(computeCounter(1111111111).readBigUInt64BE()).toBe(0x23523EDn);
    expect(computeCounter(1234567890).readBigUInt64BE()).toBe(0x273EF07n);
    expect(computeCounter(2000000000).readBigUInt64BE()).toBe(0x3F940AAn);
    expect(computeCounter(20000000000).readBigUInt64BE()).toBe(0x27BC86AAn);
  });
});

// ─── HOTP — RFC 4226 Appendix D test vectors ──────────────────────────────
// Source: https://www.rfc-editor.org/rfc/rfc4226#appendix-D
// Secret: ASCII "12345678901234567890" | Digits: 6 | Counters 0–9
describe("hotp — RFC 4226 Appendix D vectors (6-digit)", () => {
  const vectors: [number, string][] = [
    [0, "755224"],
    [1, "287082"],
    [2, "359152"],
    [3, "969429"],
    [4, "338314"],
    [5, "254676"],
    [6, "287922"],
    [7, "162583"],
    [8, "399871"],
    [9, "520489"],
  ];

  for (const [counter, expected] of vectors) {
    it(`counter=${counter} → ${expected}`, () => {
      const buf = Buffer.alloc(8);
      buf.writeBigUInt64BE(BigInt(counter));
      expect(hotp(RFC_SECRET, buf)).toBe(expected);
    });
  }
});

// ─── TOTP — RFC 6238 Appendix B SHA-1 test vectors ────────────────────────
// Source: https://www.rfc-editor.org/rfc/rfc6238#appendix-B
// Secret: ASCII "12345678901234567890" | Digits: 8 | SHA-1
// The RFC specifies 8-digit codes; we pass digits=8 to match exactly.
// This proves our algorithm is correct — 6-digit production codes are
// just the last 6 of what you'd get with digits=6 (mod 1e6 vs mod 1e8).
describe("totp — RFC 6238 Appendix B SHA-1 vectors (8-digit)", () => {
  const vectors: [number, string][] = [
    [59,          "94287082"],
    [1111111109,  "07081804"],
    [1111111111,  "14050471"],
    [1234567890,  "89005924"],
    [2000000000,  "69279037"],
    [20000000000, "65353130"],
  ];

  for (const [timestamp, expected] of vectors) {
    it(`T=${timestamp} → ${expected}`, () => {
      expect(totp(RFC_SECRET, timestamp, 8)).toBe(expected);
    });
  }
});

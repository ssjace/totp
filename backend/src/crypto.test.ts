import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "./crypto.js";

// A real 32-byte key — fixed so tests are deterministic.
// Never use a hardcoded key outside of tests.
const KEY = Buffer.from(
  "0".repeat(64), // 64 hex zeros = 32 zero bytes
  "hex",
);

describe("encrypt / decrypt", () => {
  it("round-trips a plaintext string", () => {
    const enc = encrypt("hello TOTP world", KEY);
    expect(decrypt(enc, KEY)).toBe("hello TOTP world");
  });

  it("returns base64-encoded ciphertext, iv, and authTag", () => {
    const { ciphertext, iv, authTag } = encrypt("test", KEY);
    // base64 strings only contain these characters
    const b64 = /^[A-Za-z0-9+/]+=*$/;
    expect(ciphertext).toMatch(b64);
    expect(iv).toMatch(b64);
    expect(authTag).toMatch(b64);
  });

  it("generates a fresh IV on every call (never reuses)", () => {
    const a = encrypt("same plaintext", KEY);
    const b = encrypt("same plaintext", KEY);
    expect(a.iv).not.toBe(b.iv);
    // Different IVs → different ciphertexts even for same plaintext
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("throws when ciphertext is tampered with", () => {
    const enc = encrypt("secret", KEY);
    const buf = Buffer.from(enc.ciphertext, "base64");
    buf[0] ^= 0xff;
    expect(() =>
      decrypt({ ...enc, ciphertext: buf.toString("base64") }, KEY),
    ).toThrow();
  });

  it("throws when authTag is tampered with", () => {
    const enc = encrypt("secret", KEY);
    const buf = Buffer.from(enc.authTag, "base64");
    buf[0] ^= 0xff;
    expect(() =>
      decrypt({ ...enc, authTag: buf.toString("base64") }, KEY),
    ).toThrow();
  });

  it("throws when decrypting with the wrong key", () => {
    const enc = encrypt("secret", KEY);
    const wrongKey = Buffer.from("f".repeat(64), "hex");
    expect(() => decrypt(enc, wrongKey)).toThrow();
  });
});

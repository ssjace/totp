import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "crypto";

// AES-256-GCM needs a 32-byte key, a 12-byte IV (96 bits — the
// recommended GCM nonce size), and produces a 16-byte auth tag.
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

export interface Encrypted {
  ciphertext: string; // base64
  iv: string;         // base64, 12 bytes
  authTag: string;    // base64, 16 bytes
}

// key must be a 32-byte Buffer derived from ENCRYPTION_KEY.
// Callers: Buffer.from(process.env.ENCRYPTION_KEY, "hex")
export function encrypt(plaintext: string, key: Buffer): Encrypted {
  // A fresh random IV per encryption is mandatory in GCM.
  // Reusing an IV with the same key breaks confidentiality entirely.
  const iv = randomBytes(IV_BYTES);

  const cipher = createCipheriv(ALGORITHM, key, iv);

  // cipher.update() encrypts the data; cipher.final() flushes any
  // remaining buffered bytes (empty for a stream cipher like GCM, but
  // required by the API to move the cipher into its final state).
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  // getAuthTag() must be called after final(). It returns the 16-byte
  // tag GCM computed over the ciphertext; we need it to verify
  // integrity on decryption.
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

// Throws if the auth tag doesn't match — meaning the ciphertext was
// tampered with or the wrong key was used. Never silently returns
// garbage.
export function decrypt(
  { ciphertext, iv, authTag }: Encrypted,
  key: Buffer,
): string {
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(iv, "base64"),
  );

  // setAuthTag must be called before final(). GCM checks the tag
  // during final() and throws ERR_CRYPTO_INVALID_AUTH_TAG on mismatch.
  decipher.setAuthTag(Buffer.from(authTag, "base64"));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(), // throws here if auth tag doesn't match
  ]);

  return plaintext.toString("utf8");
}

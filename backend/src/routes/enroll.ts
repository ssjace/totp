import { Router } from "express";
import { randomBytes } from "crypto";
import QRCode from "qrcode";

import { query } from "../db.js";
import { encrypt, decrypt } from "../crypto.js";
import { base32Encode, base32Decode, totp } from "../totp.js";
import { getEncryptionKey } from "../config.js";

const router = Router();

// App name shown in the authenticator app UI (e.g. "TOTPDemo:alice").
const APP_NAME = "TOTPDemo";


// Username rules: 1–20 alphanumeric characters.
// The DB CHECK constraint enforces the same rule, but we check here too
// so we return a clean 400 rather than letting a Postgres error bubble up.
function isValidUsername(s: string): boolean {
  return /^[a-zA-Z0-9]{1,20}$/.test(s);
}

// POST /enroll
// Body: { username: string }
//
// 1. Validate username.
// 2. Generate 20 random bytes as the TOTP secret.
// 3. Base32-encode the secret for the otpauth:// URI.
// 4. Encrypt the base32 string (AES-256-GCM) and persist the three
//    ciphertext pieces — plaintext never touches the database.
// 5. Build the otpauth:// URI and turn it into a QR code data URL.
// 6. Return { username, uri, qr } — paste `qr` into a browser address
//    bar to view and scan the QR code.
//
// A username that already has a *confirmed* row is a real conflict (409).
// One that exists but was never confirmed just means someone started
// enrolling and never finished — we overwrite that row with a fresh secret
// and hand back a new QR, same as if it were brand new. The ON CONFLICT
// ... WHERE clause does the "is it confirmed" check atomically: if the
// existing row is confirmed, the WHERE fails, no row is written, and
// RETURNING comes back empty.
router.post("/enroll", async (req, res) => {
  // req.body is `any` from Express; pull fields out as unknown so TypeScript
  // forces us to check the types before using them.
  const username: unknown = req.body?.username;

  if (typeof username !== "string" || !isValidUsername(username)) {
    res.status(400).json({ error: "username must be 1–20 alphanumeric characters" });
    return;
  }

  const key = getEncryptionKey();

  // 20 bytes = 160 bits of entropy — standard TOTP secret size.
  const secretBytes = randomBytes(20);
  const base32Secret = base32Encode(secretBytes);

  // We store the base32 string encrypted. On /confirm we decrypt to get
  // the string back, then base32Decode() gives the raw bytes for TOTP.
  const { ciphertext, iv, authTag } = encrypt(base32Secret, key);

  try {
    const { rowCount } = await query(
      `INSERT INTO users (username, encrypted_secret, iv, auth_tag)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (username) DO UPDATE
         SET encrypted_secret = EXCLUDED.encrypted_secret,
             iv = EXCLUDED.iv,
             auth_tag = EXCLUDED.auth_tag
         WHERE users.confirmed = false`,
      [username, ciphertext, iv, authTag],
    );
    if (rowCount === 0) {
      res.status(409).json({ error: "username already taken" });
      return;
    }
  } catch (err: unknown) {
    console.error("[enroll] db insert failed:", err);
    res.status(500).json({ error: "internal server error" });
    return;
  }

  // Standard otpauth:// URI format — all authenticator apps accept this.
  // The label ("TOTPDemo:alice") is what shows in the app's account list.
  const uri =
    `otpauth://totp/${APP_NAME}:${username}` +
    `?secret=${base32Secret}` +
    `&issuer=${APP_NAME}` +
    `&algorithm=SHA1` +
    `&digits=6` +
    `&period=30`;

  // toDataURL returns a data:image/png;base64,... string.
  // Paste it directly into a browser address bar to view/scan.
  const qr = await QRCode.toDataURL(uri);

  res.status(201).json({ username, uri, qr });
});

// POST /enroll/confirm
// Body: { username: string, code: string }
//
// 1. Fetch the user row.
// 2. Decrypt the stored secret → base32 → raw bytes.
// 3. Compute totp() for the current window and the previous one.
//    A ±30-second tolerance is conventional: it covers the few seconds
//    that pass while the user reads the code and hits submit.
// 4. On match, set confirmed = true.
router.post("/enroll/confirm", async (req, res) => {
  const username: unknown = req.body?.username;
  const code: unknown = req.body?.code;

  if (typeof username !== "string" || !username) {
    res.status(400).json({ error: "username is required" });
    return;
  }

  if (typeof code !== "string" || !code) {
    res.status(400).json({ error: "code is required" });
    return;
  }

  const key = getEncryptionKey();

  // Row type matches exactly what the SELECT returns — narrowed at the
  // query call site so TypeScript knows the shape without any cast.
  const { rows } = await query<{
    encrypted_secret: string;
    iv: string;
    auth_tag: string;
    confirmed: boolean;
  }>(
    `SELECT encrypted_secret, iv, auth_tag, confirmed
     FROM users WHERE username = $1`,
    [username],
  );

  if (rows.length === 0) {
    res.status(404).json({ error: "user not found" });
    return;
  }

  const user = rows[0];

  if (user.confirmed) {
    res.status(400).json({ error: "user is already enrolled" });
    return;
  }

  // Decrypt the stored base32 secret, decode to raw bytes for TOTP.
  // decrypt() throws if the auth tag doesn't match (tampered data or
  // wrong key) — we surface that as a 500, not a 401.
  let secretBytes: Buffer;
  try {
    const base32Secret = decrypt(
      {
        ciphertext: user.encrypted_secret,
        iv: user.iv,
        authTag: user.auth_tag,
      },
      key,
    );
    secretBytes = base32Decode(base32Secret);
  } catch (err: unknown) {
    console.error("[enroll/confirm] decrypt failed:", err);
    res.status(500).json({ error: "internal server error" });
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const expected = totp(secretBytes, now);
  const expectedPrev = totp(secretBytes, now - 30);

  if (code !== expected && code !== expectedPrev) {
    res.status(401).json({ error: "invalid code" });
    return;
  }

  await query(
    `UPDATE users SET confirmed = true WHERE username = $1`,
    [username],
  );

  res.json({ ok: true });
});

export default router;

import { Router } from "express";

import { query } from "../db.js";
import { decrypt } from "../crypto.js";
import { base32Decode, totp } from "../totp.js";
import { getEncryptionKey } from "../config.js";

const router = Router();

router.post("/login/verify", async (req, res) => {
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

  if (!rows[0].confirmed) {
    res.status(403).json({ error: "enrollment not confirmed" });
    return;
  }

  let secretBytes: Buffer;
  try {
    const base32Secret = decrypt(
      {
        ciphertext: rows[0].encrypted_secret,
        iv: rows[0].iv,
        authTag: rows[0].auth_tag,
      },
      key,
    );
    secretBytes = base32Decode(base32Secret);
  } catch (err: unknown) {
    console.error("[login/verify] decrypt failed:", err);
    res.status(500).json({ error: "internal server error" });
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  // T-1/T/T+1: one window either side covers ±30s clock skew and network latency.
  const valid = [now - 30, now, now + 30].some(t => totp(secretBytes, t) === code);

  if (!valid) {
    res.status(401).json({ error: "invalid code" });
    return;
  }

  res.json({ ok: true });
});

export default router;

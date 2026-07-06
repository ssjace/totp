import { Router } from "express";

import { query } from "../db.js";
import { decrypt } from "../crypto.js";
import { base32Decode, totp } from "../totp.js";
import { getEncryptionKey } from "../config.js";
import redis from "../redis.js";

const router = Router();

const FAIL_LIMIT = 5;
const FAIL_TTL_SECS = 300; // ~5 min

// A counter is valid across up to 3 windows (T-1, T, T+1), a 90s span.
// The replay key must outlive that span so a used code can't be submitted
// again before it rotates out of all valid windows.
const REPLAY_TTL_SECS = 90;

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

  // Rate-limit check — before any DB or crypto work.
  const failCount = Number(await redis.get(`fail:${username}`) ?? 0);
  if (failCount >= FAIL_LIMIT) {
    const retryAfter = await redis.ttl(`fail:${username}`);
    res.status(429).json({ error: "too many attempts", retryAfter });
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
  const windows = [now - 30, now, now + 30];
  const matchedAt = windows.find(t => totp(secretBytes, t) === code);

  // Increment the failure counter and return the remaining attempts.
  // Sets TTL only on the first failure so subsequent increments don't
  // reset the expiry window.
  async function recordFailure(): Promise<number> {
    const next = await redis.incr(`fail:${username}`);
    if (next === 1) await redis.expire(`fail:${username}`, FAIL_TTL_SECS);
    return Math.max(0, FAIL_LIMIT - next);
  }

  if (matchedAt === undefined) {
    const attemptsRemaining = await recordFailure();
    res.status(401).json({ error: "invalid code", attemptsRemaining });
    return;
  }

  // Each window's counter is floor(t/30). Keyed by counter so one used
  // code can't be submitted again while it's still in any valid window.
  const counter = Math.floor(matchedAt / 30);
  const replayKey = `used:${username}:${counter}`;

  if (await redis.get(replayKey)) {
    const attemptsRemaining = await recordFailure();
    res.status(401).json({ error: "code already used", attemptsRemaining });
    return;
  }

  await redis.set(replayKey, "1", "EX", REPLAY_TTL_SECS);
  await redis.del(`fail:${username}`);

  res.json({ ok: true });
});

export default router;

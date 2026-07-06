-- Users table for TOTP authentication.
-- Apply with: psql $DATABASE_URL -f backend/db/schema.sql

CREATE TABLE IF NOT EXISTS users (
  -- Auto-incrementing surrogate key. BIGSERIAL avoids int overflow at scale.
  id               BIGSERIAL PRIMARY KEY,

  -- The identifier the user logs in with. Unique index enforced by the constraint.
  username         TEXT NOT NULL UNIQUE,

  -- AES-256-GCM ciphertext of the raw TOTP secret bytes (base64-encoded).
  -- The plaintext secret is never stored.
  encrypted_secret TEXT NOT NULL,

  -- GCM initialisation vector (base64-encoded, 12 bytes / 96 bits).
  -- Must be unique per encryption; stored alongside the ciphertext so the
  -- server can decrypt later.
  iv               TEXT NOT NULL,

  -- GCM authentication tag (base64-encoded, 16 bytes / 128 bits).
  -- Verifies the ciphertext was not tampered with during decryption.
  auth_tag         TEXT NOT NULL,

  -- False until the user completes the enrollment confirmation step
  -- (proves they scanned the QR code by submitting a valid code).
  confirmed        BOOLEAN NOT NULL DEFAULT FALSE,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

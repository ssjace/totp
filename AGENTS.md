# AGENTS.md

Rules for agents in this repo.

## What this is

TOTP (RFC 6238) authentication demo. Monorepo, npm workspaces. Local-only — Docker Compose for Postgres + Redis, no cloud deploy.

## Stack

- `totp/backend` — Node + TypeScript + Express. Raw `pg` driver, no ORM. Raw SQL in `totp/backend/db/`, applied manually — no migration framework at this scope.
- `totp/frontend` — Vite + React + TypeScript.
- Redis via `ioredis` (local dev — real persistent connection, not REST).
- TOTP (RFC 6238) hand-rolled from spec: base32 decode, HMAC-SHA1, dynamic truncation, mod 1e6. No `otplib` unless the roadmap phase explicitly says to swap in a library.

## Commands

```
docker compose up -d           # start Postgres + Redis
docker compose down            # stop them
npm run dev -w totp/backend    # backend dev server
npm run dev -w totp/frontend   # frontend dev server
npm run build                  # build all workspaces
npm run lint                   # eslint, all workspaces
npm test                       # vitest
psql $DATABASE_URL -f totp/backend/db/schema.sql   # apply schema
```

Verify against actual `package.json` scripts if these drift — don't assume.

## Working process (read before writing code)

- Only implement the phase currently being worked on — do not pre-build later phases even if convenient, and do not skip a phase's "verify before moving on" step.
- State which phase you're implementing before writing code for it.
- Explain non-obvious lines rather than silently generating large blocks — the human is learning Postgres, Redis, and TOTP for the first time and needs to be able to explain every part of this project.
- Prefer small diffs over rewrites. If a function already exists and works, don't restructure it unless asked.
- When stuck or ambiguous, ask rather than guessing — this project favors correctness and understanding over speed.

## Database

- Schema: `totp/backend/db/schema.sql`. `users` table: `id`, `username` (unique), `encrypted_secret`, `iv`, `auth_tag`, `confirmed`, `created_at`.
- TOTP secret is AES-256-GCM encrypted at rest — plaintext secret must never be written to the DB, logs, or committed files. Key comes from `.env` (`ENCRYPTION_KEY`), never hardcoded.
- Redis keys: `used:{username}:{counter}` (replay protection, TTL ~30s), `fail:{username}` (rate limit counter, TTL ~5min).

## Flow — quick reference (for me)

**Enrollment (once per username)**
1. User submits a username
2. Server generates a random secret, encrypts it, saves a row (`confirmed: false`)
3. Server returns a QR code encoding `otpauth://totp/...`
4. User scans it with an authenticator app — secret now lives on both sides
5. User types the current code shown in the app, to prove the scan worked
6. Server decrypts the secret, computes the expected code, compares → marks `confirmed: true`

**Login (every time after)**
1. User enters their username, presses "Login"
2. Server looks up that username's row → gets the encrypted secret
3. User reads the current code off their authenticator app, types it in
4. Server decrypts the secret, computes the expected code for `T-1, T, T+1` (drift tolerance window)
5. Match → login succeeds. No match → fail.
6. Redis checks alongside step 4: reject if this code's time-window was already used (replay protection); reject if there have been too many recent failed attempts (rate limiting)

**Why encryption, not hashing, for the secret:** the server needs the real secret back every login to recompute the code — hashing is one-way and would make that impossible. Security comes from keeping the encryption key separate from the database, not from the ciphertext being unbreakable.

**Why the counter, not the code, identifies a Redis window:** `counter = floor(unix_time / 30)` identifies *which 30-second bucket* a code belongs to — that's what replay protection keys off, not the 6 digits themselves.

## Frontend / design

- shadcn/ui + Tailwind only. No raw `.css` files, no other component/design libraries, no custom design system.
- Icons: `lucide-react` (shadcn default).
- Minimal UI — this project demonstrates backend concepts, not visual design.

## Git

- No direct commits to `main`; branch per unit of work (`feat/`, `fix/`, `chore/`, `docs/`).
- Conventional Commits format for messages.
- Once work on a branch is done, **the agent must open the PR** using the `gh` CLI — never leave it for the human. Use `gh pr create --title "..." --body "..."`. Follow the same conventional commits format for the title; body must include what changed and how to test (and screenshots if UI changed).
- Don't delete branches after merge.

## Code quality

- No empty `catch` blocks — always at least `console.error`.

```ts
} catch (err) {
  console.error('[context] failed:', err)
}
```

- Colocate tests: `foo.ts` + `foo.test.ts`. The TOTP functions must have tests asserting against RFC 6238's official test vectors, not just internal self-consistency.
- Lint + relevant tests pass before commit; scope runs to changed files (`npx eslint <file>`, `npx vitest run <file>`) rather than the full suite unless the change is broad.

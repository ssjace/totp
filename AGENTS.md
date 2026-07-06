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

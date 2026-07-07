# TOTP Auth Demo

A hand-rolled [RFC 6238](https://datatracker.ietf.org/doc/html/rfc6238) TOTP implementation — enrollment, QR code generation, and login — built to be read and understood, not copied into production.

> **Local-only.** Runs entirely on your machine via Docker Compose. Nothing is deployed to the cloud.

[![TOTP demo video](https://ssjace.github.io/assets/totp-poster.jpg)](https://ssjace.github.io/assets/totp-demo.mp4)

---

## Prerequisites

| Tool   | Minimum version |
|--------|-----------------|
| Docker | 24              |
| Node   | 20              |
| npm    | 10              |

---

## Getting started

### 1. Clone and install

```bash
git clone <repo-url>
cd totp
npm install
```

### 2. Start Postgres and Redis

```bash
docker compose up -d
```

Postgres is available at `localhost:5432`, Redis at `localhost:6379`.

### 3. Configure environment

```bash
cp backend/.env.example backend/.env
```

Open `backend/.env` and fill in each value (see [Environment variables](#environment-variables) below). The critical one is `ENCRYPTION_KEY` — generate it with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 4. Apply the database schema

```bash
psql $DATABASE_URL -f backend/db/schema.sql
```

Or substitute the connection string directly:

```bash
psql postgresql://totp:totppass@localhost:5432/totp -f backend/db/schema.sql
```

### 5. Start the servers

In two separate terminals:

```bash
# Terminal 1 — API server (port 3001)
npm run dev:backend

# Terminal 2 — Frontend dev server (port 5173, proxies /enroll and /login to :3001)
npm run dev:frontend
```

Open [http://localhost:5173](http://localhost:5173) and scan the QR code with any TOTP authenticator (Google Authenticator, Authy, 1Password, etc.).

---

## Development

### Run tests

```bash
# All tests
npm test

# Scoped to one file
npx vitest run backend/src/totp.test.ts
npx vitest run backend/src/crypto.test.ts
```

The TOTP tests assert against the [RFC 6238 Appendix B](https://datatracker.ietf.org/doc/html/rfc6238#appendix-B) official test vectors — not just internal self-consistency.

### Lint

```bash
# Frontend (oxlint)
npm run lint --workspace=frontend

# Scoped to a file
npx oxlint frontend/src/App.tsx
```

### Build

```bash
npm run build
```

---

## Tech stack

| Layer      | Technology                                        |
|------------|---------------------------------------------------|
| Frontend   | React 19 · TypeScript · Vite · shadcn/ui · Tailwind CSS |
| Backend    | Node · Express · TypeScript · `tsx` (dev)         |
| Database   | Postgres 16 · raw `pg` driver · no ORM            |
| Cache      | Redis 7 · `ioredis`                               |
| Crypto     | Node `crypto` — AES-256-GCM, HMAC-SHA1 (TOTP)    |
| Infra      | Docker Compose (local only)                       |

---

## How it works

### System topology

```mermaid
graph LR
    Browser["Browser\n:5173"] -->|Vite proxy| Backend["Express API\n:3001"]
    Backend --> Postgres["Postgres 16\n:5432"]
    Backend --> Redis["Redis 7\n:6379"]
```

### Enrollment flow

```mermaid
sequenceDiagram
    participant U as User
    participant F as Frontend
    participant B as Backend
    participant DB as Postgres
    participant A as Authenticator App

    U->>F: Enter username
    F->>B: POST /enroll { username }
    B->>B: Generate 20 random bytes (secret)
    B->>B: Base32-encode, AES-256-GCM encrypt
    B->>DB: INSERT encrypted_secret, iv, auth_tag (confirmed=false)
    B->>F: { qr: data URI }
    F->>U: Display QR code
    U->>A: Scan QR code
    Note over A: Secret now lives on both sides
    U->>F: Type 6-digit code shown in app
    F->>B: POST /enroll/confirm { username, code }
    B->>DB: Fetch row, decrypt secret
    B->>B: Compute TOTP for T and T-1
    B->>DB: UPDATE confirmed = true
    B->>F: { ok: true }
```

### Login flow

```mermaid
sequenceDiagram
    participant U as User
    participant F as Frontend
    participant B as Backend
    participant DB as Postgres
    participant R as Redis

    U->>F: Enter username + current code
    F->>B: POST /login/verify { username, code }
    B->>R: GET fail:{username} — check rate limit
    Note over B,R: Reject after 5 failed attempts in 5 min
    B->>DB: Fetch encrypted row → decrypt secret
    B->>B: Compute TOTP for T-1, T, T+1
    alt No match
        B->>R: INCR fail:{username} (TTL 5 min)
        B->>F: 401 Unauthorized
    else Match found
        B->>R: GET used:{username}:{counter}
        Note over B,R: Reject if this time-window already used
        B->>R: SET used:{username}:{counter} EX 90
        B->>R: DEL fail:{username}
        B->>F: { ok: true }
    end
```

---

## Environment variables

All variables live in `backend/.env` (copy from `backend/.env.example`).

| Variable         | Description                                                                 |
|------------------|-----------------------------------------------------------------------------|
| `DATABASE_URL`   | Postgres connection string, e.g. `postgresql://totp:totppass@localhost:5432/totp` |
| `REDIS_URL`      | Redis connection string, e.g. `redis://localhost:6379`                      |
| `ENCRYPTION_KEY` | 32 random bytes as 64 hex chars — used for AES-256-GCM encryption of TOTP secrets |
| `PORT`           | Port the Express server listens on (default `3001`)                         |

---

## API reference

All endpoints accept and return JSON. The Vite dev server proxies `/enroll` and `/login` to the backend so the frontend never needs cross-origin requests.

### `POST /enroll`

Start enrollment for a new username.

**Request**
```json
{ "username": "alice" }
```

**Response `200`**
```json
{
  "username": "alice",
  "uri": "otpauth://totp/TOTPDemo:alice?secret=...&issuer=TOTPDemo",
  "qr": "data:image/png;base64,..."
}
```

**Errors** — `400` invalid/missing username · `409` username already enrolled

---

### `POST /enroll/confirm`

Confirm enrollment by submitting the first code from the authenticator app. Sets `confirmed = true`.

**Request**
```json
{ "username": "alice", "code": "123456" }
```

**Response `200`**
```json
{ "ok": true }
```

**Errors** — `400` invalid input · `404` user not found or already confirmed · `401` wrong code

---

### `POST /login/verify`

Verify a TOTP code. Checks the T-1/T/T+1 windows, replay protection, and rate limiting.

**Request**
```json
{ "username": "alice", "code": "123456" }
```

**Response `200`**
```json
{ "ok": true }
```

**Errors** — `400` invalid input · `401` wrong code (includes remaining attempts) · `429` rate limit exceeded · `404` user not found

---

### `GET /health`

```json
{ "status": "ok" }
```

---

## Project layout

```
totp/
├── backend/
│   ├── db/
│   │   └── schema.sql          # DDL — apply manually with psql
│   ├── src/
│   │   ├── index.ts            # Express server entry point
│   │   ├── config.ts           # Env var validation
│   │   ├── db.ts               # pg pool wrapper
│   │   ├── redis.ts            # ioredis client
│   │   ├── crypto.ts           # AES-256-GCM encrypt/decrypt
│   │   ├── crypto.test.ts
│   │   ├── totp.ts             # RFC 6238 implementation (base32, HMAC-SHA1, truncation)
│   │   ├── totp.test.ts        # Validated against RFC 6238 official test vectors
│   │   └── routes/
│   │       ├── enroll.ts       # POST /enroll, POST /enroll/confirm
│   │       └── login.ts        # POST /login/verify
│   ├── .env.example
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.tsx             # Single-page UI (enroll + login)
│   │   └── components/ui/      # shadcn/ui components
│   ├── vite.config.ts          # Proxy config
│   └── package.json
├── docker-compose.yml          # Postgres 16 + Redis 7
└── package.json                # npm workspaces root
```

---

## Security model

| Concern           | Mechanism                                                                                                |
|-------------------|----------------------------------------------------------------------------------------------------------|
| Secret storage    | TOTP secret encrypted with AES-256-GCM before hitting the DB. Only the ciphertext, IV, and auth tag are persisted — plaintext never touches disk or logs. |
| Key separation    | `ENCRYPTION_KEY` lives in `.env`, separate from the database. Compromise of the DB alone is not sufficient to recover secrets. |
| Replay protection | On successful login, `used:{username}:{counter}` is set in Redis with a 90-second TTL. The same time-window counter can't be reused within that span. |
| Rate limiting     | `fail:{username}` counts consecutive failures (TTL 5 min). After 5 failures the endpoint returns `429`. Cleared on success. |
| Drift tolerance   | Login accepts codes from the T-1, T, and T+1 windows (±30 seconds) to accommodate clock skew between server and device. |

---

## Git workflow

- Branch per unit of work: `feat/`, `fix/`, `chore/`, `docs/`
- [Conventional Commits](https://www.conventionalcommits.org/) for all commit messages and PR titles
- PRs opened via `gh pr create` — never left for a manual step
- `main` is protected — no direct commits

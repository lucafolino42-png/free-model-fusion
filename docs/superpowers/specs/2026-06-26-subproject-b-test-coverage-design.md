# Sub-project B — Test Coverage Expansion (Design Spec)

**Date:** 2026-06-26
**Status:** Approved (decomposed program; user delegated decisions)
**Parent program:** Free Model Fusion full overhaul — A→F, sequential
**Depends on:** Sub-project A (merged to `master`)

## Goal

Raise test coverage from pure-logic-only (87 tests) to cover the DB-backed
core (sessions/messages, provider registry, credential encryption round-trip)
and the security-critical utilities (SSRF validation, API-key sanitization),
plus a handful of HTTP routes via Fastify's in-process `inject()`. This
unlocks safe refactoring in Sub-project C (which restructures the 927-line
`commandsHandler` and 560-line `routes`) by giving it a regression net.

## Approach

**Hermetic in-memory DB suite.** A new `vitest.config.ts` declares a
`setupFiles` entry (`tests/setup.ts`) that sets a deterministic environment
*before any source module loads*: `DATABASE_URL=:memory:`, a 32-char
`FUSION_SECRET_KEY`, `NODE_ENV=test`, and controlled provider env keys. Because
`dotenv.config()` (in `config.ts`) does not override existing env vars, the
setup values win — tests are independent of the developer's real `.env`.

libsql's `:memory:` creates one in-memory DB per `createClient` call; since
`src/db/client.ts` builds a single shared client at module load and Vitest
isolates modules per test file, each test file gets its own fresh in-memory DB.
Files that need tables call `initializeDatabase()` in `beforeAll`.

HTTP routes are tested with Fastify's `fastify.inject({ method, url, payload })`
— in-process, no port binding. `createServer()` returns the `fastify` instance
and calls `initializeDatabase()` itself, so route tests call `createServer()`
once per file and `fastify.close()` in `afterAll`.

## Scope (in)

New test files:
1. `tests/validateUrl.test.ts` (pure) — `validateProviderUrl` rejects http
   scheme, private IPv4 ranges, `localhost`, raw IP, `.internal`/`.local`
   hostnames, too-short hostnames; accepts valid public https URLs.
   `sanitizeErrorMessage` redacts `sk-…`, `gsk_…`, `Bearer …`, `AIza…`.
2. `tests/crypto.test.ts` (pure-ish) — `encrypt`→`decrypt` round-trip returns
   the original; same plaintext yields different ciphertext (IV randomness);
   tampered ciphertext throws. (Reuses the test secret key from setup.)
3. `tests/memory.test.ts` (DB) — `getOrCreateSession` creates then reloads with
   defaults; second call returns `isNew:false`; `saveMessage`+`getSessionMessages`
   respects `limit` and `maxChars`; `clearSessionMemory` empties messages;
   `updateSessionSettings` persists profile/webMode.
4. `tests/registryDb.test.ts` (DB) — `addCustomProvider` then `getAllProviders`
   includes it; `setProviderEnabled` on a **preset** upserts an override and
   `getAllProviders` reflects the new enabled state (the A fix, now guarded);
   `setProviderEnabled` on custom provider updates its row; `deleteCustomProvider`;
   `findProviderByAlias`.
5. `tests/credentialsDb.test.ts` (DB) — `saveCredential`+`getCredential`
   round-trip (decrypts correctly); env-var priority over DB; `deleteCredential`;
   `listCredentials` returns masked keys with correct `source`.
6. `tests/routes.test.ts` (HTTP inject) — `GET /health` → 200; `GET /providers`
   → 200 with a `providers` array containing presets; `PATCH /providers/:id/toggle`
   on a preset → 200 `{"success":true,...}` (the A fix, guarded at the HTTP
   layer) and a second `GET /providers` reflects the override; `GET /` (UI) → 200.

## Scope (out — deferred / noted as gaps)

- Full `POST /chat` integration with mocked provider responses (needs a
  `fetch` mock harness; larger effort, noted for a future pass).
- Telegram bot/webhook tests (require token wiring; low ROI for a self-hosted
  tool).
- These are recorded as remaining coverage gaps, not silently skipped.

## Non-negotiables honored
- No `any` in new test code (typed where practical; vitest inject payloads
  typed via the route schemas).
- Hermetic: tests must pass with no `.env` present and with a real `.env`
  present (setup overrides).
- Existing 87 tests stay green.
- `tsc --noEmit` stays clean (test files are excluded from tsconfig, but new
  `vitest.config.ts` must not break the build).

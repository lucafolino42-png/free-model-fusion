# Sub-project A — Reliability & Correctness (Design Spec)

**Date:** 2026-06-26
**Status:** Approved (approaches + key decisions confirmed)
**Parent program:** Free Model Fusion full overhaul — A→F, approved at each boundary
**Approach:** Test-first, smallest surface (Approach 1)

## Goal

Make every chat request work when valid API keys are set. Fix dead/broken
features, stale model IDs, generic error messages, and a secret-leak risk —
done test-first so nothing regresses. This is the foundation: the "beat
OpenRouter" UX work (Sub-project D) is moot if chat is broken.

## Scope

In scope (correctness fixes only):

1. Model ID freshness (`src/providers/presets.ts`)
2. Actionable "all models failed" error messages (`src/fusion/commandsHandler.ts`)
3. Preset-provider toggle bug (`src/providers/registry.ts`, `src/db/schema.ts`, `src/db/client.ts`, `src/api/routes.ts`)
4. Secret-key & env-file leak hardening (`.gitignore`, `.env.example`, `src/index.ts`)
5. N+1 query amplification in `selectExperts` + `pickBestForRole` mutation bug (`src/fusion/routing.ts`, `src/providers/registry.ts`)

Out of scope (later sub-projects):

- Splitting `commandsHandler.ts` (902 lines) / `routes.ts` → Sub-project C
- UI redesign, mobile, accessibility → Sub-project D
- Rate-limiting / input-validation hardening → Sub-project E
- README / JSDoc cleanup → Sub-project F

## Approach

**Approach 1 — Test-first, smallest surface (chosen).** Write a failing test
for each bug, then fix it. Each fix is an isolated, reviewable change. Touches
only the files needed for correctness. Lowest regression risk.

Rejected alternatives:

- *Approach 2 (fix-then-test):* faster to "done" but bugs hide behind each
  other; a green suite at the end proves less than red→green along the way.
- *Approach 3 (bundle into the big refactor C):* mixing correctness fixes with
  a structural refactor makes it impossible to tell which change broke what,
  and violates rule 10 ("prioritize correctness over refactoring").

---

## Section 1 — Model ID freshness

### Problem
`src/providers/presets.ts` ships deprecated/dead Groq model IDs:
`llama3-8b-8192`, `llama3-70b-8192`, `mixtral-8x7b-32768`,
`llama-3.2-90b-vision-preview`. Any chat routed to them fails.

### Verified replacements (checked against Groq live docs 2026-06-26)

| Old (dead/deprecated)        | New                                              | Status                  |
|------------------------------|--------------------------------------------------|-------------------------|
| `llama3-8b-8192`             | `llama-3.1-8b-instant`                           | Production, 131K ctx    |
| `llama3-70b-8192`            | `llama-3.3-70b-versatile`                        | Production, 131K ctx    |
| `mixtral-8x7b-32768`         | `openai/gpt-oss-120b`                            | Production, 131K ctx    |
| `llama-3.2-90b-vision-preview` | `meta-llama/llama-4-scout-17b-16e-instruct`     | Preview, 131K ctx, multimodal |

**Decision (confirmed):** the old `groq_mixtral` entry becomes
`openai/gpt-oss-120b`. Groq retired Mixtral entirely; `gpt-oss-120b` is Groq's
current large production MoE-style model.

### Additional work
- Re-verify every other provider's model IDs (OpenRouter, Gemini, Together,
  Fireworks, DeepInfra, Perplexity, Cerebras) against current provider docs and
  update any that have drifted.
- `maxOutputTokens` caps remain unchanged (they are request limits, not context
  windows).
- Add a regression test asserting no preset contains a known-dead model ID.

### Files changed
- `src/providers/presets.ts`
- `tests/` (new preset-liveness test)

---

## Section 2 — Actionable error messages

### Problem
`src/fusion/commandsHandler.ts:177` returns a generic "All AI models failed to
respond" string that ignores the `responseErrors` array (which already carries
`provider`, `model`, `error` per failure). The user can't tell *which* provider
failed or *why*.

### Fix
When all experts fail, build the answer from `responseErrors`:

```
None of the available AI models responded successfully:

• Groq (llama-3.3-70b-versatile): Provider Groq Cloud returned 401: Invalid API key
• Gemini (gemini-2.0-flash): Request to Gemini (gemini-2.0-flash) failed: aborted

What to try:
- Verify your API keys with /listkeys
- Enable more providers with /providers
```

Separate the two distinct failure modes:

1. **"None configured"** — `routing.experts` is empty because no provider has a
   credential. Distinct message directing the user to add a key.
2. **"All configured experts errored"** — experts existed but every call failed.
   Use the enumerated message above.

All error strings remain sanitized via the existing `sanitizeErrorMessage`
(`src/utils/validateUrl.ts`) so API keys cannot leak into user-facing text.

### Files changed
- `src/fusion/commandsHandler.ts` (the `handleChatMessage` all-failed branch)
- `tests/` (new tests for both failure modes)

---

## Section 3 — Preset-provider toggle bug

### Problem
`setProviderEnabled()` in `src/providers/registry.ts` only updates the
`custom_providers` table. `PATCH /providers/:id/toggle` therefore returns 404
for all 16 built-in presets — the UI's toggle is broken for every built-in
provider.

### Fix
Introduce a `provider_overrides` table that stores `enabled` overrides keyed by
provider id. Presets stay immutable (good); `enabled` becomes "preset default
unless an override row exists."

**Decision (confirmed):** new `provider_overrides` table (clean, queryable,
type-safe via drizzle), over reusing the untyped `settings` table.

### Schema

```ts
// src/db/schema.ts
export const providerOverrides = sqliteTable('provider_overrides', {
  providerId: text('provider_id').primaryKey(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});
export type ProviderOverride = typeof providerOverrides.$inferSelect;
export type NewProviderOverride = typeof providerOverrides.$inferInsert;
```

Corresponding `CREATE TABLE IF NOT EXISTS` in `src/db/client.ts:initializeDatabase()`.

### Behavior changes
- `setProviderEnabled(id, enabled)`:
  - If `id` is a custom provider → update `custom_providers` (existing path).
  - If `id` is a preset → upsert into `provider_overrides`.
  - Returns `true` in both cases; `false` only if the id matches neither.
- `getAllProviders()` / `getEnabledProviders()`: overlay `provider_overrides`
  on preset defaults when computing `enabled`.
- `PATCH /providers/:id/toggle` no longer 404s for built-ins.

### Files changed
- `src/db/schema.ts` (new table + types)
- `src/db/client.ts` (create-table statement)
- `src/providers/registry.ts` (`setProviderEnabled`, `getAllProviders`/`getEnabledProviders` overlay)
- `tests/` (toggle persists + survives reload for a preset)

---

## Section 4 — Secret-key & env-file leak hardening

### Problem
- `.gitignore` ignores `.env` but **not** `.env.backup` / `.env.tmp`, both of
  which exist in the repo root and contain real secrets. Active leak risk.
- `.env.example` ships `FUSION_SECRET_KEY=replace-with-long-random-secret-at-least-32-chars`
  — a human-readable sentence that *passes* the ≥32-char length check in
  `crypto.ts:getKey()` but is a known public value if deployed verbatim.
- `index.ts:checkSecretKey()` only *warns* in production when the key is
  missing, which is misleading: the real guard is in `crypto.ts:getKey()`,
  which throws `ConfigurationError`. The two are inconsistent.

### Fix
- `.gitignore`: add `.env.*` (covers `.env.backup`, `.env.tmp`) while keeping
  `.env.example` tracked via an exception (`!.env.example`).
- `.env.example`: set `FUSION_SECRET_KEY=` (empty) with a comment instructing
  `openssl rand -hex 32`. Empty fails the length check loudly rather than
  silently using a public string.
- `src/index.ts:checkSecretKey()`: align with `crypto.ts` — in production with
  no/short key, log an error (not a warning) stating that encryption will fail
  on first use. Keep the dev fallback behavior as-is.
- Note in the change log: delete local `.env.backup` / `.env.tmp` (not tracked;
  this is not a git repo so no history cleanup needed).

### Files changed
- `.gitignore`
- `.env.example`
- `src/index.ts`
- `tests/` (`.gitignore` covers `.env.*` but not `.env.example`)

---

## Section 5 — N+1 query amplification & sort mutation

### Problem
- `selectExperts()` (`src/fusion/routing.ts`) calls `getModelsByRole()` 3×
  (expert / judge / synthesis). Each call runs `getEnabledModels()` →
  `getAllModels()` → `getAllProviders()` + a credentials query = **6+ DB
  round-trips per chat request**.
- `pickBestForRole()` mutates its input array via in-place `.sort()`. Latent
  bug: the passed array is the live `availableJudges`/`availableSynthesis`.

### Fix
- `selectExperts()`: call `getEnabledModels()` **once**, then filter by `useAs`
  and `hasCredential` in-memory for each role. One query instead of three.
- `pickBestForRole()`: sort a copy (`[...models].sort(...)`) so the caller's
  array is not mutated.
- Also remove the dead redundant lookup in `getProviderById()`
  (`registry.ts:70-73` — the second `aliases.includes` branch can never add a
  match the first `find` missed).

### Files changed
- `src/fusion/routing.ts`
- `src/providers/registry.ts` (`getProviderById` cleanup)
- `tests/` (single-query behavior via a spy/mock on the registry; non-mutation
  of input arrays in `pickBestForRole`)

---

## Testing plan (TDD)

For every fix above: write the failing test first, watch it fail, then
implement until green. New tests:

1. `presets.test.ts` — no preset `model` string is in the known-dead set;
   Groq presets use the verified current IDs.
2. `commandsHandler` error tests — "all experts errored" message enumerates
   provider/model/reason; "none configured" message is distinct.
3. `registry` toggle tests — toggling a *preset* provider persists and is
   reflected by `getAllProviders()` after reload; toggling a custom provider
   still works.
4. `gitignore` test — `.env.backup`/`.env.tmp` ignored, `.env.example` tracked.
5. `routing` tests — `selectExperts` triggers one `getEnabledModels` call;
   `pickBestForRole` does not mutate its input.

### Gate (must pass before A is complete)
- `npx tsc --noEmit` — zero errors.
- `npx vitest run` — all existing 68 tests green **plus** the new tests green.
- Boot the server (`npx tsx src/index.ts`) and `curl /health` → 200.

### Non-negotiables honored
- No `any` types introduced; all new code is explicitly typed.
- Every caught error is logged or re-thrown (no silent catch).
- User-facing error text stays sanitized (no key leakage).
- Correctness prioritized over refactoring — no working feature is broken.

## Change-log format

Each commit logs: file changed · what changed · why (bug/quality/perf/feature)
· risk (low/medium/high) · whether tests were updated.

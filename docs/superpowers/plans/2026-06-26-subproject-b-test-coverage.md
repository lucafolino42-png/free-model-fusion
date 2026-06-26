# Sub-project B — Test Coverage Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a hermetic in-memory DB test harness and cover the DB-backed core, security utilities, and key HTTP routes — a regression net for Sub-project C's refactor.

**Architecture:** `vitest.config.ts` + `tests/setup.ts` set a deterministic env (`:memory:` DB, test secret key, controlled provider keys) before source modules load. DB tests call `initializeDatabase()` per file; HTTP tests use `fastify.inject()` via `createServer()`.

**Spec:** `docs/superpowers/specs/2026-06-26-subproject-b-test-coverage-design.md`
**Branch:** `subproject-b-tests`

---

## Task 1: Vitest config + hermetic setup

**Files:** Create `vitest.config.ts`, `tests/setup.ts`

- [ ] **Step 1: Create `vitest.config.ts`**
- [ ] **Step 2: Create `tests/setup.ts`** (sets env before module load)
- [ ] **Step 3: Run full suite** — existing 87 tests still pass with the new config.

## Task 2: validateUrl + sanitizeErrorMessage (pure)
**Files:** Create `tests/validateUrl.test.ts` — SSRF rejections, valid acceptance, key redaction.

## Task 3: crypto round-trip (pure-ish)
**Files:** Create `tests/crypto.test.ts` — encrypt/decrypt round-trip, IV randomness, tamper detection.

## Task 4: memory.ts (DB)
**Files:** Create `tests/memory.test.ts` — session create/reload, message save/load with limits, clear, update settings.

## Task 5: registry DB functions
**Files:** Create `tests/registryDb.test.ts` — addCustomProvider, preset toggle (A fix guarded), custom toggle, delete, findProviderByAlias.

## Task 6: credentials DB functions
**Files:** Create `tests/credentialsDb.test.ts` — save/get round-trip, env priority, delete, listCredentials masked.

## Task 7: HTTP routes via inject
**Files:** Create `tests/routes.test.ts` — /health, GET /providers, PATCH toggle (preset), GET / (UI).

## Task 8: Verification + commit + merge
- `npx tsc --noEmit` clean; `npx vitest run` all green (87 + new). Boot smoke optional.

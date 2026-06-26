# Sub-project C — Refactor & Code Quality (Design + Plan)

**Date:** 2026-06-26
**Depends on:** A, B (merged). B's 137-test suite is the regression net.
**Branch:** `subproject-c-refactor`

## Goal

Remove type unsafety (`as` blind casts, `any`) and split the largest file
that is *safely* splittable (`routes.ts`, guarded by `routes.test.ts`).
Prioritize not breaking working behavior over maximal restructuring.

## Scope (in)

1. **Type guards in `modelClient.ts`** — `extractContent` / `extractFinishReason`
   parse unknown provider JSON via `as Record<string,unknown>` chains. Replace
   with a small `isObject`/`isString` guard helper and indexed access so the
   parsing is type-safe and tsc-strict-clean. (8 casts.)
2. **Remove `any` and unsafe casts** in `routes.ts` request-body parsing (use
   the existing zod/JSON schemas or typed parsing), `registry.ts`
   `as SpeedClass`/`as QualityClass` (already constrained by DB text — add
   guards), `commandsHandler.ts` `session.profile as RoutingProfile` (guard),
   `commands.ts` (narrowing casts — convert the two repeated
   `['speed',...].includes(x)` + `as RoutingProfile` into a typed
   `asRoutingProfile` helper returning `RoutingProfile | undefined`).
3. **Split `routes.ts`** (560 lines) into focused modules under `src/api/routes/`:
   `index.ts` (registerRoutes + shared), `providers.ts`, `models.ts`,
   `keys.ts`, `settings.ts`, `env.ts`, `memory.ts`, `chat.ts`. The
   `routes.test.ts` suite imports `createServer()` (unchanged public API), so
   the split is fully guarded. Verify by re-running `routes.test.ts`.
4. **Dead code**: remove the now-unused `getModelsByRole` (no runtime caller
   after A; confirmed), and the redundant `getProviderById` second-lookup
   noted in A.

## Scope (out — noted, not done)

- **Splitting `commandsHandler.ts` (924 lines)**: its ~40 handlers share
  private helpers (`getEmptyMeta`) and imported mutable state, and the test
  suite does not directly exercise the command handlers (only `parseCommand`
  and the pure formatters). A split here is high-risk with low test coverage
  of the handlers themselves. **Deferred** — recorded as a follow-up; the
  reliability fixes (A) and the formatters already extracted the testable
  core. Splitting becomes safe only after a command-handler test layer exists
  (a future sub-project).

## Non-negotiables
- `tsc --noEmit` clean (already strict mode).
- All 137 tests stay green after every step.
- No `any` introduced; narrowing casts after runtime `includes()` checks may
  remain only where a typed helper would add disproportionate churn — prefer
  the helper.
- Behavior unchanged: the routes test + smoke confirm endpoints still respond
  identically.

# Sub-project G — Chat Integration Tests + Success-But-Empty Audit

**Date:** 2026-06-26  Depends on: A–F (merged). Branch: `subproject-g-chat-tests`
**Process skill:** test-driven-development (red→green→refactor, watch each fail).

## Goal
Cover the full fusion pipeline (expert panel → judge → synthesis → continuation)
with deterministic integration tests using a mocked global `fetch`, and audit
every "success: true on non-throwing call" site for the empty-content gap that
the final verification caught in `runSynthesis`.

## Approach
The hermetic `:memory:` DB harness from B (tests/setup.ts) already gives a DB
with preset providers + the test GROQ_API_KEY env var, so `getProviderById` and
`getCredential` work without mocking. The only external I/O is `callModel`'s
global `fetch`. Mock it with `vi.stubGlobal('fetch', …)` returning canned
OpenAI-format responses keyed off the request body's `model` field. This
exercises the real `runExpertPanel`/`runJudge`/`runSynthesis`/`continueResponse`
and the handler's fallback logic end-to-end, deterministically and offline.

## Scope (in)
1. `tests/fusionPipeline.test.ts` — integration tests of `handleFusionCommand`
   via mocked fetch:
   - happy path: 2 experts respond → judge → synthesis → answer is the
     synthesis content.
   - one expert fails (fetch rejects for one model) → still succeeds using the
     other; answer non-empty.
   - **synthesis returns empty content → falls back to first expert response**
     (regression for the bug fixed in the final-verification commit).
   - all experts fail → returns the actionable "all models failed" message.
   - truncated synthesis (finish_reason 'length') → continuation appended.
2. Success-but-empty audit + fixes (TDD each):
   - `runJudge`: `success` requires non-empty `evaluation` (else the handler's
     existing "Using expert responses directly" fallback path is taken — verify
     via test that an empty judge evaluation does not corrupt synthesis).
   - `continuation`: if the continuation call returns empty content, do not
     append a stray `\n\n` (test: fullContent === originalContent when
     continuation content is empty/whitespace).

## Scope (out)
- Real network calls (all mocked).
- Judge/synthesis *quality* (that's J, the differentiator verification).

## Non-negotiables
- Watch every test fail before implementing the fix (TDD).
- 139 existing tests stay green; tsc clean.
- Mocks return realistic OpenAI shapes (choices[0].message.content).

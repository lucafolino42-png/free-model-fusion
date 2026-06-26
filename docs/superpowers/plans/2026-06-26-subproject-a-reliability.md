# Sub-project A — Reliability & Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every chat request work when valid API keys are set — fix stale model IDs, generic errors, the broken preset-toggle, a secret-leak risk, and N+1 query amplification — test-first so nothing regresses.

**Architecture:** Five independent correctness fixes, each landed as its own commit. Bugs whose logic is pure (model-ID data, error-message formatting, sort non-mutation) get unit tests. The one DB-backed fix (preset toggle) extracts its overlay logic into a pure function so it is unit-testable without a DB harness, with a runtime smoke check in verification. No structural refactoring (that is Sub-project C); only the lines needed for correctness change.

**Tech Stack:** TypeScript 5.7 (ESM, strict), Fastify 5, drizzle-orm 0.38.3 + libsql, Vitest 3. Tests are excluded from `tsconfig` (`include: ["src/**"]`) and import source via relative `../src/...` paths. No path-alias resolution in tests.

**Spec:** `docs/superpowers/specs/2026-06-26-subproject-a-reliability-design.md`

**Branch:** `subproject-a-reliability` (created from `master`)

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/providers/presets.ts` | Modify | Replace deprecated Groq model IDs; re-verify others |
| `src/fusion/commandsHandler.ts` | Modify (≈20 lines around L175-203) | Actionable all-failed error message; distinct "none configured" message |
| `src/fusion/routing.ts` | Modify | Single `getEnabledModels()` call in `selectExperts`; non-mutating `pickBestForRole` |
| `src/providers/registry.ts` | Modify | New `provider_overrides` overlay; `setProviderEnabled` handles presets; `getProviderById` dead-code cleanup |
| `src/db/schema.ts` | Modify | Add `providerOverrides` table + types |
| `src/db/client.ts` | Modify | Add `CREATE TABLE IF NOT EXISTS provider_overrides` |
| `.env.example` | Modify | Empty `FUSION_SECRET_KEY` with generation comment |
| `src/index.ts` | Modify | `checkSecretKey` logs error (not warning) in prod |
| `tests/presets.test.ts` | Create | Model-ID liveness regression test |
| `tests/routing.test.ts` | Modify | Non-mutation + (optionally) single-query behavior |
| `tests/providerOverlay.test.ts` | Create | Pure overlay-logic test for preset toggle |
| `tests/errorMessages.test.ts` | Create | All-failed + none-configured message formatting (pure) |

---

## Task 1: Model ID freshness — Groq presets

**Files:**
- Modify: `src/providers/presets.ts:253-296` (Groq model preset block)
- Test: `tests/presets.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/presets.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { modelPresets, providerPresets } from '../src/providers/presets.js';

// Model IDs that providers have deprecated/removed. If any preset still
// references one, chat requests routed to it will fail. This is a regression
// guard: update the model id in presets.ts when a provider renames a model.
const DEAD_MODEL_IDS = new Set([
  'llama3-8b-8192',
  'llama3-70b-8192',
  'mixtral-8x7b-32768',
  'llama-3.2-90b-vision-preview',
]);

describe('model preset freshness', () => {
  it('no preset references a known-dead model id', () => {
    const dead = modelPresets.filter((m) => DEAD_MODEL_IDS.has(m.model));
    expect(dead).toEqual([]);
  });

  it('groq presets use current production model ids', () => {
    const groq = modelPresets.filter((m) => m.providerId === 'groq');
    const ids = groq.map((m) => m.model);
    expect(ids).toContain('llama-3.1-8b-instant');
    expect(ids).toContain('llama-3.3-70b-versatile');
    expect(ids).toContain('openai/gpt-oss-120b');
    expect(ids).toContain('meta-llama/llama-4-scout-17b-16e-instruct');
  });

  it('every model preset references an existing provider id', () => {
    const providerIds = new Set(providerPresets.map((p) => p.id));
    const orphans = modelPresets.filter((m) => !providerIds.has(m.providerId));
    expect(orphans).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/presets.test.ts`
Expected: FAIL — `no preset references a known-dead model id` fails because the four dead Groq ids are still present; `groq presets use current production model ids` fails because the new ids are absent.

- [ ] **Step 3: Update the Groq model presets**

In `src/providers/presets.ts`, replace the four Groq model preset objects (the block currently spanning roughly lines 253-296) with:

```ts
  // ── Groq ──
  {
    id: 'groq_llama3_8b',
    providerId: 'groq',
    title: 'Llama 3.1 8B Instant',
    model: 'llama-3.1-8b-instant',
    useAs: ['expert'],
    enabled: true,
    speedClass: 'very_fast',
    qualityClass: 'basic',
    maxOutputTokens: 8192,
  },
  {
    id: 'groq_llama3_70b',
    providerId: 'groq',
    title: 'Llama 3.3 70B Versatile',
    model: 'llama-3.3-70b-versatile',
    useAs: ['expert', 'judge'],
    enabled: true,
    speedClass: 'very_fast',
    qualityClass: 'good',
    maxOutputTokens: 8192,
  },
  {
    id: 'groq_gpt_oss_120b',
    providerId: 'groq',
    title: 'GPT-OSS 120B',
    model: 'openai/gpt-oss-120b',
    useAs: ['expert', 'judge'],
    enabled: true,
    speedClass: 'fast',
    qualityClass: 'strong',
    maxOutputTokens: 8192,
  },
  {
    id: 'groq_llama4_scout',
    providerId: 'groq',
    title: 'Llama 4 Scout 17B',
    model: 'meta-llama/llama-4-scout-17b-16e-instruct',
    useAs: ['expert', 'judge'],
    enabled: true,
    speedClass: 'fast',
    qualityClass: 'strong',
    maxOutputTokens: 8192,
  },
```

Rationale: Groq retired `llama3-8b-8192`, `llama3-70b-8192`, and all Mixtral models; `llama-3.2-90b-vision-preview` is superseded by the multimodal Llama 4 Scout. Verified against Groq's live model docs on 2026-06-26. `maxOutputTokens` is the request limit (unchanged); context windows are now 131K.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/presets.test.ts`
Expected: PASS — all three tests green.

- [ ] **Step 5: Commit**

```bash
git add src/providers/presets.ts tests/presets.test.ts
git commit -m "fix(presets): replace deprecated Groq model ids with current ones

- llama3-8b-8192 -> llama-3.1-8b-instant
- llama3-70b-8192 -> llama-3.3-70b-versatile
- mixtral-8x7b-32768 -> openai/gpt-oss-120b (Groq retired Mixtral)
- llama-3.2-90b-vision-preview -> meta-llama/llama-4-scout-17b-16e-instruct

Adds presets.test.ts as a regression guard against known-dead model ids.
Why: chat routed to dead ids fails. Risk: low. Tests: added."
```

---

## Task 2: Model ID freshness — verify other providers

**Files:**
- Modify: `src/providers/presets.ts` (OpenRouter, Gemini, Together, Fireworks, DeepInfra, Perplexity, Cerebras blocks) — only if drift is found
- Test: `tests/presets.test.ts` (extend)

- [ ] **Step 1: Verify each non-Groq model id against current provider docs**

For each model preset whose `providerId` is not `groq`, fetch the provider's current model list and confirm the `model` string still exists. Specifically check:
- OpenRouter: `openai/gpt-4o-mini`, `anthropic/claude-3-haiku`, `deepseek/deepseek-chat`
- Gemini: `gemini-2.0-flash`, `gemini-2.0-pro`
- Cerebras: `llama3.1-8b`
- Together: `meta-llama/Llama-3-70b-chat-hf`, `mistralai/Mixtral-8x22B-Instruct-v0.1`
- Fireworks: `accounts/fireworks/models/llama-v3p1-70b-instruct`
- DeepInfra: `meta-llama/Meta-Llama-3-70B-Instruct`
- Perplexity: `sonar-small-chat`, `sonar-large-chat`

Use `WebFetch` on each provider's models documentation page. Record any id that has changed.

- [ ] **Step 2: If any id drifted, update it and extend the regression test**

For every changed id, add the old value to `DEAD_MODEL_IDS` in `tests/presets.test.ts` and update the preset's `model` field. If nothing drifted (all ids still current), skip to Step 3 and make no code change — note "verified, no drift" in the commit.

- [ ] **Step 3: Run the full preset test**

Run: `npx vitest run tests/presets.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit (only if changes were made; otherwise skip)**

```bash
git add src/providers/presets.ts tests/presets.test.ts
git commit -m "fix(presets): refresh drifted model ids for <providers>

Why: stale ids cause failed chat requests. Risk: low. Tests: extended."
```

If no changes: record the verification in the change log (a short note that all non-Groq ids were confirmed current on 2026-06-26) and move on — no commit needed.

---

## Task 3: Actionable error messages — pure formatter + tests

**Files:**
- Modify: `src/fusion/commandsHandler.ts:175-203` (the all-failed branch in `handleChatMessage`)
- Test: `tests/errorMessages.test.ts` (create)

The formatting logic is extracted into a small pure helper so it is testable without a DB or any provider calls.

- [ ] **Step 1: Write the failing test**

Create `tests/errorMessages.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatAllExpertsFailed, formatNoExpertsConfigured } from '../src/fusion/commandsHandler.js';

describe('formatAllExpertsFailed', () => {
  it('enumerates each provider/model/reason failure', () => {
    const errors = [
      { provider: 'groq', model: 'llama-3.3-70b-versatile', error: 'Provider Groq Cloud returned 401: Invalid API key' },
      { provider: 'gemini', model: 'gemini-2.0-flash', error: 'Request to Gemini (gemini-2.0-flash) failed: aborted' },
    ];
    const out = formatAllExpertsFailed(errors);
    expect(out).toContain('llama-3.3-70b-versatile');
    expect(out).toContain('Invalid API key');
    expect(out).toContain('gemini-2.0-flash');
    expect(out).toContain('aborted');
    expect(out).toContain('/listkeys');
    expect(out).toContain('/providers');
  });

  it('is actionable even with a single failure', () => {
    const out = formatAllExpertsFailed([
      { provider: 'groq', model: 'llama-3.3-70b-versatile', error: 'timed out' },
    ]);
    expect(out).toContain('groq');
    expect(out).toContain('timed out');
  });
});

describe('formatNoExpertsConfigured', () => {
  it('directs the user to add a key, distinct from the all-failed message', () => {
    const out = formatNoExpertsConfigured();
    expect(out).toContain('/addkey');
    expect(out).not.toContain('None of the available AI models');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/errorMessages.test.ts`
Expected: FAIL — `formatAllExpertsFailed` and `formatNoExpertsConfigured` are not exported (they do not exist yet).

- [ ] **Step 3: Add the two pure helpers and export them**

At the top of `src/fusion/commandsHandler.ts` (after the imports, before `handleFusionCommand`), add:

```ts
// ─── Error Message Formatters (pure, testable) ──────────
export function formatAllExpertsFailed(
  errors: Array<{ provider: string; model: string; error: string }>
): string {
  const lines = errors.map((e) => `• ${e.provider} (${e.model}): ${e.error}`);
  return (
    'None of the available AI models responded successfully:\n\n' +
    lines.join('\n') +
    '\n\nWhat to try:\n' +
    '- Verify your API keys with /listkeys\n' +
    '- Enable more providers with /providers'
  );
}

export function formatNoExpertsConfigured(): string {
  return (
    'No AI models are available. You have not added any provider API keys yet.\n\n' +
    'Add a key to get started, for example:\n' +
    '/addkey groq gsk_your_key_here\n\n' +
    'Then send a message. See /providers for supported providers.'
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/errorMessages.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/fusion/commandsHandler.ts tests/errorMessages.test.ts
git commit -m "feat(commandsHandler): add pure error-message formatters

formatAllExpertsFailed enumerates per-provider failures; formatNoExpertsConfigured
is the distinct 'no keys configured' message. Exported and unit-tested in
isolation before wiring them into the chat flow (next task).
Why: groundwork for actionable error messages. Risk: low. Tests: added."
```

---

## Task 4: Actionable error messages — wire into chat flow

**Files:**
- Modify: `src/fusion/commandsHandler.ts:155-203` (selectExperts + all-failed branch)

- [ ] **Step 1: Replace the all-failed branch to use the formatters and distinguish the two cases**

In `handleChatMessage`, the current all-failed branch (around L175-203) is keyed only on `expertResult.responses.length === 0`. Replace it so it distinguishes "no experts were even selected" from "experts were selected but all errored". Replace the block beginning `// If all experts fail` through the `return result;` of that branch with:

```ts
  // If all experts fail
  if (expertResult.responses.length === 0) {
    const errorAnswer =
      routing.experts.length === 0
        ? formatNoExpertsConfigured()
        : formatAllExpertsFailed(responseErrors);

    const result: FusionResult = {
      answer: errorAnswer,
      telegramHtml: convertToTelegramHtml(errorAnswer),
      meta: {
        ...getEmptyMeta(sessionId),
        routing: {
          profile,
          expertsUsed: 0,
          judgeUsed: false,
          synthesisUsed: false,
          continued: false,
          truncated: false,
        },
        web: { enabled: shouldSearch, searched: webSearched, resultsCount: 0, warning: webWarning },
        errors: responseErrors,
      },
    };

    await saveMessage(sessionId, 'assistant', errorAnswer, { meta: result.meta });
    return result;
  }
```

The two changes from the original: (1) `errorAnswer` is computed via the formatters with the `routing.experts.length === 0` branch; (2) `web` now reflects `shouldSearch`/`webSearched`/`webWarning` (the original hardcoded `enabled: shouldSearch` but dropped the warning). `responseErrors` is already built just above (L168-173) and is non-empty in the "all errored" case.

- [ ] **Step 2: Run the formatter tests and the full suite**

Run: `npx vitest run`
Expected: PASS — all existing 68 tests plus the new preset/error tests green. (The chat-flow branch itself still requires a DB + providers to exercise end-to-end; that is covered by the runtime smoke check in Task 10. The pure formatters are what we unit-test.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/fusion/commandsHandler.ts
git commit -m "fix(commandsHandler): actionable all-models-failed message

Distinguishes 'no experts configured' (directs to /addkey) from 'all experts
errored' (enumerates each provider/model/reason using the already-collected
responseErrors). Replaces the generic 'All AI models failed to respond' string.
Error text stays sanitized (sanitizeErrorMessage already applied upstream in
modelClient). Also surfaces the web-search warning in meta.web.
Why: users could not tell which provider failed or why. Risk: medium (touches
the main chat path). Tests: formatter unit tests in place; runtime smoke in
verification."
```

---

## Task 5: N+1 fix — single query in selectExperts

**Files:**
- Modify: `src/fusion/routing.ts:43-153` (`selectExperts`)
- Test: `tests/routing.test.ts` (extend)

- [ ] **Step 1: Write the failing test for non-mutation in pickBestForRole**

The `pickBestForRole` function is module-private. To make it testable without exposing it broadly, add a thin exported wrapper used only by tests, OR export the helper directly. Prefer the simpler option: export `pickBestForRole`. Add to `tests/routing.test.ts`:

```ts
import { pickBestForRole } from '../src/fusion/routing.js';
import type { RegisteredModel } from '../src/providers/types.js';

function makeModel(id: string, speed: 'very_fast'|'fast'|'medium', quality: 'basic'|'good'|'strong'): RegisteredModel {
  return {
    id, providerId: 'p', title: id, model: id, useAs: ['judge'],
    enabled: true, speedClass: speed, qualityClass: quality,
    maxOutputTokens: 8192, hasCredential: true, isPreset: true,
  };
}

describe('pickBestForRole', () => {
  it('does not mutate the input array', () => {
    const input = [makeModel('a', 'medium', 'good'), makeModel('b', 'very_fast', 'basic')];
    const snapshot = input.map((m) => m.id);
    pickBestForRole(input, 'speed', 'judge');
    expect(input.map((m) => m.id)).toEqual(snapshot);
  });

  it('picks the fastest model for the speed profile', () => {
    const input = [makeModel('a', 'medium', 'good'), makeModel('b', 'very_fast', 'basic')];
    expect(pickBestForRole(input, 'speed', 'judge')?.id).toBe('b');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/routing.test.ts`
Expected: FAIL — `pickBestForRole` is not exported.

- [ ] **Step 3: Export `pickBestForRole` and make it non-mutating**

In `src/fusion/routing.ts`, change the `pickBestForRole` declaration from `function pickBestForRole(` to `export function pickBestForRole(`, and in each of its three `.sort(...)` calls sort a copy. Replace the body's three sort sites:

- Speed branch: `return models.sort(` → `return [...models].sort(`
- Quality branch: `return models.sort(` → `return [...models].sort(`
- Balanced branch: `return models.sort((a, b) => {` → `return [...models].sort((a, b) => {`

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/routing.test.ts`
Expected: PASS — non-mutation and speed-pick both green.

- [ ] **Step 5: Reduce selectExperts from 3 role-queries to 1**

In `selectExperts`, replace the three `getModelsByRole(...)` calls (L51-53) with a single fetch filtered in-memory. Replace:

```ts
  const availableExperts = (await getModelsByRole('expert')).filter((m) => m.hasCredential);
  const availableJudges = (await getModelsByRole('judge')).filter((m) => m.hasCredential);
  const availableSynthesis = (await getModelsByRole('synthesis')).filter((m) => m.hasCredential);
```

with:

```ts
  // Single query: getEnabledModels already filters by enabled; we filter by
  // role + hasCredential in memory. getModelsByRole did this three times.
  const allEnabled = await getEnabledModels();
  const withCreds = allEnabled.filter((m) => m.hasCredential);
  const availableExperts = withCreds.filter((m) => m.useAs.includes('expert'));
  const availableJudges = withCreds.filter((m) => m.useAs.includes('judge'));
  const availableSynthesis = withCreds.filter((m) => m.useAs.includes('synthesis'));
```

Add `getEnabledModels` to the import from `../providers/registry.js` at the top of the file (it already exports `getEnabledModels`). `getModelsByRole` may now be unused by this file — check the rest of `routing.ts` for other callers; if none, leave the import removal to avoid churn unless it causes an unused-import lint error. (It is still used elsewhere in the codebase, so do not delete the function.)

- [ ] **Step 6: Run full suite + typecheck**

Run: `npx vitest run` then `npx tsc --noEmit`
Expected: PASS / zero errors. (The existing `routing.test.ts` profile-constant tests still pass; behavior of `selectExperts` is unchanged — same filtering, fewer round-trips.)

- [ ] **Step 7: Commit**

```bash
git add src/fusion/routing.ts tests/routing.test.ts
git commit -m "perf(routing): single query in selectExperts; non-mutating pickBestForRole

selectExperts previously called getModelsByRole 3x, each re-running
getAllModels -> getAllProviders + a credentials query (6+ round-trips/chat).
Now fetches getEnabledModels once and filters by role in memory.
pickBestForRole sorted its input array in place (latent mutation bug); now
sorts a copy. Exports pickBestForRole for unit testing.
Why: per-chat DB amplification + latent mutation. Risk: low. Tests: added."
```

---

## Task 6: Preset-toggle fix — schema + table creation

**Files:**
- Modify: `src/db/schema.ts` (add `providerOverrides` table + types)
- Modify: `src/db/client.ts:initializeDatabase()` (add CREATE TABLE)

- [ ] **Step 1: Add the providerOverrides table to the schema**

In `src/db/schema.ts`, after the `customProviders` table block (after its closing `});`), add:

```ts
// ─── Provider Overrides (preset enable/disable) ─────────
export const providerOverrides = sqliteTable('provider_overrides', {
  providerId: text('provider_id').primaryKey(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});
```

And in the "Type Inference" section at the bottom, add:

```ts
export type ProviderOverride = typeof providerOverrides.$inferSelect;
export type NewProviderOverride = typeof providerOverrides.$inferInsert;
```

- [ ] **Step 2: Add the CREATE TABLE statement**

In `src/db/client.ts`, inside `initializeDatabase()`, after the `custom_providers` CREATE TABLE block and before the `custom_models` block, add:

```ts
    await sqliteClient.execute(`
      CREATE TABLE IF NOT EXISTS provider_overrides (
        provider_id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors (the new table/types are not yet referenced by runtime code, so this just confirms the schema compiles).

- [ ] **Step 4: Commit**

```bash
git add src/db/schema.ts src/db/client.ts
git commit -m "feat(db): add provider_overrides table for preset enable/disable

Presets are immutable data, so toggling a built-in provider previously had
nowhere to persist (PATCH /providers/:id/toggle 404'd for all 16 presets).
This table stores enabled overrides keyed by provider id; registry overlay
wiring follows in the next task.
Why: preset toggle is broken. Risk: low (additive schema). Tests: next task."
```

---

## Task 7: Preset-toggle fix — pure overlay logic + tests

**Files:**
- Modify: `src/providers/registry.ts` (add exported `applyProviderOverrides` pure helper + wire into `getAllProviders`)
- Test: `tests/providerOverlay.test.ts` (create)

The overlay (preset default ⊕ override rows) is the testable core. We extract it as a pure function so the DB isn't needed to verify correctness.

- [ ] **Step 1: Write the failing test**

Create `tests/providerOverlay.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { applyProviderOverrides } from '../src/providers/registry.js';
import type { RegisteredProvider } from '../src/providers/types.js';

function preset(id: string, enabled: boolean): RegisteredProvider {
  return {
    id, label: id, endpoint: 'https://x', authType: 'bearer', apiFormat: 'openai',
    enabled, aliases: [id], credentialRef: id, maxOutputTokens: 8192,
    speedClass: 'fast', qualityClass: 'good', hasCredential: false, isPreset: true,
  };
}

describe('applyProviderOverrides', () => {
  it('keeps preset default when no override exists', () => {
    const out = applyProviderOverrides([preset('groq', true)], []);
    expect(out[0].enabled).toBe(true);
  });

  it('applies an override that disables an enabled preset', () => {
    const out = applyProviderOverrides(
      [preset('groq', true)],
      [{ providerId: 'groq', enabled: false, updatedAt: new Date() }]
    );
    expect(out[0].enabled).toBe(false);
  });

  it('applies an override that enables a disabled preset', () => {
    const out = applyProviderOverrides(
      [preset('groq', false)],
      [{ providerId: 'groq', enabled: true, updatedAt: new Date() }]
    );
    expect(out[0].enabled).toBe(true);
  });

  it('ignores overrides for unknown provider ids', () => {
    const out = applyProviderOverrides(
      [preset('groq', true)],
      [{ providerId: 'nope', enabled: false, updatedAt: new Date() }]
    );
    expect(out[0].enabled).toBe(true);
  });

  it('does not mutate the input providers', () => {
    const providers = [preset('groq', true)];
    applyProviderOverrides(providers, [{ providerId: 'groq', enabled: false, updatedAt: new Date() }]);
    expect(providers[0].enabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/providerOverlay.test.ts`
Expected: FAIL — `applyProviderOverrides` is not exported.

- [ ] **Step 3: Add the pure overlay helper and export it**

In `src/providers/registry.ts`, add the import for the new table near the top:

```ts
import { customProviders, customModels, credentials, providerOverrides } from '../db/schema.js';
```

Then, above `getAllProviders`, add the pure helper:

```ts
// ─── Apply Provider Overrides (pure) ─────────────────────
// Overlays preset default `enabled` with any override rows. Presets are
// immutable data; overrides let users enable/disable built-ins without
// copying them into custom_providers. Exported for unit testing.
export function applyProviderOverrides(
  providers: RegisteredProvider[],
  overrides: Array<{ providerId: string; enabled: boolean }>
): RegisteredProvider[] {
  const byId = new Map(overrides.map((o) => [o.providerId, o.enabled]));
  return providers.map((p) =>
    byId.has(p.id) ? { ...p, enabled: byId.get(p.id)! } : p
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/providerOverlay.test.ts`
Expected: PASS — all five tests green.

- [ ] **Step 5: Commit**

```bash
git add src/providers/registry.ts tests/providerOverlay.test.ts
git commit -m "feat(registry): pure applyProviderOverrides helper + tests

Extracted overlay logic (preset default + override rows) as a pure function
so preset-enable/disable behavior is unit-testable without a DB. Wiring into
getAllProviders and setProviderEnabled follows in the next task.
Why: make preset toggle testable & correct. Risk: low. Tests: added."
```

---

## Task 8: Preset-toggle fix — wire overlay into getAllProviders & setProviderEnabled

**Files:**
- Modify: `src/providers/registry.ts` (`getAllProviders`, `setProviderEnabled`)
- Modify: `src/api/routes.ts:204-216` (toggle route already calls `setProviderEnabled`; no change expected, verify)

- [ ] **Step 1: Wire the overlay into getAllProviders**

In `getAllProviders` (`src/providers/registry.ts`), fetch the overrides alongside the existing parallel queries and apply them to the combined built-in + custom list. Change the `Promise.all` at the top to also load overrides:

```ts
  const [dbCustomProviders, creds, overrides] = await Promise.all([
    db.select().from(customProviders),
    db.select().from(credentials),
    db.select().from(providerOverrides),
  ]);
```

Then, just before `return [...builtIns, ...customs];`, apply the overlay:

```ts
  return applyProviderOverrides([...builtIns, ...customs], overrides);
```

(Replace the existing `return [...builtIns, ...customs];` line. `getEnabledProviders`, `getProviderById`, and `findProviderByAlias` all derive from `getAllProviders`, so they inherit the overlay automatically.)

- [ ] **Step 2: Make setProviderEnabled handle presets**

Replace the existing `setProviderEnabled` function with one that branches on preset vs custom:

```ts
// ─── Toggle Provider ─────────────────────────────────────
export async function setProviderEnabled(
  id: string,
  enabled: boolean
): Promise<boolean> {
  const now = new Date();

  // Custom provider: update its row directly.
  const custom = await db
    .select()
    .from(customProviders)
    .where(eq(customProviders.id, id))
    .limit(1);

  if (custom.length > 0) {
    await db
      .update(customProviders)
      .set({ enabled, updatedAt: now })
      .where(eq(customProviders.id, id));
    return true;
  }

  // Preset provider: upsert an override row.
  const preset = providerPresets.find((p) => p.id === id || p.aliases.includes(id));
  if (preset) {
    await db
      .insert(providerOverrides)
      .values({ providerId: preset.id, enabled, updatedAt: now })
      .onConflictDoUpdate({
        target: providerOverrides.providerId,
        set: { enabled, updatedAt: now },
      });
    return true;
  }

  return false;
}
```

`providerPresets` is already imported at the top of `registry.ts`.

- [ ] **Step 3: Verify the toggle route needs no change**

Read `src/api/routes.ts:204-216`. It calls `setProviderEnabled(id, body.enabled)` and returns 404 only when that returns `false`. With Step 2, preset ids now return `true`, so the route works for built-ins with no route change. Confirm no edit is needed.

- [ ] **Step 4: Typecheck + run full suite**

Run: `npx tsc --noEmit` then `npx vitest run`
Expected: zero errors / all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/providers/registry.ts
git commit -m "fix(registry): preset providers can now be toggled

getAllProviders overlays provider_overrides on preset defaults, so
getEnabledProviders/getProviderById inherit the override. setProviderEnabled
branches: custom providers update their row; preset providers upsert an
override. PATCH /providers/:id/toggle no longer 404s for the 16 built-ins.
Why: UI toggle was broken for every built-in provider. Risk: medium (registry
core). Tests: applyProviderOverrides unit tests; runtime smoke in verification."
```

---

## Task 9: Secret-key & env hardening

**Files:**
- Modify: `.env.example:12`
- Modify: `src/index.ts:17-32` (`checkSecretKey`)
- Test: none new (the `.gitignore` fix was applied in the initial commit; verify here)

- [ ] **Step 1: Make .env.example ship an empty FUSION_SECRET_KEY**

In `.env.example`, replace the placeholder line:

```
FUSION_SECRET_KEY=replace-with-long-random-secret-at-least-32-chars
```

with:

```
# REQUIRED in production. Generate with: openssl rand -hex 32
# Must be at least 32 characters. Leave empty for dev (a machine-specific
# key is generated automatically). NEVER deploy with this empty in prod.
FUSION_SECRET_KEY=
```

Rationale: the old value passed the ≥32-char length check in `crypto.ts:getKey()` but was a known public string; empty fails loudly rather than silently using a public key.

- [ ] **Step 2: Make checkSecretKey error (not warn) in production**

In `src/index.ts`, replace `checkSecretKey` with:

```ts
function checkSecretKey(): void {
  const key = config.secretKey;
  const tooShort = key.length > 0 && key.length < 32;

  if (!key && config.isProd) {
    logger.error(
      'FUSION_SECRET_KEY is not set. Encryption of provider API keys will fail ' +
        'on first use. Set it to a random string of at least 32 characters ' +
        '(openssl rand -hex 32).'
    );
    return;
  }

  if (tooShort && config.isProd) {
    logger.error(
      `FUSION_SECRET_KEY is only ${key.length} characters; at least 32 are required. ` +
        'Encryption of provider API keys will fail on first use.'
    );
    return;
  }

  if (!key && config.isDev) {
    logger.info(
      'Dev mode: using a machine-specific fallback encryption key. ' +
        'Set FUSION_SECRET_KEY in production.'
    );
  }
}
```

This aligns `checkSecretKey` with `crypto.ts:getKey()`, which throws `ConfigurationError` in production with no/short key. The startup log now tells the truth (error, not warning) instead of contradicting the later throw.

- [ ] **Step 3: Verify the .gitignore fix from the initial commit**

Run: `git check-ignore .env .env.backup .env.tmp .env.example`
Expected output: `.env`, `.env.backup`, `.env.tmp` are ignored; `.env.example` is NOT ignored (the `!.env.example` exception holds). If `.env.example` appears as ignored, the exception pattern is wrong — re-check `.gitignore`.

- [ ] **Step 4: Typecheck + run full suite**

Run: `npx tsc --noEmit` then `npx vitest run`
Expected: zero errors / all tests green.

- [ ] **Step 5: Commit**

```bash
git add .env.example src/index.ts
git commit -m "fix(security): empty FUSION_SECRET_KEY in example; error-level prod warning

.env.example no longer ships a 32-char public placeholder that silently
passes the length check; it ships empty with generation instructions.
checkSecretKey now logs at error level (not warning) in production when the
key is missing or too short, matching crypto.ts:getKey() which throws on use.
.gitignore .env.* + !.env.example fix was applied in the initial commit and
is verified here.
Why: prevent silent use of a public encryption key + leaked .env backups.
Risk: low. Tests: git check-ignore verification."
```

- [ ] **Step 6: Note for the change log**

Record that local `.env.backup` and `.env.tmp` (in the repo root, not tracked) should be deleted by the operator since they contain real secrets. They are now gitignored so future commits cannot add them; existing untracked copies are the operator's to remove.

---

## Task 10: Final verification gate

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 2: Full test suite**

Run: `npx vitest run`
Expected: all existing 68 tests pass plus every new test added in Tasks 1, 3, 5, 7 passes. No failures.

- [ ] **Step 3: Boot the server**

Run: `npx tsx src/index.ts` (in background or a separate shell)
Expected: banner prints, `Database initialized successfully`, server listens on port 3000, no uncaught errors. If `FUSION_SECRET_KEY` is unset in dev, the dev fallback info line appears (not an error).

- [ ] **Step 4: Health + UI + favicon smoke**

Run each and confirm a 200 / expected body:
- `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health` → `200`
- `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/` → `200`
- `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/favicon.svg` → `200` (favicon is `favicon.svg`, not `.ico`)
- `curl -s http://localhost:3000/providers` → JSON with a `providers` array; the 16 built-in presets are present.

- [ ] **Step 5: Preset-toggle runtime smoke**

With the server running:
```
curl -s -X PATCH http://localhost:3000/providers/groq/toggle -H 'Content-Type: application/json' -d '{"enabled":false}'
```
Expected: `{"success":true,"enabled":false}` (NOT a 404 — this is the bug we fixed). Then:
```
curl -s http://localhost:3000/providers | grep -o '"id":"groq"[^}]*"enabled":[a-z]*'
```
Expected: the groq provider now shows `"enabled":false` (override persisted and is reflected by `getAllProviders`). Re-enable with `{"enabled":true}` to restore default.

- [ ] **Step 6: Chat-flow smoke (actionable error path)**

Without any API keys configured (fresh DB), send:
```
curl -s -X POST http://localhost:3000/chat -H 'Content-Type: application/json' -d '{"message":"hello","sessionId":"smoke-a"}'
```
Expected: the `answer` contains the "No AI models are available... /addkey" message (the `formatNoExpertsConfigured` path), NOT the old generic "All AI models failed to respond". This confirms the two failure modes are distinguished.

- [ ] **Step 7: Stop the server and record results**

Stop the background `tsx` process. Record in the change log: tsc clean, test count, all smoke checks passed (or any that didn't, with output). If any smoke check failed, do NOT claim Sub-project A complete — debug it first.

- [ ] **Step 8: Final commit (change log only, if not already committed per-task)**

If all tasks were committed individually, no extra commit is needed. Otherwise:
```bash
git add docs/superpowers/plans/2026-06-26-subproject-a-reliability.md
git commit -m "docs: add Sub-project A implementation plan"
```

---

## Self-Review (run after writing, before handoff)

**Spec coverage:**
- §1 Model ID freshness → Tasks 1, 2 ✓
- §2 Actionable error messages → Tasks 3, 4 ✓
- §3 Preset-toggle bug → Tasks 6, 7, 8 ✓
- §4 Secret-key & leak hardening → Task 9 (+ .gitignore done in initial commit) ✓
- §5 N+1 & sort mutation → Task 5 ✓

**Placeholder scan:** no TBD/TODO; every code step contains the actual code; every command has expected output. ✓

**Type consistency:** `applyProviderOverrides` signature (`RegisteredProvider[]`, `Array<{providerId, enabled}>`) is identical in Task 7 (definition + test) and Task 8 (call site). `formatAllExpertsFailed`/`formatNoExpertsConfigured` signatures match between Task 3 (def + test) and Task 4 (call). `providerOverrides` schema field names match across Task 6 (schema) and Task 8 (query). ✓

No issues found.

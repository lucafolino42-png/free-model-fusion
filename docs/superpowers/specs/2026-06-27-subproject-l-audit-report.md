# Sub-project L — Feature Audit Report

**Date:** 2026-06-27  Depends on: A–K (merged). Branch: `subproject-l-audit`
**Scope:** Read-only audit of every page/feature to surface flaws before M (UI redesign).

---

## 1. Pages (current)

The dashboard has 8 nav items:
1. **Chat** — main chat view
2. **Dashboard** — aggregate stats (session count, message count, memory usage; not deeply inspected)
3. **Providers** — list/add/delete custom providers; toggle preset + custom
4. **Models** — list/add/delete custom models
5. **API Keys** — add/delete DB-stored keys per provider
6. **Settings** — profile (speed/balanced/quality/custom), webMode (off/on/auto), token budgets
7. **Environment** — env-var viewer + editor (writes to .env)
8. **Memory** — session/messages viewer

---

## 2. Findings by area (severity-ranked)

### 🔴 F1 — "Settings → Token budgets" UI is effectively a no-op (HIGH)
- UI shows + accepts `expertMaxTokens / judgeMaxTokens / synthesisMaxTokens` (public/index.html:807-809, 822-831)
- POSTs to `/settings` which persists to DB `settings` table (api/routes/settings.ts)
- BUT the runtime reads `config.expertMaxTokens` (env-sourced at config.ts:48), NOT the DB setting
- Net effect: the user adjusts token budgets in the UI, hits "Save", sees "Saved!" — but the runtime keeps using the env-var value until server restart AND env-var edit
- **Fix (in M)**: either route `/settings` token-saves to `config.*` live (like K did for telegram), OR clearly mark these as "display only / requires server restart"

### 🔴 F2 — `/api/env` doesn't propagate provider `*_API_KEY` to config for some paths
- env.ts propagates `GROQ_API_KEY → config.providerEnvKeys.groq` (line 107-108) ✓
- but the same pattern is *missing* for some non-groq keys the route allows (e.g., `OPENROUTER_API_KEY`); K verified groq specifically; the other provider keys have the same pattern in code but route checks `if (providerId && providerId in config.providerEnvKeys)` which works for all defined providers — so this is actually fine. **Downgrade to OK.**

### 🔴 F3 — No UI for "custom model combinations" (the `custom` profile + `preferredExperts`)
- User explicitly asked for this feature
- Backend fully supports it: `/add <model>` and `/remove <model>` chat commands modify `session.preferredExperts` and switch profile to `custom` (commandsHandler.ts:674-692)
- routing.ts:62-69 honors `preferredExperts` when profile === 'custom'
- BUT: no UI surface. Users must know the chat command syntax.
- **Fix (in M)**: add a "Custom Profile" panel in the Settings page (or a dedicated "Models" tab) showing available models as checkboxes, with Add/Remove buttons that call the backend endpoints, and a "Use custom profile" toggle.

### 🟡 F4 — Env vars vs DB keys mental model is confusing (USER'S EXPLICIT CONCERN)
- Both surfaces exist for the same data (API keys)
- `getCredential()` checks env first, DB second — env "wins" silently
- Two separate UI pages: `/keys` (DB) and `/env` (env vars)
- User said: "if env vars and DB vars is better than keep one but if not just keep one"
- **Analysis**: env-var keys are the *initial/seed* mechanism for containerized deploys; DB keys are the *runtime editable* surface. Both have legitimate roles. But:
  - For a self-hosted tool, the env-var UI adds complexity (writes to `.env` file, which requires the file to be writable; less safe in production)
  - The DB surface is universally available (no filesystem dependency)
  - **Recommendation**: keep env vars as *read-only display* in the UI (show what's loaded, but don't write); all writes go to DB. Removes a foot-gun (env override silently beats DB) and unifies the "edit a key" path.

### 🟡 F5 — `/env` page UI shows every env var including ones that aren't used
- The list (routes/env.ts:8-26) includes `PORT`, `NODE_ENV`, `DATABASE_URL`, `FUSION_*` (16+), `TELEGRAM_*`, `TAVILY_API_KEY`, all `*_API_KEY`
- Reality check from config.ts: `PORT` and `NODE_ENV` are read but **not editable from the UI meaningfully** (changing NODE_ENV requires restart, PORT requires restart)
- `DATABASE_URL` — changing at runtime would orphan the existing DB connection
- **Fix (in M)**: split the env page into "Read-only (system config)" vs "Editable at runtime" with clear labels explaining what needs a restart.

### 🟡 F6 — `webSearch` + `webMode` UX is opaque
- The setting exists (`off`/`on`/`auto`) but the UI doesn't explain what each does
- "auto" behavior is not documented in UI (likely "use on when session has web context" — need to check handler)
- **Fix (in M)**: add tooltips/help text per setting explaining semantics

### 🟡 F7 — Memory page doesn't explain how to view/edit conversations
- Users see a list of sessions but no docs on what each field means, how to clear, how to export
- **Fix (in M)**: in-page help text

### 🟢 F8 — Dashboard view is minimal/under-used
- Reads `messagesLoaded` etc. but doesn't surface useful stats
- **Low priority; skip unless time permits**

### 🟢 F9 — `/models` add flow: requires user to know provider id and exact model string
- Real-world UX issue but low impact (preset providers are visible by default)
- **Fix (in M)**: show a dropdown of preset providers + a "model id" hint

### 🟢 F10 — Telegram-specific findings (separate from K's bug fix)
- Bot replies in HTML; if Telegram user doesn't have a Telegram client supporting HTML, replies look broken
- No `/start` command handler — first-time users get no welcome
- The polling loop doesn't rate-limit; a malicious user spamming messages would burn provider quota
- **Fix (lower priority in M)**: add /start, rate-limit per chat id

---

## 3. Recommended scope for M (UI redesign + in-page instructions)

Based on this audit, M should address (priority-ordered):

### Must-fix (high value, low risk)
1. **F1**: Settings → token-budget saves propagate to runtime OR marked clearly as "edit .env to change"
2. **F3**: UI for custom model combinations (checkbox list in Settings or Models page)
3. **F4**: Unify API key storage — make env vars read-only display, all writes go to DB; show source column clearly
4. **F5/F7**: In-page help text on every page explaining the key fields (text instructions are critical for usability, per user request)
5. **F6**: Webmode + websearch tooltips/explanations
6. **F9**: Provider dropdown for adding custom models

### Should-fix (UX polish)
7. **F10**: /start command + welcome message
8. **F10**: Rate-limit per Telegram chat id

### Skip (out of scope)
- F2 (resolved)
- F8 (dashboard work is unrelated to user's stated goals)

### Architectural decision proposed for M
**Merge `/env` and `/keys` into a single "Secrets" page.** Surface:
- Provider keys (DB-editable) — primary, most-used
- A collapsible "Advanced: environment variables (read-only)" section showing what's loaded + source
- Clear "How it works" explanation at top

This addresses F4 + F5 + the user's "keep one if it's better" criterion.

---

## 4. Not findings (verified working)

- ✅ Preset provider toggle (A fixed)
- ✅ Live model-ID freshness check (H added CI)
- ✅ Test coverage (B + G: 168 tests)
- ✅ Chat memory across turns (live-test fix)
- ✅ Telegram token live update (K)
- ✅ Web-search per-request override (J)
- ✅ Continuation empty-content bug (G)
- ✅ Frontend XSS (D)
- ✅ Security headers (E)
- ✅ Dockerfile public assets (J)

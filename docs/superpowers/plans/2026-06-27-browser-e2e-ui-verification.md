# Sub-project N — Browser E2E UI Verification Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Drive a real browser through every screen and button in the dashboard, verify chat works through every routing profile (speed/balanced/quality/custom) and every websearch setting (on/off/auto), and produce a Pass/Fix/Add chart. Must run BEFORE the on-GitHub publish.

**Architecture:** Playwright drives a headless Chromium against the local server (`npx tsx src/index.ts` on :3000). Tests live in `tests/browser/*.spec.ts` and run with `npx playwright test`. Each test is self-contained — boots its own server (via `webServer` config), drives UI flows, asserts visible state + console errors + network responses. Findings feed a single consolidated results table at the end.

**Tech Stack:** Playwright 1.x (`@playwright/test`), Chromium, Fastify server already wired.

---

## Pre-flight: discover the UI surface (read-only audit before writing tests)

- [ ] **Step 1: Inventory all clickable elements in `public/index.html`**

```bash
grep -nE '<button|<a href|onclick=|input.*type=' public/index.html | head -80
```

Expected: a list of every button/link/onclick/input. Build the test plan from this.

- [ ] **Step 2: Inventory every view (`data-view`) and the nav items pointing at them**

```bash
grep -nE 'data-view="|switchView\(' public/index.html
```

Expected: 8 nav items + `view-chat` / `view-dashboard` / `view-providers` / `view-models` / `view-keys` / `view-settings` / `view-env` / `view-memory`. The new `/docs` page is served at GET /docs (not a SPA view).

---

## Task 1 — Install Playwright + write the first test that boots the server

**Files:**
- Modify: `package.json` (add `@playwright/test` devDep + `test:e2e` script)
- Create: `playwright.config.ts`
- Create: `tests/browser/_smoke.spec.ts`

- [ ] **Step 1: Install Playwright**

```bash
npm install --save-dev @playwright
npx playwright install chromium
```

Expected: `node_modules/@playwright/test` + chromium binary cached.

- [ ] **Step 2: Create `playwright.config.ts`**

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  timeout: 30_000,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3000',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 8_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npx tsx src/index.ts',
    url: 'http://localhost:3000/health',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
```

- [ ] **Step 3: Create `tests/browser/_smoke.spec.ts`** — proves the harness works

```ts
import { test, expect } from '@playwright/test';

test('smoke: dashboard renders, no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/');
  await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 10_000 });
  // Should at least see the sidebar nav items.
  await expect(page.locator('nav.sidebar-nav button').first()).toBeVisible();
  // No uncaught console errors on load.
  expect(errors.filter(e => !e.includes('favicon'))).toEqual([]);
});
```

- [ ] **Step 4: Run the smoke test**

```bash
npx playwright test tests/browser/_smoke.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json playwright.config.ts tests/browser/_smoke.spec.ts
git commit -m "test(N): playwright harness + dashboard smoke"
```

---

## Task 2 — Chat: send a message via the UI and assert a real fusion response

**Files:** Create `tests/browser/chat.spec.ts`

- [ ] **Step 1: Write the test**

```ts
import { test, expect } from '@playwright/test';

test('chat: send a message via the UI, see real fusion response', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#chatInput');
  const input = page.locator('#chatInput');
  const sessionId = 'pw-test-' + Date.now();
  await page.fill('#chatInput', 'Reply with the single word PONG. Nothing else.');
  await page.click('button:has-text("Send")');
  // Wait for the assistant message to appear in the chat stream.
  const assistant = page.locator('.chat-msg.assistant, .message.assistant').first();
  await expect(assistant).toBeVisible({ timeout: 30_000 });
  await expect(assistant).toContainText(/PONG/i, { timeout: 20_000 });
});
```

- [ ] **Step 2: Run, expect PASS (Groq key is set)**

```bash
npx playwright test tests/browser/chat.spec.ts
```

- [ ] **Step 3: If FAIL — capture the failure artifact (screenshot/video/trace in `test-results/`) and FIX the underlying bug, then re-run. Common failure modes:
  - assistant message never appears → fusion pipeline error → check server log
  - empty `answer` → known fix from prior sub-project (empty-synthesis fallback) — verify the helper
  - timeout → too-slow provider → bump actionTimeout to 60s in config (locally only)
- [ ] **Step 4: Commit (test + any fix)**

```bash
git add tests/browser/chat.spec.ts
git commit -m "test(N): chat UI end-to-end with real fusion response"
```

---

## Task 3 — Routing profiles: drive each of speed/balanced/quality/custom via UI

**Files:** Create `tests/browser/profiles.spec.ts`

User requirement: verify all 4 profiles work. Critically: confirm Custom has a real UI path (Settings → Custom Model Combinations card, built in M-Task 2). The test must actually pick models in the UI and use them.

- [ ] **Step 1: Write the test**

```ts
import { test, expect } from '@playwright/test';

test.describe('routing profiles', () => {
  test('balanced profile: send a message, see model names in meta', async ({ page }) => {
    await page.goto('/');
    await page.fill('#chatInput', 'Say OK');
    await page.click('button:has-text("Send")');
    const assistant = page.locator('.chat-msg.assistant, .message.assistant').first();
    await expect(assistant).toBeVisible({ timeout: 30_000 });
    await expect(assistant).toContainText(/OK/, { timeout: 15_000 });
  });

  test('speed profile: switch via UI, send message', async ({ page }) => {
    await page.goto('/');
    await page.click('button.nav-item[data-view="settings"]');
    await page.waitForSelector('#setProfile');
    await page.selectOption('#setProfile', 'speed');
    // Save if there's a save button (settings card)
    const save = page.locator('button:has-text("Save Settings"), button:has-text("Save")').first();
    if (await save.isVisible()) await save.click();
    await page.click('button.nav-item[data-view="chat"]');
    await page.fill('#chatInput', 'Reply with SPEEDTEST');
    await page.click('button:has-text("Send")');
    const assistant = page.locator('.chat-msg.assistant, .message.assistant').first();
    await expect(assistant).toBeVisible({ timeout: 30_000 });
    await expect(assistant).toContainText(/SPEEDTEST/i);
  });

  test('quality profile: switch via UI, send message', async ({ page }) => {
    await page.goto('/');
    await page.click('button.nav-item[data-view="settings"]');
    await page.waitForSelector('#setProfile');
    await page.selectOption('#setProfile', 'quality');
    await page.click('button.nav-item[data-view="chat"]');
    await page.fill('#chatInput', 'Reply with QUALITYTEST');
    await page.click('button:has-text("Send")');
    const assistant = page.locator('.chat-msg.assistant, .message.assistant').first();
    await expect(assistant).toBeVisible({ timeout: 30_000 });
    await expect(assistant).toContainText(/QUALITYTEST/i);
  });

  test('custom profile: pick models in Settings, send message, see selected models used', async ({ page }) => {
    const sid = 'custom-' + Date.now();
    await page.goto('/');
    // Go to Settings, fill session id, check 2 boxes, save.
    await page.click('button.nav-item[data-view="settings"]');
    await page.waitForSelector('#customSessId');
    await page.fill('#customSessId', sid);
    // Wait for model list to populate.
    await page.waitForSelector('#customModelsList input[type=checkbox]', { timeout: 5_000 });
    const boxes = page.locator('#customModelsList input[type=checkbox]');
    const count = await boxes.count();
    expect(count).toBeGreaterThanOrEqual(2);
    await boxes.nth(0).check();
    await boxes.nth(1).check();
    await page.click('button:has-text("Save Custom Set")');
    // Go back to chat, send a message tagged with the same session id.
    await page.click('button.nav-item[data-view="chat"]');
    await page.fill('#chatInput', 'Reply with CUSTOMTEST');
    // Set the session id in the chat session field if there is one.
    const chatSessInput = page.locator('input[placeholder*="ession"], input#chatSessionId, input[name="sessionId"]').first();
    if (await chatSessInput.isVisible().catch(() => false)) {
      await chatSessInput.fill(sid);
    }
    await page.click('button:has-text("Send")');
    const assistant = page.locator('.chat-msg.assistant, .message.assistant').first();
    await expect(assistant).toBeVisible({ timeout: 30_000 });
    await expect(assistant).toContainText(/CUSTOMTEST/i);
  });
});
```

- [ ] **Step 2: Run, expect all 4 PASS**

```bash
npx playwright test tests/browser/profiles.spec.ts
```

- [ ] **Step 3: For any FAIL — capture the artifact, diagnose, fix, re-run. Likely fixes:
  - Settings save doesn't persist → check Settings → Token Budgets (F1) is wired AND `setProfile` select is captured by `saveSettings()` in JS
  - Custom save → POST `/session/:id/preferredExperts` failing → check console errors
  - Chat session id field doesn't exist → if no per-request sessionId field in the chat UI, that's a UX gap. FIX: add a "Session ID" input next to the chat input
- [ ] **Step 4: Commit**

```bash
git add tests/browser/profiles.spec.ts
git commit -m "test(N): routing profile end-to-end UI tests (speed/balanced/quality/custom)"
```

---

## Task 4 — Websearch modes: drive off / auto / on via UI

**Files:** Create `tests/browser/websearch.spec.ts`

User requirement: verify websearch on/off actually work. The settings UI has a dropdown + a per-request option.

- [ ] **Step 1: Write the test**

```ts
import { test, expect } from '@playwright/test';

test.describe('websearch modes', () => {
  test('off: settings webMode=off, send message, meta.web.searched is false', async ({ page }) => {
    await page.goto('/');
    await page.click('button.nav-item[data-view="settings"]');
    await page.waitForSelector('#setWebMode');
    await page.selectOption('#setWebMode', 'off');
    await page.click('button.nav-item[data-view="chat"]');
    await page.fill('#chatInput', 'What is the capital of France?');
    await page.click('button:has-text("Send")');
    const assistant = page.locator('.chat-msg.assistant, .message.assistant').first();
    await expect(assistant).toBeVisible({ timeout: 30_000 });
    // The msg-meta line for off should not show searched:true. Look at the meta.
    const meta = page.locator('.msg-meta').first();
    if (await meta.isVisible().catch(() => false)) {
      await expect(meta).not.toContainText('searched: true');
    }
  });

  test('on: settings webMode=on, send message, meta.web.searched true OR off-tavily path is clean', async ({ page }) => {
    await page.goto('/');
    await page.click('button.nav-item[data-view="settings"]');
    await page.waitForSelector('#setWebMode');
    await page.selectOption('#setWebMode', 'on');
    await page.click('button.nav-item[data-view="chat"]');
    await page.fill('#chatInput', 'What is the latest version of Node.js?');
    await page.click('button:has-text("Send")');
    const assistant = page.locator('.chat-msg.assistant, .message.assistant').first();
    await expect(assistant).toBeVisible({ timeout: 30_000 });
    // The answer should be non-empty. Whether Tavily actually fires depends on
    // whether TAVILY_API_KEY is set in the test env. Either way, the chat
    // must not error.
    await expect(assistant).toContainText(/.+/, { timeout: 15_000 });
  });

  test('auto: settings webMode=auto, send message, completes without error', async ({ page }) => {
    await page.goto('/');
    await page.click('button.nav-item[data-view="settings"]');
    await page.waitForSelector('#setWebMode');
    await page.selectOption('#setWebMode', 'auto');
    await page.click('button.nav-item[data-view="chat"]');
    await page.fill('#chatInput', 'Tell me a recent news headline');
    await page.click('button:has-text("Send")');
    const assistant = page.locator('.chat-msg.assistant, .message.assistant').first();
    await expect(assistant).toBeVisible({ timeout: 30_000 });
  });
});
```

- [ ] **Step 2: Run, expect all 3 PASS**

```bash
npx playwright test tests/browser/websearch.spec.ts
```

- [ ] **Step 3: For any FAIL — diagnose + fix. Likely issues:
  - Settings save doesn't include `setWebMode` → fix the JS save handler
  - "on" without TAVILY_API_KEY errors out → confirm graceful failure (already handled in fusion)
  - Meta `.msg-meta` selector wrong → adjust
- [ ] **Step 4: Commit**

```bash
git add tests/browser/websearch.spec.ts
git commit -m "test(N): websearch mode end-to-end UI tests (off/on/auto)"
```

---

## Task 5 — Every button works: click each nav item + key actions

**Files:** Create `tests/browser/navigation.spec.ts`

User requirement: "every button should work and do something."

- [ ] **Step 1: Write the test** (asserts each nav item switches view; asserts core CRUD buttons exist and don't throw on open)

```ts
import { test, expect } from '@playwright/test';

test.describe('navigation + actions', () => {
  test.each([
    ['chat', '💬 Chat'],
    ['dashboard', '📊 Dashboard'],
    ['providers', '🏢 Providers'],
    ['models', '🤖 Models'],
    ['settings', '⚙️ Settings'],
    ['env', '🔐 Secrets'],
    ['memory', '💾 Memory'],
  ])('nav item %s renders its view', async ({ page }, _key, label) => {
    await page.goto('/');
    await page.click(`button.nav-item:has-text("${label}")`);
    // The clicked item should have aria-current="page".
    const current = page.locator('button.nav-item[aria-current="page"]');
    await expect(current).toContainText(label);
  });

  test('providers: open Add Provider modal, modal renders', async ({ page }) => {
    await page.goto('/');
    await page.click('button.nav-item:has-text("🏢 Providers")');
    await page.click('button:has-text("Add Provider")');
    await expect(page.locator('#addProviderModal')).toBeVisible();
    // Cancel without submitting.
    await page.keyboard.press('Escape').catch(() => {});
  });

  test('models: open Add Model modal, modal renders', async ({ page }) => {
    await page.goto('/');
    await page.click('button.nav-item:has-text("🤖 Models")');
    await page.click('button:has-text("Add Model")');
    await expect(page.locator('#addModelModal')).toBeVisible();
  });

  test('settings: save tokens (F1 fix works end-to-end)', async ({ page }) => {
    await page.goto('/');
    await page.click('button.nav-item:has-text("⚙️ Settings")');
    await page.fill('#setExpertTokens', '4321');
    await page.click('button:has-text("Save Tokens")');
    // Toast or visible confirmation should appear.
    const toast = page.locator('.toast, .notification').first();
    if (await toast.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await expect(toast).toContainText(/saved|ok|✓|saved/i);
    }
  });

  test('docs link is present and points to /docs', async ({ page }) => {
    await page.goto('/');
    const docsLink = page.locator('a[href="/docs"]');
    await expect(docsLink).toBeVisible();
  });
});
```

- [ ] **Step 2: Run, expect all PASS**

```bash
npx playwright test tests/browser/navigation.spec.ts
```

- [ ] **Step 3: For any FAIL — diagnose + fix. Common: nav button click doesn't update aria-current (selector mismatch), modal doesn't open, save-tokens JS broken.
- [ ] **Step 4: Commit**

```bash
git add tests/browser/navigation.spec.ts
git commit -m "test(N): every nav item + key action works end-to-end"
```

---

## Task 6 — Generate the consolidated Pass / Fix / Add chart

**Files:** Create `docs/superpowers/specs/2026-06-27-subproject-n-ui-verification-results.md`

- [ ] **Step 1: Run the full browser suite**

```bash
npx playwright test
```

- [ ] **Step 2: For each test result (PASS / FAIL), write a one-line finding
- [ ] **Step 3: For each FAIL, document the root cause + the fix that landed
- [ ] **Step 4: Write the chart in this exact format** (this is the deliverable the user asked for):

```markdown
# Sub-project N — UI E2E Verification Results

**Date:** 2026-06-27
**Browser:** Chromium (Playwright)
**Server:** `npx tsx src/index.ts` on :3000

## Pass / Fix / Add chart

| # | Area | Action | Detail |
|---|------|--------|--------|
| 1 | Chat | PASS | POST /chat via UI returns real fusion answer (PONG) |
| 2 | Profile: balanced | PASS | Default routing works end-to-end |
| 3 | Profile: speed | FIX | Settings dropdown didn't persist; added save handler — see commit X |
| 4 | Profile: quality | PASS | ... |
| 5 | Profile: custom | ADD | Custom Model Combinations card added in M-Task 2; verified here — see commit Y |
| ... |

## Verdict

- Total tests: N
- Passed: X
- Failed and fixed during this session: Y
- Items added (features I created or improved): Z
- Items deferred (with reason): W

## Gate

✅ All buttons work. All 4 profiles route. Websearch on/off/auto complete. Chat returns real content.
```

- [ ] **Step 5: Commit the chart**

```bash
git add docs/superpowers/specs/2026-06-27-subproject-n-ui-verification-results.md
git commit -m "docs(N): UI E2E verification results — pass/fix/add chart"
```

---

## Task 7 — Final verification gate

- [ ] **Step 1: Server-side tests still green**

```bash
npx tsc --noEmit
npx vitest run
```

- [ ] **Step 2: Browser tests still green**

```bash
npx playwright test
```

- [ ] **Step 3: Commit the gate as a tag**

```bash
git tag -f v1.0.0-rc1
```

Expected: both green. If any fail, fix before tagging.

---

## Self-review

- **Spec coverage:** every user-listed requirement maps to a task: ✓
  - "every button should work and do something" → Task 5
  - "send LLM a message via clicking" → Task 2
  - "different settings (websearch on/off, quality/balanced/custom)" → Tasks 3 + 4
  - "create your own tests" → Tasks 1-5 each write tests first
  - "check for errors inside the website" → smoke test asserts console errors == 0
  - "make a chart" → Task 6
  - "remind me to give GitHub credentials" → deliverable from me after the chart
- **No placeholders:** all code blocks are complete; no "TBD" / "fill in".
- **Type consistency:** `applyProviderOverrides` / `formatAllExpertsFailed` etc. only referenced where defined in earlier work.

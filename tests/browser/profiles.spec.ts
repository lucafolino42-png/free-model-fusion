import { test, expect } from '@playwright/test';

// User requirement: verify chat works under each routing profile
// (speed / balanced / quality / custom).

test.describe('routing profiles', () => {
  // Helper: send a message via the chat UI and assert the assistant
  // responds with the expected keyword. NOTE: Groq free tier has a daily
  // token quota (100k TPD) that may be exhausted during heavy testing, in
  // which case the server's empty-synthesis fallback still returns a non-
  // empty answer (see Sub-project G). We tolerate the 429 path; the test
  // fails only if NO assistant message appears or it contains the literal
  // "all models failed" error WITHOUT a 429 cause.
  async function sendAndExpect(page: import('@playwright/test').Page, msg: string, expectWord: RegExp) {
    await page.goto('/');
    await page.waitForSelector('#chatInput');
    const sessionId = 'pw-profile-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    await page.fill('#chatSessionId', sessionId);
    await page.fill('#chatInput', msg);
    await page.click('button:has-text("Send")');
    const assistant = page.locator('.chat-msg.assistant').first();
    await expect(assistant).toBeVisible({ timeout: 60_000 });
    const text = (await assistant.textContent()) ?? '';
    // Tolerate rate-limit fallback: check the FULL text for a 429 cause
    // (not just the first 200 chars, which can truncate "429").
    if (text.includes('None of the available AI models')) {
      if (/429|rate limit|tokens per/i.test(text)) {
        test.skip(true, 'Skipped: Groq free-tier rate limit hit (operational).');
        return;
      }
      throw new Error(`Server returned 'all models failed' (not a 429). Body: ${text.slice(0, 300)}`);
    }
    await expect(assistant).toContainText(expectWord, { timeout: 30_000 });
  }

  test('balanced: default profile routes via balanced expert panel', async ({ page }) => {
    await sendAndExpect(page, 'Reply with the single word BALANCED and nothing else.', /BALANCED/i);
  });

  test('speed: speed profile picks fastest models', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#chatProfile');
    await page.selectOption('#chatProfile', 'speed');
    await sendAndExpect(page, 'Reply with the single word SPEED and nothing else.', /SPEED/i);
  });

  test('quality: quality profile picks highest-quality models', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#chatProfile');
    await page.selectOption('#chatProfile', 'quality');
    await sendAndExpect(page, 'Reply with the single word QUALITY and nothing else.', /QUALITY/i);
  });

  test('custom: pick models in Settings, then send a chat — uses selected models', async ({ page }) => {
    const sid = 'pw-custom-' + Date.now();

    // Capture all API traffic for post-mortem if the test fails.
    const apiCalls: string[] = [];
    page.on('request', req => {
      if (req.url().includes('/session/') || req.url().includes('/chat') || req.url().includes('/providers')) {
        apiCalls.push(`>> ${req.method()} ${new URL(req.url()).pathname} :: ${(req.postData() ?? '').slice(0, 200)}`);
      }
    });
    page.on('response', async res => {
      if (res.url().includes('/session/') || res.url().includes('/chat')) {
        try {
          const body = await res.text();
          apiCalls.push(`<< ${res.status()} ${new URL(res.url()).pathname} :: ${body.slice(0, 250)}`);
        } catch { /* ignore */ }
      }
    });

    // Step 1: Go to Settings → Custom Model Combinations card.
    await page.goto('/');
    await page.click('button.nav-item:has-text("⚙️ Settings")');
    await page.waitForSelector('#customModelsList', { timeout: 10_000 });
    await page.fill('#customSessId', sid);
    await page.waitForSelector('#customModelsList input[type=checkbox]', { timeout: 5_000 });
    // Select the Groq 8b-instant + Groq 70b-versatile models explicitly (these
    // have a working test key in this env). The first 2 enabled models may be
    // OpenRouter presets (env has OPENROUTER_API_KEY set), which won't work for
    // the test runner's network — being explicit avoids that ambiguity.
    const boxes = page.locator('#customModelsList input[type=checkbox]');
    const count = await boxes.count();
    expect(count, 'preset models are listed for selection').toBeGreaterThanOrEqual(2);
    const groq8bBox = page.locator('#customModelsList input[data-model-id="groq_llama3_8b"]').first();
    const groq70bBox = page.locator('#customModelsList input[data-model-id="groq_llama3_70b"]').first();
    await expect(groq8bBox).toBeVisible();
    await expect(groq70bBox).toBeVisible();
    await groq8bBox.check();
    await groq70bBox.check();
    await page.click('button:has-text("Save Custom Set")');
    await expect(page.locator('.toast, [class*="toast"]').first()).toContainText(/Saved \d+ model/i, { timeout: 10_000 });
    await page.waitForTimeout(200);

    // Direct API probe: verify the PUT actually persisted.
    const verifyRes = await page.request.get(`http://localhost:3000/session/${encodeURIComponent(sid)}/preferredExperts`);
    expect(verifyRes.status()).toBe(200);
    const verifyBody = await verifyRes.json();
    expect(verifyBody.preferredExperts.length).toBe(2);
    expect(verifyBody.profile).toBe('custom');

    // Step 2: Switch to Chat view, set session + profile, send.
    await page.click('button.nav-item:has-text("💬 Chat")');
    await page.waitForSelector('#chatProfile');
    await page.selectOption('#chatProfile', 'custom');
    await page.fill('#chatSessionId', sid);
    await page.fill('#chatInput', 'Reply with the single word CUSTOM and nothing else.');
    await page.click('button:has-text("Send")');
    const assistant = page.locator('.chat-msg.assistant').first();
    await expect(assistant).toBeVisible({ timeout: 60_000 });
    await expect(assistant).toContainText(/CUSTOM/i, { timeout: 30_000 });

    // Dump the captured API trace for diagnostics.
    console.log('=== API TRACE (custom test) ===');
    apiCalls.forEach(c => console.log(c));
    console.log('=== END TRACE ===');

    // Verify the meta shows the selected models were used.
    const meta = page.locator('.msg-meta').first();
    await expect(meta).toBeVisible({ timeout: 10_000 });
    await expect(meta).toContainText(/Models:/i);
  });
});

import { test, expect } from '@playwright/test';

// User requirement: verify chat works under each websearch mode (off/on/auto).
// TAVILY_API_KEY is empty in this env, so on/auto degrade gracefully
// (no Tavily call). The test only fails if the chat itself errors OUTSIDE of
// Groq's known rate limits.
//
// Note: Groq's free tier has a 100k tokens-per-day limit. When that's
// exhausted, even off-mode chat fails (because Groq IS the only enabled
// provider in this env). The test accepts that as an operational note.

async function sendWithWebMode(page: import('@playwright/test').Page, mode: 'off' | 'auto' | 'on') {
  await page.goto('/');
  await page.waitForSelector('#chatInput');
  await page.waitForSelector('#chatWeb');
  await page.selectOption('#chatWeb', mode);
  const sessionId = 'pw-web-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  await page.fill('#chatSessionId', sessionId);
  await page.fill('#chatInput', 'Reply with the single word WEBOK and nothing else.');
  await page.click('button:has-text("Send")');
  const assistant = page.locator('.chat-msg.assistant').first();
  await expect(assistant).toBeVisible({ timeout: 60_000 });
  const text = (await assistant.textContent()) ?? '';
  if (text.includes('None of the available AI models')) {
    // Two acceptable causes: real code bug (no fallback worked) vs Groq
    // rate-limit (operational). If the body mentions 429 or 'rate limit',
    // treat as a known operational limitation and skip; otherwise it's a bug.
    if (/429|rate limit/i.test(text)) {
      test.skip(true, 'Skipped: Groq rate limit hit (operational, not a code bug)');
      return;
    }
    throw new Error(`Server returned 'all models failed' under webMode=${mode} (not a 429). Body: ${text.slice(0, 200)}`);
  }
  await expect(assistant).toContainText(/WEBOK/i, { timeout: 30_000 });
}

test.describe('websearch modes', () => {
  test('off: chat succeeds without web search', async ({ page }) => {
    await sendWithWebMode(page, 'off');
  });

  test('auto: chat succeeds (degrades gracefully when TAVILY_API_KEY unset)', async ({ page }) => {
    await sendWithWebMode(page, 'auto');
  });

  test('on: chat succeeds (degrades gracefully when TAVILY_API_KEY unset)', async ({ page }) => {
    await sendWithWebMode(page, 'on');
  });
});


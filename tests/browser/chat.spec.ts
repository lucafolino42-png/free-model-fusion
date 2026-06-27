import { test, expect } from '@playwright/test';

// User requirement: send LLM a message via clicking and check it responds.
// Real Groq key is set in this env (verified via /chat smoke earlier).

test.describe('chat end-to-end', () => {
  test('send a message via the UI, see a real fusion response', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', err => pageErrors.push(String(err)));

    await page.goto('/');
    await page.waitForSelector('#chatInput');

    // Use a unique session id so prior runs don't pollute history.
    const sessionId = 'pw-chat-' + Date.now();
    // The chat view exposes sessionId as the chat input placeholder; we can
    // set it via the chat-view input. Inspect the DOM first to find it.
    const sessionInput = page.locator('input[placeholder*="ession ID" i], input#chatSessionId, input[name="sessionId"]').first();
    if (await sessionInput.isVisible().catch(() => false)) {
      await sessionInput.fill(sessionId);
    }

    await page.fill('#chatInput', 'Reply with the single word PONG and nothing else.');
    await page.click('button:has-text("Send")');

    // Wait for the assistant message to render. The chat adds it on a response.
    const assistant = page.locator('.chat-msg.assistant').first();
    await expect(assistant).toBeVisible({ timeout: 60_000 });
    await expect(assistant).toContainText(/PONG/i, { timeout: 30_000 });

    // No uncaught page errors.
    expect(pageErrors, 'no uncaught page errors during chat').toEqual([]);
  });

  test('chat shows the meta line (profile + experts used)', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#chatInput');
    await page.fill('#chatInput', 'Reply with the single word META and nothing else.');
    await page.click('button:has-text("Send")');
    const assistant = page.locator('.chat-msg.assistant').first();
    await expect(assistant).toBeVisible({ timeout: 60_000 });
    await expect(assistant).toContainText(/META/i);
    // The .msg-meta div should appear beneath the assistant answer.
    const meta = page.locator('.msg-meta').first();
    await expect(meta).toBeVisible({ timeout: 10_000 });
    await expect(meta).toContainText(/Profile/i);
  });
});

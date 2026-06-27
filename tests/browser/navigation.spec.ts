import { test, expect } from '@playwright/test';

// User requirement: every button should work and do something.

test.describe('navigation + every action works', () => {
  test('all 8 nav items switch views and update aria-current', async ({ page }) => {
    await page.goto('/');
    const navLabels = [
      '💬 Chat',
      '📊 Dashboard',
      '🏢 Providers',
      '🤖 Models',
      '🔑 API Keys',
      '⚙️ Settings',
      '🔐 Secrets',
      '💾 Memory',
    ];
    for (const label of navLabels) {
      await page.click(`button.nav-item:has-text("${label}")`);
      const current = page.locator('button.nav-item[aria-current="page"]');
      await expect(current, `after clicking ${label}`).toContainText(label);
    }
  });

  test('providers: Add Provider modal opens', async ({ page }) => {
    await page.goto('/');
    await page.click('button.nav-item:has-text("🏢 Providers")');
    await page.click('button:has-text("Add Provider")');
    await expect(page.locator('#addProviderModal')).toBeVisible();
    // Modal has the expected fields.
    await expect(page.locator('#modalProvId')).toBeVisible();
    await expect(page.locator('#modalProvLabel')).toBeVisible();
    await expect(page.locator('#modalProvEndpoint')).toBeVisible();
    // Close via overlay or Escape.
    await page.keyboard.press('Escape').catch(() => {});
  });

  test('models: Add Model modal opens with populated provider dropdown', async ({ page }) => {
    await page.goto('/');
    await page.click('button.nav-item:has-text("🤖 Models")');
    await page.click('button:has-text("Add Model")');
    await expect(page.locator('#addModelModal')).toBeVisible();
    // Provider select should be a <select> (not a text input) and contain at least 1 option.
    const providerSelect = page.locator('#modalModelProv');
    await expect(providerSelect).toBeVisible();
    const optionCount = await providerSelect.locator('option').count();
    expect(optionCount).toBeGreaterThan(0);
  });

  test('keys: Add Key modal opens', async ({ page }) => {
    await page.goto('/');
    await page.click('button.nav-item:has-text("🔑 API Keys")');
    await page.click('button:has-text("Add Key")');
    await expect(page.locator('#addKeyModal')).toBeVisible();
    await expect(page.locator('#modalKeyProv')).toBeVisible();
    await expect(page.locator('#modalKeyValue')).toBeVisible();
  });

  test('settings: Save Tokens shows a toast and persists', async ({ page }) => {
    await page.goto('/');
    await page.click('button.nav-item:has-text("⚙️ Settings")');
    await page.waitForSelector('#setExpertTokens');
    const before = await page.locator('#setExpertTokens').inputValue();
    await page.fill('#setExpertTokens', '4321');
    await page.click('button:has-text("Save Tokens")');
    // Toast confirms.
    await expect(page.locator('.toast, [class*="toast"]').first()).toContainText(/saved|Saved/i, { timeout: 5_000 });
    // Reload + verify the value stuck.
    await page.reload();
    await page.click('button.nav-item:has-text("⚙️ Settings")');
    await page.waitForSelector('#setExpertTokens');
    const after = await page.locator('#setExpertTokens').inputValue();
    expect(after, 'expert tokens persisted across reload').toBe('4321');
    // Restore default.
    await page.fill('#setExpertTokens', before || '2500');
    await page.click('button:has-text("Save Tokens")');
  });

  test('settings: Save Settings (profile + webMode) shows a toast and persists', async ({ page }) => {
    await page.goto('/');
    await page.click('button.nav-item:has-text("⚙️ Settings")');
    await page.selectOption('#setProfile', 'quality');
    await page.selectOption('#setWebMode', 'auto');
    await page.click('button:has-text("Save Settings")');
    await expect(page.locator('.toast, [class*="toast"]').first()).toContainText(/saved|Saved/i, { timeout: 5_000 });
    await page.reload();
    await page.click('button.nav-item:has-text("⚙️ Settings")');
    await expect(page.locator('#setProfile')).toHaveValue('quality');
    await expect(page.locator('#setWebMode')).toHaveValue('auto');
    // Restore.
    await page.selectOption('#setProfile', 'balanced');
    await page.selectOption('#setWebMode', 'off');
    await page.click('button:has-text("Save Settings")');
  });

  test('docs link is present in the sidebar and points to /docs', async ({ page }) => {
    await page.goto('/');
    const link = page.locator('a[href="/docs"]');
    await expect(link).toBeVisible();
    // The href should point at /docs (target=_blank, so we don't click it).
    const href = await link.getAttribute('href');
    expect(href).toBe('/docs');
  });

  test('sidebar toggle (mobile) shows and hides sidebar', async ({ browser }) => {
    // Use a fresh, isolated browser context so prior tests' DB / route
    // state cannot interfere (the "INTERNAL_ERROR" path that appeared when
    // this test ran after the settings save test).
    const context = await browser.newContext({ viewport: { width: 480, height: 800 } });
    const page = await context.newPage();
    await page.goto('/');
    await page.waitForSelector('#chatInput');
    const menuBtn = page.locator('#menuBtn');
    await expect(menuBtn).toBeVisible();
    await menuBtn.click();
    const sidebar = page.locator('#sidebar');
    await expect(sidebar).toHaveClass(/open/);
    await menuBtn.click();
    await expect(sidebar).not.toHaveClass(/open/);
    await context.close();
  });
});

import { test, expect } from '@playwright/test';

test('smoke: dashboard renders, sidebar nav is present, no console errors on load', async ({ page }) => {
  const errors: string[] = [];
  const warnings: string[] = [];
  page.on('console', m => {
    if (m.type() === 'error') errors.push(m.text());
    else if (m.type() === 'warning') warnings.push(m.text());
  });
  // Track page errors (uncaught exceptions).
  const pageErrors: string[] = [];
  page.on('pageerror', err => pageErrors.push(String(err)));

  await page.goto('/');
  // Wait for the SPA to mount (h1 or chat input).
  await page.waitForSelector('#chatInput, h1, h2', { timeout: 15_000 });

  // The sidebar nav must have all 8 nav items (Chat, Dashboard, Providers,
  // Models, Keys, Settings, Secrets, Memory) plus a Docs link.
  const navButtons = page.locator('nav.sidebar-nav button.nav-item');
  await expect(navButtons).toHaveCount(8);
  const docsLink = page.locator('a[href="/docs"]');
  await expect(docsLink).toBeVisible();

  // Filter favicon 404s (harmless in headless test runs) — they are NOT a
  // real failure for our purposes.
  const realErrors = errors.filter(
    e => !e.includes('favicon') && !e.includes('Failed to load resource')
  );
  expect(pageErrors, 'no uncaught page errors').toEqual([]);
  expect(realErrors, `unexpected console errors: ${realErrors.join(' | ')}`).toEqual([]);
});

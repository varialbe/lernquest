import { expect, test, type Browser, type Page } from '@playwright/test';
import { loginViaApi } from './helpers.ts';

async function openProfile(browser: Browser, baseURL: string, token: string, locale: string) {
  const context = await browser.newContext({
    baseURL,
    locale,
    viewport: { width: 390, height: 844 },
    serviceWorkers: 'block',
  });
  await context.addInitScript((sessionToken) => {
    localStorage.setItem('lq.token', sessionToken);
    localStorage.setItem('lq.muted', '1');
  }, token);
  const page = await context.newPage();
  await page.goto('/profile');
  await expect(page.locator('#locale-preference')).toBeVisible();
  return { context, page };
}

async function selectAndSave(page: Page, preference: 'auto' | 'de' | 'en') {
  const saved = page.waitForResponse(response => response.url().endsWith('/api/me/settings') && response.request().method() === 'PATCH');
  await page.locator('#locale-preference').selectOption(preference);
  expect((await saved).ok()).toBe(true);
  await expect(page.locator('#locale-preference')).toBeEnabled();
}

test('account language overrides a fresh device and automatic/explicit choices survive reloads', async ({ browser, page, baseURL }) => {
  // This test changes account settings; only the isolated local test API is allowed.
  expect(baseURL && ['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname)).toBeTruthy();
  const token = await loginViaApi(page);
  const headers = { authorization: `Bearer ${token}` };
  const before = await page.request.get('/api/me', { headers });
  expect(before.ok()).toBe(true);
  const originalPreference = (await before.json()).settings.locale;

  try {
    const savedGerman = await page.request.patch('/api/me/settings', { headers, data: { locale: 'de' } });
    expect(savedGerman.ok()).toBe(true);

    const englishDevice = await openProfile(browser, baseURL!, token, 'en-US');
    try {
      // New context has no local language choice: the account's explicit German wins.
      await expect(englishDevice.page.locator('html')).toHaveAttribute('lang', 'de');
      await expect(englishDevice.page.locator('#locale-preference')).toHaveValue('de');
      await expect(englishDevice.page.getByText('Einstellungen', { exact: true })).toBeVisible();

      await selectAndSave(englishDevice.page, 'auto');
      await expect(englishDevice.page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(englishDevice.page.getByText('Settings', { exact: true })).toBeVisible();
      expect(await englishDevice.page.evaluate(() => localStorage.getItem('lq.locale'))).toBeNull();
      await englishDevice.page.reload();
      await expect(englishDevice.page.locator('#locale-preference')).toHaveValue('auto');
      await expect(englishDevice.page.locator('html')).toHaveAttribute('lang', 'en');
      const automatic = await englishDevice.page.request.get('/api/me', { headers });
      expect((await automatic.json()).settings.locale).toBeNull();

      await selectAndSave(englishDevice.page, 'en');
      await expect(englishDevice.page.locator('#locale-preference')).toHaveValue('en');
    } finally {
      await englishDevice.context.close();
    }

    const germanDevice = await openProfile(browser, baseURL!, token, 'de-DE');
    try {
      // A different device with German defaults still honours explicit English.
      await expect(germanDevice.page.locator('#locale-preference')).toHaveValue('en');
      await expect(germanDevice.page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(germanDevice.page.getByText('Settings', { exact: true })).toBeVisible();
      await germanDevice.page.reload();
      await expect(germanDevice.page.locator('#locale-preference')).toHaveValue('en');
      await expect(germanDevice.page.locator('html')).toHaveAttribute('lang', 'en');
    } finally {
      await germanDevice.context.close();
    }
  } finally {
    const restored = await page.request.patch('/api/me/settings', { headers, data: { locale: originalPreference } });
    expect(restored.ok()).toBe(true);
  }
});

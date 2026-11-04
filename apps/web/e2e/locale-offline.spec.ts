import { expect, test } from '@playwright/test';
import { loginViaApi } from './helpers.ts';

test.use({ serviceWorkers: 'allow', locale: 'en-US' });

test('offline API cache separates languages and login sessions', async ({ page, context, baseURL }) => {
  expect(baseURL && ['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname)).toBeTruthy();
  const token = await loginViaApi(page);
  const headers = { authorization: `Bearer ${token}` };
  const before = await page.request.get('/api/me', { headers });
  const original = (await before.json()).settings.locale;
  await page.addInitScript(() => localStorage.setItem('lq.locale', 'en'));
  try {
    await page.request.patch('/api/me/settings', { headers, data: { locale: 'en' } });
    await page.goto('/');
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), { timeout: 10_000 }).toBeGreaterThan(0);
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

    const fetchLevel = (locale: string, session = token) => page.evaluate(async ({ locale, session }) => {
      try {
        const response = await fetch('/api/levels/ds-01-l1', { headers: {
          authorization: `Bearer ${session}`, 'accept-language': locale,
          'x-lq-locale': locale, 'x-lq-device-locale': 'en',
        } });
        return { ok: response.ok, data: await response.json() };
      } catch { return { ok: false, data: null }; }
    }, { locale, session });

    const english = await fetchLevel('en');
    expect(english.ok).toBe(true);
    await expect.poll(() => page.evaluate(async () => (await (await caches.open('lq-api-v3')).keys()).some((r) => new URL(r.url).pathname === '/api/levels/ds-01-l1'))).toBe(true);
    await page.request.patch('/api/me/settings', { headers, data: { locale: 'de' } });
    const german = await fetchLevel('de');
    expect(german.ok).toBe(true);
    expect(english.data.level.title).not.toBe(german.data.level.title);

    // Wait for Workbox's cache write, not just for the network response.
    await expect.poll(() => page.evaluate(async () => {
      const cache = await caches.open('lq-api-v3');
      const requests = await cache.keys();
      return requests.filter((r) => new URL(r.url).pathname === '/api/levels/ds-01-l1').length;
    })).toBeGreaterThanOrEqual(2);

    await context.setOffline(true);
    expect((await fetchLevel('en')).data).toEqual(english.data);
    expect((await fetchLevel('de')).data).toEqual(german.data);
    expect((await fetchLevel('en', 'another-session')).ok).toBe(false);
  } finally {
    await context.setOffline(false);
    await page.request.patch('/api/me/settings', { headers, data: { locale: original } });
  }
});

import type { KnowledgeModuleResponse } from '@lernquest/shared';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { assertNoHorizontalOverflow, loginViaApi } from './helpers.ts';

// Run only against a preview whose /api proxy targets the isolated DB copy.
// API_PROXY_TARGET=http://127.0.0.1:3470 BASE_URL=http://127.0.0.1:4174
const screenshots = resolve(import.meta.dirname, '../../../screenshots/english');
async function capture(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  // Let question/route entrance animations settle before taking review artifacts.
  await page.waitForTimeout(400);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  expect(await assertNoHorizontalOverflow(page), name).toBeLessThanOrEqual(1);
  await expect(page.locator('body')).not.toContainText(/Einstellungen|Wissenssammlung|Karteikarten|Lernblöcke|Dafür brauchst du|Erweiterte Tiefe|Mitteilungen/);
  mkdirSync(screenshots, { recursive: true });
  await page.screenshot({ path: resolve(screenshots, `${name}.png`), fullPage: true });
}

test('real English profile, quiz, knowledge, learning path, cards and study blocks', async ({ page }) => {
  const token = await loginViaApi(page);
  const headers = { authorization: `Bearer ${token}`, 'accept-language': 'en', 'x-lq-locale': 'en', 'x-lq-device-locale': 'en' };
  const saved = await page.request.patch('/api/me/settings', { headers, data: { locale: 'en' } });
  expect(saved.ok()).toBeTruthy();
  await page.addInitScript(() => { localStorage.setItem('lq.locale', 'en'); localStorage.setItem('lq.module', 'DS'); });
  await page.goto('/profile');
  await expect(page.locator('#locale-preference')).toHaveValue('en');
  await expect(page.getByText('Settings', { exact: true })).toBeVisible();
  await capture(page, 'profile');
  await page.getByText('Study blocks', { exact: true }).scrollIntoViewIfNeeded();
  await capture(page, 'study-blocks');

  await page.goto('/');
  await expect(page.getByText(/^Daily goal[: ]/)).toBeVisible();
  await expect(page.getByRole('heading').first()).toBeVisible();
  await capture(page, 'home');
  await page.goto('/level/ds-01-l1');
  await expect(page.getByRole('button', { name: 'Check', exact: true })).toBeVisible();
  await capture(page, 'quiz');

  const response = await page.request.get('/api/knowledge/ERA', { headers });
  expect(response.ok()).toBeTruthy();
  const knowledge = await response.json() as KnowledgeModuleResponse;
  const entry = knowledge.units.flatMap((u) => u.entries).find((e) => e.requires.some((r) => r.type === 'essential' || r.type === 'background'));
  expect(entry).toBeTruthy();
  if (!entry) throw new Error('No prerequisite path available');
  await page.goto(`/wissen?m=ERA&q=${encodeURIComponent(entry.term)}`);
  const term = page.locator(`#${entry.id} > button`);
  // A matching knowledge deep link opens its entry automatically.
  await expect(term).toHaveAttribute('aria-expanded', 'true');
  await capture(page, 'knowledge');
  await page.getByRole('button', { name: /Explain from the foundations/ }).first().click({ timeout: 10_000 });
  await expect(page.getByRole('switch')).toBeVisible();
  await capture(page, 'learning-path');
  await page.getByRole('switch').click();
  await capture(page, 'learning-path-extended');

  await page.goto('/karten?m=DS');
  await expect(page.getByRole('button', { name: 'Flip card', exact: true })).toBeVisible();
  await capture(page, 'flashcards');
  await page.getByRole('button', { name: 'Flip card', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Got it', exact: true })).toBeVisible();
  await capture(page, 'flashcards-answer');

  await page.goto('/profile');
  const language = page.locator('#locale-preference');
  await language.selectOption('de');
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await expect(page.getByText('Einstellungen', { exact: true })).toBeVisible();
  await language.selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.reload();
  await expect(page.locator('#locale-preference')).toHaveValue('en');
  await capture(page, 'profile-persisted');
});

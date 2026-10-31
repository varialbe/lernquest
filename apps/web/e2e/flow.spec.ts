import { expect, test } from '@playwright/test';
import { creds } from './helpers.ts';

/**
 * E2E: Testuser loggt sich über die UI ein → spielt ein Level komplett (richtige Antworten aus den Level-Daten)
 * → bekommt XP und Coins → Streak ist aktiv (und steigt, falls heute noch nicht gelernt wurde).
 */
test('testuser plays a level and earns XP, coins and streak', async ({ page }) => {
  const c = creds('Testuser');
  await page.addInitScript(() => localStorage.setItem('lq.muted', '1'));
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(c.username);
  await page.getByLabel('Passwort').fill(c.password);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await page.getByText(/Tagesziel/).first().waitFor();

  const token = await page.evaluate(() => localStorage.getItem('lq.token'));
  const headers = { authorization: `Bearer ${token}` };
  const before = await (await page.request.get('/api/me', { headers })).json();
  const path = await (await page.request.get('/api/path', { headers })).json();
  const open = path.modules.flatMap((m: any) => m.units.flatMap((u: any) => u.levels)).find((l: any) => l.status === 'open');
  expect(open, 'kein offenes Level für den Testuser').toBeTruthy();
  const level = await (await page.request.get(`/api/levels/${open.id}`, { headers })).json();

  await page.goto(`/level/${open.id}`);
  for (let i = 0; i < level.questions.length; i++) {
    await page.getByRole('button', { name: 'Prüfen' }).waitFor();
    // aktuelle Frage anhand des Index (Reihenfolge = Level-Reihenfolge, alle richtig → keine Wiederholung)
    const q = level.questions[i];
    const options = page.locator('main button[aria-pressed]');
    const n = await options.count();
    for (let k = 0; k < n; k++) {
      if (q.correct.includes(q.options[k].id)) await options.nth(k).click();
    }
    await page.getByRole('button', { name: 'Prüfen' }).click();
    await expect(page.getByRole('status').getByRole('heading')).not.toHaveText('Nicht ganz …');
    await page.getByRole('button', { name: 'Weiter' }).click();
  }

  await expect(page.getByRole('heading', { name: /geschafft|Perfekt/ })).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${process.env.SHOT_DIR ?? 'screenshots'}/flow-reward.png` });

  const after = await (await page.request.get('/api/me', { headers })).json();
  expect(after.stats.xp).toBeGreaterThan(before.stats.xp);
  expect(after.stats.coins).toBeGreaterThanOrEqual(before.stats.coins);
  expect(after.stats.streakActiveToday).toBe(true);
  expect(after.stats.streak).toBeGreaterThanOrEqual(before.stats.streakActiveToday ? before.stats.streak : before.stats.streak + 1);
  console.log(`XP ${before.stats.xp} → ${after.stats.xp}, Coins ${before.stats.coins} → ${after.stats.coins}, Streak ${before.stats.streak} → ${after.stats.streak}`);
});

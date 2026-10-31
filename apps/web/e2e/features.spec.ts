import { expect, test } from '@playwright/test';
import { assertNoHorizontalOverflow, loginViaApi } from './helpers.ts';

/** Üben-Hub, Konzepte, Duelle, Tagesaufgaben, Klausur-Check und Schwächen-Runde (Testuser) */
const OUT = process.env.SHOT_DIR ?? 'screenshots';

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme}`, () => {
    test.use({ colorScheme: scheme });

    test(`hub screens (${scheme})`, async ({ page }) => {
      await loginViaApi(page, 'Testuser');
      for (const [name, url] of [
        ['20-home-quests', '/'],
        ['21-train', '/train'],
        ['22-mastery', '/mastery'],
        ['23-duels', '/duels'],
      ] as const) {
        await page.goto(url);
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(900);
        await page.screenshot({ path: `${OUT}/${scheme}-${name}.png` });
        expect(await assertNoHorizontalOverflow(page), `${name} hat horizontalen Overflow`).toBeLessThanOrEqual(0);
      }
      await page.getByRole('button', { name: 'Neues Duell' }).click();
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${OUT}/${scheme}-24-duel-new.png` });
    });

    test(`exam and weak runs (${scheme})`, async ({ page }) => {
      test.skip(scheme === 'dark' && !process.env.SHOT_ALL, 'Runden nur einmal spielen (schreibt Antworten)');
      await loginViaApi(page, 'Testuser');
      await page.goto('/exam/DS');
      const next = page.getByRole('button', { name: /^(Weiter|Abgeben)$/ });
      await next.waitFor();
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${OUT}/${scheme}-25-exam.png` });
      for (let i = 0; i < 20; i++) {
        const slider = page.getByRole('slider', { name: 'Schätzwert' });
        if (await slider.count()) {
          await slider.focus();
          await page.keyboard.press('ArrowRight');
        } else await page.locator('main button[aria-pressed]').first().click();
        await next.click();
        await page.waitForTimeout(250);
        if (!(await next.count())) break;
      }
      await page.getByText('Klausur-Check', { exact: true }).waitFor();
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${OUT}/${scheme}-26-exam-result.png` });
      const first = page.locator('main li button').first();
      if (await first.count()) {
        await first.click();
        await page.waitForTimeout(400);
        await page.screenshot({ path: `${OUT}/${scheme}-27-exam-review.png`, fullPage: true });
      }
      expect(await assertNoHorizontalOverflow(page)).toBeLessThanOrEqual(0);

      await page.goto('/weak/DS');
      await page.getByRole('button', { name: 'Prüfen' }).waitFor();
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${OUT}/${scheme}-28-weak.png` });
    });
  });
}

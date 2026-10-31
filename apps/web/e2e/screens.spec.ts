import { expect, test } from '@playwright/test';
import { assertNoHorizontalOverflow, loginViaApi } from './helpers.ts';

/** Screenshots aller Screens in 390×844, hell + dunkel → screenshots/<scheme>-<name>.png */
const OUT = process.env.SHOT_DIR ?? 'screenshots';

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme}`, () => {
    test.use({ colorScheme: scheme });

    test(`auth screens (${scheme})`, async ({ page }) => {
      await page.goto('/login');
      await page.getByRole('button', { name: 'Anmelden' }).waitFor();
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${OUT}/${scheme}-01-login.png` });
      await page.goto('/register?code=LQ-DEMO-CODE');
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${OUT}/${scheme}-02-register.png`, fullPage: true });
      expect(await assertNoHorizontalOverflow(page)).toBeLessThanOrEqual(0);
    });

    test(`admin screen (${scheme})`, async ({ page }) => {
      await loginViaApi(page, 'Admin');
      await page.goto('/admin');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${OUT}/${scheme}-09-admin.png` });
    });

    test(`app screens (${scheme})`, async ({ page }) => {
      await loginViaApi(page, 'Testuser');
      const shots: [string, string, (() => Promise<void>)?][] = [
        ['03-home', '/'],
        ['05-pets', '/pets'],
        ['06-shop', '/shop'],
        ['07-league', '/league'],
        ['08-profile', '/profile'],
        ['10-practice', '/practice'],
      ];
      for (const [name, url] of shots) {
        await page.goto(url);
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(900);
        await page.screenshot({ path: `${OUT}/${scheme}-${name}.png` });
        if (['08-profile', '06-shop'].includes(name)) await page.screenshot({ path: `${OUT}/${scheme}-${name}-full.png`, fullPage: true });
        expect(await assertNoHorizontalOverflow(page), `${name} hat horizontalen Overflow`).toBeLessThanOrEqual(0);
      }
    });

    test(`quiz screens (${scheme})`, async ({ page }) => {
      await loginViaApi(page, 'Admin');
      // Admin hat alles freigeschaltet → ein Diagramm-/Formel-Level zeigen, ohne Fortschritt zu speichern
      const level = process.env.SHOT_LEVEL ?? 'ds-01-l2';
      await page.goto(`/level/${level}`);
      await page.getByRole('button', { name: 'Prüfen' }).waitFor();
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${OUT}/${scheme}-11-quiz.png` });
      const options = page.locator('main button[aria-pressed]');
      await options.first().click();
      await page.screenshot({ path: `${OUT}/${scheme}-12-quiz-selected.png` });
      await page.getByRole('button', { name: 'Prüfen' }).click();
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${OUT}/${scheme}-13-quiz-feedback.png` });
      expect(await assertNoHorizontalOverflow(page)).toBeLessThanOrEqual(0);
      // Diagramm-Frage suchen (falls vorhanden)
      for (let i = 0; i < 14; i++) {
        if (await page.locator('main [role="img"][aria-label="Diagramm"] svg').count()) {
          await page.waitForTimeout(400);
          await page.screenshot({ path: `${OUT}/${scheme}-14-quiz-diagram.png` });
          break;
        }
        const next = page.getByRole('button', { name: 'Weiter' });
        if (await next.isVisible()) await next.click();
        await page.waitForTimeout(300);
        if (!(await page.getByRole('button', { name: 'Prüfen' }).isVisible())) break;
        await page.locator('main button[aria-pressed]').first().click();
        await page.getByRole('button', { name: 'Prüfen' }).click();
        await page.waitForTimeout(300);
      }
    });
  });
}

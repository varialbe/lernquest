import { expect, test } from '@playwright/test';
import { loginViaApi } from './helpers.ts';

test('profile, learning path, quiz and knowledge use English', async ({ page }) => {
  await loginViaApi(page, 'Testuser');

  await page.goto('/profile');
  const language = page.locator('#locale-preference');
  await language.waitFor();
  await language.selectOption('de');
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await language.selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByText('Settings', { exact: true })).toBeVisible();

  await page.goto('/');
  await expect(page.getByText(/^Daily goal[: ]/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Learn' })).toBeVisible();

  await page.route('**/api/levels/ds-01-l1', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        level: { id: 'ds-01-l1', index: 1, kind: 'normal', title: 'English quiz fixture', unitId: 'ds-01', unitTitle: 'Logic', module: 'DS' },
        questions: [
          {
            id: 'english-fixture-q1',
            type: 'single',
            prompt: 'Which statement is logically equivalent to its converse?',
            options: [
              { id: 'a', text: 'A conditional statement' },
              { id: 'b', text: 'A biconditional statement' },
              { id: 'c', text: 'A contradiction' },
            ],
            correct: ['b'],
            explanation: 'A biconditional states both directions of the implication.',
            source: { file: 'DS Lecture 1.md', heading: 'Equivalence' },
            difficulty: 1,
            concepts: ['biconditional'],
          },
        ],
      }),
    }),
  );
  await page.goto('/level/ds-01-l1');
  await expect(page.getByText('Which statement is logically equivalent to its converse?')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Choose the correct answer' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check' })).toBeVisible();

  await page.route('**/api/knowledge/DS', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        module: 'DS',
        units: [
          {
            unitId: 'ds-01',
            unitNumber: 1,
            unitTitle: 'Logic and sets',
            overview: 'Core ideas from the first lecture.',
            entries: [
              {
                id: 'ds-01-k01',
                term: 'Biconditional',
                kind: 'definition',
                short: 'A statement that implies each direction.',
                explanation: 'A biconditional is true when both implications hold.',
                example: null,
                pitfalls: [],
                related: [],
                heading: null,
                requires: [],
              },
            ],
          },
        ],
      }),
    }),
  );
  await page.goto('/wissen?m=DS&q=Biconditional');
  await expect(page.getByRole('link', { name: 'Knowledge' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Lecture', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Biconditional' })).toBeVisible();
  await expect(page.getByText('Definition', { exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

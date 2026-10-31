import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';

/** Zugangsdaten aus CREDENTIALS.local.md (oder Env) – Passwörter stehen nie im Code. */
export function creds(kind: 'Testuser' | 'Admin') {
  const env = kind === 'Testuser' ? [process.env.TEST_USER, process.env.TEST_PASS] : [process.env.ADMIN_USER, process.env.ADMIN_PASS];
  if (env[0] && env[1]) return { username: env[0], password: env[1] };
  const file = readFileSync(resolve(import.meta.dirname, '../../../CREDENTIALS.local.md'), 'utf8');
  const m = new RegExp(`${kind}: \`([^\`]+)\` / \`([^\`]+)\``).exec(file);
  if (!m) throw new Error(`${kind} nicht in CREDENTIALS.local.md`);
  return { username: m[1]!, password: m[2]! };
}

export async function loginViaApi(page: Page, kind: 'Testuser' | 'Admin' = 'Testuser') {
  const c = creds(kind);
  const res = await page.request.post('/api/auth/login', { data: c });
  const { token } = await res.json();
  await page.addInitScript((t) => {
    localStorage.setItem('lq.token', t);
    localStorage.setItem('lq.muted', '1');
  }, token);
  return token as string;
}

/** Keine horizontale Scrollbar, nichts über den Rand. */
export async function assertNoHorizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

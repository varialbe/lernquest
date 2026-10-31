import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
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

/** Tokens zwischen Tests wiederverwenden – sonst greift bei vielen Läufen das Login-Rate-Limit (10 / 15 min). */
const TOKEN_CACHE = resolve(import.meta.dirname, '../../../.tmp/e2e-tokens.json');
function cachedTokens(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(TOKEN_CACHE, 'utf8'));
  } catch {
    return {};
  }
}

export async function loginViaApi(page: Page, kind: 'Testuser' | 'Admin' = 'Testuser') {
  const cache = cachedTokens();
  let token = cache[kind];
  if (!token || !(await page.request.get('/api/me', { headers: { authorization: `Bearer ${token}` } })).ok()) {
    const res = await page.request.post('/api/auth/login', { data: creds(kind) });
    if (res.status() === 429) throw new Error('Login-Rate-Limit erreicht (10 pro 15 min) – kurz warten oder Token-Cache .tmp/e2e-tokens.json nutzen');
    if (!res.ok()) throw new Error(`Login als ${kind} fehlgeschlagen: ${res.status()}`);
    token = (await res.json()).token as string;
    mkdirSync(dirname(TOKEN_CACHE), { recursive: true });
    writeFileSync(TOKEN_CACHE, JSON.stringify({ ...cache, [kind]: token }), { mode: 0o600 });
  }
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

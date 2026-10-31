import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import type { DB } from '../src/db/index.ts';
import { authTokens, newsletterIssues, users } from '../src/db/schema.ts';
import { confirmedSubscribers, emailOf } from '../src/lib/account.ts';
import { decrypt, emailHash, encrypt } from '../src/lib/crypto.ts';
import { sentMails } from '../src/lib/mail.ts';
import { render, sendIssue } from '../src/lib/newsletter.ts';
import { testDb } from './helpers.ts';

let db: DB;
let app: FastifyInstance;
beforeEach(async () => {
  process.env.WEB_ORIGIN = 'https://lern.example.org,https://mateenbatt.de';
  db = testDb();
  app = await buildApp(db);
  sentMails.length = 0;
});

const register = (username: string, extra: Record<string, unknown> = {}) =>
  app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, email: `${username}@Example.org`, displayName: username, password: 'geheim1234', acceptPrivacy: true, ...extra } });
const authed = (t: string) => ({ authorization: `Bearer ${t}` });
const row = (username: string) => db.select().from(users).where(eq(users.username, username)).get()!;
/** Link aus der letzten Mail an `to` */
const linkIn = (to: string, re: RegExp) => {
  const m = [...sentMails].reverse().find((x) => x.to === to);
  return re.exec(m?.text ?? '')?.[0] ?? null;
};

describe('registration and login', () => {
  it('works without invite code, needs privacy confirmation and an e-mail', async () => {
    expect((await register('ida', { acceptPrivacy: false })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'ida', displayName: 'I', password: 'geheim1234', acceptPrivacy: true } })).statusCode).toBe(400);
    const r = await register('ida');
    expect(r.statusCode).toBe(200);
    const u = row('ida');
    expect(u.privacyAcceptedAt).toBeGreaterThan(0);
    expect(u.invitedWith).toBeNull();
  });

  it('stores e-mail only encrypted and finds it by keyed hash', async () => {
    await register('jan');
    const u = row('jan');
    expect(u.email).toBeNull();
    expect(u.emailEnc).not.toContain('jan@');
    expect(u.emailHash).toBe(emailHash('JAN@example.org'));
    expect(emailOf(u)).toBe('jan@example.org');
    expect(decrypt(encrypt('x@y.z'))).toBe('x@y.z');
    expect(decrypt('v1.kaputt.kaputt.kaputt')).toBeNull();
  });

  it('logs in with username or e-mail (case-insensitive)', async () => {
    await register('kim');
    for (const id of ['kim', 'KIM@example.org']) {
      expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: id, password: 'geheim1234' } })).statusCode).toBe(200);
    }
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'kim@example.org', password: 'falsch123' } })).statusCode).toBe(401);
  });

  it('rejects an e-mail that already belongs to someone else', async () => {
    await register('lea');
    const r = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'lea2', email: 'LEA@example.org', displayName: 'L', password: 'geheim1234', acceptPrivacy: true } });
    expect(r.statusCode).toBe(409);
  });

  it('sends a verification mail; the link verifies once and only stores the token hash', async () => {
    await register('max');
    const link = linkIn('max@example.org', /https:\/\/lern\.example\.org\/api\/auth\/verify\?token=[\w-]+/);
    expect(link).toBeTruthy();
    const token = new URL(link!).searchParams.get('token')!;
    expect(db.select().from(authTokens).all().some((t) => t.tokenHash.includes(token))).toBe(false);
    const res = await app.inject({ method: 'GET', url: `/api/auth/verify?token=${token}` });
    expect(res.statusCode).toBe(200);
    expect(row('max').emailVerifiedAt).toBeGreaterThan(0);
    expect((await app.inject({ method: 'GET', url: `/api/auth/verify?token=${token}` })).statusCode).toBe(400);
  });
});

describe('password reset', () => {
  it('mails a reset link for username or e-mail, resets once, ends old sessions', async () => {
    const old = (await register('nora')).json().token as string;
    const anon = await app.inject({ method: 'POST', url: '/api/auth/forgot', payload: { identifier: 'gibtsnicht' } });
    expect(anon.json()).toEqual({ ok: true }); // verrät nichts
    await app.inject({ method: 'POST', url: '/api/auth/forgot', payload: { identifier: 'NORA@example.org' }, headers: { origin: 'https://mateenbatt.de' } });
    const link = linkIn('nora@example.org', /https:\/\/mateenbatt\.de\/lernen\/reset\?token=[\w-]+/);
    expect(link).toBeTruthy();
    const token = new URL(link!).searchParams.get('token')!;
    const r = await app.inject({ method: 'POST', url: '/api/auth/reset', payload: { token, password: 'ganzneu123' } });
    expect(r.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: authed(old) })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'nora', password: 'ganzneu123' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/auth/reset', payload: { token, password: 'nochmal123' } })).statusCode).toBe(400);
  });
});

describe('newsletter double opt-in', () => {
  it('is pending until confirmed, then receives issues with footer and one-click unsubscribe', async () => {
    const t = (await register('olga', { newsletter: true })).json().token as string;
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: authed(t) })).json().settings.newsletter).toBe('pending');
    expect(confirmedSubscribers(db)).toHaveLength(0);
    const optIn = sentMails.find((m) => m.from === 'news' && m.to === 'olga@example.org')!;
    expect(optIn.subject).toMatch(/bestätige/i);
    const token = /newsletter\/confirm\?token=([\w-]+)/.exec(optIn.text)![1]!;
    expect((await app.inject({ method: 'GET', url: `/api/newsletter/confirm?token=${token}` })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: authed(t) })).json().settings.newsletter).toBe('confirmed');
    expect(row('olga').newsletterAt).toBeGreaterThan(0);

    const issue = db.insert(newsletterIssues).values({ subject: 'Neu: ERA', format: 'md', source: '# Hallo\n\nNeue **Level** sind da: https://x.y' }).returning().get();
    sentMails.length = 0;
    const r = await sendIssue(db, issue);
    expect(r).toEqual({ sent: 1, failed: 0, total: 1 });
    const mail = sentMails[0]!;
    expect(mail.from).toBe('news');
    expect(mail.html).toContain('<strong>Level</strong>');
    expect(mail.html).toContain('Newsletter abbestellen');
    expect(mail.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    const unsub = /<(.+)>/.exec(mail.headers!['List-Unsubscribe']!)![1]!;
    const path = unsub.replace('https://lern.example.org', '');
    expect((await app.inject({ method: 'GET', url: path.replace(/s=[^&]+/, 's=falsch') })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: path })).statusCode).toBe(200);
    expect(confirmedSubscribers(db)).toHaveLength(0);
    expect(db.select().from(newsletterIssues).where(eq(newsletterIssues.id, issue.id)).get()!.status).toBe('sent');
  });

  it('renders txt, html and markdown', () => {
    expect(render('txt', 'Hallo <du>\n\nhttps://a.b').html).toContain('&lt;du&gt;');
    expect(render('html', '<html><body><p>Hi</p><script>x()</script></body></html>').html).not.toContain('script');
    expect(render('md', '## Titel').html).toMatch(/<h2[^>]*style=/);
  });
});

describe('admin user management', () => {
  async function admin() {
    const t = (await register('admina')).json().token as string;
    db.update(users).set({ role: 'admin' }).where(eq(users.username, 'admina')).run();
    return t;
  }
  it('is admin-only and lists decrypted e-mails', async () => {
    const u = (await register('paul')).json().token as string;
    expect((await app.inject({ method: 'GET', url: '/api/admin/users', headers: authed(u) })).statusCode).toBe(403);
    const t = await admin();
    const list = (await app.inject({ method: 'GET', url: '/api/admin/users', headers: authed(t) })).json() as { username: string; email: string; hasPassword: boolean }[];
    expect(list.find((x) => x.username === 'paul')).toMatchObject({ email: 'paul@example.org', hasPassword: true });
  });
  it('edits, sends reset mail, resets progress, ends sessions and deletes', async () => {
    const t = await admin();
    const ut = (await register('rita')).json().token as string;
    const id = row('rita').id;
    db.update(users).set({ xp: 500, coins: 20, streak: 4 }).where(eq(users.id, id)).run();
    const h = authed(t);
    expect((await app.inject({ method: 'PATCH', url: `/api/admin/users/${id}`, headers: h, payload: { displayName: 'Rita R.', email: 'rita.neu@example.org' } })).statusCode).toBe(200);
    expect(emailOf(row('rita'))).toBe('rita.neu@example.org');
    expect(row('rita').emailVerifiedAt).toBeNull();
    expect((await app.inject({ method: 'POST', url: `/api/admin/users/${id}/send-reset`, headers: h })).json()).toMatchObject({ ok: true, to: 'rita.neu@example.org' });
    expect((await app.inject({ method: 'POST', url: `/api/admin/users/${id}/reset-progress`, headers: h })).statusCode).toBe(200);
    expect(row('rita')).toMatchObject({ xp: 0, coins: 0, streak: 0 });
    expect((await app.inject({ method: 'POST', url: `/api/admin/users/${id}/revoke-sessions`, headers: h })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: authed(ut) })).statusCode).toBe(401);
    expect((await app.inject({ method: 'DELETE', url: `/api/admin/users/${id}`, headers: h })).statusCode).toBe(200);
    expect(db.select().from(users).where(eq(users.id, id)).get()).toBeUndefined();
  });
});

describe('google', () => {
  it('builds an authorization URL with PKCE for the calling domain; unknown pending registrations expire', async () => {
    process.env.GOOGLE_CLIENT_ID = 'cid.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = 'secret';
    const r = await app.inject({ method: 'POST', url: '/api/auth/google/start', payload: { mode: 'login' }, headers: { origin: 'https://mateenbatt.de' } });
    const url = new URL(r.json().url);
    expect(url.host).toBe('accounts.google.com');
    expect(url.searchParams.get('redirect_uri')).toBe('https://mateenbatt.de/lernen/api/auth/google/callback');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    const native = await app.inject({ method: 'POST', url: '/api/auth/google/start', payload: { mode: 'login', native: true } });
    expect(new URL(native.json().url).searchParams.get('redirect_uri')).toBe('https://lern.example.org/api/auth/google/callback');
    expect((await app.inject({ method: 'POST', url: '/api/auth/google/poll', payload: { nonce: native.json().appNonce } })).json()).toEqual({ status: 'wait' });
    expect((await app.inject({ method: 'GET', url: '/api/auth/google/pending/xxxxxxxxxxxxxxxx' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/auth/google/start', payload: { mode: 'link' } })).statusCode).toBe(401);
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });
});

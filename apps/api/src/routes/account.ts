import { createHash, randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ForgotReq, GoogleCompleteReq, ResetReq } from '@lernquest/shared';
import type { DB } from '../db/index.ts';
import { invites, users } from '../db/schema.ts';
import {
  consumeToken,
  emailFields,
  emailOf,
  issueToken,
  requestNewsletter,
  sendVerify,
  stopNewsletter,
  suggestUsername,
  unusablePasswordHash,
  userByEmail,
  userByIdentifier,
} from '../lib/account.ts';
import { createSession, hashPassword, requireAuth, revokeAllSessions, toPublicUser, userFromRequest } from '../lib/auth.ts';
import { maskEmail, verifySig } from '../lib/crypto.ts';
import { badRequest, conflict, HttpError } from '../lib/http.ts';
import { appUrl, layout, resetMail, sendMail } from '../lib/mail.ts';
import { addStarterPet } from '../lib/shop.ts';
import { localeForUser, type Locale } from '../lib/locale.ts';
import { deviceLocaleFromHeaders, preferenceFromHeaders } from '../lib/locale.ts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Kleine Ergebnis-Seite (für Links aus Mails, die im Browser geöffnet werden) */
function page(reply: FastifyReply, title: string, text: string, app: string, cta?: string, locale: Locale = 'de') {
  reply.header('content-type', 'text/html; charset=utf-8').header('cache-control', 'no-store');
  return reply.send(
    layout({
      title,
      app,
      locale,
      body: `<h1 style="margin:0 0 12px;font-size:22px;font-weight:900">${esc(title)}</h1><p style="margin:0 0 18px">${esc(text)}</p><a href="${esc(app)}" style="display:inline-block;padding:12px 22px;border-radius:14px;background:#7c5cff;color:#fff;font-weight:800;text-decoration:none">${esc(cta ?? (locale === 'en' ? 'Open LernQuest' : 'LernQuest öffnen'))}</a>`,
    }),
  );
}

// ---------- Google (OAuth 2.0 / OpenID Connect, Authorization Code + PKCE) ----------
type OAuthState = { mode: 'login' | 'link'; userId?: number; app: string; redirectUri: string; verifier: string; appNonce?: string; locale: Locale; expires: number };
type Outcome = { status: 'code'; code: string } | { status: 'pending'; pendingId: string } | { status: 'linked' } | { status: 'error'; message: string };
type Pending = { sub: string; email: string; name: string; expires: number };

const states = new Map<string, OAuthState>();
const loginCodes = new Map<string, { userId: number; expires: number }>();
const pendings = new Map<string, Pending>();
const appResults = new Map<string, { outcome?: Outcome; expires: number }>();
const rnd = () => randomBytes(24).toString('base64url');
function sweep() {
  const now = Date.now();
  for (const m of [states, loginCodes, pendings, appResults] as Map<string, { expires: number }>[]) for (const [k, v] of m) if (v.expires < now) m.delete(k);
}

const googleId = () => process.env.GOOGLE_CLIENT_ID?.trim() ?? '';
const googleSecret = () => process.env.GOOGLE_CLIENT_SECRET?.trim() ?? '';

/** ID-Token direkt vom Token-Endpunkt (TLS, mit Client-Secret) → Claims prüfen (aud/iss/exp), Signaturprüfung ist dann laut OIDC nicht nötig */
function readIdToken(idToken: string) {
  const payload = JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>;
  if (payload.aud !== googleId()) throw new Error('aud passt nicht');
  if (!['https://accounts.google.com', 'accounts.google.com'].includes(String(payload.iss))) throw new Error('iss passt nicht');
  if (Number(payload.exp) * 1000 < Date.now()) throw new Error('Token abgelaufen');
  return {
    sub: String(payload.sub),
    email: typeof payload.email === 'string' ? payload.email.toLowerCase() : '',
    emailVerified: payload.email_verified === true || payload.email_verified === 'true',
    name: String(payload.name ?? payload.given_name ?? '').trim(),
  };
}

export function accountRoutes(app: FastifyInstance, db: DB) {
  const auth = { preHandler: requireAuth(db) };
  const strict = { config: { rateLimit: { max: 8, timeWindow: '15 minutes' } } };
  const normal = { config: { rateLimit: { max: 30, timeWindow: '15 minutes' } } };

  // ---------- E-Mail bestätigen ----------
  app.get('/api/auth/verify', async (req, reply) => {
    const { token } = z.object({ token: z.string().min(20).max(200) }).parse(req.query);
    try {
      const { user, app: target } = consumeToken(db, 'verify', token);
      db.update(users).set({ emailVerifiedAt: Date.now() }).where(eq(users.id, user.id)).run();
      const locale = localeForUser(user);
      return page(reply, locale === 'en' ? 'Email verified ✅' : 'E-Mail bestätigt ✅', locale === 'en' ? `Thank you, ${user.displayName}! Your email address is now verified.` : `Danke, ${user.displayName}! Deine Adresse ist jetzt bestätigt.`, target ?? appUrl(), undefined, locale);
    } catch (e) {
      const locale = deviceLocaleFromHeaders(req.headers);
      return page(reply.code(400), locale === 'en' ? 'Invalid link' : 'Link ungültig', locale === 'en' ? 'This link is invalid or has expired. Please request a new one in the app.' : (e as Error).message, appUrl(), undefined, locale);
    }
  });

  app.post('/api/auth/verify/resend', { ...auth, ...strict }, async (req) => {
    if (!emailOf(req.user)) throw badRequest('no_email', 'Du hast noch keine E-Mail-Adresse hinterlegt.');
    if (req.user.emailVerifiedAt) return { ok: true, already: true };
    await sendVerify(db, req.user, appUrl(req.headers.origin));
    return { ok: true };
  });

  // ---------- Passwort vergessen ----------
  app.post('/api/auth/forgot', strict, async (req) => {
    const body = ForgotReq.parse(req.body);
    const u = userByIdentifier(db, body.identifier);
    const to = u ? emailOf(u) : null;
    // immer dieselbe Antwort – verrät nicht, ob es das Konto gibt
    if (u && to && !u.disabled) {
      const target = appUrl(req.headers.origin);
      const token = issueToken(db, u.id, 'reset', 3_600_000, target);
      await sendMail(resetMail({ to, name: u.displayName, username: u.username, link: `${target}/reset?token=${token}`, app: target, locale: localeForUser(u) })).catch((e) => req.log.error(e, 'Reset-Mail fehlgeschlagen'));
    }
    return { ok: true };
  });

  app.post('/api/auth/reset', strict, async (req) => {
    const body = ResetReq.parse(req.body);
    const { user } = consumeToken(db, 'reset', body.token);
    // Link aus der Mail beweist auch, dass die Adresse stimmt
    db.update(users)
      .set({ passwordHash: await hashPassword(body.password), hasPassword: true, mustChangePassword: false, emailVerifiedAt: user.emailVerifiedAt ?? Date.now() })
      .where(eq(users.id, user.id))
      .run();
    revokeAllSessions(db, user.id);
    const fresh = db.select().from(users).where(eq(users.id, user.id)).get()!;
    return { token: createSession(db, user.id, req.headers['user-agent']), user: toPublicUser(fresh) };
  });

  // ---------- Newsletter (Double-Opt-in) ----------
  app.get('/api/newsletter/confirm', async (req, reply) => {
    const { token } = z.object({ token: z.string().min(20).max(200) }).parse(req.query);
    try {
      const { user, app: target } = consumeToken(db, 'newsletter', token);
      const now = Date.now();
      db.update(users).set({ newsletter: true, newsletterAt: now, newsletterRequestedAt: null, emailVerifiedAt: user.emailVerifiedAt ?? now }).where(eq(users.id, user.id)).run();
      const locale = localeForUser(user);
      return page(reply, locale === 'en' ? 'Newsletter confirmed 📬' : 'Newsletter bestätigt 📬', locale === 'en' ? 'Thank you! You are now subscribed to the LernQuest newsletter. Unsubscribe at any time using the link in each email or in your profile.' : 'Danke! Du bekommst ab jetzt den LernQuest-Newsletter. Abbestellen kannst du jederzeit per Link in jeder Mail oder im Profil.', target ?? appUrl(), undefined, locale);
    } catch (e) {
      const locale = deviceLocaleFromHeaders(req.headers);
      return page(reply.code(400), locale === 'en' ? 'Invalid link' : 'Link ungültig', locale === 'en' ? 'This link is invalid or has expired. Please request a new one in the app.' : (e as Error).message, appUrl(), undefined, locale);
    }
  });

  const unsubscribe = (req: FastifyRequest) => {
    const q = z.object({ u: z.coerce.number().int().positive(), s: z.string().max(64) }).parse(req.query);
    if (!verifySig(`unsub:${q.u}`, q.s)) throw badRequest('bad_link', 'Ungültiger Abmeldelink.');
    const user = db.select().from(users).where(eq(users.id, q.u)).get();
    stopNewsletter(db, q.u);
    return user ? localeForUser(user) : deviceLocaleFromHeaders(req.headers);
  };
  app.get('/api/newsletter/unsubscribe', async (req, reply) => {
    try {
      const locale = unsubscribe(req);
      return page(reply, locale === 'en' ? 'Unsubscribed' : 'Abgemeldet', locale === 'en' ? 'You will no longer receive the LernQuest newsletter. You can subscribe again at any time in your profile.' : 'Du bekommst keinen LernQuest-Newsletter mehr. Schade – aber du kannst ihn im Profil jederzeit wieder abonnieren.', appUrl(), undefined, locale);
    } catch (e) {
      const locale = deviceLocaleFromHeaders(req.headers);
      return page(reply.code(400), locale === 'en' ? 'Invalid link' : 'Link ungültig', locale === 'en' ? 'This link is invalid or has expired. Please request a new one in the app.' : (e as Error).message, appUrl(), undefined, locale);
    }
  });
  // One-Click-Abmeldung (RFC 8058, „List-Unsubscribe-Post“)
  app.post('/api/newsletter/unsubscribe', async (req) => {
    unsubscribe(req);
    return { ok: true };
  });

  // ---------- Google ----------
  app.post('/api/auth/google/start', normal, async (req) => {
    if (!googleId() || !googleSecret()) throw new HttpError(503, 'google_off', 'Google-Anmeldung ist nicht eingerichtet.');
    sweep();
    const body = z.object({ mode: z.enum(['login', 'link']).default('login'), native: z.boolean().optional() }).parse(req.body ?? {});
    let userId: number | undefined;
    if (body.mode === 'link') {
      const u = userFromRequest(db, req);
      if (!u) throw new HttpError(401, 'unauthorized', 'Bitte melde dich an.');
      userId = u.id;
    }
    const target = appUrl(body.native ? null : req.headers.origin);
    const redirectUri = `${target}/api/auth/google/callback`;
    const state = rnd();
    const verifier = rnd() + rnd();
    const appNonce = body.native ? rnd() : undefined;
    const expires = Date.now() + 10 * 60_000;
    states.set(state, { mode: body.mode, userId, app: target, redirectUri, verifier, appNonce, locale: preferenceFromHeaders(req.headers) ?? deviceLocaleFromHeaders(req.headers), expires });
    if (appNonce) appResults.set(appNonce, { expires });
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: googleId(),
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    }).toString();
    return { url: url.toString(), appNonce };
  });

  app.get('/api/auth/google/callback', async (req, reply) => {
    const q = z.object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional() }).parse(req.query);
    const st = q.state ? states.get(q.state) : undefined;
    if (q.state) states.delete(q.state);
    if (!st || st.expires < Date.now()) return page(reply.code(400), deviceLocaleFromHeaders(req.headers) === 'en' ? 'Sign-in expired' : 'Anmeldung abgelaufen', deviceLocaleFromHeaders(req.headers) === 'en' ? 'Please start Google sign-in again.' : 'Bitte starte die Google-Anmeldung noch einmal.', appUrl(), undefined, deviceLocaleFromHeaders(req.headers));

    let outcome: Outcome;
    try {
      if (q.error || !q.code) throw new Error(q.error === 'access_denied' ? 'Anmeldung abgebrochen.' : 'Google hat keinen Code geliefert.');
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code: q.code, client_id: googleId(), client_secret: googleSecret(), redirect_uri: st.redirectUri, grant_type: 'authorization_code', code_verifier: st.verifier }),
        signal: AbortSignal.timeout(15_000),
      });
      const tok = (await res.json()) as { id_token?: string; error_description?: string };
      if (!res.ok || !tok.id_token) throw new Error(tok.error_description ?? `Google-Fehler ${res.status}`);
      const g = readIdToken(tok.id_token);
      outcome = resolveGoogle(g, st);
    } catch (e) {
      req.log.warn({ err: (e as Error).message }, 'Google-Anmeldung fehlgeschlagen');
      outcome = { status: 'error', message: (e as Error).message.slice(0, 200) };
    }

    if (st.appNonce) {
      // iOS-App: Ergebnis abholen lassen (die App fragt per /poll nach)
      appResults.set(st.appNonce, { outcome, expires: Date.now() + 10 * 60_000 });
      return outcome.status === 'error'
        ? page(reply, st.locale === 'en' ? 'Sign-in failed' : 'Das hat nicht geklappt', st.locale === 'en' ? 'Please return to the app and try again.' : outcome.message, st.app, st.locale === 'en' ? 'Back' : 'Zurück', st.locale)
        : page(reply, st.locale === 'en' ? 'Done ✅' : 'Fertig ✅', st.locale === 'en' ? 'You can close this window and return to the LernQuest app.' : 'Du kannst dieses Fenster schließen und zur LernQuest-App zurückkehren.', st.app, st.locale === 'en' ? 'Open app' : 'Zur App', st.locale);
    }
    const to =
      outcome.status === 'code'
        ? `${st.app}/login?oauth=${outcome.code}`
        : outcome.status === 'pending'
          ? `${st.app}/register?google=${outcome.pendingId}`
          : outcome.status === 'linked'
            ? `${st.app}/profile?google=linked`
            : `${st.app}/${st.mode === 'link' ? 'profile' : 'login'}?oauthError=${encodeURIComponent(outcome.message)}`;
    return reply.redirect(to, 302);
  });

  /** Google-Konto → Login, Verknüpfung oder ausstehende Registrierung */
  function resolveGoogle(g: ReturnType<typeof readIdToken>, st: OAuthState): Outcome {
    const bySub = db.select().from(users).where(eq(users.googleSub, g.sub)).get();
    if (st.mode === 'link') {
      if (bySub && bySub.id !== st.userId) return { status: 'error', message: 'Dieses Google-Konto ist schon mit einem anderen LernQuest-Konto verknüpft.' };
      const u = db.select().from(users).where(eq(users.id, st.userId!)).get();
      if (!u) return { status: 'error', message: 'Konto nicht gefunden.' };
      const patch: Partial<typeof users.$inferInsert> = { googleSub: g.sub };
      if (!u.emailEnc && g.email && g.emailVerified && !userByEmail(db, g.email)) Object.assign(patch, emailFields(db, g.email, { exceptUserId: u.id, verified: true }));
      db.update(users).set(patch).where(eq(users.id, u.id)).run();
      return { status: 'linked' };
    }
    let user = bySub;
    // bestehendes Konto mit derselben, dort bestätigten Adresse → automatisch verknüpfen
    if (!user && g.email && g.emailVerified) {
      const byMail = userByEmail(db, g.email);
      if (byMail?.emailVerifiedAt) {
        db.update(users).set({ googleSub: g.sub }).where(eq(users.id, byMail.id)).run();
        user = byMail;
      } else if (byMail) {
        return { status: 'error', message: 'Zu dieser E-Mail gibt es schon ein Konto. Melde dich mit Passwort an und verknüpfe Google im Profil.' };
      }
    }
    if (user) {
      if (user.disabled) return { status: 'error', message: 'Dein Account ist gesperrt.' };
      const code = rnd();
      loginCodes.set(code, { userId: user.id, expires: Date.now() + 2 * 60_000 });
      return { status: 'code', code };
    }
    if (!g.email || !g.emailVerified) return { status: 'error', message: 'Dein Google-Konto hat keine bestätigte E-Mail-Adresse.' };
    const pendingId = rnd();
    pendings.set(pendingId, { sub: g.sub, email: g.email, name: g.name, expires: Date.now() + 30 * 60_000 });
    return { status: 'pending', pendingId };
  }

  app.post('/api/auth/google/exchange', normal, async (req) => {
    const { code } = z.object({ code: z.string().min(10).max(100) }).parse(req.body);
    const c = loginCodes.get(code);
    loginCodes.delete(code);
    if (!c || c.expires < Date.now()) throw new HttpError(401, 'oauth_expired', 'Anmeldung abgelaufen – bitte nochmal versuchen.');
    const u = db.select().from(users).where(eq(users.id, c.userId)).get()!;
    const deviceLocale = deviceLocaleFromHeaders(req.headers);
    const locale = u.locale ?? preferenceFromHeaders(req.headers);
    db.update(users).set({ deviceLocale, locale }).where(eq(users.id, u.id)).run();
    return { token: createSession(db, u.id, req.headers['user-agent']), user: toPublicUser({ ...u, locale, deviceLocale }) };
  });

  app.post('/api/auth/google/poll', async (req) => {
    const { nonce } = z.object({ nonce: z.string().min(10).max(100) }).parse(req.body);
    const r = appResults.get(nonce);
    if (!r || r.expires < Date.now()) return { status: 'expired' };
    if (!r.outcome) return { status: 'wait' };
    appResults.delete(nonce);
    return r.outcome;
  });

  app.get<{ Params: { id: string } }>('/api/auth/google/pending/:id', async (req) => {
    const p = pendings.get(req.params.id);
    if (!p || p.expires < Date.now()) throw new HttpError(404, 'pending_expired', 'Die Google-Anmeldung ist abgelaufen – bitte nochmal starten.');
    return { email: maskEmail(p.email), name: p.name, username: suggestUsername(db, p.email.split('@')[0]!) };
  });

  app.post('/api/auth/google/complete', strict, async (req) => {
    const body = GoogleCompleteReq.parse(req.body);
    const p = pendings.get(body.pendingId);
    if (!p || p.expires < Date.now()) throw new HttpError(400, 'pending_expired', 'Die Google-Anmeldung ist abgelaufen – bitte nochmal starten.');
    const username = body.username.toLowerCase();
    const code = body.inviteCode?.toUpperCase();
    const passwordHash = await unusablePasswordHash();
    const now = Date.now();
    const mail = emailFields(db, p.email, { verified: true });
    const user = db.transaction((tx) => {
      if (code) {
        const inv = tx.select().from(invites).where(eq(invites.code, code)).get();
        if (!inv || inv.revoked) throw badRequest('invalid_invite', 'Diesen Einladungscode gibt es nicht – lass das Feld einfach leer.');
        tx.update(invites).set({ uses: sql`${invites.uses} + 1` }).where(eq(invites.code, code)).run();
      }
      if (tx.select().from(users).where(eq(users.username, username)).get()) throw conflict('username_taken', 'Benutzername ist schon vergeben.');
      if (tx.select().from(users).where(eq(users.googleSub, p.sub)).get()) throw conflict('google_taken', 'Dieses Google-Konto ist schon verknüpft.');
      return tx
        .insert(users)
        .values({ username, displayName: body.displayName, passwordHash, hasPassword: false, googleSub: p.sub, invitedWith: code ?? null, ...mail, locale: preferenceFromHeaders(req.headers), deviceLocale: deviceLocaleFromHeaders(req.headers), privacyAcceptedAt: now })
        .returning()
        .get();
    });
    pendings.delete(body.pendingId);
    addStarterPet(db, user.id, body.starterPet);
    if (body.newsletter) await requestNewsletter(db, user, appUrl(req.headers.origin)).catch((e) => req.log.error(e, 'Opt-in-Mail fehlgeschlagen'));
    return { token: createSession(db, user.id, req.headers['user-agent']), user: toPublicUser(user) };
  });

  app.delete('/api/me/google', auth, async (req) => {
    if (!req.user.hasPassword) throw badRequest('need_password', 'Leg zuerst ein Passwort fest (Passwort vergessen?), sonst kommst du nicht mehr in dein Konto.');
    db.update(users).set({ googleSub: null }).where(eq(users.id, req.user.id)).run();
    return { ok: true };
  });

}

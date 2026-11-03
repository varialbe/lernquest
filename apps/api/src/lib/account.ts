import { randomBytes } from 'node:crypto';
import { and, eq, gt, isNotNull, isNull, sql } from 'drizzle-orm';
import type { DB } from '../db/index.ts';
import { answers, authTokens, levelProgress, questClaims, quizRuns, reviewItems, users, xpEvents, studyBlocks, studyClaims } from '../db/schema.ts';
import type { AuthUser } from './auth.ts';
import { hashPassword } from './auth.ts';
import { decrypt, emailHash, encrypt, newToken, normalizeEmail, sign, tokenHash } from './crypto.ts';
import { badRequest, conflict, HttpError } from './http.ts';
import { apiUrl, optInMail, sendMail, verifyMail } from './mail.ts';

/** Klartext-E-Mail eines Nutzers (entschlüsselt) */
export const emailOf = (u: Pick<AuthUser, 'emailEnc'>) => decrypt(u.emailEnc);

export const userByEmail = (db: DB, email: string) => db.select().from(users).where(eq(users.emailHash, emailHash(email))).get();

/** Benutzername oder E-Mail → Nutzer */
export function userByIdentifier(db: DB, identifier: string) {
  const id = identifier.trim();
  if (id.includes('@')) return userByEmail(db, id);
  return db.select().from(users).where(eq(users.username, id.toLowerCase())).get();
}

/** Felder für eine (neue) E-Mail-Adresse; wirft, wenn sie schon zu einem anderen Konto gehört */
export function emailFields(db: DB, email: string, opts: { exceptUserId?: number; verified?: boolean } = {}) {
  const norm = normalizeEmail(email);
  const other = userByEmail(db, norm);
  if (other && other.id !== opts.exceptUserId) throw conflict('email_taken', 'Diese E-Mail-Adresse gehört schon zu einem anderen Konto.');
  return { emailEnc: encrypt(norm), emailHash: emailHash(norm), emailVerifiedAt: opts.verified ? Date.now() : null, email: null };
}

const DAY = 86_400_000;
export function issueToken(db: DB, userId: number, kind: 'verify' | 'reset' | 'newsletter', ttlMs: number, app: string) {
  const { token, hash } = newToken();
  // pro Art nur ein gültiger Token
  db.delete(authTokens).where(and(eq(authTokens.userId, userId), eq(authTokens.kind, kind))).run();
  db.insert(authTokens).values({ userId, kind, tokenHash: hash, meta: { app }, expiresAt: Date.now() + ttlMs }).run();
  return token;
}

/** Token einlösen (genau einmal). Gibt Nutzer + App-URL zurück. */
export function consumeToken(db: DB, kind: 'verify' | 'reset' | 'newsletter', token: string) {
  const row = db
    .select()
    .from(authTokens)
    .where(and(eq(authTokens.tokenHash, tokenHash(token)), eq(authTokens.kind, kind), isNull(authTokens.usedAt), gt(authTokens.expiresAt, Date.now())))
    .get();
  if (!row) throw new HttpError(400, 'token_invalid', 'Der Link ist abgelaufen oder wurde schon benutzt.');
  db.update(authTokens).set({ usedAt: Date.now() }).where(eq(authTokens.id, row.id)).run();
  const user = db.select().from(users).where(eq(users.id, row.userId)).get();
  if (!user) throw new HttpError(400, 'token_invalid', 'Konto nicht gefunden.');
  return { user, app: row.meta.app };
}

/** Bestätigungs-Mail für die E-Mail-Adresse */
export async function sendVerify(db: DB, u: AuthUser, app: string) {
  const to = emailOf(u);
  if (!to) return;
  const token = issueToken(db, u.id, 'verify', 7 * DAY, app);
  await sendMail(verifyMail({ to, name: u.displayName, link: `${apiUrl()}/auth/verify?token=${token}`, app }));
}

/** Newsletter: Anmeldung vormerken und Double-Opt-in-Mail schicken */
export async function requestNewsletter(db: DB, u: AuthUser, app: string) {
  const to = emailOf(u);
  if (!to) throw badRequest('email_required', 'Für den Newsletter brauchen wir deine E-Mail-Adresse.');
  if (u.newsletter) return;
  db.update(users).set({ newsletterRequestedAt: Date.now() }).where(eq(users.id, u.id)).run();
  const token = issueToken(db, u.id, 'newsletter', 7 * DAY, app);
  await sendMail(optInMail({ to, name: u.displayName, link: `${apiUrl()}/newsletter/confirm?token=${token}`, app }));
}

export function stopNewsletter(db: DB, userId: number) {
  db.update(users).set({ newsletter: false, newsletterAt: null, newsletterRequestedAt: null }).where(eq(users.id, userId)).run();
  db.delete(authTokens).where(and(eq(authTokens.userId, userId), eq(authTokens.kind, 'newsletter'))).run();
}

/** Abmeldelink ohne gespeicherten Token (signiert) */
export const unsubscribeUrl = (userId: number) => `${apiUrl()}/newsletter/unsubscribe?u=${userId}&s=${sign(`unsub:${userId}`)}`;

export const confirmedSubscribers = (db: DB) =>
  db
    .select({ id: users.id, emailEnc: users.emailEnc, displayName: users.displayName })
    .from(users)
    .where(and(eq(users.newsletter, true), isNotNull(users.emailEnc), eq(users.disabled, false)))
    .all();

/** Nutzername aus E-Mail/Name vorschlagen (frei, 3–24 Zeichen) */
export function suggestUsername(db: DB, base: string) {
  let stem = base.toLowerCase().normalize('NFKD').replace(/[^a-z0-9_.-]/g, '').slice(0, 20);
  if (stem.length < 3) stem = `lerner${stem}`;
  for (let i = 0; i < 1000; i++) {
    const name = i ? `${stem}${i}`.slice(0, 24) : stem;
    if (!db.select({ id: users.id }).from(users).where(eq(users.username, name)).get()) return name;
  }
  return `${stem.slice(0, 14)}${randomBytes(4).toString('hex')}`;
}

/** Unbenutzbarer Passwort-Hash für reine Google-Konten */
export const unusablePasswordHash = () => hashPassword(randomBytes(32).toString('base64url'));

/** Lernfortschritt, XP, Coins und Streak zurücksetzen (Konto, Pets und gekaufte Items bleiben) */
export function resetProgress(db: DB, userId: number) {
  db.transaction((tx) => {
    for (const t of [levelProgress, answers, reviewItems, xpEvents, questClaims, studyBlocks, studyClaims] as const) tx.delete(t).where(eq(t.userId, userId)).run();
    tx.delete(quizRuns).where(eq(quizRuns.userId, userId)).run();
    tx.update(users).set({ xp: 0, coins: 0, streak: 0, longestStreak: 0, lastActiveDay: null, streakFreezes: 0, leagueTier: 0 }).where(eq(users.id, userId)).run();
  });
}

/** Einmalig: Klartext-Adressen aus Migration 0003 verschlüsseln */
export function migrateLegacyEmails(db: DB) {
  const rows = db.select({ id: users.id, email: users.email }).from(users).where(isNotNull(users.email)).all();
  for (const r of rows) {
    try {
      db.update(users).set(emailFields(db, r.email!, { exceptUserId: r.id })).where(eq(users.id, r.id)).run();
    } catch {
      db.update(users).set({ email: null }).where(eq(users.id, r.id)).run();
    }
  }
  return rows.length;
}

export const subscriberCounts = (db: DB) =>
  db
    .select({
      confirmed: sql<number>`sum(case when ${users.newsletter} then 1 else 0 end)`,
      pending: sql<number>`sum(case when not ${users.newsletter} and ${users.newsletterRequestedAt} is not null then 1 else 0 end)`,
    })
    .from(users)
    .get() ?? { confirmed: 0, pending: 0 };

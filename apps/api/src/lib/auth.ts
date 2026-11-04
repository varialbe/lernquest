import { createHash, randomBytes, randomInt } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { and, eq, gt, lt } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { PublicUser } from '@lernquest/shared';
import type { DB } from '../db/index.ts';
import { sessions, users } from '../db/schema.ts';
import { deviceLocaleFromHeaders } from './locale.ts';
import { HttpError } from './http.ts';

const SESSION_DAYS = 90;
// OWASP-Empfehlung für argon2id (19 MiB, t=2)
const ARGON = { algorithm: 2 /* Argon2id */, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export const hashPassword = (pw: string) => hash(pw, ARGON);
export const verifyPassword = (stored: string, pw: string) => verify(stored, pw).catch(() => false);
/** Konstantzeit-Dummy, damit unbekannte Benutzernamen nicht schneller antworten. */
const DUMMY = hash('dummy-password', ARGON);
export const burnPasswordCheck = async (pw: string) => verify(await DUMMY, pw).catch(() => false);

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Lesbares Zufallspasswort ohne verwechselbare Zeichen. */
export function randomPassword(len = 14): string {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: len }, () => chars[randomInt(chars.length)]).join('');
}
export const randomInviteCode = () => `LQ-${randomPassword(4).toUpperCase()}-${randomPassword(4).toUpperCase()}`;

export function createSession(db: DB, userId: number, userAgent?: string): string {
  const token = randomBytes(32).toString('base64url');
  db.insert(sessions)
    .values({ tokenHash: sha256(token), userId, userAgent: userAgent?.slice(0, 200), expiresAt: Date.now() + SESSION_DAYS * 86_400_000 })
    .run();
  return token;
}

export function revokeSession(db: DB, token: string) {
  db.delete(sessions).where(eq(sessions.tokenHash, sha256(token))).run();
}
export function revokeAllSessions(db: DB, userId: number) {
  db.delete(sessions).where(eq(sessions.userId, userId)).run();
}

export type AuthUser = typeof users.$inferSelect;

export const toPublicUser = (u: AuthUser): PublicUser => ({
  id: u.id,
  username: u.username,
  displayName: u.displayName,
  role: u.role,
  mustChangePassword: u.mustChangePassword,
});

const bearer = (req: FastifyRequest) => {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7).trim() : null;
};

/** Löst den Session-Token auf (sliding expiry); null wenn ungültig. */
export function userFromRequest(db: DB, req: FastifyRequest): AuthUser | null {
  const token = bearer(req);
  if (!token) return null;
  const now = Date.now();
  const row = db
    .select({ user: users, session: sessions })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, now)))
    .get();
  if (!row || row.user.disabled) return null;
  // nur gelegentlich schreiben (max. 1× pro Stunde)
  if (now - row.session.lastSeenAt > 3_600_000) {
    db.update(sessions).set({ lastSeenAt: now, expiresAt: now + SESSION_DAYS * 86_400_000 }).where(eq(sessions.id, row.session.id)).run();
  }
  return row.user;
}

export function cleanupSessions(db: DB) {
  db.delete(sessions).where(lt(sessions.expiresAt, Date.now())).run();
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser;
  }
}

export const requireAuth = (db: DB) => async (req: FastifyRequest, _reply: FastifyReply) => {
  const u = userFromRequest(db, req);
  if (!u) throw new HttpError(401, 'unauthorized', 'Bitte melde dich an.');
  const hasDeviceLocale = req.headers['x-lq-device-locale'] != null || req.headers['accept-language'] != null;
  const deviceLocale = hasDeviceLocale ? deviceLocaleFromHeaders(req.headers) : u.deviceLocale;
  if ((deviceLocale === 'de' || deviceLocale === 'en') && deviceLocale !== u.deviceLocale) {
    db.update(users).set({ deviceLocale }).where(eq(users.id, u.id)).run();
    req.user = { ...u, deviceLocale };
  } else req.user = u;
};

export const requireAdmin = (db: DB) => async (req: FastifyRequest, reply: FastifyReply) => {
  await requireAuth(db)(req, reply);
  if (req.user.role !== 'admin') throw new HttpError(403, 'forbidden', 'Nur für Admins.');
};

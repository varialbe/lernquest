import { randomUUID } from 'node:crypto';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { DB } from '../db/index.ts';
import { passkeys, users } from '../db/schema.ts';
import { createSession, requireAuth, toPublicUser } from '../lib/auth.ts';
import { badRequest, HttpError, notFound } from '../lib/http.ts';

/**
 * Relying Party = die Web-Origin, über die die App gerade läuft (lern.varialbe.xyz oder mateenbatt.de, Liste in WEB_ORIGIN).
 * Ein Passkey gilt nur für die Domain, auf der er angelegt wurde. Die iOS-App (capacitor://localhost) kann ohne Associated Domains keine Passkeys.
 */
function rp(req: FastifyRequest) {
  const allowed = (process.env.WEB_ORIGIN ?? 'http://localhost:5173').split(',').map((s) => s.trim()).filter((s) => /^https?:\/\//.test(s));
  const sent = req.headers.origin;
  const origin = sent && allowed.includes(sent) ? sent : allowed[0]!;
  return { origin, rpID: new URL(origin).hostname };
}

/** Challenges kurzlebig im Speicher (eine API-Instanz) */
const challenges = new Map<string, { challenge: string; userId?: number; expires: number }>();
function keepChallenge(challenge: string, userId?: number) {
  const now = Date.now();
  for (const [k, v] of challenges) if (v.expires < now) challenges.delete(k);
  const id = randomUUID();
  challenges.set(id, { challenge, userId, expires: now + 5 * 60_000 });
  return id;
}
function takeChallenge(id: string, userId?: number) {
  const c = challenges.get(id);
  challenges.delete(id);
  if (!c || c.expires < Date.now() || c.userId !== userId) throw badRequest('challenge_expired', 'Zeit abgelaufen – bitte nochmal versuchen.');
  return c.challenge;
}

const Finish = z.object({ challengeId: z.string().uuid(), response: z.record(z.string(), z.unknown()), name: z.string().trim().max(60).optional() });

export function passkeyRoutes(app: FastifyInstance, db: DB) {
  const auth = { preHandler: requireAuth(db) };
  const limit = { config: { rateLimit: { max: 20, timeWindow: '15 minutes' } } };

  // ---------- Anmelden ----------
  app.post('/api/auth/passkey/options', limit, async (req) => {
    const { rpID } = rp(req);
    const options = await generateAuthenticationOptions({ rpID, userVerification: 'preferred', allowCredentials: [] });
    return { challengeId: keepChallenge(options.challenge), options };
  });

  app.post('/api/auth/passkey/login', limit, async (req) => {
    const body = Finish.parse(req.body);
    const response = body.response as unknown as AuthenticationResponseJSON;
    const expectedChallenge = takeChallenge(body.challengeId);
    const pk = db.select().from(passkeys).where(eq(passkeys.id, String(response.id))).get();
    if (!pk) throw new HttpError(401, 'unknown_passkey', 'Dieser Passkey ist nicht (mehr) bei LernQuest hinterlegt.');
    const { origin, rpID } = rp(req);
    const v = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
      credential: { id: pk.id, publicKey: Buffer.from(pk.publicKey, 'base64url'), counter: pk.counter, transports: pk.transports as AuthenticatorTransportFuture[] },
    }).catch(() => null);
    if (!v?.verified) throw new HttpError(401, 'passkey_failed', 'Passkey konnte nicht bestätigt werden.');
    const u = db.select().from(users).where(eq(users.id, pk.userId)).get();
    if (!u) throw new HttpError(401, 'unknown_passkey', 'Account nicht gefunden.');
    if (u.disabled) throw new HttpError(403, 'disabled', 'Dein Account ist gesperrt.');
    db.update(passkeys).set({ counter: v.authenticationInfo.newCounter, lastUsedAt: Date.now() }).where(eq(passkeys.id, pk.id)).run();
    return { token: createSession(db, u.id, req.headers['user-agent']), user: toPublicUser(u) };
  });

  // ---------- Verwalten (eingeloggt) ----------
  app.get('/api/me/passkeys', auth, async (req) => ({
    passkeys: db
      .select({ id: passkeys.id, name: passkeys.name, createdAt: passkeys.createdAt, lastUsedAt: passkeys.lastUsedAt })
      .from(passkeys)
      .where(eq(passkeys.userId, req.user.id))
      .all(),
  }));

  app.post('/api/me/passkeys/options', { ...auth, ...limit }, async (req) => {
    const { rpID } = rp(req);
    const existing = db.select({ id: passkeys.id, transports: passkeys.transports }).from(passkeys).where(eq(passkeys.userId, req.user.id)).all();
    const options = await generateRegistrationOptions({
      rpName: 'LernQuest',
      rpID,
      userName: req.user.username,
      userDisplayName: req.user.displayName,
      userID: new TextEncoder().encode(`lq-${req.user.id}`),
      attestationType: 'none',
      excludeCredentials: existing.map((p) => ({ id: p.id, transports: p.transports as AuthenticatorTransportFuture[] })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    });
    return { challengeId: keepChallenge(options.challenge, req.user.id), options };
  });

  app.post('/api/me/passkeys', { ...auth, ...limit }, async (req) => {
    const body = Finish.parse(req.body);
    const expectedChallenge = takeChallenge(body.challengeId, req.user.id);
    const { origin, rpID } = rp(req);
    const v = await verifyRegistrationResponse({
      response: body.response as unknown as RegistrationResponseJSON,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    }).catch((e: Error) => {
      throw badRequest('passkey_invalid', `Passkey konnte nicht angelegt werden: ${e.message}`);
    });
    if (!v.verified || !v.registrationInfo) throw badRequest('passkey_invalid', 'Passkey konnte nicht bestätigt werden.');
    const { credential } = v.registrationInfo;
    db.insert(passkeys)
      .values({
        id: credential.id,
        userId: req.user.id,
        publicKey: Buffer.from(credential.publicKey).toString('base64url'),
        counter: credential.counter,
        transports: credential.transports ?? [],
        name: body.name || 'Passkey',
      })
      .onConflictDoNothing()
      .run();
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/me/passkeys/:id', auth, async (req) => {
    const r = db.delete(passkeys).where(and(eq(passkeys.id, req.params.id), eq(passkeys.userId, req.user.id))).run();
    if (!r.changes) throw notFound('Passkey nicht gefunden.');
    return { ok: true };
  });
}

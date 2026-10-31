import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  ACHIEVEMENTS,
  ChangePasswordReq,
  CompleteLevelReq,
  EquipReq,
  LoginReq,
  MODULES,
  PracticeSubmitReq,
  RegisterReq,
  ReportReq,
  SettingsReq,
  SHOP_ITEMS,
  type ProfileResponse,
} from '@lernquest/shared';
import { z } from 'zod';
import type { DB } from '../db/index.ts';
import { invites, pushSubscriptions, questionReports, questions, users } from '../db/schema.ts';
import {
  burnPasswordCheck,
  createSession,
  hashPassword,
  requireAuth,
  revokeAllSessions,
  revokeSession,
  toPublicUser,
  verifyPassword,
} from '../lib/auth.ts';
import { buildPath, completeLevel, completePractice, getLevel, meResponse, practiceSet, unlockedAchievements, userStats } from '../lib/game.ts';
import { badRequest, conflict, HttpError, notFound } from '../lib/http.ts';
import { calendar, leaderboard } from '../lib/league.ts';
import { pushEnabled } from '../lib/push.ts';
import { addStarterPet, equip, purchase, validateSettings } from '../lib/shop.ts';

export function userRoutes(app: FastifyInstance, db: DB) {
  const auth = { preHandler: requireAuth(db) };
  const authLimit = { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } };

  app.get('/api/health', async () => {
    db.$client.prepare('select 1').get();
    return { ok: true, time: new Date().toISOString() };
  });

  app.get('/api/config', async () => ({
    sourceLinkBase: process.env.SOURCE_LINK_BASE || 'https://github.com/varialbe/studium/blob/main',
    vapidPublicKey: pushEnabled() ? process.env.VAPID_PUBLIC_KEY : null,
  }));

  // ---------- Auth ----------
  app.post('/api/auth/register', authLimit, async (req) => {
    const body = RegisterReq.parse(req.body);
    const username = body.username.toLowerCase();
    const code = body.inviteCode.trim().toUpperCase();
    const passwordHash = await hashPassword(body.password);
    const user = db.transaction((tx) => {
      const inv = tx.select().from(invites).where(eq(invites.code, code)).get();
      if (!inv || inv.revoked || inv.uses >= inv.maxUses || (inv.expiresAt && inv.expiresAt < Date.now())) {
        throw badRequest('invalid_invite', 'Einladungscode ungültig oder schon verbraucht.');
      }
      if (tx.select().from(users).where(eq(users.username, username)).get()) throw conflict('username_taken', 'Benutzername ist schon vergeben.');
      const u = tx.insert(users).values({ username, displayName: body.displayName, passwordHash, invitedWith: code }).returning().get();
      tx.update(invites).set({ uses: sql`${invites.uses} + 1` }).where(eq(invites.code, code)).run();
      return u;
    });
    addStarterPet(db, user.id, body.starterPet);
    const token = createSession(db, user.id, req.headers['user-agent']);
    return { token, user: toPublicUser(user) };
  });

  app.post('/api/auth/login', authLimit, async (req) => {
    const body = LoginReq.parse(req.body);
    const u = db.select().from(users).where(eq(users.username, body.username.toLowerCase())).get();
    if (!u) {
      await burnPasswordCheck(body.password);
      throw new HttpError(401, 'invalid_credentials', 'Benutzername oder Passwort falsch.');
    }
    if (!(await verifyPassword(u.passwordHash, body.password))) throw new HttpError(401, 'invalid_credentials', 'Benutzername oder Passwort falsch.');
    if (u.disabled) throw new HttpError(403, 'disabled', 'Dein Account ist gesperrt.');
    return { token: createSession(db, u.id, req.headers['user-agent']), user: toPublicUser(u) };
  });

  app.post('/api/auth/logout', auth, async (req) => {
    revokeSession(db, req.headers.authorization!.slice(7).trim());
    return { ok: true };
  });

  app.post('/api/auth/password', { ...auth, ...authLimit }, async (req) => {
    const body = ChangePasswordReq.parse(req.body);
    if (!req.user.mustChangePassword && !(await verifyPassword(req.user.passwordHash, body.oldPassword))) {
      throw badRequest('wrong_password', 'Aktuelles Passwort ist falsch.');
    }
    db.update(users).set({ passwordHash: await hashPassword(body.newPassword), mustChangePassword: false }).where(eq(users.id, req.user.id)).run();
    revokeAllSessions(db, req.user.id);
    return { token: createSession(db, req.user.id, req.headers['user-agent']) };
  });

  // ---------- Ich ----------
  app.get('/api/me', auth, async (req) => meResponse(db, req.user));

  app.patch('/api/me/settings', auth, async (req) => {
    const s = SettingsReq.parse(req.body);
    validateSettings(db, req.user.id, s);
    const patch: Partial<typeof users.$inferInsert> = {};
    if (s.displayName !== undefined) patch.displayName = s.displayName;
    if (s.dailyGoal !== undefined) patch.dailyGoal = s.dailyGoal;
    if (s.theme !== undefined) patch.theme = s.theme;
    if (s.frame !== undefined) patch.frame = s.frame;
    if (s.activePet !== undefined) patch.activePet = s.activePet;
    if (s.soundOn !== undefined) patch.soundOn = s.soundOn;
    if (Object.keys(patch).length) db.update(users).set(patch).where(eq(users.id, req.user.id)).run();
    return meResponse(db, db.select().from(users).where(eq(users.id, req.user.id)).get()!);
  });

  // ---------- Lernen ----------
  app.get('/api/path', auth, async (req) => buildPath(db, req.user));
  app.get<{ Params: { id: string } }>('/api/levels/:id', auth, async (req) => getLevel(db, req.user, req.params.id));
  app.post<{ Params: { id: string } }>('/api/levels/:id/complete', auth, async (req) => {
    const body = CompleteLevelReq.parse(req.body);
    return completeLevel(db, req.user, req.params.id, body.answers);
  });
  app.get('/api/practice', auth, async (req) => ({ questions: practiceSet(db, req.user) }));
  app.post('/api/practice/complete', auth, async (req) => completePractice(db, req.user, PracticeSubmitReq.parse(req.body).answers));

  app.post('/api/reports', { ...auth, config: { rateLimit: { max: 30, timeWindow: '1 hour' } } }, async (req) => {
    const body = ReportReq.parse(req.body);
    if (!db.select().from(questions).where(eq(questions.id, body.questionId)).get()) throw notFound('Frage nicht gefunden');
    const open = db
      .select()
      .from(questionReports)
      .where(and(eq(questionReports.userId, req.user.id), eq(questionReports.questionId, body.questionId), eq(questionReports.status, 'open')))
      .get();
    if (open) return { ok: true, duplicate: true };
    db.insert(questionReports).values({ userId: req.user.id, questionId: body.questionId, reason: body.reason, comment: body.comment ?? null }).run();
    return { ok: true };
  });

  // ---------- Shop & Pets ----------
  app.get('/api/shop', auth, async () => ({ items: SHOP_ITEMS }));
  app.post('/api/shop/buy', auth, async (req) => {
    const { itemId } = z.object({ itemId: z.string() }).parse(req.body);
    purchase(db, req.user.id, itemId);
    return meResponse(db, db.select().from(users).where(eq(users.id, req.user.id)).get()!);
  });
  app.post('/api/pets/equip', auth, async (req) => {
    const body = EquipReq.parse(req.body);
    equip(db, req.user.id, body.petId, body.accessory);
    return meResponse(db, req.user);
  });

  // ---------- Sozial ----------
  app.get<{ Params: { kind: string } }>('/api/leaderboard/:kind', auth, async (req) => leaderboard(db, req.user.id, req.params.kind));

  app.get<{ Params: { username: string } }>('/api/profile/:username', auth, async (req): Promise<ProfileResponse> => {
    const target = req.params.username === 'me' ? req.user : db.select().from(users).where(eq(users.username, req.params.username.toLowerCase())).get();
    if (!target || target.disabled) throw notFound('Profil nicht gefunden');
    const me = meResponse(db, target);
    const s = userStats(db, target.id);
    const unlocked = new Set(unlockedAchievements(db, target.id));
    const path = buildPath(db, target);
    return {
      user: toPublicUser(target),
      joinedAt: new Date(target.createdAt).toISOString(),
      stats: { ...me.stats, levelsDone: s.levelsDone, perfectLevels: s.perfectLevels, questionsAnswered: s.questionsAnswered, accuracy: s.accuracy },
      calendar: calendar(db, target.id),
      achievements: ACHIEVEMENTS.map((a) => ({ id: a.id, unlocked: unlocked.has(a.id) })),
      moduleProgress: MODULES.map((m) => {
        const mod = path.modules.find((x) => x.id === m)!;
        const lv = mod.units.flatMap((u) => u.levels);
        return { module: m, done: lv.filter((l) => l.status === 'done' || l.status === 'gold').length, total: lv.length };
      }),
    };
  });

  // ---------- Web Push ----------
  app.post('/api/push/subscribe', auth, async (req) => {
    const sub = z.object({ endpoint: z.url().max(1000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) }).parse(req.body);
    db.insert(pushSubscriptions)
      .values({ userId: req.user.id, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth })
      .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId: req.user.id, p256dh: sub.keys.p256dh, auth: sub.keys.auth } })
      .run();
    return { ok: true };
  });
  app.post('/api/push/unsubscribe', auth, async (req) => {
    const { endpoint } = z.object({ endpoint: z.string() }).parse(req.body);
    db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, req.user.id))).run();
    return { ok: true };
  });
}

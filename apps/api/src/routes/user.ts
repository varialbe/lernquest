import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  ACHIEVEMENTS,
  ChangePasswordReq,
  CompleteLevelReq,
  CreateDuelReq,
  EquipReq,
  LoginReq,
  CardReviewReq,
  MODULES,
  ModuleId,
  PracticeSubmitReq,
  RegisterReq,
  ReportReq,
  RunSubmitReq,
  SettingsReq,
  SHOP_ITEMS,
  StartExamReq,
  StartWeakReq,
  type ProfileResponse,
} from '@lernquest/shared';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { DB } from '../db/index.ts';
import { adminNotifications, invites, pushSubscriptions, questionReports, questions, users } from '../db/schema.ts';
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
import { buildDiscover, buildPath, completeLevel, completePractice, getLevel, meResponse, practiceSet, unlockedAchievements, userStats } from '../lib/game.ts';
import { badRequest, conflict, HttpError, notFound } from '../lib/http.ts';
import { createDuel, declineDuel, listDuels, playDuel, resolveDuel } from '../lib/duels.ts';
import { calendar, leaderboard } from '../lib/league.ts';
import { pushEnabled } from '../lib/push.ts';
import { emailFields, emailOf, requestNewsletter, sendVerify, stopNewsletter, userByIdentifier } from '../lib/account.ts';
import { appUrl } from '../lib/mail.ts';
import { claimQuest, questsFor } from '../lib/quests.ts';
import { completeRun, mastery, startExam, startWeak } from '../lib/runs.ts';
import { knowledgeForModule } from '../lib/knowledge.ts';
import { cardSession, cardsOverview, reviewCard } from '../lib/cards.ts';
import { weeklyRecap } from '../lib/recap.ts';
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
    googleLogin: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  }));

  // Live-Update der iOS-App: Manifest des neuesten Web-Pakets (deploy-web.sh legt es ab). Über die API wegen CORS (capacitor://localhost).
  app.get('/api/app/update', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    try {
      return JSON.parse(await readFile(`${process.env.WEB_ROOT ?? '/var/www/lernquest'}/app-updates/latest.json`, 'utf8'));
    } catch {
      return { version: null };
    }
  });

  // Fehlgeschlagene Live-Updates der iOS-App melden (sonst unsichtbar). Ohne Login, eng begrenzt.
  app.post('/api/app/diag', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req) => {
    const d = z.object({ version: z.string().max(60), stage: z.string().max(20), error: z.string().max(500) }).parse(req.body);
    req.log.warn({ appUpdate: d }, 'Live-Update fehlgeschlagen');
    db.insert(adminNotifications).values({ level: 'warn', title: d.stage === 'haptic' ? 'iOS-Haptik fehlgeschlagen' : `iOS-Live-Update fehlgeschlagen (${d.stage})`, body: `App-Version ${d.version}: ${d.error}` }).run();
    return { ok: true };
  });

  // ---------- Auth ----------
  app.post('/api/auth/register', authLimit, async (req) => {
    const body = RegisterReq.parse(req.body);
    const username = body.username.toLowerCase();
    // Einladungscode ist optional – er zeigt dem Admin nur, über wen jemand gekommen ist
    const code = body.inviteCode?.toUpperCase();
    const passwordHash = await hashPassword(body.password);
    const now = Date.now();
    const mail = emailFields(db, body.email);
    const user = db.transaction((tx) => {
      if (code) {
        const inv = tx.select().from(invites).where(eq(invites.code, code)).get();
        if (!inv || inv.revoked) throw badRequest('invalid_invite', 'Diesen Einladungscode gibt es nicht – lass das Feld einfach leer.');
        tx.update(invites).set({ uses: sql`${invites.uses} + 1` }).where(eq(invites.code, code)).run();
      }
      if (tx.select().from(users).where(eq(users.username, username)).get()) throw conflict('username_taken', 'Benutzername ist schon vergeben.');
      return tx
        .insert(users)
        .values({
          username,
          displayName: body.displayName,
          passwordHash,
          invitedWith: code ?? null,
          ...mail,
          privacyAcceptedAt: now,
        })
        .returning()
        .get();
    });
    addStarterPet(db, user.id, body.starterPet);
    const app = appUrl(req.headers.origin);
    // Mails dürfen die Registrierung nicht scheitern lassen
    await sendVerify(db, user, app).catch((e) => req.log.error(e, 'Bestätigungs-Mail fehlgeschlagen'));
    if (body.newsletter) await requestNewsletter(db, user, app).catch((e) => req.log.error(e, 'Opt-in-Mail fehlgeschlagen'));
    const token = createSession(db, user.id, req.headers['user-agent']);
    return { token, user: toPublicUser(user) };
  });

  app.post('/api/auth/login', authLimit, async (req) => {
    const body = LoginReq.parse(req.body);
    const u = userByIdentifier(db, body.username);
    if (!u) {
      await burnPasswordCheck(body.password);
      throw new HttpError(401, 'invalid_credentials', 'Benutzername/E-Mail oder Passwort falsch.');
    }
    if (!u.hasPassword) {
      await burnPasswordCheck(body.password);
      throw new HttpError(401, 'google_only', 'Dieses Konto nutzt „Mit Google anmelden“. Über „Passwort vergessen?“ kannst du zusätzlich ein Passwort festlegen.');
    }
    if (!(await verifyPassword(u.passwordHash, body.password))) throw new HttpError(401, 'invalid_credentials', 'Benutzername/E-Mail oder Passwort falsch.');
    if (u.disabled) throw new HttpError(403, 'disabled', 'Dein Account ist gesperrt.');
    return { token: createSession(db, u.id, req.headers['user-agent']), user: toPublicUser(u) };
  });

  app.post('/api/auth/logout', auth, async (req) => {
    revokeSession(db, req.headers.authorization!.slice(7).trim());
    return { ok: true };
  });

  app.post('/api/auth/password', { ...auth, ...authLimit }, async (req) => {
    const body = ChangePasswordReq.parse(req.body);
    // reine Google-Konten haben noch kein Passwort → kein altes abfragen
    if (req.user.hasPassword && !req.user.mustChangePassword && !(await verifyPassword(req.user.passwordHash, body.oldPassword))) {
      throw badRequest('wrong_password', 'Aktuelles Passwort ist falsch.');
    }
    db.update(users).set({ passwordHash: await hashPassword(body.newPassword), mustChangePassword: false, hasPassword: true }).where(eq(users.id, req.user.id)).run();
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
    if (s.weeklyRecap !== undefined) patch.weeklyRecap = s.weeklyRecap;
    const app = appUrl(req.headers.origin);
    let emailChanged = false;
    if (s.email !== undefined && s.email !== emailOf(req.user)) {
      Object.assign(patch, emailFields(db, s.email, { exceptUserId: req.user.id }));
      emailChanged = true;
      // neue Adresse: Newsletter muss neu bestätigt werden
      if (req.user.newsletter || req.user.newsletterRequestedAt) Object.assign(patch, { newsletter: false, newsletterAt: null, newsletterRequestedAt: null });
    }
    if (Object.keys(patch).length) db.update(users).set(patch).where(eq(users.id, req.user.id)).run();
    let fresh = db.select().from(users).where(eq(users.id, req.user.id)).get()!;
    if (emailChanged) await sendVerify(db, fresh, app).catch((e) => req.log.error(e, 'Bestätigungs-Mail fehlgeschlagen'));
    if (s.newsletter === true) await requestNewsletter(db, fresh, app);
    if (s.newsletter === false) stopNewsletter(db, req.user.id);
    if (s.newsletter !== undefined) fresh = db.select().from(users).where(eq(users.id, req.user.id)).get()!;
    return meResponse(db, fresh);
  });

  // ---------- Lernen ----------
  app.get('/api/path', auth, async (req) => buildPath(db, req.user));
  app.get('/api/discover', auth, async (req) => buildDiscover(db, req.user));
  app.get<{ Params: { id: string } }>('/api/levels/:id', auth, async (req) => getLevel(db, req.user, req.params.id));
  app.post<{ Params: { id: string } }>('/api/levels/:id/complete', auth, async (req) => {
    const body = CompleteLevelReq.parse(req.body);
    return completeLevel(db, req.user, req.params.id, body.answers);
  });
  app.get('/api/practice', auth, async (req) => ({ questions: practiceSet(db, req.user) }));
  app.post('/api/practice/complete', auth, async (req) => completePractice(db, req.user, PracticeSubmitReq.parse(req.body).answers));

  // ---------- Schwächen, Klausur-Check, Duelle ----------
  app.get('/api/mastery', auth, async (req) => mastery(db, req.user));
  // Wissenssammlung (Nachschlagewerk) je Modul
  app.get<{ Params: { module: string } }>('/api/knowledge/:module', auth, async (req) => knowledgeForModule(db, ModuleId.parse(req.params.module.toUpperCase()), req.user.id));
  // Karteikarten aus der Wissenssammlung (Leitner)
  app.get('/api/cards', auth, async (req) => cardsOverview(db, req.user));
  app.get<{ Params: { module: string }; Querystring: { unit?: string } }>('/api/cards/:module', auth, async (req) =>
    cardSession(db, req.user, ModuleId.parse(req.params.module.toUpperCase()), req.query.unit ? String(req.query.unit).slice(0, 10) : undefined),
  );
  app.post('/api/cards/review', auth, async (req) => {
    const b = CardReviewReq.parse(req.body);
    return reviewCard(db, req.user, b.entryId, b.known);
  });
  // Wochenrückblick (iOS-App plant ihn lokal, Web-App bekommt ihn per Push)
  app.get('/api/recap', auth, async (req) => weeklyRecap(db, req.user));
  app.post('/api/runs/weak', auth, async (req) => startWeak(db, req.user, StartWeakReq.parse(req.body ?? {}).module));
  app.post('/api/runs/exam', auth, async (req) => startExam(db, req.user, StartExamReq.parse(req.body).module));
  app.post<{ Params: { id: string } }>('/api/runs/:id/complete', auth, async (req) => {
    const body = RunSubmitReq.parse(req.body);
    return completeRun(db, req.user, req.params.id, body.answers, body.durationSec, { afterDuelRun: (duelId) => resolveDuel(db, duelId, req.user.id) });
  });
  app.get('/api/duels', auth, async (req) => listDuels(db, req.user));
  app.post('/api/duels', { ...auth, config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req) => {
    const body = CreateDuelReq.parse(req.body);
    return createDuel(db, req.user, body.opponent, body.module);
  });
  app.post<{ Params: { id: string } }>('/api/duels/:id/play', auth, async (req) => playDuel(db, req.user, req.params.id));
  app.post<{ Params: { id: string } }>('/api/duels/:id/decline', auth, async (req) => {
    declineDuel(db, req.user, req.params.id);
    return { ok: true };
  });

  // ---------- Tagesaufgaben ----------
  app.get('/api/quests', auth, async (req) => questsFor(db, req.user));
  app.post<{ Params: { id: string } }>('/api/quests/:id/claim', auth, async (req) => claimQuest(db, req.user, req.params.id));

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

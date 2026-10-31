import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { desc, eq, sql } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DB } from '../db/index.ts';
import { adminNotifications, invites, passkeys, pipelineRuns, processedFiles, questionReports, questions, sessions, units, users } from '../db/schema.ts';
import { emailFields, emailOf, issueToken, resetProgress, sendVerify, subscriberCounts } from '../lib/account.ts';
import { appUrl, resetMail, sendMail } from '../lib/mail.ts';
import { hashPassword, randomInviteCode, randomPassword, requireAdmin, revokeAllSessions } from '../lib/auth.ts';
import { badRequest, HttpError, notFound } from '../lib/http.ts';

const dataDir = () => dirname(process.env.DATABASE_PATH ?? 'data/lernquest.db');
const Id = z.coerce.number().int().positive();

export function adminRoutes(app: FastifyInstance, db: DB) {
  const admin = { preHandler: requireAdmin(db) };

  app.get('/api/admin/overview', admin, async () => {
    const count = (t: SQLiteTable) => db.select({ n: sql<number>`count(*)` }).from(t).get()?.n ?? 0;
    return {
      users: count(users),
      units: count(units),
      questions: db.select({ n: sql<number>`count(*)` }).from(questions).where(eq(questions.active, true)).get()?.n ?? 0,
      openReports: db.select({ n: sql<number>`count(*)` }).from(questionReports).where(eq(questionReports.status, 'open')).get()?.n ?? 0,
      unreadNotifications: db.select({ n: sql<number>`count(*)` }).from(adminNotifications).where(eq(adminNotifications.read, false)).get()?.n ?? 0,
      lastRun: db.select().from(pipelineRuns).orderBy(desc(pipelineRuns.startedAt)).limit(1).get() ?? null,
      failedFiles: db.select().from(processedFiles).where(eq(processedFiles.status, 'failed')).all(),
      newsletter: subscriberCounts(db),
    };
  });

  // ---------- Nutzer ----------
  app.get('/api/admin/users', admin, async () => {
    const sessionCount = new Map(db.select({ u: sessions.userId, n: sql<number>`count(*)` }).from(sessions).groupBy(sessions.userId).all().map((r) => [r.u, r.n]));
    const passkeyCount = new Map(db.select({ u: passkeys.userId, n: sql<number>`count(*)` }).from(passkeys).groupBy(passkeys.userId).all().map((r) => [r.u, r.n]));
    return db
      .select()
      .from(users)
      .orderBy(users.id)
      .all()
      .map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        role: u.role,
        disabled: u.disabled,
        unlockAll: u.unlockAll,
        xp: u.xp,
        coins: u.coins,
        streak: u.streak,
        lastActiveDay: u.lastActiveDay,
        createdAt: u.createdAt,
        invitedWith: u.invitedWith,
        email: emailOf(u),
        emailVerified: !!u.emailVerifiedAt,
        newsletter: u.newsletter ? 'confirmed' : u.newsletterRequestedAt ? 'pending' : 'none',
        google: !!u.googleSub,
        hasPassword: u.hasPassword,
        sessions: sessionCount.get(u.id) ?? 0,
        passkeys: passkeyCount.get(u.id) ?? 0,
      }));
  });

  app.patch<{ Params: { id: string } }>('/api/admin/users/:id', admin, async (req) => {
    const id = Id.parse(req.params.id);
    const body = z
      .object({
        disabled: z.boolean().optional(),
        unlockAll: z.boolean().optional(),
        role: z.enum(['user', 'admin']).optional(),
        coins: z.number().int().min(0).max(1e6).optional(),
        displayName: z.string().trim().min(1).max(40).optional(),
        username: z.string().trim().toLowerCase().regex(/^[a-z0-9_.-]{3,24}$/, '3–24 Zeichen: a–z, 0–9, _ . -').optional(),
        email: z.string().trim().toLowerCase().email().max(120).nullable().optional(),
      })
      .parse(req.body);
    if (id === req.user.id && (body.disabled || body.role === 'user')) throw badRequest('self', 'Du kannst dich nicht selbst sperren oder degradieren.');
    const target = db.select().from(users).where(eq(users.id, id)).get();
    if (!target) throw notFound('Nutzer nicht gefunden');
    const { email, ...rest } = body;
    const patch: Partial<typeof users.$inferInsert> = { ...rest };
    if (rest.username && rest.username !== target.username && db.select({ id: users.id }).from(users).where(eq(users.username, rest.username)).get()) {
      throw badRequest('username_taken', 'Benutzername ist schon vergeben.');
    }
    if (email === null) Object.assign(patch, { emailEnc: null, emailHash: null, emailVerifiedAt: null, newsletter: false, newsletterAt: null, newsletterRequestedAt: null });
    else if (email !== undefined && email !== emailOf(target)) Object.assign(patch, emailFields(db, email, { exceptUserId: id }), { newsletter: false, newsletterAt: null, newsletterRequestedAt: null });
    db.update(users).set(patch).where(eq(users.id, id)).run();
    if (body.disabled) revokeAllSessions(db, id);
    if (email) await sendVerify(db, db.select().from(users).where(eq(users.id, id)).get()!, appUrl()).catch((e) => req.log.error(e));
    return { ok: true };
  });

  /** Temporäres Passwort – wird genau einmal angezeigt; Nutzer muss es beim nächsten Login ändern. */
  app.post<{ Params: { id: string } }>('/api/admin/users/:id/reset-password', admin, async (req) => {
    const id = Id.parse(req.params.id);
    if (!db.select().from(users).where(eq(users.id, id)).get()) throw notFound('Nutzer nicht gefunden');
    const temp = randomPassword(12);
    db.update(users).set({ passwordHash: await hashPassword(temp), mustChangePassword: true, hasPassword: true }).where(eq(users.id, id)).run();
    revokeAllSessions(db, id);
    return { temporaryPassword: temp };
  });

  /** Reset-Link per Mail an die hinterlegte Adresse */
  app.post<{ Params: { id: string } }>('/api/admin/users/:id/send-reset', admin, async (req) => {
    const u = db.select().from(users).where(eq(users.id, Id.parse(req.params.id))).get();
    if (!u) throw notFound('Nutzer nicht gefunden');
    const to = emailOf(u);
    if (!to) throw badRequest('no_email', 'Für dieses Konto ist keine E-Mail-Adresse hinterlegt – nutze das temporäre Passwort.');
    const target = appUrl();
    const token = issueToken(db, u.id, 'reset', 24 * 3_600_000, target);
    await sendMail(resetMail({ to, name: u.displayName, username: u.username, link: `${target}/reset?token=${token}`, app: target }));
    return { ok: true, to };
  });

  app.post<{ Params: { id: string } }>('/api/admin/users/:id/reset-progress', admin, async (req) => {
    const id = Id.parse(req.params.id);
    if (!db.select({ id: users.id }).from(users).where(eq(users.id, id)).get()) throw notFound('Nutzer nicht gefunden');
    resetProgress(db, id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/admin/users/:id/revoke-sessions', admin, async (req) => {
    revokeAllSessions(db, Id.parse(req.params.id));
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/admin/users/:id/google', admin, async (req) => {
    const id = Id.parse(req.params.id);
    const u = db.select().from(users).where(eq(users.id, id)).get();
    if (!u) throw notFound('Nutzer nicht gefunden');
    if (!u.hasPassword) throw badRequest('need_password', 'Das Konto hat kein Passwort – erst ein temporäres Passwort vergeben.');
    db.update(users).set({ googleSub: null }).where(eq(users.id, id)).run();
    return { ok: true };
  });

  /** Konto endgültig löschen (alle Daten per ON DELETE CASCADE) */
  app.delete<{ Params: { id: string } }>('/api/admin/users/:id', admin, async (req) => {
    const id = Id.parse(req.params.id);
    if (id === req.user.id) throw badRequest('self', 'Du kannst dein eigenes Konto hier nicht löschen.');
    const r = db.delete(users).where(eq(users.id, id)).run();
    if (!r.changes) throw notFound('Nutzer nicht gefunden');
    return { ok: true };
  });

  // ---------- Einladungen ----------
  app.get('/api/admin/invites', admin, async () => db.select().from(invites).orderBy(desc(invites.createdAt)).all());
  app.post('/api/admin/invites', admin, async (req) => {
    const body = z.object({ maxUses: z.number().int().min(1).max(50).default(1), note: z.string().max(100).optional(), days: z.number().int().min(1).max(365).optional() }).parse(req.body ?? {});
    const code = randomInviteCode();
    db.insert(invites).values({ code, createdBy: req.user.id, maxUses: body.maxUses, note: body.note ?? null, expiresAt: body.days ? Date.now() + body.days * 86_400_000 : null }).run();
    return db.select().from(invites).where(eq(invites.code, code)).get();
  });
  app.delete<{ Params: { code: string } }>('/api/admin/invites/:code', admin, async (req) => {
    db.update(invites).set({ revoked: true }).where(eq(invites.code, req.params.code)).run();
    return { ok: true };
  });

  // ---------- Pipeline ----------
  app.get('/api/admin/runs', admin, async () =>
    db
      .select({ id: pipelineRuns.id, mode: pipelineRuns.mode, status: pipelineRuns.status, startedAt: pipelineRuns.startedAt, finishedAt: pipelineRuns.finishedAt, summary: pipelineRuns.summary })
      .from(pipelineRuns)
      .orderBy(desc(pipelineRuns.startedAt))
      .limit(50)
      .all(),
  );
  app.get<{ Params: { id: string } }>('/api/admin/runs/:id', admin, async (req) => {
    const id = req.params.id.replace(/[^\w-]/g, '');
    const run = db.select().from(pipelineRuns).where(eq(pipelineRuns.id, id)).get();
    if (!run) throw notFound('Lauf nicht gefunden');
    const logFile = join(dataDir(), 'runs', `${id}.log`);
    const log = existsSync(logFile) ? readFileSync(logFile, 'utf8').split('\n').slice(-300).join('\n') : '';
    return { ...run, log };
  });
  app.post('/api/admin/runs', admin, async (req) => {
    const { mode } = z.object({ mode: z.enum(['run', 'dry-run']).default('run') }).parse(req.body ?? {});
    const url = `http://${process.env.PIPELINE_HOST || '127.0.0.1'}:${process.env.PIPELINE_PORT || 3461}/run`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.PIPELINE_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ mode }),
      signal: AbortSignal.timeout(10_000),
    }).catch((e: Error) => {
      throw new HttpError(502, 'pipeline_unreachable', `Pipeline-Dienst nicht erreichbar: ${e.message}`);
    });
    const json = await res.json();
    if (res.status === 409) throw new HttpError(409, 'already_running', `Läuft bereits (${json.runId}).`);
    if (!res.ok) throw new HttpError(502, 'pipeline_error', JSON.stringify(json));
    return json;
  });

  // ---------- Fragen & Meldungen ----------
  app.get('/api/admin/reports', admin, async () =>
    db
      .select({ report: questionReports, username: users.username, question: questions.data, active: questions.active })
      .from(questionReports)
      .leftJoin(users, eq(users.id, questionReports.userId))
      .leftJoin(questions, eq(questions.id, questionReports.questionId))
      .orderBy(sql`${questionReports.status} = 'open' desc`, desc(questionReports.createdAt))
      .limit(200)
      .all(),
  );
  app.patch<{ Params: { id: string } }>('/api/admin/reports/:id', admin, async (req) => {
    const id = Id.parse(req.params.id);
    const body = z.object({ status: z.enum(['open', 'resolved', 'dismissed']), deactivateQuestion: z.boolean().optional() }).parse(req.body);
    const r = db.select().from(questionReports).where(eq(questionReports.id, id)).get();
    if (!r) throw notFound('Meldung nicht gefunden');
    db.update(questionReports).set({ status: body.status, resolvedBy: req.user.id, resolvedAt: Date.now() }).where(eq(questionReports.id, id)).run();
    if (body.deactivateQuestion) db.update(questions).set({ active: false, disabledByAdmin: true }).where(eq(questions.id, r.questionId)).run();
    return { ok: true };
  });
  app.patch<{ Params: { id: string } }>('/api/admin/questions/:id', admin, async (req) => {
    const { active } = z.object({ active: z.boolean() }).parse(req.body);
    const res = db.update(questions).set({ active, disabledByAdmin: !active }).where(eq(questions.id, req.params.id)).run();
    if (!res.changes) throw notFound('Frage nicht gefunden');
    return { ok: true };
  });

  // ---------- Benachrichtigungen ----------
  app.get('/api/admin/notifications', admin, async () => db.select().from(adminNotifications).orderBy(desc(adminNotifications.createdAt)).limit(100).all());
  app.post('/api/admin/notifications/read', admin, async () => {
    db.update(adminNotifications).set({ read: true }).where(eq(adminNotifications.read, false)).run();
    return { ok: true };
  });
}

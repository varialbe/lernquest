import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { DB } from './db/index.ts';
import { HttpError } from './lib/http.ts';
import { adminRoutes } from './routes/admin.ts';
import { passkeyRoutes } from './routes/passkeys.ts';
import { accountRoutes } from './routes/account.ts';
import { userRoutes } from './routes/user.ts';

export async function buildApp(db: DB, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  // Request-Logs ohne IP-Adresse und Header (Datensparsamkeit; IPs stehen nur 14 Tage im Apache-Log)
  const app = Fastify({ logger: opts.logger ? { level: 'info', serializers: { req: (r: { method: string; url: string }) => ({ method: r.method, url: r.url.replace(/\?.*$/, '') }) } } : false, trustProxy: '127.0.0.1', bodyLimit: 256 * 1024 });

  const origins = new Set(['capacitor://localhost', 'http://localhost', 'https://localhost', ...(process.env.WEB_ORIGIN ?? '').split(',').map((s) => s.trim()).filter(Boolean)]);
  await app.register(cors, {
    origin: (origin, cb) => cb(null, !origin || origins.has(origin) || /^http:\/\/localhost:\d+$/.test(origin)),
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['authorization', 'content-type'],
    maxAge: 86400,
  });
  // global großzügig; Login/Registrierung haben eigene, strenge Limits (siehe routes/user.ts)
  await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute', keyGenerator: (req) => req.ip });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'validation', message: err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.code, message: err.message });
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 429) return reply.code(429).send({ error: 'rate_limited', message: 'Zu viele Versuche – bitte warte kurz.' });
    if (status && status < 500) return reply.code(status).send({ error: 'bad_request', message: (err as Error).message });
    req.log.error(err);
    return reply.code(500).send({ error: 'internal', message: 'Interner Fehler' });
  });

  // Liste aller Routen (für den Sicherheitstest: jede nicht-öffentliche Route braucht Anmeldung)
  const routes: { method: string; url: string }[] = [];
  app.addHook('onRoute', (r) => {
    for (const m of [r.method].flat()) if (m !== 'HEAD' && m !== 'OPTIONS') routes.push({ method: m, url: r.url });
  });
  app.decorate('routeList', routes);

  userRoutes(app, db);
  passkeyRoutes(app, db);
  accountRoutes(app, db);
  adminRoutes(app, db);
  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    routeList: { method: string; url: string }[];
  }
}

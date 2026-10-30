import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import { eq } from 'drizzle-orm';
import { getDb } from '@lernquest/api/db';
import { pipelineRuns } from '@lernquest/api/schema';
import { config } from './config.ts';
import { notify } from './notify.ts';
import { currentLock, newRunId } from './run.ts';

/** Kleiner Trigger-Dienst für n8n: nur auf 127.0.0.1, Bearer-Token. */
const app = Fastify({ logger: { level: 'info' } });
const db = getDb();
// Läufe, deren Prozess nicht mehr existiert (z. B. nach Reboot), als abgebrochen markieren
if (!currentLock()) {
  db.update(pipelineRuns).set({ status: 'failed', finishedAt: Date.now(), summary: 'abgebrochen (Prozess beendet)' }).where(eq(pipelineRuns.status, 'running')).run();
}

if (!config.token) throw new Error('PIPELINE_TOKEN fehlt in .env');
const tokenBuf = Buffer.from(config.token);

app.addHook('onRequest', async (req, reply) => {
  if (req.url === '/health') return;
  const got = Buffer.from((req.headers.authorization ?? '').replace(/^Bearer\s+/i, ''));
  if (got.length !== tokenBuf.length || !timingSafeEqual(got, tokenBuf)) return reply.code(401).send({ error: 'unauthorized' });
});

app.get('/health', async () => ({ ok: true, running: currentLock()?.runId ?? null }));

app.post<{ Body: { mode?: string; file?: string } | undefined }>('/run', async (req, reply) => {
  const held = currentLock();
  if (held) return reply.code(409).send({ error: 'already_running', runId: held.runId });
  const mode = ['run', 'backfill', 'dry-run', 'regenerate'].includes(req.body?.mode ?? '') ? req.body!.mode! : 'run';
  const runId = newRunId();
  mkdirSync(join(config.dataDir, 'runs'), { recursive: true });
  const out = openSync(join(config.dataDir, 'runs', `${runId}.stdout`), 'a');
  const args = ['--import', 'tsx', join(config.root, 'pipeline/src/cli.ts'), mode, '--run-id', runId];
  if (mode === 'regenerate' && req.body?.file) args.push(req.body.file);
  const child = spawn(process.execPath, args, { cwd: join(config.root, 'pipeline'), detached: true, stdio: ['ignore', out, out], env: process.env });
  child.unref();
  closeSync(out);
  return reply.code(202).send({ runId, mode, status: 'running' });
});

app.get<{ Params: { runId: string } }>('/status/:runId', async (req, reply) => {
  const run = db.select().from(pipelineRuns).where(eq(pipelineRuns.id, req.params.runId)).get();
  if (!run) {
    // Kindprozess hat die Zeile evtl. noch nicht angelegt
    if (currentLock()?.runId === req.params.runId) return { runId: req.params.runId, status: 'running', done: false };
    return reply.code(404).send({ error: 'not_found' });
  }
  const report = run.report as { totals?: { failed?: number } } | null;
  return {
    runId: run.id,
    mode: run.mode,
    status: run.status,
    done: run.status !== 'running',
    failedFiles: report?.totals?.failed ?? 0,
    summary: run.summary,
    report: run.report,
  };
});

/** Für n8n-Fehlerpfade (Trigger nicht erreichbar, Timeout): Telegram bzw. Admin-Notification. */
app.post<{ Body: { level?: string; title?: string; body?: string } }>('/notify', async (req) => {
  const level = req.body?.level === 'error' ? 'error' : req.body?.level === 'warn' ? 'warn' : 'info';
  const title = String(req.body?.title ?? 'LernQuest').slice(0, 200);
  const body = String(req.body?.body ?? '').slice(0, 3000);
  const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return { via: await notify(level, title, esc(body), body) };
});

await app.listen({ host: config.host, port: config.port });

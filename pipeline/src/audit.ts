import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { eq } from 'drizzle-orm';
import { getDb } from '@lernquest/api/db';
import { importUnit } from '@lernquest/api/import';
import { units } from '@lernquest/api/schema';
import { Unit } from '@lernquest/shared';
import { RateLimitError } from './codex.ts';
import { config } from './config.ts';
import * as git from './git.ts';
import { notify } from './notify.ts';
import type { Vault } from './obsidian.ts';
import { prepareNote } from './prepare.ts';
import { qualityGate, type GateReport } from './quality.ts';
import { acquireLock, newRunId, releaseLock } from './run.ts';

export type AuditUnit = { unitId: string; title: string; status: 'ok' | 'changed' | 'failed' | 'skipped'; gate?: GateReport; error?: string; tokens: number; durationSec: number };
export type AuditReport = { runId: string; startedAt: string; durationSec: number; units: AuditUnit[]; totals: { checked: number; passed: number; repaired: number; dropped: number; failedUnits: number; tokens: number } };

const PARALLEL = 3;

/**
 * Blind-Test über bestehende Units: jede Frage ohne Vorlesung lösen lassen, Durchgefallene reparieren
 * (max. 2 Versuche, mit Prüfskript bei Rechenaufgaben) oder verwerfen. Ersatzfragen bekommen neue IDs (…-r1),
 * die alten werden beim Import deaktiviert. Ergebnis: data/reports/audit-<runId>.json + Telegram.
 */
export async function audit(only: string[] = [], opts: { notify?: boolean } = {}): Promise<AuditReport> {
  const runId = `audit-${newRunId()}`;
  const started = Date.now();
  const logDir = join(config.dataDir, 'runs');
  mkdirSync(logDir, { recursive: true });
  const log = (m: string) => {
    const line = `[${new Date().toISOString().slice(11, 19)}] ${m}`;
    console.log(line);
    writeFileSync(join(logDir, `${runId}.log`), `${line}\n`, { flag: 'a' });
  };
  acquireLock(runId);
  const db = getDb();
  const results: AuditUnit[] = [];
  try {
    const files = readdirSync(config.contentDir)
      .flatMap((m) => (existsSync(join(config.contentDir, m)) ? readdirSync(join(config.contentDir, m)).filter((f) => f.endsWith('.json')).map((f) => join(config.contentDir, m, f)) : []))
      .sort();
    const todo = files
      .map((file) => ({ file, unit: Unit.parse(JSON.parse(readFileSync(file, 'utf8'))) }))
      .filter((x) => !only.length || only.includes(x.unit.id));
    log(`Audit ${runId}: ${todo.length} Units, ${todo.reduce((n, x) => n + x.unit.levels.reduce((k, l) => k + l.questions.length, 0), 0)} Fragen`);
    const vault: Vault = { root: config.studiumRepo, files: git.listAllFiles() };
    let rateLimited = false;

    const work = async ({ file, unit }: (typeof todo)[number]) => {
      const t0 = Date.now();
      const ulog = (m: string) => log(`[${unit.id}] ${m.trim()}`);
      if (rateLimited) return results.push({ unitId: unit.id, title: unit.title, status: 'skipped', error: 'Rate-Limit', tokens: 0, durationSec: 0 });
      try {
        const workDir = join(config.dataDir, 'work', runId, unit.id);
        mkdirSync(workDir, { recursive: true });
        const current = db.select({ f: units.sourceFile }).from(units).where(eq(units.id, unit.id)).get()?.f ?? unit.source.file;
        const note = existsSync(git.studiumPath(current)) ? await prepareNote(vault, current, workDir) : null;
        const g = await qualityGate(unit, { source: note ? { file: current, headings: note.headings, text: note.text } : null, workDir, log: ulog });
        const changed = g.report.repaired.length + g.report.dropped.length > 0;
        if (changed) {
          writeFileSync(file, JSON.stringify(g.unit, null, 2) + '\n');
          importUnit(db, g.unit);
        }
        results.push({ unitId: unit.id, title: unit.title, status: changed ? 'changed' : 'ok', gate: g.report, tokens: g.tokens, durationSec: Math.round((Date.now() - t0) / 1000) });
      } catch (e) {
        if (e instanceof RateLimitError) rateLimited = true;
        ulog(`✗ ${(e as Error).message}`);
        results.push({ unitId: unit.id, title: unit.title, status: 'failed', error: (e as Error).message.slice(0, 500), tokens: 0, durationSec: Math.round((Date.now() - t0) / 1000) });
      }
    };
    const queue = [...todo];
    await Promise.all(Array.from({ length: PARALLEL }, async () => {
      for (let x = queue.shift(); x; x = queue.shift()) await work(x);
    }));

    const changedFiles = todo.filter((x) => results.find((r) => r.unitId === x.unit.id)?.status === 'changed').map((x) => relative(config.lernquestRepo, x.file));
    if (changedFiles.length && git.commitContent(changedFiles, `content: blind-test audit – ${changedFiles.length} Units repariert`)) {
      const err = git.pushContent();
      log(err ? `⚠ Push: ${err}` : 'Content gepusht.');
    }
  } finally {
    releaseLock(runId);
  }

  const gates = results.flatMap((r) => (r.gate ? [r.gate] : []));
  const report: AuditReport = {
    runId,
    startedAt: new Date(started).toISOString(),
    durationSec: Math.round((Date.now() - started) / 1000),
    units: results.sort((a, b) => a.unitId.localeCompare(b.unitId)),
    totals: {
      checked: gates.reduce((n, g) => n + g.checked, 0),
      passed: gates.reduce((n, g) => n + g.checked - g.failedFirst, 0),
      repaired: gates.reduce((n, g) => n + g.repaired.length, 0),
      dropped: gates.reduce((n, g) => n + g.dropped.length, 0),
      failedUnits: results.filter((r) => r.status !== 'ok' && r.status !== 'changed').length,
      tokens: results.reduce((n, r) => n + r.tokens, 0),
    },
  };
  mkdirSync(join(config.dataDir, 'reports'), { recursive: true });
  writeFileSync(join(config.dataDir, 'reports', `${runId}.json`), JSON.stringify(report, null, 2));
  const t = report.totals;
  const lines = [
    `${t.checked} Fragen geprüft · ${t.passed} direkt bestanden · ${t.repaired} neu generiert · ${t.dropped} verworfen${t.failedUnits ? ` · ${t.failedUnits} Units nicht geprüft` : ''}`,
    ...report.units.map((u) => `${u.status === 'failed' ? '✗' : u.status === 'changed' ? '✎' : '✓'} ${u.unitId}: ${u.gate ? `${u.gate.checked - u.gate.failedFirst}/${u.gate.checked} ok, ${u.gate.repaired.length} repariert, ${u.gate.dropped.length} verworfen` : u.error ?? u.status}`),
  ];
  log(lines.join('\n'));
  if (opts.notify !== false) await notify(t.failedUnits ? 'warn' : 'info', '🔍 LernQuest Blind-Test-Audit', lines.join('\n'));
  return report;
}

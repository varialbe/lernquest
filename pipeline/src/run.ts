import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { and, asc, eq, lt, max } from 'drizzle-orm';
import { getDb, type DB } from '@lernquest/api/db';
import { pipelineRuns, pipelineState, processedFiles, units } from '@lernquest/api/schema';
import { importContentDir, importUnit } from '@lernquest/api/import';
import { ModuleId } from '@lernquest/shared';
import { config, moduleOf } from './config.ts';
import type { Vault } from './obsidian.ts';
import { prepareNote } from './prepare.ts';
import { generateUnit } from './generate.ts';
import * as git from './git.ts';

export type Mode = 'run' | 'backfill' | 'dry-run' | 'regenerate';

type PlanItem = {
  path: string;
  sha256: string;
  action: 'new' | 'regenerate' | 'skip';
  reason: string;
  unitId?: string;
};

export type FileReport = {
  path: string;
  status: 'done' | 'failed' | 'skipped' | 'planned';
  reason?: string;
  unitId?: string;
  title?: string;
  levels?: number;
  questions?: number;
  dropped?: string[];
  /** Hinweise zur Notiz: ignorierte/fehlende Bilder, unaufgelöste Wikilinks */
  notes?: string[];
  review?: { checked: number; fixed: number; removed: number; notes: string };
  error?: string;
  durationSec?: number;
};

export type Report = {
  runId: string;
  mode: Mode;
  status: 'success' | 'nothing_new' | 'partial' | 'failed';
  startedAt: string;
  finishedAt: string;
  durationSec: number;
  studiumHead: string;
  previousSha: string | null;
  files: FileReport[];
  totals: { processed: number; failed: number; skipped: number; levels: number; questions: number };
  warnings: string[];
};

export const newRunId = () => `${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}-${randomBytes(3).toString('hex')}`;

// ---------- Lock: nie zwei Läufe parallel ----------
const lockFile = () => join(config.dataDir, 'pipeline.lock');
export function currentLock(): { pid: number; runId: string; startedAt: string } | null {
  if (!existsSync(lockFile())) return null;
  try {
    const lock = JSON.parse(readFileSync(lockFile(), 'utf8'));
    process.kill(lock.pid, 0); // wirft, wenn der Prozess nicht mehr existiert
    return lock;
  } catch {
    return null; // verwaistes Lockfile
  }
}
function acquireLock(runId: string) {
  const held = currentLock();
  if (held && held.pid !== process.pid) throw new Error(`Pipeline läuft bereits (Run ${held.runId}, PID ${held.pid})`);
  mkdirSync(config.dataDir, { recursive: true });
  writeFileSync(lockFile(), JSON.stringify({ pid: process.pid, runId, startedAt: new Date().toISOString() }));
}
function releaseLock(runId: string) {
  try {
    const lock = JSON.parse(readFileSync(lockFile(), 'utf8'));
    if (lock.runId === runId) unlinkSync(lockFile());
  } catch {
    /* ignore */
  }
}

// ---------- State ----------
const getState = (db: DB, key: string) => db.select().from(pipelineState).where(eq(pipelineState.key, key)).get()?.value ?? null;
const setState = (db: DB, key: string, value: string) =>
  db.insert(pipelineState).values({ key, value }).onConflictDoUpdate({ target: pipelineState.key, set: { value, updatedAt: Date.now() } }).run();

const unitForPath = (db: DB, path: string) => db.select().from(units).where(eq(units.sourceFile, path)).get();
/** Verlinkt die Notiz einer bestehenden Unit (per Wikilink) auf `target`? */
const linksTo = (db: DB, fromFile: string, target: string) => unitForPath(db, fromFile)?.links.includes(target) ?? false;

function recordFile(db: DB, sha256: string, path: string, status: 'done' | 'failed' | 'skipped', runId: string, extra: { unitId?: string; error?: string } = {}) {
  const prev = db.select().from(processedFiles).where(eq(processedFiles.sha256, sha256)).get();
  const attempts = status === 'failed' ? (prev?.status === 'failed' ? prev.attempts + 1 : 1) : (prev?.attempts ?? 1);
  db.insert(processedFiles)
    .values({ sha256, path, status, runId, attempts, unitId: extra.unitId ?? null, error: extra.error ?? null })
    .onConflictDoUpdate({
      target: processedFiles.sha256,
      set: { path, status, runId, attempts, unitId: extra.unitId ?? null, error: extra.error ?? null, processedAt: Date.now() },
    })
    .run();
}

// ---------- Planung ----------
function plan(db: DB, mode: Mode, head: string, file: string | undefined, warnings: string[]): PlanItem[] {
  const items: PlanItem[] = [];
  const seen = new Set<string>();
  const add = (item: PlanItem) => {
    if (seen.has(item.path)) return;
    seen.add(item.path);
    items.push(item);
  };
  const classify = (path: string, status: 'A' | 'R' | 'M', oldPath?: string): PlanItem => {
    const abs = git.studiumPath(path);
    if (!existsSync(abs)) return { path, sha256: '', action: 'skip', reason: 'Datei existiert nicht mehr' };
    const sha256 = git.sha256File(abs);
    const done = db.select().from(processedFiles).where(eq(processedFiles.sha256, sha256)).get();
    if (done?.status === 'done') {
      if (done.path !== path) {
        db.update(processedFiles).set({ path }).where(eq(processedFiles.sha256, sha256)).run();
        if (done.unitId) db.update(units).set({ sourceFile: path }).where(eq(units.id, done.unitId)).run();
      }
      return { path, sha256, action: 'skip', reason: 'Inhalt bereits verarbeitet (gleicher sha256)' };
    }
    if (done?.status === 'failed' && done.attempts >= config.maxAttempts) {
      return { path, sha256, action: 'skip', reason: `schon ${done.attempts}× fehlgeschlagen – nur per regenerate` };
    }
    const existing = unitForPath(db, path) ?? (oldPath ? unitForPath(db, oldPath) : undefined);
    if (existing) {
      if (status !== 'A' && !config.regenerateOnModify) {
        return { path, sha256, action: 'skip', reason: `geänderte Datei (Unit ${existing.id}) – REGENERATE_ON_MODIFY=false` };
      }
      return { path, sha256, action: 'regenerate', reason: status === 'R' ? `umbenannt von ${oldPath}` : 'geändert', unitId: existing.id };
    }
    if (status === 'M') return { path, sha256, action: 'new', reason: 'geändert, aber noch keine Unit vorhanden' };
    return { path, sha256, action: 'new', reason: status === 'R' ? `umbenannt von ${oldPath}, neuer Inhalt` : 'neu hinzugefügt' };
  };

  if (mode === 'regenerate') {
    if (!file) throw new Error('regenerate braucht einen Dateipfad (relativ zum Studium-Repo)');
    const rel = file.startsWith(config.studiumRepo) ? relative(config.studiumRepo, file) : file;
    const abs = git.studiumPath(rel);
    if (!existsSync(abs)) throw new Error(`Datei nicht gefunden: ${rel}`);
    const existing = unitForPath(db, rel);
    add({ path: rel, sha256: git.sha256File(abs), action: existing ? 'regenerate' : 'new', reason: 'manuell angefordert', unitId: existing?.id });
    return items;
  }

  const last = getState(db, 'last_sha');
  if (mode === 'backfill' || !last || !git.commitExists(last)) {
    if (mode !== 'backfill') warnings.push(last ? `last_sha ${last} nicht gefunden – vollständiger Abgleich` : 'Erster Lauf – vollständiger Abgleich');
    for (const p of git.chronological(git.listLectureFiles())) add(classify(p, 'A'));
  } else {
    const changes = git.diffLectures(last, head);
    for (const c of changes) add(classify(c.path, c.status, c.oldPath));
  }

  // fehlgeschlagene Dateien erneut versuchen (max. maxAttempts)
  const failed = db.select().from(processedFiles).where(eq(processedFiles.status, 'failed')).all();
  for (const f of failed) {
    if (!seen.has(f.path) && f.attempts < config.maxAttempts && existsSync(git.studiumPath(f.path))) add(classify(f.path, 'A'));
  }

  // neue Dateien chronologisch, damit Units aufeinander aufbauen
  const work = items.filter((i) => i.action !== 'skip');
  const order = git.chronological(work.map((i) => i.path));
  return [...order.map((p) => work.find((i) => i.path === p)!), ...items.filter((i) => i.action === 'skip')];
}

// ---------- Ausführung ----------
export async function execute(mode: Mode, opts: { runId?: string; file?: string; quiet?: boolean } = {}): Promise<Report> {
  const runId = opts.runId ?? newRunId();
  const started = Date.now();
  const logDir = join(config.dataDir, 'runs');
  mkdirSync(logDir, { recursive: true });
  const logPath = join(logDir, `${runId}.log`);
  const log = (msg: string) => {
    const line = `[${new Date().toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin' })}] ${msg}`;
    appendFileSync(logPath, line + '\n');
    if (!opts.quiet) console.log(line);
  };
  const warnings: string[] = [];
  const files: FileReport[] = [];
  const db = getDb();
  const dry = mode === 'dry-run';

  let head = '';
  let locked = false;
  const previousSha = getState(db, 'last_sha');

  try {
    if (!dry) {
      acquireLock(runId);
      locked = true;
      db.insert(pipelineRuns).values({ id: runId, mode, status: 'running' }).onConflictDoNothing().run();
    }
    log(`Run ${runId} – Modus ${mode}`);
    if (existsSync(config.contentDir)) {
      const synced = importContentDir(db, config.contentDir).filter((r) => r.status !== 'unchanged');
      if (synced.length) log(`content/ mit DB abgeglichen: ${synced.map((s) => `${s.unitId} (${s.status})`).join(', ')}`);
    }
    head = git.pullStudium();
    log(`Studium-Repo auf ${head.slice(0, 8)} (zuletzt verarbeitet: ${previousSha?.slice(0, 8) ?? '–'})`);

    const items = plan(db, mode, head, opts.file, warnings);
    for (const w of warnings) log(`Hinweis: ${w}`);
    const todo = items.filter((i) => i.action !== 'skip');
    for (const s of items.filter((i) => i.action === 'skip')) {
      files.push({ path: s.path, status: 'skipped', reason: s.reason });
      log(`· übersprungen: ${s.path} – ${s.reason}`);
    }

    if (dry) {
      for (const t of todo) {
        files.push({ path: t.path, status: 'planned', reason: `${t.action}: ${t.reason}`, unitId: t.unitId });
        log(`+ würde verarbeiten: ${t.path} (${t.action}: ${t.reason})`);
      }
      if (!todo.length) log('Nichts Neues.');
    } else {
      if (!todo.length) log('Nichts Neues.');
      let committed = false;
      const vault: Vault = { root: config.studiumRepo, files: git.listAllFiles() };
      for (const [i, item] of todo.entries()) {
        const t0 = Date.now();
        let notes: string[] = [];
        log(`[${i + 1}/${todo.length}] ${item.path} (${item.action}: ${item.reason})`);
        try {
          const module = ModuleId.parse(moduleOf(item.path));
          const existing = item.unitId ? db.select().from(units).where(eq(units.id, item.unitId)).get() : undefined;
          const number =
            existing?.number ??
            (db.select({ n: max(units.number) }).from(units).where(eq(units.module, module)).get()?.n ?? 0) + 1;
          const previous = db
            .select()
            .from(units)
            .where(and(eq(units.module, module), lt(units.number, number)))
            .orderBy(asc(units.number))
            .all()
            .map((u) => ({ number: u.number, title: u.title, concepts: u.concepts, keyFacts: u.keyFacts, sourceFile: u.sourceFile, linked: false }));
          const workDir = join(config.dataDir, 'work', runId, String(i + 1));
          const prepared = await prepareNote(vault, item.path, workDir);
          notes = prepared.notes;
          // Konzeptgraph: Units, deren Notiz per Wikilink verlinkt ist (in beide Richtungen)
          for (const p of previous) p.linked = prepared.links.includes(p.sourceFile) || linksTo(db, p.sourceFile, item.path);
          const s = prepared.stats;
          log(`  Notiz: ${s.chars} Zeichen, ${prepared.headings.length} Überschriften, ${s.mermaid} Mermaid, ${s.callouts} Callouts, ${s.math} Formeln, ${s.images} Bilder · ${prepared.links.length} Wikilinks · Kontext: ${previous.length} frühere Units`);
          for (const n of notes) log(`  ⚑ ${n}`);

          const { unit, dropped } = await generateUnit({ module, number, file: item.path, sha256: item.sha256, commit: head, prepared, previous, workDir, log });

          // content/<modul>/<nr>-<slug>.json schreiben (alte Datei derselben Unit ersetzen)
          const modDir = join(config.contentDir, module.toLowerCase());
          mkdirSync(modDir, { recursive: true });
          const prefix = `${String(number).padStart(2, '0')}-`;
          const target = join(modDir, `${prefix}${unit.slug}.json`);
          const stale = readdirSync(modDir).filter((f) => f.startsWith(prefix) && join(modDir, f) !== target);
          for (const f of stale) rmSync(join(modDir, f));
          writeFileSync(target, JSON.stringify(unit, null, 2) + '\n');

          const verb = item.action === 'regenerate' ? 'regenerate' : 'add';
          const changed = git.commitContent([relative(config.lernquestRepo, target), ...stale.map((f) => relative(config.lernquestRepo, join(modDir, f)))], `content: ${verb} ${module} Vorlesung ${number} – ${unit.title}`);
          committed ||= changed;
          const imported = importUnit(db, unit);
          recordFile(db, item.sha256, item.path, 'done', runId, { unitId: unit.id });
          const qCount = unit.levels.reduce((n, l) => n + l.questions.length, 0);
          files.push({
            path: item.path,
            status: 'done',
            unitId: unit.id,
            title: unit.title,
            levels: unit.levels.length,
            questions: qCount,
            dropped,
            notes,
            review: unit.generator.review,
            durationSec: Math.round((Date.now() - t0) / 1000),
          });
          log(`  ✓ ${unit.id} „${unit.title}“: ${qCount} Fragen (${imported.status}), Review: ${unit.generator.review.fixed} korrigiert, ${unit.generator.review.removed} entfernt, ${dropped.length} bei Validierung verworfen`);
        } catch (e) {
          const msg = (e as Error).message.slice(0, 2000);
          recordFile(db, item.sha256, item.path, 'failed', runId, { error: msg });
          files.push({ path: item.path, status: 'failed', error: msg, notes, durationSec: Math.round((Date.now() - t0) / 1000) });
          log(`  ✗ fehlgeschlagen: ${msg}`);
        }
      }
      if (committed) {
        const pushErr = git.pushContent();
        if (pushErr) {
          warnings.push(`Push fehlgeschlagen: ${pushErr}`);
          log(`⚠ Push: ${pushErr}`);
        } else log('Content gepusht.');
      }
      if (mode !== 'regenerate') setState(db, 'last_sha', head);
    }
  } catch (e) {
    warnings.push((e as Error).message);
    log(`✗ Abbruch: ${(e as Error).message}`);
    files.push({ path: '(run)', status: 'failed', error: (e as Error).message });
  } finally {
    if (locked) releaseLock(runId);
  }

  const done = files.filter((f) => f.status === 'done');
  const failed = files.filter((f) => f.status === 'failed');
  const report: Report = {
    runId,
    mode,
    status: failed.length && !done.length ? 'failed' : failed.length ? 'partial' : done.length || files.some((f) => f.status === 'planned') ? 'success' : 'nothing_new',
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date().toISOString(),
    durationSec: Math.round((Date.now() - started) / 1000),
    studiumHead: head,
    previousSha,
    files,
    totals: {
      processed: done.length,
      failed: failed.length,
      skipped: files.filter((f) => f.status === 'skipped').length,
      levels: done.reduce((n, f) => n + (f.levels ?? 0), 0),
      questions: done.reduce((n, f) => n + (f.questions ?? 0), 0),
    },
    warnings,
  };
  const text = formatReport(report);
  log(text);
  const reportDir = join(config.dataDir, 'reports');
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(join(reportDir, `${runId}.json`), JSON.stringify(report, null, 2));
  if (!dry) {
    db.update(pipelineRuns).set({ status: report.status, finishedAt: Date.now(), summary: text, report }).where(eq(pipelineRuns.id, runId)).run();
  }
  return report;
}

export function formatReport(r: Report): string {
  const lines = [
    `LernQuest-Pipeline ${r.runId} (${r.mode}) – ${({ success: 'erfolgreich', nothing_new: 'nichts Neues', partial: 'teilweise fehlgeschlagen', failed: 'fehlgeschlagen' } as const)[r.status]}`,
    `Dauer ${Math.floor(r.durationSec / 60)} min ${r.durationSec % 60} s · ${r.totals.processed} Units, ${r.totals.levels} Level, ${r.totals.questions} Fragen · ${r.totals.failed} Fehler · ${r.totals.skipped} übersprungen`,
  ];
  for (const f of r.files.filter((x) => x.status === 'done')) {
    lines.push(`  ✓ ${f.unitId} ${f.title} – ${f.questions} Fragen (${f.path})`);
    for (const n of f.notes ?? []) lines.push(`      ⚑ ${n}`);
  }
  for (const f of r.files.filter((x) => x.status === 'planned')) lines.push(`  + ${f.path} – ${f.reason}`);
  for (const f of r.files.filter((x) => x.status === 'failed')) lines.push(`  ✗ ${f.path}: ${f.error}`);
  for (const w of r.warnings) lines.push(`  ⚠ ${w}`);
  return lines.join('\n');
}

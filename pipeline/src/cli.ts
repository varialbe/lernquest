import './config.ts';
import { telegramSetup } from './notify.ts';
import { execute, type Mode } from './run.ts';
import { watchdog } from './watchdog.ts';
import { config } from './config.ts';
import { RateLimitError } from './codex.ts';

const [cmd = 'help', ...rest] = process.argv.slice(2);
const runIdFlag = rest.indexOf('--run-id');
const runId = runIdFlag >= 0 ? rest[runIdFlag + 1] : undefined;
const flag = (name: string) => (rest.indexOf(name) >= 0 ? rest[rest.indexOf(name) + 1] : undefined);
const positional = rest.filter((a, i) => !a.startsWith('--') && !['--run-id', '--force', '--reason'].includes(rest[i - 1]!));

const modes: Record<string, Mode> = { run: 'run', backfill: 'backfill', 'dry-run': 'dry-run', regenerate: 'regenerate', bonus: 'bonus', knowledge: 'knowledge' };

if (cmd === 'telegram-setup') {
  await telegramSetup();
  process.exit(0);
}
if (cmd === 'wissen-check') {
  // Wissenssammlung + Voraussetzungen aktuell und konsistent? (Exit 1 bei Problemen)
  const { allContentUnits, readKnowledge } = await import('./knowledge.ts');
  const { translationStatus } = await import('./translate.ts');
  const { checkKnowledge, knowledgeWarnings } = await import('./prereqs.ts');
  const problems = checkKnowledge(allContentUnits());
  const warnings = knowledgeWarnings(allContentUnits());
  for (const warning of warnings) console.log(`⚠ ${warning}`);
  if (problems.length) {
    console.log(`✗ ${problems.length} Problem(e):`);
    for (const x of problems) console.log(`  - ${x}`);
    console.log('→ beheben mit: pnpm pipeline knowledge [unit-id]');
  } else console.log('✓ Wissenssammlung und Voraussetzungen sind für alle Units aktuell.');
  for (const unit of allContentUnits()) {
    const state = translationStatus(unit, readKnowledge(unit.id));
    if (!state.current) console.log(`⚠ ${unit.id}: ${state.reason}`);
  }
  process.exit(problems.length ? 1 : 0);
}
if (cmd === 'prereqs-migrate') {
  const { parseMigrationOptions, runPrereqMigration } = await import('./prereq-migration.ts');
  const result = await runPrereqMigration(parseMigrationOptions(rest));
  if ('stamp' in result) {
    console.log(`Trockenlauf ${result.stamp}: ${result.unitCount} Units`);
    console.log(`Vorschläge: ${result.directory}`);
    for (const file of result.reportFiles ?? []) console.log(`Report: ${file}`);
    console.log(`Apply: pnpm pipeline prereqs-migrate --apply --stamp ${result.stamp}`);
  } else console.log(result.message);
  process.exit(0);
}
if (cmd === 'prereqs-eval') {
  const { evaluatePrereqs } = await import('./prereq-eval.ts');
  const graphFlag = rest.indexOf('--graph');
  const graphDir = graphFlag >= 0 ? rest[graphFlag + 1] : undefined;
  const report = evaluatePrereqs(graphDir);
  console.log(report.text);
  process.exit(0);
}
if (cmd === 'lint') {
  // Formatierung wie in der App prüfen: KaTeX, vergessene $, LaTeX außerhalb von Formeln, deutsche Reste im Englischen
  const { lintAll } = await import('./lint.ts');
  const issues = lintAll();
  if (rest.includes('--json')) console.log(JSON.stringify(issues, null, 1));
  else {
    for (const i of issues) console.log(`✗ ${i.kind} · ${i.file} · ${i.path} · ${i.detail}\n    ${i.text.replace(/\n/g, '⏎')}`);
    const kinds = Object.entries(issues.reduce<Record<string, number>>((acc, i) => ({ ...acc, [i.kind]: (acc[i.kind] ?? 0) + 1 }), {}));
    console.log(issues.length ? `${issues.length} Problem(e): ${kinds.map(([k, n]) => `${k} ${n}`).join(', ')}` : '✓ Keine Formatierungsprobleme.');
  }
  process.exit(rest.includes('--strict') && issues.length ? 1 : 0);
}
if (cmd === 'proofread') {
  const { allContentUnits } = await import('./knowledge.ts');
  const { proofreadUnit } = await import('./proofread.ts');
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const all = rest.includes('--all');
  const dryRun = rest.includes('--dry-run');
  const langFlag = flag('--lang') ?? 'de';
  const langs = (langFlag === 'both' ? ['de', 'en'] : [langFlag]) as ('de' | 'en')[];
  const ids = rest.filter((arg, i) => !arg.startsWith('--') && rest[i - 1] !== '--lang');
  if ((!all && !ids.length) || langs.some((l) => l !== 'de' && l !== 'en')) {
    console.error('Verwendung: pnpm pipeline proofread <unit-id …>|--all [--lang de|en|both] [--dry-run]');
    process.exit(1);
  }
  const units = allContentUnits().filter((u) => all || ids.includes(u.id));
  const report: unknown[] = [];
  let failed = 0;
  for (const lang of langs) {
    const queue = [...units];
    await Promise.all(Array.from({ length: 3 }, async () => {
      for (let unit = queue.shift(); unit; unit = queue.shift()) {
        try {
          const r = await proofreadUnit(unit.id, lang, { dryRun, log: (m) => console.log(`[${unit.id}/${lang}] ${m.trim()}`) });
          if (!dryRun && lang === 'de' && r.unitChanged) {
            const { getDb } = await import('@lernquest/api/db');
            const { importUnit } = await import('@lernquest/api/import');
            importUnit(getDb(), r.unit);
          }
          report.push({ unitId: unit.id, lang, changes: r.changes, rejected: r.rejected, tokens: r.tokens });
          console.log(`✓ ${unit.id}/${lang}: ${r.changes.length} Korrektur(en), ${r.rejected.length} verworfen`);
          for (const c of r.changes) console.log(`    ${c.asset} ${c.path}\n      - ${c.before.replace(/\n/g, '⏎').slice(0, 300)}\n      + ${c.after.replace(/\n/g, '⏎').slice(0, 300)}`);
        } catch (error) {
          failed++;
          console.error(`✗ ${unit.id}/${lang}: ${(error as Error).message}`);
        }
      }
    }));
  }
  mkdirSync(`${config.dataDir}/reports`, { recursive: true });
  const file = `${config.dataDir}/reports/proofread-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(`Bericht: ${file}${dryRun ? ' (Trockenlauf, nichts geschrieben)' : ''}`);
  if (!dryRun && langs.includes('de')) console.log('→ Deutsche Quellen geändert: danach pnpm pipeline translate --all (betroffene Units werden als veraltet erkannt).');
  process.exit(failed ? 1 : 0);
}
if (cmd === 'translate-check') {
  const { allContentUnits, readKnowledge } = await import('./knowledge.ts');
  const { translationStatus } = await import('./translate.ts');
  const warnings = allContentUnits().flatMap((unit) => {
    const status = translationStatus(unit, readKnowledge(unit.id));
    return status.current ? [] : [`${unit.id}: ${status.reason}`];
  });
  if (warnings.length) {
    console.log(`⚠ ${warnings.length} englische Übersetzung(en) fehlen oder sind veraltet:`);
    for (const warning of warnings) console.log(`  - ${warning}`);
    console.log('→ nachholen mit: pnpm pipeline translate --all');
  } else console.log('✓ Alle englischen Übersetzungen sind aktuell und gültig.');
  process.exit(rest.includes('--strict') && warnings.length ? 1 : 0);
}
if (cmd === 'translate') {
  const { allContentUnits, readKnowledge } = await import('./knowledge.ts');
  const { findContentFile, translateUnit, translationStatus } = await import('./translate.ts');
  const all = rest.includes('--all');
  const force = rest.includes('--force');
  const ids = rest.filter((arg) => !arg.startsWith('--'));
  if (!all && !ids.length) {
    console.error('Verwendung: pnpm pipeline translate <unit-id …> [--force] oder pnpm pipeline translate --all [--force]');
    process.exit(1);
  }
  const units = allContentUnits().filter((unit) => all || ids.includes(unit.id));
  const missing = ids.filter((id) => !units.some((unit) => unit.id === id));
  for (const id of missing) console.error(`✗ Unit nicht gefunden: ${id}`);
  let failed = missing.length;
  let translated = 0;
  for (const [index, unit] of units.entries()) {
    const knowledge = readKnowledge(unit.id);
    const unitFile = findContentFile(unit);
    const status = translationStatus(unit, knowledge, unitFile);
    if (!force && status.current) {
      console.log(`· ${unit.id}: Übersetzung aktuell`);
      continue;
    }
    if (!knowledge || !unitFile) {
      console.error(`✗ ${unit.id}: ${!knowledge ? 'deutsche Wissenssammlung fehlt' : 'Unit-Datei fehlt'}`);
      failed++;
      continue;
    }
    try {
      const workDir = `${config.dataDir}/work/translate-${unit.id}-${process.pid}-${Date.now()}-${index + 1}`;
      const result = await translateUnit(unit, knowledge, unitFile, workDir, (message) => console.log(message), undefined, { force });
      console.log(`✓ ${unit.id}: ${result.unitFile} · ${result.knowledgeFile}`);
      translated++;
    } catch (error) {
      console.error(`✗ ${unit.id}: ${(error as Error).message}`);
      failed++;
      if (error instanceof RateLimitError) {
        console.error('Rate limit reached; aborting. Re-run the same command to resume.');
        break;
      }
    }
  }
  console.log(`Translation complete: ${translated} written, ${failed} failed.`);
  process.exit(failed ? 1 : 0);
}
if (cmd === 'watchdog') process.exit((await watchdog()) ? 0 : 2);
if (cmd === 'audit') {
  const { audit } = await import('./audit.ts');
  // --force id1,id2 --reason "…": diese Fragen ohne Blind-Test-Befund neu generieren (z. B. stillschweigend vorausgesetztes Vorlesungsszenario)
  const r = await audit(positional, { notify: !rest.includes('--no-notify'), force: flag('--force')?.split(',').filter(Boolean), reason: flag('--reason') });
  process.exit(r.totals.failedUnits ? 1 : 0);
}

if (!(cmd in modes)) {
  console.log(`LernQuest-Pipeline

  pnpm pipeline run                 neue Vorlesungsnotizen verarbeiten (Normalbetrieb)
  pnpm pipeline backfill            alle vorhandenen Vorlesungen chronologisch nachholen
  pnpm pipeline dry-run             nur anzeigen, was neu wäre
  pnpm pipeline regenerate <datei>  eine Notiz neu generieren (Pfad relativ zum Studium-Repo)
  pnpm pipeline bonus [unit-id]      Praxis-Level für Units ohne Bonus (oder eine Unit neu) erzeugen
  pnpm pipeline knowledge [unit-id]  Wissenssammlung + Voraussetzungen für Units ohne (aktuelle) Fassung (oder eine Unit neu) erzeugen
  pnpm pipeline prereqs-migrate --dry-run [--module era] [--unit era-10] [--resume]  typisierte Graph-Migration vorschlagen
  pnpm pipeline prereqs-migrate --apply --stamp <stamp>  gespeicherten Trockenlauf anwenden
  pnpm pipeline prereqs-migrate --rollback <stamp>  gesicherte Graphen wiederherstellen
  pnpm pipeline prereqs-eval [--graph <dir>]  Graph-Evaluation gegen das Gold-Set
  pnpm pipeline wissen-check        prüfen, ob Wissenssammlung und Voraussetzungen für alle Units aktuell sind
  pnpm pipeline translate <unit-id …> [--force]  Units und Wissen ins Englische übersetzen
  pnpm pipeline translate --all [--force]        fehlende/veraltete englische Übersetzungen erzeugen
  pnpm pipeline lint [--strict] [--json]         Formeln/Markdown wie in der App prüfen (DE + EN)
  pnpm pipeline proofread <unit-id …>|--all [--lang de|en|both] [--dry-run]  Rechtschreibung/Grammatik korrigieren (IDs, Formeln, Code bleiben)
  pnpm pipeline translate-check [--strict]      Übersetzungen prüfen (strict: Exit 1 bei Problemen)
  pnpm pipeline audit [unit-id …]  Blind-Test über bestehende Units, Durchgefallene neu generieren (--no-notify: ohne Telegram)
  pnpm pipeline watchdog            prüfen, ob heute ein nächtlicher Lauf stattfand (sonst Warnung)
  pnpm pipeline telegram-setup      einmalig: Chat-ID nach /start an den Bot in .env eintragen`);
  process.exit(cmd === 'help' ? 0 : 1);
}

const report = await execute(modes[cmd]!, { runId, file: positional.join(' ') || undefined, notify: !rest.includes('--no-notify') });
process.exit(report.status === 'failed' ? 1 : 0);

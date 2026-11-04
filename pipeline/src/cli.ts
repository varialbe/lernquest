import './config.ts';
import { telegramSetup } from './notify.ts';
import { execute, type Mode } from './run.ts';
import { watchdog } from './watchdog.ts';

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
  const { allContentUnits } = await import('./knowledge.ts');
  const { checkKnowledge, knowledgeWarnings } = await import('./prereqs.ts');
  const problems = checkKnowledge(allContentUnits());
  const warnings = knowledgeWarnings(allContentUnits());
  for (const warning of warnings) console.log(`⚠ ${warning}`);
  if (problems.length) {
    console.log(`✗ ${problems.length} Problem(e):`);
    for (const x of problems) console.log(`  - ${x}`);
    console.log('→ beheben mit: pnpm pipeline knowledge [unit-id]');
  } else console.log('✓ Wissenssammlung und Voraussetzungen sind für alle Units aktuell.');
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
  pnpm pipeline audit [unit-id …]  Blind-Test über bestehende Units, Durchgefallene neu generieren (--no-notify: ohne Telegram)
  pnpm pipeline watchdog            prüfen, ob heute ein nächtlicher Lauf stattfand (sonst Warnung)
  pnpm pipeline telegram-setup      einmalig: Chat-ID nach /start an den Bot in .env eintragen`);
  process.exit(cmd === 'help' ? 0 : 1);
}

const report = await execute(modes[cmd]!, { runId, file: positional.join(' ') || undefined, notify: !rest.includes('--no-notify') });
process.exit(report.status === 'failed' ? 1 : 0);

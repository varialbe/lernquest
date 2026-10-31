import './config.ts';
import { telegramSetup } from './notify.ts';
import { execute, type Mode } from './run.ts';
import { watchdog } from './watchdog.ts';

const [cmd = 'help', ...rest] = process.argv.slice(2);
const runIdFlag = rest.indexOf('--run-id');
const runId = runIdFlag >= 0 ? rest[runIdFlag + 1] : undefined;
const positional = rest.filter((a, i) => !a.startsWith('--') && rest[i - 1] !== '--run-id');

const modes: Record<string, Mode> = { run: 'run', backfill: 'backfill', 'dry-run': 'dry-run', regenerate: 'regenerate', bonus: 'bonus' };

if (cmd === 'telegram-setup') {
  await telegramSetup();
  process.exit(0);
}
if (cmd === 'watchdog') process.exit((await watchdog()) ? 0 : 2);

if (!(cmd in modes)) {
  console.log(`LernQuest-Pipeline

  pnpm pipeline run                 neue Vorlesungsnotizen verarbeiten (Normalbetrieb)
  pnpm pipeline backfill            alle vorhandenen Vorlesungen chronologisch nachholen
  pnpm pipeline dry-run             nur anzeigen, was neu wäre
  pnpm pipeline regenerate <datei>  eine Notiz neu generieren (Pfad relativ zum Studium-Repo)
  pnpm pipeline bonus [unit-id]      Praxis-Level für Units ohne Bonus (oder eine Unit neu) erzeugen
  pnpm pipeline watchdog            prüfen, ob heute ein nächtlicher Lauf stattfand (sonst Warnung)
  pnpm pipeline telegram-setup      einmalig: Chat-ID nach /start an den Bot in .env eintragen`);
  process.exit(cmd === 'help' ? 0 : 1);
}

const report = await execute(modes[cmd]!, { runId, file: positional.join(' ') || undefined });
process.exit(report.status === 'failed' ? 1 : 0);

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const tmp = mkdtempSync(join(tmpdir(), 'lq-pipeline-'));
const studium = join(tmp, 'studium');
const lq = join(tmp, 'lernquest');
const sh = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });

/** Fake-Codex: schreibt eine gültige Roh-Unit nach -o. */
const FAKE_CODEX = `#!/usr/bin/env node
const fs = require('fs');
const a = process.argv;
const out = a[a.indexOf('-o') + 1];
console.log('tokens used'); console.log('1,234');
const kinds = ['basics', 'apply', 'deepen', 'boss'];
const levels = kinds.map((kind, li) => ({
  kind, title: kind,
  questions: Array.from({ length: 10 }, (_, i) => i % 3 === 0
    ? { type: 'truefalse', prompt: 'Aussage ' + li + '-' + i + ' stimmt?', options: [{ id: 'true', text: 'Wahr' }, { id: 'false', text: 'Falsch' }], correct: ['true'], explanation: 'Weil es so ist.', source: { file: 'x', heading: 'mengen' }, difficulty: 2, concepts: ['K'] }
    : { type: 'single', prompt: 'Frage ' + li + '-' + i + '?', options: [{ id: 'a', text: 'eins' }, { id: 'b', text: 'zwei' }, { id: 'c', text: 'drei' }, { id: 'd', text: 'vier' }], correct: ['b'], explanation: 'Zwei ist richtig.', source: { file: 'x', heading: 'mengen' }, difficulty: 9, concepts: ['K'] }),
}));
fs.writeFileSync(out, JSON.stringify({ title: 'Mengen & Relationen', slug: 'Mengen Relationen', summary: 'Eine Zusammenfassung.', concepts: ['K'], keyFacts: ['F'], levels, review: { checked: 40, fixed: 1, removed: 0, notes: 'ok' } }));
`;

let run: typeof import('../src/run.ts');

beforeAll(async () => {
  mkdirSync(join(studium, 'DS/01_Vorlesungen'), { recursive: true });
  sh(tmp, 'init', '-q', '-b', 'main', studium);
  sh(studium, 'config', 'user.email', 't@t');
  sh(studium, 'config', 'user.name', 't');
  writeFileSync(join(studium, 'DS/01_Vorlesungen/DS VO1.md'), '# Mengen\nEine Menge ist …');
  writeFileSync(join(studium, 'DS/01_Vorlesungen/.gitkeep'), '');
  writeFileSync(join(studium, 'README.md'), 'nicht relevant');
  sh(studium, 'add', '.');
  sh(studium, 'commit', '-qm', 'init');
  // Bare-Remote, damit `git pull` funktioniert
  const remote = join(tmp, 'studium.git');
  sh(tmp, 'clone', '-q', '--bare', studium, remote);
  sh(studium, 'remote', 'add', 'origin', remote);
  sh(studium, 'fetch', '-q', 'origin');
  sh(studium, 'branch', '-q', '--set-upstream-to=origin/main', 'main');

  mkdirSync(join(lq, 'content'), { recursive: true });
  sh(tmp, 'init', '-q', '-b', 'main', lq);
  sh(lq, 'config', 'user.email', 't@t');
  sh(lq, 'config', 'user.name', 't');
  sh(lq, 'commit', '-q', '--allow-empty', '-m', 'init');

  const fake = join(tmp, 'fake-codex');
  writeFileSync(fake, FAKE_CODEX);
  chmodSync(fake, 0o755);

  Object.assign(process.env, {
    STUDIUM_REPO: studium,
    LERNQUEST_REPO: lq,
    DATABASE_PATH: join(tmp, 'db.sqlite'),
    CODEX_BIN: fake,
    GIT_PUSH: 'false',
    REGENERATE_ON_MODIFY: 'false',
  });
  const { config } = await import('../src/config.ts');
  config.contentDir = join(lq, 'content');
  config.dataDir = join(tmp, 'data');
  run = await import('../src/run.ts');
});

const pushToRemote = (msg: string) => {
  sh(studium, 'add', '-A');
  sh(studium, 'commit', '-qm', msg);
  sh(studium, 'push', '-q', 'origin', 'main');
};

describe('pipeline', () => {
  it('dry-run lists the first lecture file only', async () => {
    const r = await run.execute('dry-run', { quiet: true });
    expect(r.files.filter((f) => f.status === 'planned').map((f) => f.path)).toEqual(['DS/01_Vorlesungen/DS VO1.md']);
  });

  it('run generates, validates, writes content, commits and imports', async () => {
    const r = await run.execute('run', { quiet: true });
    expect(r.status).toBe('success');
    expect(r.totals.processed).toBe(1);
    expect(r.totals.questions).toBe(40);
    expect(r.totals.tokens).toBe(2468); // generate + review
    expect(r.rateLimited).toBe(false);
    const files = readdirSync(join(lq, 'content/ds'));
    expect(files).toEqual(['01-mengen-relationen.json']);
    const unit = JSON.parse(readFileSync(join(lq, 'content/ds', files[0]!), 'utf8'));
    expect(unit.id).toBe('ds-01');
    expect(unit.levels[0].questions[1].id).toBe('ds-01-l1-q02');
    expect(unit.levels[0].questions[1].difficulty).toBe(5);
    expect(unit.levels[0].questions[1].source).toEqual({ file: 'DS/01_Vorlesungen/DS VO1.md', heading: 'Mengen' });
    expect(sh(lq, 'log', '-1', '--format=%s')).toContain('content: add DS Vorlesung 1 – Mengen & Relationen');
  });

  it('second run reports nothing new and falls back to admin notifications without telegram', async () => {
    const r = await run.execute('run', { quiet: true });
    expect(r.status).toBe('nothing_new');
    const { getDb } = await import('@lernquest/api/db');
    const { adminNotifications } = await import('@lernquest/api/schema');
    const notes = getDb().select().from(adminNotifications).all();
    expect(notes.at(-1)?.title).toContain('nichts Neues');
    expect(notes.at(-1)?.body).toContain('Telegram nicht konfiguriert');
  });

  it('renamed file with same content is not processed again', async () => {
    renameSync(join(studium, 'DS/01_Vorlesungen/DS VO1.md'), join(studium, 'DS/01_Vorlesungen/Diskrete Strukturen VO1.md'));
    pushToRemote('rename');
    const r = await run.execute('run', { quiet: true });
    expect(r.status).toBe('nothing_new');
    expect(r.files[0]?.reason).toContain('bereits verarbeitet');
  });

  it('modified files are ignored by default, new files become unit 2', async () => {
    writeFileSync(join(studium, 'DS/01_Vorlesungen/Diskrete Strukturen VO1.md'), '# Mengen\nGeändert');
    writeFileSync(
      join(studium, 'DS/01_Vorlesungen/Diskrete Strukturen VO2.md'),
      '---\ntags: [ds, relationen]\n---\n# Relationen\nAufbauend auf [[Diskrete Strukturen VO1|Mengen]].\n![[Pasted image 1.png]]\n',
    );
    // Bilder/Anhänge in den Vorlesungsordnern sind nie „neu“
    writeFileSync(join(studium, 'DS/01_Vorlesungen/skizze.png'), 'nicht wirklich ein Bild');
    pushToRemote('vo2');
    const r = await run.execute('run', { quiet: true });
    expect(r.totals.processed).toBe(1);
    const done = r.files.find((f) => f.status === 'done')!;
    expect(done.unitId).toBe('ds-02');
    expect(done.notes?.join()).toContain('Bild fehlt');
    expect(r.files.some((f) => f.path.endsWith('.png'))).toBe(false);
    expect(r.files.find((f) => f.status === 'skipped')?.reason).toContain('REGENERATE_ON_MODIFY=false');
    const unit = JSON.parse(readFileSync(join(lq, 'content/ds', readdirSync(join(lq, 'content/ds')).find((f) => f.startsWith('02-'))!), 'utf8'));
    expect(unit.tags).toEqual(['ds', 'relationen']);
    expect(unit.links).toEqual(['DS/01_Vorlesungen/Diskrete Strukturen VO1.md']);
    expect(unit.levels[0].questions[0].source).toEqual({ file: 'DS/01_Vorlesungen/Diskrete Strukturen VO2.md', heading: null });
  });

  it('refuses to run twice in parallel', async () => {
    const { config } = await import('../src/config.ts');
    mkdirSync(config.dataDir, { recursive: true });
    writeFileSync(join(config.dataDir, 'pipeline.lock'), JSON.stringify({ pid: process.ppid, runId: 'other', startedAt: '' }));
    const r = await run.execute('run', { quiet: true });
    expect(r.status).toBe('failed');
    expect(r.warnings.join()).toContain('läuft bereits');
  });
});

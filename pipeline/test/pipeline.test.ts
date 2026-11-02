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
const schema = a[a.indexOf('--output-schema') + 1];
const input = fs.readFileSync(0, 'utf8');
if (schema.includes('blind')) {
  // Blind-Test: richtig ist immer „zwei“/„Wahr“/„Navi“; Verweis auf die Vorlesung = fehlende Info
  const results = input.split('### Frage \`').slice(1).map((block) => {
    const key = block.slice(0, block.indexOf('\`'));
    const missing = block.includes('aus der Vorlesung');
    const opt = /- \`([a-z]+)\`: (zwei|Wahr|Navi)/.exec(block);
    const value = block.includes('Teilmengen') ? 64 : block.includes('PINs') ? 10000 : null;
    return { key, missingInfo: missing, missing: missing ? 'Treppe fehlt' : null, answer: opt ? [opt[1]] : [], value, confidence: 0.9, note: null };
  });
  fs.writeFileSync(out, JSON.stringify({ results }));
  process.exit(0);
}
if (schema.includes('knowledge')) {
  // Wissenssammlung: 4 Einträge, einer doppelt (wird verworfen), ein Term mit $…$ (wird bereinigt)
  const e = (term, kind) => ({ term, kind, short: term + ' kurz erklärt.', explanation: 'Eine **Erklärung** zu ' + term + ' mit $A \\cup B$.', example: null, pitfalls: [], related: ['Menge'], heading: 'mengen' });
  fs.writeFileSync(out, JSON.stringify({ overview: 'Worum es geht.', entries: [e('Menge', 'definition'), e('Vereinigung $∪$', 'notation'), e('menge', 'concept'), e('Mächtigkeit', 'definition')], review: { checked: 4, fixed: 0, added: 0, notes: '' } }));
  process.exit(0);
}
if (schema.includes('repair')) {
  const keys = [...input.matchAll(/### Frage \`([^\`]+)\`/g)].map((m) => m[1]);
  const questions = keys.map((key) => ({ key, type: 'calc', prompt: 'Treppe mit Stufenkosten 1, 1, 3: minimale Kosten, wenn man 1 oder 2 Stufen nimmt?', options: [{ id: 'a', text: 'drei' }, { id: 'b', text: 'zwei' }, { id: 'c', text: 'fünf' }], correct: ['b'], explanation: '1 + 1 = 2.', source: { file: 'x', heading: null }, difficulty: 2, concepts: ['K'], slider: null, context: { type: 'table', content: '| Stufe | Kosten |\\n|---|---|\\n| 1 | 1 |\\n| 2 | 1 |\\n| 3 | 3 |', language: null, caption: null, frames: [] }, verify: 'c=[1,1,3]\\nbest=min(c[0]+c[1], c[1])\\nprint("ANSWER: " + {3:"a",2:"b",5:"c"}.get(c[0]+c[1], "?"))' }));
  fs.writeFileSync(out, JSON.stringify({ questions }));
  process.exit(0);
}
const kinds = ['basics', 'apply', 'deepen', 'boss'];
const levels = kinds.map((kind, li) => ({
  kind, title: kind,
  questions: Array.from({ length: 10 }, (_, i) => li === 1 && i === 1
    ? { type: 'single', prompt: 'Was ist die schnellste Route über die Treppe aus der Vorlesung?', options: [{ id: 'a', text: 'links' }, { id: 'b', text: 'zwei' }, { id: 'c', text: 'rechts' }], correct: ['b'], explanation: 'Siehe VO.', source: { file: 'x', heading: null }, difficulty: 3, concepts: ['K'], context: null, verify: null }
    : i % 3 === 0
    ? { type: 'truefalse', prompt: 'Aussage ' + li + '-' + i + ' stimmt?', options: [{ id: 'true', text: 'Wahr' }, { id: 'false', text: 'Falsch' }], correct: ['true'], explanation: 'Weil es so ist.', source: { file: 'x', heading: 'mengen' }, difficulty: 2, concepts: ['K'] }
    : { type: 'single', prompt: 'Frage ' + li + '-' + i + '?', options: [{ id: 'a', text: 'eins' }, { id: 'b', text: 'zwei' }, { id: 'c', text: 'drei' }, { id: 'd', text: 'vier' }], correct: ['b'], explanation: 'Zwei ist richtig.', source: { file: 'x', heading: 'mengen' }, difficulty: 9, concepts: ['K'] }),
}));
if (schema.includes('bonus')) {
  // Praxis-Level: 7 Anwendungsfragen + 3 Schätzfragen (eine davon ungültig → wird verworfen)
  const questions = Array.from({ length: 7 }, (_, i) => ({ type: 'single', prompt: 'Welcher Alltagsfall ' + i + '?', options: [{ id: 'a', text: 'Navi' }, { id: 'b', text: 'Toaster' }, { id: 'c', text: 'Ampel' }], correct: ['a'], explanation: 'Weil Graphen.', source: { file: 'x', heading: null }, difficulty: 2, concepts: ['K'], slider: null }));
  questions.push({ type: 'estimate', prompt: 'Wie viele Teilmengen hat eine 6-elementige Menge?', options: [], correct: [], explanation: '2^6 = 64.', source: { file: 'x', heading: null }, difficulty: 2, concepts: ['K'], slider: { min: 0, max: 100, step: 1, answer: 64, tolerance: 0, unit: null, scale: 'linear' } });
  questions.push({ type: 'estimate', prompt: 'Wie viele PINs mit 4 Ziffern gibt es?', options: [], correct: [], explanation: '10^4.', source: { file: 'x', heading: null }, difficulty: 2, concepts: ['K'], slider: { min: 10, max: 1000000, step: 1, answer: 10000, tolerance: 1500, unit: 'PINs', scale: 'log' } });
  questions.push({ type: 'estimate', prompt: 'Kaputter Regler?', options: [], correct: [], explanation: 'Nope.', source: { file: 'x', heading: null }, difficulty: 2, concepts: ['K'], slider: { min: 0, max: 10, step: 1, answer: 50, tolerance: 0, unit: null, scale: 'linear' } });
  fs.writeFileSync(out, JSON.stringify({ title: 'Praxis: Mengen im Alltag', questions, review: { checked: 10, fixed: 0, removed: 0, notes: '' } }));
  process.exit(0);
}
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
  config.knowledgeDir = join(lq, 'wissen');
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
    expect(r.totals.questions).toBe(49); // 4 × 10 + Praxis 9 (1 Schätzfrage verworfen)
    // generate + review, Praxis generate + review, Blind-Test (49 Fragen = 3 Batches), Reparatur + Blind-Test des Ersatzes, Wissen generate + review
    expect(r.totals.tokens).toBe(11 * 1234);
    expect(r.files[0]!.knowledge).toBe(3);
    expect(r.files[0]!.gate).toMatchObject({ checked: 49, failedFirst: 1, dropped: [] });
    expect(r.files[0]!.gate!.repaired).toEqual([expect.objectContaining({ oldId: 'ds-01-l2-q02', newId: 'ds-01-l2-q02-r1' })]);
    expect(r.rateLimited).toBe(false);
    const files = readdirSync(join(lq, 'content/ds'));
    expect(files).toEqual(['01-mengen-relationen.json']);
    const unit = JSON.parse(readFileSync(join(lq, 'content/ds', files[0]!), 'utf8'));
    expect(unit.id).toBe('ds-01');
    expect(unit.levels[0].questions[1].id).toBe('ds-01-l1-q02');
    expect(unit.levels[0].questions[1].difficulty).toBe(5);
    expect(unit.levels[0].questions[1].source).toEqual({ file: 'DS/01_Vorlesungen/DS VO1.md', heading: 'Mengen' });
    expect(unit.levels).toHaveLength(5);
    expect(unit.levels[1].questions[1]).toMatchObject({ id: 'ds-01-l2-q02-r1', type: 'calc', context: { type: 'table' } });
    expect(unit.levels[4]).toMatchObject({ id: 'ds-01-l5', kind: 'bonus', title: 'Praxis: Mengen im Alltag' });
    expect(unit.levels[4].questions.filter((q: { type: string }) => q.type === 'estimate').map((q: { slider: { answer: number } }) => q.slider.answer)).toEqual([64, 10000]);
    expect(r.files[0]!.dropped!.join()).toContain('answer außerhalb');
    expect(sh(lq, 'log', '-2', '--format=%s')).toContain('content: add DS Vorlesung 1 – Mengen & Relationen');
    // Wissenssammlung: eigene Datei + eigener Commit, doppelte Begriffe raus, $ aus Termen entfernt
    const k = JSON.parse(readFileSync(join(lq, 'wissen/ds/ds-01.json'), 'utf8'));
    expect(k).toMatchObject({ unitId: 'ds-01', module: 'DS', unitNumber: 1, sourceSha: unit.source.sha256, overview: 'Worum es geht.' });
    expect(k.entries.map((x: { id: string; term: string }) => `${x.id} ${x.term}`)).toEqual(['ds-01-k01 Menge', 'ds-01-k02 Vereinigung ∪', 'ds-01-k03 Mächtigkeit']);
    expect(k.entries[0].heading).toBe('Mengen');
    expect(k.entries[0].related).toEqual([]); // Verweis auf sich selbst entfällt
    expect(sh(lq, 'log', '-1', '--format=%s')).toContain('wissen: DS Vorlesung 1');
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

  it('bonus mode regenerates only the praxis level of an existing unit', async () => {
    const r = await run.execute('bonus', { quiet: true, file: 'ds-01' });
    expect(r.files.find((f) => f.error)?.error).toBeUndefined();
    expect(r.status).toBe('success');
    expect(r.files.map((f) => [f.unitId, f.questions])).toEqual([['ds-01', 9]]);
    // identischer Inhalt → kein leerer Commit
    expect(sh(lq, 'log', '-1', '--format=%s')).not.toContain('Praxis-Level');
    expect((await run.execute('bonus', { quiet: true })).status).toBe('nothing_new'); // alle haben schon eins
  });

  it('bonus mode commits every unit it fills, not only the first', async () => {
    const dir = join(lq, "content/ds");
    for (const f of readdirSync(dir)) {
      const u = JSON.parse(readFileSync(join(dir, f), "utf8"));
      u.levels = u.levels.slice(0, 4);
      writeFileSync(join(dir, f), JSON.stringify(u, null, 2) + "\n");
    }
    sh(lq, "commit", "-qam", "strip praxis");
    const r = await run.execute("bonus", { quiet: true });
    expect(r.files.map((f) => f.unitId).sort()).toEqual(["ds-01", "ds-02"]);
    expect(sh(lq, "status", "--porcelain").trim()).toBe("");
    expect(sh(lq, "log", "-2", "--format=%s").match(/Praxis-Level/g)).toHaveLength(2);
  });

  it('knowledge mode regenerates the collection of one unit; normal runs catch up missing ones', async () => {
    const r = await run.execute('knowledge', { quiet: true, file: 'ds-01' });
    expect(r.status).toBe('success');
    expect(r.files).toEqual([expect.objectContaining({ unitId: 'ds-01', status: 'done', knowledge: 3 })]);
    // fehlende Sammlung (z. B. gelöscht) holt der nächste normale Lauf nach, ohne dass es als neue Notiz zählt
    const { rmSync } = await import('node:fs');
    rmSync(join(lq, 'wissen/ds/ds-02.json'), { force: true });
    const r2 = await run.execute('run', { quiet: true });
    expect(r2.files.filter((f) => f.knowledge).map((f) => f.unitId)).toContain('ds-02');
    expect(readdirSync(join(lq, 'wissen/ds'))).toContain('ds-02.json');
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

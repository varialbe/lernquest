import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { checkAnswer, Level, MODULE_INFO, Unit, type Question } from '@lernquest/shared';
import { codexJson } from './codex.ts';
import { config } from './config.ts';
import { FENCE, fill, formatHeadings, normalizeQuestion, template, type RawQuestion } from './generate.ts';
import type { Heading } from './obsidian.ts';

/**
 * Qualitäts-Tor nach der Generierung:
 * 1. Prüfskripte (`verify`, Python) ausführen und mit der hinterlegten Lösung vergleichen.
 * 2. Blind-Test: ein zweiter Codex-Lauf sieht NUR Frage + Kontext + Optionen (keine Vorlesung) und löst.
 *    „Fehlende Info“ oder eine abweichende Antwort = durchgefallen.
 * 3. Durchgefallene Fragen mit Befund neu generieren (max. 2 Versuche, jeder Ersatz wieder 1.+2.), sonst verwerfen.
 */

/** Roh-Fragen aus der Codex-Ausgabe, über den Prompt-Text zugeordnet (IDs/Optionen werden beim Normalisieren neu vergeben). */
export type RawIndex = Map<string, RawQuestion>;

export type GateSource = { file: string; headings: Heading[]; text: string } | null;

export type GateReport = {
  checked: number;
  verified: number;
  failedFirst: number;
  repaired: { oldId: string; newId: string; reason: string }[];
  dropped: { id: string; prompt: string; reason: string }[];
};

export type GateResult = { unit: Unit; report: GateReport; tokens: number };

const BLIND_BATCH = 24;
const blindSchema = resolve(config.root, 'pipeline/schemas/blind-output.schema.json');
const repairSchema = resolve(config.root, 'pipeline/schemas/repair-output.schema.json');

// ---------- Prüfskripte ----------
type VerifyOutcome = { status: 'ok' } | { status: 'none' } | { status: 'fail'; reason: string };

const sandbox = resolve(config.root, 'pipeline/src/sandbox.py');

/** Führt ein Prüfskript isoliert aus (python3 -I über sandbox.py, Timeout, leeres Arbeitsverzeichnis) und liest „ANSWER: …“. */
export function runVerifyScript(script: string): { answer: string } | { error: string } {
  const dir = mkdtempSync(join(tmpdir(), 'lq-verify-'));
  try {
    writeFileSync(join(dir, 'verify.py'), script);
    const r = spawnSync(config.pythonBin, ['-I', sandbox, 'verify.py'], { cwd: dir, timeout: 10_000, encoding: 'utf8', env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' }, maxBuffer: 1 << 20 });
    if (r.error) return { error: `Prüfskript nicht ausführbar: ${r.error.message}` };
    if (r.status !== 0) return { error: `Prüfskript-Fehler: ${(r.stderr || '').trim().split('\n').at(-1)?.slice(0, 200) ?? `Exit ${r.status}`}` };
    const line = r.stdout.trim().split('\n').reverse().find((l) => /^ANSWER:/i.test(l.trim()));
    if (!line) return { error: 'Prüfskript gab keine Zeile „ANSWER: …“ aus' };
    return { answer: line.trim().slice(7).trim() };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Ergebnis des Prüfskripts (Options-IDs der Roh-Frage) über die Optionstexte auf die normalisierte Frage abbilden und vergleichen. */
export function verifyQuestion(q: Question, raw: RawQuestion | undefined): VerifyOutcome {
  if (!raw?.verify?.trim()) return { status: 'none' };
  const out = runVerifyScript(raw.verify);
  if ('error' in out) return { status: 'fail', reason: out.error };
  if (q.type === 'estimate') {
    const v = Number(out.answer.replace(',', '.'));
    if (!Number.isFinite(v)) return { status: 'fail', reason: `Prüfskript lieferte keine Zahl („${out.answer.slice(0, 40)}“)` };
    return checkAnswer(q, [String(v)]) ? { status: 'ok' } : { status: 'fail', reason: `Prüfskript berechnet ${v}, hinterlegt ist ${q.slider?.answer} ± ${q.slider?.tolerance}` };
  }
  const rawIds = out.answer.split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  let ids: string[];
  if (q.type === 'truefalse') ids = rawIds.map((id) => (/^(true|wahr|richtig)$/.test(id) ? 'true' : /^(false|falsch)$/.test(id) ? 'false' : id));
  else {
    const textOf = new Map((raw.options ?? []).map((o) => [o.id.trim().toLowerCase(), o.text.trim()]));
    ids = rawIds.map((id) => q.options.find((o) => o.text.trim() === textOf.get(id))?.id ?? `?${id}`);
  }
  return checkAnswer(q, ids) ? { status: 'ok' } : { status: 'fail', reason: `Prüfskript kommt auf ${rawIds.join(',')} statt der hinterlegten Lösung` };
}

// ---------- Blind-Test ----------
/** So sieht die Frage in der App aus – nur das bekommt der Blind-Test. */
export function renderForBlind(q: Question, key: string): string {
  const parts = [`### Frage \`${key}\` (Typ: ${q.type})`, q.prompt];
  const c = q.context;
  if (c) {
    const lang = c.type === 'mermaid' ? 'mermaid' : c.type === 'code' ? (c.language ?? '') : '';
    parts.push(`**Kontext${c.caption ? ` – ${c.caption}` : ''}:**`, c.type === 'table' ? c.content : `${FENCE}${lang}\n${c.content}\n${FENCE}`);
    c.frames?.forEach((f, i) => parts.push(`**Schritt ${i + 1}${f.caption ? ` – ${f.caption}` : ''}:**\n${FENCE}mermaid\n${f.content}\n${FENCE}`));
  }
  if (q.type === 'estimate' && q.slider) {
    const s = q.slider;
    parts.push(`Antwort per Schieberegler von ${s.min} bis ${s.max}${s.unit ? ` ${s.unit}` : ''} (Schrittweite ${s.step}, ${s.scale === 'log' ? 'logarithmisch' : 'linear'}).`);
  } else {
    parts.push(q.type === 'multi' ? 'Optionen (mehrere können richtig sein):' : 'Optionen (genau eine ist richtig):', ...q.options.map((o) => `- \`${o.id}\`: ${o.text}`));
  }
  return parts.join('\n\n');
}

type BlindRow = { key: string; missingInfo: boolean; missing: string | null; answer: string[]; value: number | null; confidence: number; note: string | null };

/** Blind-Test für eine Menge Fragen. Ergebnis: Fragen-ID → Grund des Durchfallens (fehlt = bestanden). */
export async function blindTest(questions: Question[], module: Unit['module'], workDir: string, label: string, log: (m: string) => void): Promise<{ failures: Map<string, string>; tokens: number }> {
  const failures = new Map<string, string>();
  let tokens = 0;
  for (let i = 0; i < questions.length; i += BLIND_BATCH) {
    const batch = questions.slice(i, i + BLIND_BATCH);
    const prompt = fill(template('blind-test.md'), {
      MODULE: module,
      MODULE_NAME: MODULE_INFO[module].name,
      QUESTIONS: batch.map((q) => renderForBlind(q, q.id)).join('\n\n---\n\n'),
    });
    const r = await codexJson({ prompt, effort: config.codexBlindEffort, workDir, label: `${label}-${i / BLIND_BATCH + 1}`, log, schema: blindSchema });
    tokens += r.tokens;
    const rows = new Map(((r.data as { results?: BlindRow[] }).results ?? []).map((x) => [x.key, x]));
    for (const q of batch) {
      const row = rows.get(q.id);
      if (!row) failures.set(q.id, 'Blind-Test lieferte kein Ergebnis');
      else if (row.missingInfo) failures.set(q.id, `fehlende Info: ${row.missing ?? row.note ?? 'nicht lösbar ohne Vorlesung'}`);
      else if (q.type === 'estimate') {
        if (row.value === null || !checkAnswer(q, [String(row.value)])) failures.set(q.id, `Blind-Test schätzt ${row.value ?? '–'}, hinterlegt ${q.slider?.answer} ± ${q.slider?.tolerance}`);
      } else if (!checkAnswer(q, row.answer.map((a) => a.trim().toLowerCase()))) {
        failures.set(q.id, `Blind-Test antwortet ${row.answer.join(',') || '–'} statt ${q.correct.join(',')}${row.note ? ` (${row.note.slice(0, 160)})` : ''}`);
      }
    }
  }
  return { failures, tokens };
}

// ---------- Reparatur ----------
const nextId = (id: string, taken: Set<string>) => {
  const m = /^(.*?)(?:-r(\d+))?$/.exec(id)!;
  let n = Number(m[2] ?? 0) + 1;
  while (taken.has(`${m[1]}-r${n}`)) n++;
  return `${m[1]}-r${n}`;
};

async function repair(
  failed: { q: Question; reason: string }[],
  unit: Unit,
  source: GateSource,
  workDir: string,
  attempt: number,
  log: (m: string) => void,
): Promise<{ raws: Map<string, RawQuestion>; tokens: number }> {
  const prompt = fill(template('repair-questions.md'), {
    MODULE: unit.module,
    MODULE_NAME: MODULE_INFO[unit.module].name,
    FILE: source?.file ?? unit.source.file,
    HEADINGS: formatHeadings(source?.headings ?? []),
    FAILED: failed
      .map(({ q, reason }) => `${renderForBlind(q, q.id)}\n\n**Hinterlegte Lösung:** ${q.type === 'estimate' ? `${q.slider?.answer}` : q.correct.join(',')} · **Erklärung:** ${q.explanation}\n\n**Befund:** ${reason}`)
      .join('\n\n---\n\n'),
    SOURCE: source ? `${FENCE}markdown\n${source.text}\n${FENCE}` : `_(Mitschrift nicht verfügbar – Zusammenfassung: ${unit.summary}; Kernaussagen: ${unit.keyFacts.join(' · ')})_`,
  });
  const r = await codexJson({ prompt, effort: config.codexEffort, workDir, label: `repair-${attempt}`, log, schema: repairSchema });
  const raws = new Map<string, RawQuestion>();
  for (const rq of (r.data as { questions?: (RawQuestion & { key: string })[] }).questions ?? []) raws.set(rq.key, rq);
  return { raws, tokens: r.tokens };
}

/** Prüft eine komplette Unit (inkl. Praxis-Level) und repariert/verwirft durchgefallene Fragen. */
export async function qualityGate(
  unit: Unit,
  opts: { raws?: RawIndex; source: GateSource; workDir: string; log: (m: string) => void; label?: string; /** nur diese Level prüfen */ only?: string[]; /** diese Fragen unabhängig vom Blind-Test neu generieren (ID → Grund) */ force?: Map<string, string> },
): Promise<GateResult> {
  const { source, workDir, log } = opts;
  const raws = opts.raws ?? new Map();
  const all = unit.levels.filter((l) => !opts.only || opts.only.includes(l.id)).flatMap((l) => l.questions);
  const report: GateReport = { checked: all.length, verified: 0, failedFirst: 0, repaired: [], dropped: [] };
  let tokens = 0;

  // 1. Prüfskripte
  const failures = new Map<string, string>();
  for (const q of all) {
    const v = verifyQuestion(q, raws.get(q.prompt));
    if (v.status === 'ok') report.verified++;
    if (v.status === 'fail') failures.set(q.id, v.reason);
  }
  // 2. Blind-Test
  log(`  → Blind-Test ${unit.id}: ${all.length} Fragen (effort ${config.codexBlindEffort})`);
  const blind = await blindTest(all, unit.module, workDir, opts.label ?? 'blind', log);
  tokens += blind.tokens;
  for (const [id, reason] of blind.failures) failures.set(id, failures.has(id) ? `${failures.get(id)}; ${reason}` : reason);
  for (const [id, reason] of opts.force ?? []) if (all.some((q) => q.id === id)) failures.set(id, failures.has(id) ? `${failures.get(id)}; ${reason}` : reason);
  report.failedFirst = failures.size;
  log(`  Blind-Test ${unit.id}: ${all.length - failures.size}/${all.length} bestanden${report.verified ? `, ${report.verified} Prüfskripte ok` : ''}`);

  // 3. Reparieren (max. 2 Versuche), sonst verwerfen
  const replaced = new Map<string, Question>();
  const taken = new Set(all.map((q) => q.id));
  let pending = all.filter((q) => failures.has(q.id)).map((q) => ({ orig: q, q, reason: failures.get(q.id)! }));
  for (let attempt = 1; attempt <= 2 && pending.length; attempt++) {
    log(`  → Reparatur ${unit.id}, Versuch ${attempt}: ${pending.length} Fragen`);
    const rep = await repair(pending.map((p) => ({ q: p.q, reason: p.reason })), unit, source, workDir, attempt, log);
    tokens += rep.tokens;
    const candidates: { p: (typeof pending)[number]; q: Question }[] = [];
    const still: typeof pending = [];
    for (const p of pending) {
      const rq = rep.raws.get(p.q.id);
      if (!rq) {
        still.push({ ...p, reason: `${p.reason}; keine Ersatzfrage geliefert` });
        continue;
      }
      const id = nextId(p.orig.id, taken);
      const n = normalizeQuestion(rq, id, { file: unit.source.file, headings: source?.headings ?? [], knownFiles: [unit.source.file], fallbackConcept: p.orig.concepts[0]! });
      if (!n.ok) {
        still.push({ ...p, reason: `Ersatz ungültig: ${n.error}` });
        continue;
      }
      const v = verifyQuestion(n.question, rq);
      if (v.status === 'fail') {
        still.push({ ...p, q: n.question, reason: v.reason });
        continue;
      }
      candidates.push({ p, q: n.question });
    }
    if (candidates.length) {
      const b = await blindTest(candidates.map((c) => c.q), unit.module, workDir, `blind-repair-${attempt}`, log);
      tokens += b.tokens;
      for (const c of candidates) {
        const fail = b.failures.get(c.q.id);
        if (fail) still.push({ ...c.p, q: c.q, reason: fail });
        else {
          taken.add(c.q.id);
          replaced.set(c.p.orig.id, c.q);
          report.repaired.push({ oldId: c.p.orig.id, newId: c.q.id, reason: c.p.reason });
        }
      }
    }
    pending = still;
  }
  for (const p of pending) report.dropped.push({ id: p.orig.id, prompt: p.orig.prompt.slice(0, 120), reason: p.reason });
  if (report.repaired.length || report.dropped.length) log(`  ${unit.id}: ${report.repaired.length} repariert, ${report.dropped.length} verworfen`);

  // 4. Unit neu zusammensetzen
  const droppedIds = new Set(report.dropped.map((d) => d.id));
  const levels = unit.levels.map((l) => {
    const questions = l.questions.filter((q) => !droppedIds.has(q.id)).map((q) => replaced.get(q.id) ?? q);
    const parsed = Level.safeParse({ ...l, questions });
    if (!parsed.success) throw new Error(`Level ${l.id} hätte nach dem Blind-Test nur ${questions.length} Fragen (mind. 8) – Unit bleibt unverändert`);
    return parsed.data;
  });
  return { unit: Unit.parse({ ...unit, levels }), report, tokens };
}

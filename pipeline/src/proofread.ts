import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  isMermaidDocument, knowledgeTranslationFields, mermaidSkeleton, protectedTokens, Unit, UnitKnowledge, unitTranslationFields,
  validateKnowledgeTranslation, validateUnitTranslation, type Unit as UnitType, type UnitKnowledge as KnowledgeType,
} from '@lernquest/shared';
import { codexJson, type CodexOptions, type CodexResult } from './codex.ts';
import { config } from './config.ts';
import { fill, template } from './generate.ts';
import { readKnowledge } from './knowledge.ts';
import { findContentFile, maskFields, translationPaths } from './translate.ts';

/**
 * Korrekturlesen (Rechtschreibung, Grammatik, Zeichensetzung, deutsche Reste im Englischen) ohne inhaltliche Änderungen.
 * Deterministische Schranken: Formeln/Code/Lücken byte-gleich, Diagrammstruktur gleich, nur kleine Wortänderungen,
 * Unit/Wissen bleiben schema-gültig, englische Fassungen bestehen weiter den Übersetzungs-Validator.
 */
type Field = { path: string; text: string };
type Lang = 'de' | 'en';
export type ProofreadChange = { unitId: string; lang: Lang; asset: 'unit' | 'knowledge'; path: string; before: string; after: string };
export type ProofreadRejection = ProofreadChange & { reason: string };
type RunCodex = (options: CodexOptions) => Promise<CodexResult>;

function words(text: string) {
  return text.split(/\s+/).filter(Boolean);
}
/** Anzahl geänderter Wörter (Wort-LCS). */
export function changedWords(before: string, after: string): number {
  const a = words(before);
  const b = words(after);
  const prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = a[i - 1] === b[j - 1] ? diag + 1 : Math.max(prev[j]!, prev[j - 1]!);
      diag = tmp;
    }
  }
  return Math.max(a.length, b.length) - prev[b.length]!;
}

/** Ist die Korrektur eines Feldes zulässig? `null` = ok, sonst Grund. */
export function checkCorrection(before: string, after: string, lang: Lang): string | null {
  if (!after.trim()) return 'empty text';
  if (before === after) return 'unchanged';
  if (isMermaidDocument(before)) return mermaidSkeleton(before) === mermaidSkeleton(after) ? null : 'diagram structure changed';
  if (protectedTokens(before).join('\n') !== protectedTokens(after).join('\n')) return 'formula or code changed';
  if ((before.match(/_{3,}/g)?.length ?? 0) !== (after.match(/_{3,}/g)?.length ?? 0)) return 'cloze marker changed';
  const limit = Math.max(3, Math.ceil(words(before).length * (lang === 'en' ? 0.4 : 0.25)));
  const changed = changedWords(before, after);
  if (changed > limit) return `too many changed words (${changed} > ${limit})`;
  return null;
}

function setPath(target: unknown, path: string, value: string) {
  const parts = path.split('.');
  let node = target as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) node = node[part] as Record<string, unknown>;
  node[parts.at(-1)!] = value;
}

/** JSON wie die Originaldatei schreiben (Zeilenenden beibehalten). */
function writeJson(file: string, value: unknown) {
  const crlf = existsSync(file) && readFileSync(file, 'utf8').includes('\r\n');
  const text = JSON.stringify(value, null, 2) + '\n';
  writeFileSync(file, crlf ? text.replace(/\n/g, '\r\n') : text);
}

async function proofreadAsset<T>(opts: {
  unitId: string; lang: Lang; asset: 'unit' | 'knowledge'; value: T; fields: Field[]; workDir: string; log: (m: string) => void; runCodex: RunCodex;
  validate: (candidate: T) => string[];
}): Promise<{ value: T; changes: ProofreadChange[]; rejected: ProofreadRejection[]; tokens: number }> {
  const { maskedFields, protectedSpans, unmask } = maskFields(opts.fields, { fillMissing: true });
  const reference = protectedSpans.length ? `\n\nPLACEHOLDER CONTENT FOR CONTEXT ONLY (never edit; keep the ⟦LQnumber⟧ placeholders):\n${JSON.stringify(protectedSpans.map((text, i) => ({ placeholder: `⟦LQ${i}⟧`, text })))}` : '';
  const prompt = fill(template('proofread.md'), { LANGUAGE: opts.lang === 'de' ? 'German' : 'English', FIELDS: JSON.stringify(maskedFields, null, 2) }) + reference;
  const result = await opts.runCodex({ prompt, effort: config.codexEffort, workDir: opts.workDir, label: `proofread-${opts.asset}-${opts.lang}`, log: opts.log, schema: config.translationFieldsSchemaFile });
  const response = unmask(result.data) as { translations?: Field[] } | null;
  const byPath = new Map(opts.fields.map((f) => [f.path, f.text]));
  const out = structuredClone(opts.value);
  const changes: ProofreadChange[] = [];
  const rejected: ProofreadRejection[] = [];
  for (const item of response?.translations ?? []) {
    if (typeof item?.path !== 'string' || typeof item.text !== 'string') continue;
    const before = byPath.get(item.path);
    if (before == null) continue;
    const change = { unitId: opts.unitId, lang: opts.lang, asset: opts.asset, path: item.path, before, after: item.text };
    const reason = checkCorrection(before, item.text, opts.lang);
    if (reason === 'unchanged') continue;
    if (reason) rejected.push({ ...change, reason });
    else {
      setPath(out, item.path, item.text);
      changes.push(change);
    }
  }
  // Gesamtprüfung; bei Fehlern einzelne Änderungen zurücknehmen, bis alles gültig ist
  let errors = opts.validate(out);
  if (errors.length) {
    for (const change of [...changes]) {
      const blamed = errors.some((e) => e.startsWith(change.path) || e.includes(change.path));
      if (!blamed) continue;
      setPath(out, change.path, change.before);
      changes.splice(changes.indexOf(change), 1);
      rejected.push({ ...change, reason: `validator: ${errors.find((e) => e.includes(change.path))}` });
    }
    errors = opts.validate(out);
    if (errors.length) {
      opts.log(`  ⚠ ${opts.unitId} ${opts.asset}/${opts.lang}: Korrekturen verworfen (${errors.slice(0, 3).join('; ')})`);
      return { value: opts.value, changes: [], rejected: [...rejected, ...changes.map((c) => ({ ...c, reason: 'asset validation failed' }))], tokens: result.tokens };
    }
  }
  return { value: out, changes, rejected, tokens: result.tokens };
}

export async function proofreadUnit(unitId: string, lang: Lang, opts: { dryRun?: boolean; log?: (m: string) => void; runCodex?: RunCodex } = {}) {
  const log = opts.log ?? ((m: string) => console.log(m));
  const runCodex = opts.runCodex ?? codexJson;
  const knowledge = readKnowledge(unitId);
  const module = unitId.split('-')[0]!.toUpperCase();
  const number = Number(unitId.split('-')[1]);
  const unitFile = findContentFile({ module: module as UnitType['module'], number });
  if (!unitFile) throw new Error(`Unit-Datei für ${unitId} fehlt`);
  const deUnit = Unit.parse(JSON.parse(readFileSync(unitFile, 'utf8')));
  const paths = translationPaths(unitFile, deUnit);
  const knowledgeFile = lang === 'de' ? join(config.knowledgeDir, module.toLowerCase(), `${unitId}.json`) : paths.translatedKnowledge;
  const targetUnitFile = lang === 'de' ? unitFile : paths.translatedUnit;
  if (!existsSync(targetUnitFile)) throw new Error(`${targetUnitFile} fehlt`);
  const unit = Unit.parse(JSON.parse(readFileSync(targetUnitFile, 'utf8')));
  const know = existsSync(knowledgeFile) ? UnitKnowledge.parse(JSON.parse(readFileSync(knowledgeFile, 'utf8'))) : null;
  const workDir = join(config.dataDir, 'work', `proofread-${unitId}-${lang}-${process.pid}-${Date.now()}`);
  mkdirSync(workDir, { recursive: true });

  const validateUnit = (candidate: UnitType) => {
    const parsed = Unit.safeParse(candidate);
    if (!parsed.success) return parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    return lang === 'en' ? validateUnitTranslation(deUnit, candidate) : [];
  };
  const validateKnow = (candidate: KnowledgeType) => {
    const parsed = UnitKnowledge.safeParse(candidate);
    if (!parsed.success) return parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    return lang === 'en' && knowledge ? validateKnowledgeTranslation(knowledge, candidate) : [];
  };
  const [u, k] = await Promise.all([
    proofreadAsset({ unitId, lang, asset: 'unit', value: unit, fields: unitTranslationFields(unit), workDir, log, runCodex, validate: validateUnit }),
    know ? proofreadAsset({ unitId, lang, asset: 'knowledge', value: know, fields: knowledgeTranslationFields(know), workDir, log, runCodex, validate: validateKnow }) : Promise.resolve(null),
  ]);
  const written: string[] = [];
  if (!opts.dryRun) {
    if (u.changes.length) { writeJson(targetUnitFile, u.value); written.push(targetUnitFile); }
    if (k?.changes.length) { writeJson(knowledgeFile, k.value); written.push(knowledgeFile); }
  }
  return { unit: u.value, unitChanged: u.changes.length > 0, changes: [...u.changes, ...(k?.changes ?? [])], rejected: [...u.rejected, ...(k?.rejected ?? [])], tokens: u.tokens + (k?.tokens ?? 0), written };
}

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { KnowledgeGraph, Unit, UnitKnowledge, unitTranslationFields, knowledgeTranslationFields, validateUnitTranslation, validateKnowledgeTranslation, protectedTokens, type Unit as UnitType, type UnitKnowledge as KnowledgeType } from '@lernquest/shared';
export { unitTranslationFields, knowledgeTranslationFields, validateUnitTranslation, validateKnowledgeTranslation, protectedTokens } from '@lernquest/shared';
import { codexJson, type CodexOptions, type CodexResult } from './codex.ts';
import { config } from './config.ts';
import { fill, template } from './generate.ts';

type Field = { path: string; text: string };
type FieldResponse = { translations: Field[] };
type TranslateFn = (options: CodexOptions) => Promise<CodexResult>;
export type TranslationMeta = {
  sourceUnitHash: string;
  sourceUnitSha: string;
  sourceUnitGeneratedAt: string;
  sourceKnowledgeHash: string;
  sourceKnowledgeGeneratedAt: string;
  translatedAt: string;
};
export type TranslationResult = { unitFile: string; knowledgeFile: string; metaFile: string; prereqFile?: string; tokens: number };

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function applyFields<T>(source: T, expected: Field[], raw: unknown): { value: T; errors: string[] } {
  const out = clone(source);
  const errors: string[] = [];
  const response = raw as Partial<FieldResponse> | null;
  if (!response || !Array.isArray(response.translations)) return { value: out, errors: ['response must contain a translations array'] };
  const expectedByPath = new Map(expected.map((field) => [field.path, field]));
  const received = new Map<string, string>();
  for (const item of response.translations) {
    if (!item || typeof item.path !== 'string' || typeof item.text !== 'string') {
      errors.push('each translation needs string path and text fields');
      continue;
    }
    if (!expectedByPath.has(item.path)) errors.push(`unexpected path: ${item.path}`);
    if (received.has(item.path)) errors.push(`duplicate path: ${item.path}`);
    received.set(item.path, item.text);
  }
  for (const field of expected) {
    if (!received.has(field.path)) {
      errors.push(`missing path: ${field.path}`);
      continue;
    }
    const parts = field.path.split('.');
    let target = out as Record<string, unknown>;
    for (const part of parts.slice(0, -1)) target = target[part] as Record<string, unknown>;
    target[parts.at(-1)!] = received.get(field.path)!;
  }
  return { value: out, errors };
}

async function translateAsset<T>(opts: {
  kind: 'unit' | 'knowledge' | 'prereqs';
  source: T;
  fields: Field[];
  validate: (candidate: unknown) => string[];
  workDir: string;
  log: (message: string) => void;
  runCodex: TranslateFn;
}): Promise<{ value: T; tokens: number }> {
  // Models occasionally drop delimiters even when instructed to copy formulas.
  // Placeholders preserve complete protected spans; the final validator still checks bytes.
  const protectedSpans: string[] = [];
  const maskedFields = opts.fields.map((field) => ({ ...field, text: field.text.replace(/```[\s\S]*?```|`[^`\n]*`|\$\$[\s\S]*?\$\$|(?<!\\)\$(?!\$)[^$\n]+(?<!\\)\$/g, (span) => `⟦LQ${protectedSpans.push(span) - 1}⟧`) }));
  const unmask = (raw: unknown): unknown => {
    const response = raw as Partial<FieldResponse> | null;
    if (!response || !Array.isArray(response.translations)) return raw;
    return { ...response, translations: response.translations.map((field) => typeof field?.text === 'string' ? { ...field, text: field.text.replace(/⟦LQ(\d+)⟧/g, (marker, index: string) => protectedSpans[Number(index)] ?? marker) } : field) };
  };
  const fieldsJson = JSON.stringify(maskedFields, null, 2);
  const reference = protectedSpans.length ? `\n\nPROTECTED SPANS FOR CONTEXT (copy only their ⟦LQnumber⟧ placeholders unchanged in translations, exactly once and in their source occurrence order; rephrase English around that order and never add delimiters around them):\n${JSON.stringify(protectedSpans.map((text, i) => ({ placeholder: `⟦LQ${i}⟧`, text })))}` : '';
  const makePrompt = (name: string, vars: Record<string, string>) => fill(template(name), vars);
  const ask = async (attempt: number, prompt: string) => opts.runCodex({
    prompt: prompt + reference,
    effort: config.codexEffort,
    workDir: opts.workDir,
    label: `translate-${opts.kind}-${attempt}`,
    log: opts.log,
    schema: config.translationFieldsSchemaFile,
  });
  const first = await ask(1, makePrompt(opts.kind === 'unit' ? 'translate-unit.md' : opts.kind === 'prereqs' ? 'translate-prereqs.md' : 'translate-knowledge.md', { FIELDS: fieldsJson }));
  const firstData = unmask(first.data);
  let applied = applyFields(opts.source, opts.fields, firstData);
  let errors = [...applied.errors, ...opts.validate(applied.value)];
  if (!errors.length) return { value: applied.value, tokens: first.tokens };

  opts.log(`  ⚠ ${opts.kind} translation validation failed; requesting one repair (${errors.length} issue(s))`);
  // A repair changes only rejected fields; successful translations are retained.
  // Structural errors have no path, so request a complete replacement in that case.
  const rejected = opts.fields.filter((field) => errors.some((error) => error.startsWith(`${field.path}:`) || error === `missing path: ${field.path}`));
  const repairFields = rejected.length && errors.every((error) => rejected.some((field) => error.startsWith(`${field.path}:`) || error === `missing path: ${field.path}`)) ? rejected : opts.fields;
  const previous = (firstData as FieldResponse)?.translations ?? [];
  const repairPaths = new Set(repairFields.map((field) => field.path));
  const second = await ask(2, makePrompt('repair-translation.md', { ERRORS: errors.map((e) => `- ${e}`).join('\n'), FIELDS: JSON.stringify(maskedFields.filter((field) => repairPaths.has(field.path)), null, 2), CANDIDATE: JSON.stringify(previous.filter((field) => repairPaths.has(field.path)), null, 2) }));
  const repaired = unmask(second.data) as Partial<FieldResponse> | null;
  const repairedCheck = applyFields(opts.source, repairFields, repaired);
  const merged = { translations: [...previous.filter((field) => !repairPaths.has(field.path)), ...(repaired?.translations ?? [])] };
  applied = applyFields(opts.source, opts.fields, merged);
  applied.errors.push(...repairedCheck.errors);
  errors = [...applied.errors, ...opts.validate(applied.value)];
  if (errors.length) throw new Error(`${opts.kind} translation rejected after repair: ${errors.join('; ').slice(0, 1800)}`);
  return { value: applied.value, tokens: first.tokens + second.tokens };
}

type PrereqTranslation = { schemaVersion: 1; unitId: string; sourceHash: string; translations: { entryId: string; id: string; type: string; sourceWhy: string; why: string }[] };

function prereqSource(unit: UnitType, knowledge: KnowledgeType): PrereqTranslation {
  const file = join(config.knowledgeDir, unit.module.toLowerCase(), '_voraussetzungen.json');
  const graph = existsSync(file) ? KnowledgeGraph.parse(JSON.parse(readFileSync(file, 'utf8'))) : null;
  const translations = knowledge.entries.flatMap((entry) => (graph?.requires[entry.id] ?? []).filter((link) => link.why.trim()).map((link) => ({ entryId: entry.id, id: link.id, type: link.type, sourceWhy: link.why, why: link.why })));
  return { schemaVersion: 1, unitId: unit.id, sourceHash: hash(translations), translations };
}

function validatePrereqs(source: PrereqTranslation, raw: unknown): string[] {
  const candidate = raw as PrereqTranslation | null;
  if (!candidate || !Array.isArray(candidate.translations)) return ['invalid prerequisite translation structure'];
  const errors: string[] = [];
  const immutable = (value: PrereqTranslation) => ({ ...value, translations: value.translations.map((link) => ({ ...link, why: '' })) });
  if (JSON.stringify(immutable(source)) !== JSON.stringify(immutable(candidate))) errors.push('prerequisite structure or source fields changed');
  source.translations.forEach((link, i) => {
    const translated = candidate.translations[i]?.why;
    if (typeof translated !== 'string' || !translated.trim() || translated.length > 240) errors.push(`translations.${i}.why: expected nonempty text, max 240 characters`);
    else if (protectedTokens(link.why).join('\n') !== protectedTokens(translated).join('\n')) errors.push(`translations.${i}.why: code or mathematical notation changed`);
  });
  return errors;
}

/** Translate concrete graph explanations independently; edges and types remain German-source identities. */
export async function translatePrereqs(unit: UnitType, knowledge: KnowledgeType, workDir: string, log: (message: string) => void, runCodex: TranslateFn = codexJson, force = false): Promise<number> {
  const source = prereqSource(unit, knowledge);
  if (!source.translations.length) return 0;
  const file = join(config.knowledgeDir, unit.module.toLowerCase(), 'en', `${unit.id}.prereqs.json`);
  try { if (!force && existsSync(file) && !validatePrereqs(source, JSON.parse(readFileSync(file, 'utf8'))).length) return 0; } catch { /* Recreate malformed or stale overlays. */ }
  const fields = source.translations.map((link, i) => ({ path: `translations.${i}.why`, text: link.why }));
  const result = await translateAsset({ kind: 'prereqs', source, fields, validate: (value) => validatePrereqs(source, value), workDir, log, runCodex });
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(result.value, null, 2) + '\n');
  return result.tokens;
}

export function translationPaths(unitFile: string, unit: UnitType) {
  const unitDir = join(dirname(unitFile), 'en');
  const translatedUnit = join(unitDir, basename(unitFile));
  const knowledgeDir = join(config.knowledgeDir, unit.module.toLowerCase(), 'en');
  const translatedKnowledge = join(knowledgeDir, `${unit.id}.json`);
  return { translatedUnit, translatedKnowledge, metaFile: `${translatedUnit}.meta.json`, prereqFile: join(knowledgeDir, `${unit.id}.prereqs.json`) };
}

export function findContentFile(unit: Pick<UnitType, 'module' | 'number'>): string | null {
  const dir = join(config.contentDir, unit.module.toLowerCase());
  if (!existsSync(dir)) return null;
  const prefix = `${String(unit.number).padStart(2, '0')}-`;
  const file = readdirSync(dir).filter((name) => name.startsWith(prefix) && name.endsWith('.json')).sort()[0];
  return file ? join(dir, file) : null;
}

export function translationStatus(unit: UnitType, knowledge: KnowledgeType | null, unitFile = findContentFile(unit), checkPrereqs = true) {
  if (!knowledge || !unitFile) return { current: false, reason: !knowledge ? 'missing German knowledge collection' : 'source unit file not found' };
  const paths = translationPaths(unitFile, unit);
  if (!existsSync(paths.translatedUnit) || !existsSync(paths.translatedKnowledge) || !existsSync(paths.metaFile)) return { current: false, reason: 'English translation missing' };
  try {
    const meta = JSON.parse(readFileSync(paths.metaFile, 'utf8')) as TranslationMeta;
    const translatedUnit = JSON.parse(readFileSync(paths.translatedUnit, 'utf8'));
    const translatedKnowledge = JSON.parse(readFileSync(paths.translatedKnowledge, 'utf8'));
    if (meta.sourceUnitHash !== hash(Unit.parse(unit)) || meta.sourceUnitSha !== unit.source.sha256 || meta.sourceUnitGeneratedAt !== unit.generator.generatedAt || meta.sourceKnowledgeHash !== hash(UnitKnowledge.parse(knowledge)) || meta.sourceKnowledgeGeneratedAt !== knowledge.generator.generatedAt) return { current: false, reason: 'English translation is stale' };
    const unitErrors = validateUnitTranslation(unit, translatedUnit);
    const knowledgeErrors = validateKnowledgeTranslation(knowledge, translatedKnowledge);
    if (unitErrors.length || knowledgeErrors.length) return { current: false, reason: `English translation invalid: ${[...unitErrors, ...knowledgeErrors].join('; ').slice(0, 400)}` };
    const prereqs = prereqSource(unit, knowledge);
    if (checkPrereqs && prereqs.translations.length) {
      const prereqFile = join(config.knowledgeDir, unit.module.toLowerCase(), 'en', `${unit.id}.prereqs.json`);
      if (!existsSync(prereqFile) || validatePrereqs(prereqs, JSON.parse(readFileSync(prereqFile, 'utf8'))).length) return { current: false, reason: 'English prerequisite explanations missing, stale or invalid' };
    }
    return { current: true, reason: '' };
  } catch {
    return { current: false, reason: 'English translation or metadata is invalid' };
  }
}

export async function translateUnit(
  unitInput: UnitType,
  knowledgeInput: KnowledgeType,
  unitFile: string,
  workDir: string,
  log: (message: string) => void,
  runCodex: TranslateFn = codexJson,
  options: { force?: boolean } = {},
): Promise<TranslationResult> {
  const unit = Unit.parse(unitInput);
  const knowledge = UnitKnowledge.parse(knowledgeInput);
  if (knowledge.unitId !== unit.id || knowledge.sourceSha !== unit.source.sha256) throw new Error(`knowledge collection for ${unit.id} does not match the source unit`);
  const paths = translationPaths(unitFile, unit);
  mkdirSync(workDir, { recursive: true });
  if (!options.force && translationStatus(unit, knowledge, unitFile, false).current) {
    const tokens = await translatePrereqs(unit, knowledge, workDir, log, runCodex);
    return { unitFile: paths.translatedUnit, knowledgeFile: paths.translatedKnowledge, metaFile: paths.metaFile, ...(existsSync(paths.prereqFile) ? { prereqFile: paths.prereqFile } : {}), tokens };
  }
  const [translatedUnit, translatedKnowledge] = await Promise.all([
    translateAsset({ kind: 'unit', source: unit, fields: unitTranslationFields(unit), validate: (v) => validateUnitTranslation(unit, v), workDir, log, runCodex }),
    translateAsset({ kind: 'knowledge', source: knowledge, fields: knowledgeTranslationFields(knowledge), validate: (v) => validateKnowledgeTranslation(knowledge, v), workDir, log, runCodex }),
  ]);
  const prereqTokens = await translatePrereqs(unit, knowledge, workDir, log, runCodex, !!options.force);
  const meta: TranslationMeta = {
    sourceUnitHash: hash(Unit.parse(unit)),
    sourceUnitSha: unit.source.sha256,
    sourceUnitGeneratedAt: unit.generator.generatedAt,
    sourceKnowledgeHash: hash(UnitKnowledge.parse(knowledge)),
    sourceKnowledgeGeneratedAt: knowledge.generator.generatedAt,
    translatedAt: new Date().toISOString(),
  };
  mkdirSync(dirname(paths.translatedUnit), { recursive: true });
  mkdirSync(dirname(paths.translatedKnowledge), { recursive: true });
  writeFileSync(paths.translatedUnit, JSON.stringify(translatedUnit.value, null, 2) + '\n');
  writeFileSync(paths.translatedKnowledge, JSON.stringify(translatedKnowledge.value, null, 2) + '\n');
  writeFileSync(paths.metaFile, JSON.stringify(meta, null, 2) + '\n');
  return { unitFile: paths.translatedUnit, knowledgeFile: paths.translatedKnowledge, metaFile: paths.metaFile, ...(existsSync(paths.prereqFile) ? { prereqFile: paths.prereqFile } : {}), tokens: translatedUnit.tokens + translatedKnowledge.tokens + prereqTokens };
}

/** Parse and validate one on-disk translation without making any Codex call. */
export function parseTranslatedUnit(file: string): UnitType {
  return Unit.parse(JSON.parse(readFileSync(file, 'utf8')));
}
export function parseTranslatedKnowledge(file: string): KnowledgeType {
  return UnitKnowledge.parse(JSON.parse(readFileSync(file, 'utf8')));
}


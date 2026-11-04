import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { Unit, UnitKnowledge, unitTranslationFields, knowledgeTranslationFields, validateUnitTranslation, validateKnowledgeTranslation, type Unit as UnitType, type UnitKnowledge as KnowledgeType } from '@lernquest/shared';
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
export type TranslationResult = { unitFile: string; knowledgeFile: string; metaFile: string; tokens: number };

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
  kind: 'unit' | 'knowledge';
  source: T;
  fields: Field[];
  validate: (candidate: unknown) => string[];
  workDir: string;
  log: (message: string) => void;
  runCodex: TranslateFn;
}): Promise<{ value: T; tokens: number }> {
  const fieldsJson = JSON.stringify(opts.fields, null, 2);
  const makePrompt = (name: string, vars: Record<string, string>) => fill(template(name), vars);
  const ask = async (attempt: number, prompt: string) => opts.runCodex({
    prompt,
    effort: config.codexEffort,
    workDir: opts.workDir,
    label: `translate-${opts.kind}-${attempt}`,
    log: opts.log,
    schema: config.translationFieldsSchemaFile,
  });
  const first = await ask(1, makePrompt(opts.kind === 'unit' ? 'translate-unit.md' : 'translate-knowledge.md', { FIELDS: fieldsJson }));
  let applied = applyFields(opts.source, opts.fields, first.data);
  let errors = [...applied.errors, ...opts.validate(applied.value)];
  if (!errors.length) return { value: applied.value, tokens: first.tokens };

  opts.log(`  ⚠ ${opts.kind} translation validation failed; requesting one repair (${errors.length} issue(s))`);
  const second = await ask(2, makePrompt('repair-translation.md', { ERRORS: errors.map((e) => `- ${e}`).join('\n'), FIELDS: fieldsJson, CANDIDATE: JSON.stringify((first.data as FieldResponse)?.translations ?? [], null, 2) }));
  applied = applyFields(opts.source, opts.fields, second.data);
  errors = [...applied.errors, ...opts.validate(applied.value)];
  if (errors.length) throw new Error(`${opts.kind} translation rejected after repair: ${errors.join('; ').slice(0, 1800)}`);
  return { value: applied.value, tokens: first.tokens + second.tokens };
}

export function translationPaths(unitFile: string, unit: UnitType) {
  const unitDir = join(dirname(unitFile), 'en');
  const translatedUnit = join(unitDir, basename(unitFile));
  const knowledgeDir = join(config.knowledgeDir, unit.module.toLowerCase(), 'en');
  const translatedKnowledge = join(knowledgeDir, `${unit.id}.json`);
  return { translatedUnit, translatedKnowledge, metaFile: `${translatedUnit}.meta.json` };
}

export function findContentFile(unit: Pick<UnitType, 'module' | 'number'>): string | null {
  const dir = join(config.contentDir, unit.module.toLowerCase());
  if (!existsSync(dir)) return null;
  const prefix = `${String(unit.number).padStart(2, '0')}-`;
  const file = readdirSync(dir).filter((name) => name.startsWith(prefix) && name.endsWith('.json')).sort()[0];
  return file ? join(dir, file) : null;
}

export function translationStatus(unit: UnitType, knowledge: KnowledgeType | null, unitFile = findContentFile(unit)) {
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
): Promise<TranslationResult> {
  const unit = Unit.parse(unitInput);
  const knowledge = UnitKnowledge.parse(knowledgeInput);
  if (knowledge.unitId !== unit.id || knowledge.sourceSha !== unit.source.sha256) throw new Error(`knowledge collection for ${unit.id} does not match the source unit`);
  const paths = translationPaths(unitFile, unit);
  mkdirSync(workDir, { recursive: true });
  const [translatedUnit, translatedKnowledge] = await Promise.all([
    translateAsset({ kind: 'unit', source: unit, fields: unitTranslationFields(unit), validate: (v) => validateUnitTranslation(unit, v), workDir, log, runCodex }),
    translateAsset({ kind: 'knowledge', source: knowledge, fields: knowledgeTranslationFields(knowledge), validate: (v) => validateKnowledgeTranslation(knowledge, v), workDir, log, runCodex }),
  ]);
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
  return { unitFile: paths.translatedUnit, knowledgeFile: paths.translatedKnowledge, metaFile: paths.metaFile, tokens: translatedUnit.tokens + translatedKnowledge.tokens };
}

/** Parse and validate one on-disk translation without making any Codex call. */
export function parseTranslatedUnit(file: string): UnitType {
  return Unit.parse(JSON.parse(readFileSync(file, 'utf8')));
}
export function parseTranslatedKnowledge(file: string): KnowledgeType {
  return UnitKnowledge.parse(JSON.parse(readFileSync(file, 'utf8')));
}


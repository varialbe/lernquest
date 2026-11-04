import { createHash } from 'node:crypto';
import { ROOT } from '../env.ts';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Unit, type ModuleId, type Question, type Unit as UnitType, type PathResponse, type DiscoverResponse, validateUnitTranslation } from '@lernquest/shared';
import type { LevelResponse } from '@lernquest/shared';

const contentRoot = () => resolve(process.env.CONTENT_DIR ?? resolve(ROOT, 'content'));
const cache = new Map<string, { mtime: number; sourceMtime: number; metaMtime: number; unit: UnitType | null }>();
export const englishModuleName = (module: ModuleId) => ({ DS: 'Discrete Structures', EIP: 'Introduction to Computer Science and Programming', ERA: 'Introduction to Computer Architecture' })[module];

export function sourceUnitFile(module: ModuleId, number: number) {
  const dir = join(contentRoot(), module.toLowerCase());
  if (!existsSync(dir)) return null;
  const prefix = `${String(number).padStart(2, '0')}-`;
  const name = readdirSync(dir).filter((x) => x.startsWith(prefix) && x.endsWith('.json')).sort()[0];
  return name ? join(dir, name) : null;
}

/** Returns a validated, current English JSON overlay. Missing or stale data returns null for German fallback. */
export function translatedUnit(unitId: string, locale: 'de' | 'en'): UnitType | null {
  if (locale !== 'en') return null;
  const match = /^([a-z]+)-(\d{2})$/.exec(unitId);
  if (!match) return null;
  const module = match[1]!.toUpperCase() as ModuleId;
  const source = sourceUnitFile(module, Number(match[2]));
  if (!source) return null;
  const file = join(dirname(source), 'en', source.split('/').at(-1)!);
  if (!existsSync(file)) return null;
  const metaFile = `${file}.meta.json`;
  if (!existsSync(metaFile)) return null;
  const metaMtime = statSync(metaFile).mtimeMs;
  const mtime = statSync(file).mtimeMs;
  const sourceMtime = statSync(source).mtimeMs;
  const hit = cache.get(file);
  if (hit?.mtime === mtime && hit.sourceMtime === sourceMtime && hit.metaMtime === metaMtime) return hit.unit;
  let data: UnitType | null = null;
  try {
    const original = Unit.parse(JSON.parse(readFileSync(source, 'utf8')));
    const translated = Unit.parse(JSON.parse(readFileSync(file, 'utf8')));
    const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
    const sourceHash = createHash('sha256').update(JSON.stringify(original)).digest('hex');
    if (meta.sourceUnitHash === sourceHash && !validateUnitTranslation(original, translated).length) data = translated;
  } catch (error) {
    console.error(`Invalid English content ${unitId}: ${(error as Error).message.slice(0, 250)}`);
  }
  cache.set(file, { mtime, sourceMtime, metaMtime, unit: data });
  return data;
}

export function localizedQuestion(question: Question, locale: 'de' | 'en'): Question {
  const unitId = /^([a-z]+-\d{2})-/.exec(question.id)?.[1];
  const translated = unitId ? translatedUnit(unitId, locale) : null;
  return translated?.levels.flatMap((level) => level.questions).find((q) => q.id === question.id) ?? question;
}

export function localizedUnitTitle(unitId: string, fallback: string, locale: 'de' | 'en') {
  return translatedUnit(unitId, locale)?.title ?? fallback;
}

export function localizedConcept(unitId: string, concept: string, locale: 'de' | 'en') {
  const translated = translatedUnit(unitId, locale);
  if (!translated) return concept;
  const match = /^([a-z]+)-(\d{2})$/.exec(unitId);
  if (!match) return concept;
  const sourceFile = sourceUnitFile(match[1]!.toUpperCase() as ModuleId, Number(match[2]));
  if (!sourceFile) return concept;
  try {
    const source = Unit.parse(JSON.parse(readFileSync(sourceFile, 'utf8')));
    const sourceLabels = [
      ...source.concepts,
      ...source.levels.flatMap((level) => level.questions.flatMap((question) => question.concepts)),
    ];
    const translatedLabels = [
      ...translated.concepts,
      ...translated.levels.flatMap((level) => level.questions.flatMap((question) => question.concepts)),
    ];
    const i = sourceLabels.indexOf(concept);
    return i >= 0 ? translatedLabels[i] ?? concept : concept;
  } catch {
    return concept;
  }
}

export function localizeLevel(response: LevelResponse, locale: 'de' | 'en'): LevelResponse {
  if (locale !== 'en') return response;
  const unit = translatedUnit(response.level.unitId, locale);
  const level = unit?.levels.find((item) => item.id === response.level.id);
  return {
    level: { ...response.level, title: level?.title ?? response.level.title, unitTitle: unit?.title ?? response.level.unitTitle },
    questions: response.questions.map((question) => localizedQuestion(question, locale)),
  };
}

export function localizePath(response: PathResponse, locale: 'de' | 'en'): PathResponse {
  if (locale !== 'en') return response;
  return { ...response, modules: response.modules.map((mod) => ({
    ...mod,
    name: englishModuleName(mod.id),
    units: mod.units.map((node) => {
      const unit = translatedUnit(node.id, locale);
      return unit ? { ...node, title: unit.title, summary: unit.summary, concepts: unit.concepts, levels: node.levels.map((level) => ({ ...level, title: unit.levels.find((item) => item.id === level.id)?.title ?? level.title })) } : node;
    }),
  })) };
}

export function localizeDiscover(response: DiscoverResponse, locale: 'de' | 'en'): DiscoverResponse {
  if (locale !== 'en') return response;
  return { ...response, modules: response.modules.map((mod) => ({
    ...mod,
    name: englishModuleName(mod.id),
    items: mod.items.map((item) => {
      const unit = translatedUnit(item.unitId, locale);
      const bonus = unit?.levels.find((level) => level.kind === 'bonus');
      return unit ? { ...item, unitTitle: unit.title, title: bonus?.title ?? item.title } : item;
    }),
  })) };
}


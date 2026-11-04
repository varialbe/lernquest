import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { sourceUnitFile } from './content-locale.ts';
import type { Locale } from './locale.ts';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { and, asc, eq } from 'drizzle-orm';
import { KnowledgeGraph, protectedTokens, validateKnowledgeTranslation, normalizeEntryMath, normalizeMathDelimiters, UnitKnowledge, type KnowledgeModuleResponse, type ModuleId } from '@lernquest/shared';
import { ROOT } from '../env.ts';
import type { DB } from '../db/index.ts';
import { cardItems, units } from '../db/schema.ts';

/** Wissenssammlung: wissen/<modul>/<unit-id>.json (schreibt die Pipeline), hier nur gelesen + nach mtime gecacht. */
const dir = () => process.env.KNOWLEDGE_DIR || resolve(ROOT, 'wissen');
const cache = new Map<string, { mtime: number; sourceMtime: number; metaMtime: number; data: UnitKnowledge | null }>();

export function unitKnowledge(unitId: string, locale: Locale = 'de'): UnitKnowledge | null {
  const germanFile = join(dir(), unitId.split('-')[0]!, `${unitId}.json`);
  const file = locale === 'en' ? join(dir(), unitId.split('-')[0]!, 'en', `${unitId}.json`) : germanFile;
  if (locale === 'en' && !existsSync(file)) return unitKnowledge(unitId);
  const sourceFile = locale === 'en' ? sourceUnitFile(unitId.split('-')[0]!.toUpperCase() as ModuleId, Number(unitId.split('-')[1])) : null;
  const metaFile = sourceFile ? join(dirname(sourceFile), 'en', `${sourceFile.split('/').at(-1)!}.meta.json`) : null;
  const sourceMtime = existsSync(germanFile) ? statSync(germanFile).mtimeMs : -1;
  const metaMtime = metaFile && existsSync(metaFile) ? statSync(metaFile).mtimeMs : -1;
  if (!existsSync(file)) return null;
  const mtime = statSync(file).mtimeMs;
  const hit = cache.get(file);
  if (hit && hit.mtime === mtime && hit.sourceMtime === sourceMtime && hit.metaMtime === metaMtime) return hit.data;
  let data: UnitKnowledge | null = null;
  try {
    const k = UnitKnowledge.parse(JSON.parse(readFileSync(file, 'utf8')));
    if (locale === 'en') {
      const original = UnitKnowledge.parse(JSON.parse(readFileSync(germanFile, 'utf8')));
      const meta = metaFile && existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, 'utf8')) : null;
      const sourceHash = createHash('sha256').update(JSON.stringify(original)).digest('hex');
      if (meta?.sourceKnowledgeHash !== sourceHash || validateKnowledgeTranslation(original, k).length) throw new Error('English knowledge translation is invalid or stale');
    }
    // ältere Dateien können Formeln als \( … \) enthalten → für KaTeX auf $ … $ umstellen
    data = { ...k, overview: normalizeMathDelimiters(k.overview), entries: k.entries.map(normalizeEntryMath) };
  } catch (e) {
    console.error(`wissen/${unitId}.json ungültig: ${(e as Error).message.slice(0, 300)}`);
  }
  if (!data && locale === 'en') data = unitKnowledge(unitId);
  cache.set(file, { mtime, sourceMtime, metaMtime, data });
  return data;
}

const graphCache = new Map<string, { mtime: number; data: KnowledgeGraph | null }>();
/** Voraussetzungs-Graph des Moduls (wissen/<modul>/_voraussetzungen.json), nach mtime gecacht */
export function moduleGraph(module: ModuleId): KnowledgeGraph | null {
  const file = join(dir(), module.toLowerCase(), '_voraussetzungen.json');
  if (!existsSync(file)) return null;
  const mtime = statSync(file).mtimeMs;
  const hit = graphCache.get(file);
  if (hit && hit.mtime === mtime) return hit.data;
  let data: KnowledgeGraph | null = null;
  try {
    data = KnowledgeGraph.parse(JSON.parse(readFileSync(file, 'utf8')));
  } catch (e) {
    console.error(`wissen/${module}/_voraussetzungen.json ungültig: ${(e as Error).message.slice(0, 300)}`);
  }
  graphCache.set(file, { mtime, data });
  return data;
}

type PrereqTranslation = { entryId: string; id: string; type: string; sourceWhy: string; why: string };
const reasonCache = new Map<string, { mtime: number; data: PrereqTranslation[] }>();
function translatedReasons(unitId: string): PrereqTranslation[] {
  const file = join(dir(), unitId.split('-')[0]!, 'en', `${unitId}.prereqs.json`);
  if (!existsSync(file)) return [];
  const mtime = statSync(file).mtimeMs;
  const hit = reasonCache.get(file);
  if (hit?.mtime === mtime) return hit.data;
  let data: PrereqTranslation[] = [];
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    if (raw.schemaVersion === 1 && raw.unitId === unitId && Array.isArray(raw.translations)) {
      data = raw.translations.filter((item: Partial<PrereqTranslation>) =>
        typeof item.entryId === 'string' && typeof item.id === 'string' && typeof item.type === 'string' &&
        typeof item.sourceWhy === 'string' && typeof item.why === 'string' && item.why.trim().length > 0 && item.why.length <= 240 &&
        JSON.stringify(protectedTokens(item.sourceWhy)) === JSON.stringify(protectedTokens(item.why)),
      );
    }
  } catch { /* Missing or invalid reasons fall back to the source wording. */ }
  reasonCache.set(file, { mtime, data });
  return data;
}

export function knowledgeForModule(db: DB, module: ModuleId, userId?: number, locale: Locale = 'de'): KnowledgeModuleResponse {
  const list = db.select({ id: units.id, number: units.number, title: units.title }).from(units).where(eq(units.module, module)).orderBy(asc(units.number)).all();
  const loaded = list.map((u) => ({ u, k: unitKnowledge(u.id, locale) }));
  const ids = new Set(loaded.flatMap(({ k }) => k?.entries.map((e) => e.id) ?? []));
  const graph = moduleGraph(module);
  const reasons = locale === 'en' ? loaded.flatMap(({ u }) => translatedReasons(u.id)) : [];
  const masteredEntryIds = userId == null
    ? []
    : db.select({ entryId: cardItems.entryId, box: cardItems.box }).from(cardItems)
        .where(and(eq(cardItems.userId, userId), eq(cardItems.module, module))).all()
        .filter((row) => row.box >= 6)
        .map((row) => row.entryId);
  return {
    module,
    masteredEntryIds,
    aliases: graph?.aliases ?? {},
    units: loaded.map(({ u, k }) => ({
      unitId: u.id,
      unitNumber: u.number,
      unitTitle: k?.unitTitle ?? u.title,
      overview: k?.overview ?? null,
      // nur Verweise auf Einträge, die es (noch) gibt
      entries: (k?.entries ?? []).map((e) => ({ ...e, requires: (graph?.requires[e.id] ?? []).filter((l) => ids.has(l.id)).map((l) => ({ ...l, why: normalizeMathDelimiters(reasons.find((r) => r.entryId === e.id && r.id === l.id && r.type === l.type && r.sourceWhy === l.why)?.why ?? l.why) })) })),
    })),
  };
}

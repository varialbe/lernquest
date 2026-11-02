import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { asc, eq } from 'drizzle-orm';
import { KnowledgeGraph, normalizeEntryMath, normalizeMathDelimiters, UnitKnowledge, type KnowledgeModuleResponse, type ModuleId } from '@lernquest/shared';
import { ROOT } from '../env.ts';
import type { DB } from '../db/index.ts';
import { units } from '../db/schema.ts';

/** Wissenssammlung: wissen/<modul>/<unit-id>.json (schreibt die Pipeline), hier nur gelesen + nach mtime gecacht. */
const dir = () => process.env.KNOWLEDGE_DIR || resolve(ROOT, 'wissen');
const cache = new Map<string, { mtime: number; data: UnitKnowledge | null }>();

export function unitKnowledge(unitId: string): UnitKnowledge | null {
  const file = join(dir(), unitId.split('-')[0]!, `${unitId}.json`);
  if (!existsSync(file)) return null;
  const mtime = statSync(file).mtimeMs;
  const hit = cache.get(file);
  if (hit && hit.mtime === mtime) return hit.data;
  let data: UnitKnowledge | null = null;
  try {
    const k = UnitKnowledge.parse(JSON.parse(readFileSync(file, 'utf8')));
    // ältere Dateien können Formeln als \( … \) enthalten → für KaTeX auf $ … $ umstellen
    data = { ...k, overview: normalizeMathDelimiters(k.overview), entries: k.entries.map(normalizeEntryMath) };
  } catch (e) {
    console.error(`wissen/${unitId}.json ungültig: ${(e as Error).message.slice(0, 300)}`);
  }
  cache.set(file, { mtime, data });
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

export function knowledgeForModule(db: DB, module: ModuleId): KnowledgeModuleResponse {
  const list = db.select({ id: units.id, number: units.number, title: units.title }).from(units).where(eq(units.module, module)).orderBy(asc(units.number)).all();
  const loaded = list.map((u) => ({ u, k: unitKnowledge(u.id) }));
  const ids = new Set(loaded.flatMap(({ k }) => k?.entries.map((e) => e.id) ?? []));
  const graph = moduleGraph(module);
  return {
    module,
    units: loaded.map(({ u, k }) => ({
      unitId: u.id,
      unitNumber: u.number,
      unitTitle: u.title,
      overview: k?.overview ?? null,
      // nur Verweise auf Einträge, die es (noch) gibt
      entries: (k?.entries ?? []).map((e) => ({ ...e, requires: (graph?.requires[e.id] ?? []).filter((l) => ids.has(l.id)).map((l) => ({ ...l, why: normalizeMathDelimiters(l.why) })) })),
    })),
  };
}

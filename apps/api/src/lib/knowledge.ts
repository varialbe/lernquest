import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { asc, eq } from 'drizzle-orm';
import { normalizeEntryMath, normalizeMathDelimiters, UnitKnowledge, type KnowledgeModuleResponse, type ModuleId } from '@lernquest/shared';
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

export function knowledgeForModule(db: DB, module: ModuleId): KnowledgeModuleResponse {
  const list = db.select({ id: units.id, number: units.number, title: units.title }).from(units).where(eq(units.module, module)).orderBy(asc(units.number)).all();
  return {
    module,
    units: list.map((u) => {
      const k = unitKnowledge(u.id);
      return { unitId: u.id, unitNumber: u.number, unitTitle: u.title, overview: k?.overview ?? null, entries: k?.entries ?? [] };
    }),
  };
}

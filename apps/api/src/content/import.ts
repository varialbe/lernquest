import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq, notInArray, sql } from 'drizzle-orm';
import { Unit } from '@lernquest/shared';
import type { DB } from '../db/index.ts';
import { levels, questions, units } from '../db/schema.ts';

export type ImportResult = { unitId: string; status: 'created' | 'updated' | 'unchanged' | 'failed'; questions: number; error?: string };

const hashOf = (u: Unit) => createHash('sha256').update(JSON.stringify(u.levels)).update(u.title).update(u.summary).digest('hex');

/**
 * Importiert eine Unit idempotent (Upsert über stabile IDs).
 * - unveränderte Units werden übersprungen
 * - Fragen, die im neuen JSON fehlen, werden deaktiviert (Fortschritt bleibt erhalten)
 * - von Admins deaktivierte Fragen bleiben deaktiviert
 */
export function importUnit(db: DB, raw: unknown): ImportResult {
  const unit = Unit.parse(raw);
  const contentHash = hashOf(unit);
  const existing = db.select({ hash: units.contentHash }).from(units).where(eq(units.id, unit.id)).get();
  if (existing?.hash === contentHash) {
    return { unitId: unit.id, status: 'unchanged', questions: unit.levels.reduce((n, l) => n + l.questions.length, 0) };
  }

  let count = 0;
  db.transaction((tx) => {
    const row = {
      module: unit.module,
      number: unit.number,
      slug: unit.slug,
      title: unit.title,
      summary: unit.summary,
      concepts: unit.concepts,
      keyFacts: unit.keyFacts,
      tags: unit.tags,
      links: unit.links,
      sourceFile: unit.source.file,
      sourceSha: unit.source.sha256,
      contentHash,
    };
    tx.insert(units)
      .values({ id: unit.id, ...row })
      .onConflictDoUpdate({ target: units.id, set: { ...row, updatedAt: sql`(cast(unixepoch('subsec') * 1000 as integer))` } })
      .run();

    for (const level of unit.levels) {
      tx.insert(levels)
        .values({ id: level.id, unitId: unit.id, idx: level.index, kind: level.kind, title: level.title })
        .onConflictDoUpdate({ target: levels.id, set: { idx: level.index, kind: level.kind, title: level.title } })
        .run();
      level.questions.forEach((q, position) => {
        count++;
        tx.insert(questions)
          .values({ id: q.id, levelId: level.id, unitId: unit.id, position, type: q.type, data: q, active: true })
          .onConflictDoUpdate({
            target: questions.id,
            set: {
              levelId: level.id,
              position,
              type: q.type,
              data: q,
              active: sql`not ${questions.disabledByAdmin}`,
              updatedAt: sql`(cast(unixepoch('subsec') * 1000 as integer))`,
            },
          })
          .run();
      });
      const keep = level.questions.map((q) => q.id);
      tx.update(questions)
        .set({ active: false })
        .where(and(eq(questions.levelId, level.id), notInArray(questions.id, keep)))
        .run();
    }
  });
  return { unitId: unit.id, status: existing ? 'updated' : 'created', questions: count };
}

/** Importiert alle content/<modul>/*.json (z. B. nach frischem Deploy). */
export function importContentDir(db: DB, dir: string): ImportResult[] {
  const results: ImportResult[] = [];
  if (!existsSync(dir)) return results;
  for (const mod of readdirSync(dir)) {
    const modDir = join(dir, mod);
    if (!statSync(modDir).isDirectory()) continue;
    for (const f of readdirSync(modDir).filter((x) => x.endsWith('.json')).sort()) {
      try {
        results.push(importUnit(db, JSON.parse(readFileSync(join(modDir, f), 'utf8'))));
      } catch (e) {
        // eine kaputte Datei darf den Start nicht verhindern
        results.push({ unitId: `${mod}/${f}`, status: 'failed', questions: 0, error: (e as Error).message.slice(0, 500) });
      }
    }
  }
  return results;
}

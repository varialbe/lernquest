import { and, asc, eq, lte, sql } from 'drizzle-orm';
import { CARDS, LEITNER_INTERVALS, MODULES, type CardSession, type CardsOverview, type ModuleId } from '@lernquest/shared';
import type { DB } from '../db/index.ts';
import { cardItems } from '../db/schema.ts';
import type { AuthUser } from './auth.ts';
import { badRequest, notFound } from './http.ts';
import { knowledgeForModule } from './knowledge.ts';
import { addDays, berlinDay } from './time.ts';

/**
 * Karteikarten aus der Wissenssammlung: vorne der Begriff, hinten Kurzfassung + Erklärung.
 * Leitner wie die Wiederholung (Box 1–5, Abstände 1/2/4/7/14 Tage), danach Box 6 „gemeistert“ (alle 30 Tage).
 * Fortschritt pro Eintrags-ID; wird eine Wissenssammlung neu erzeugt, starten deren Karten neu.
 */
export const MASTERED_BOX = 6;

export function nextCard(box: number | null, known: boolean, today: string): { box: number; dueDay: string } {
  if (!known) return { box: 1, dueDay: addDays(today, 1) };
  const next = Math.min((box ?? 0) + 1, MASTERED_BOX);
  return { box: next, dueDay: addDays(today, next === MASTERED_BOX ? CARDS.masteredDays : (LEITNER_INTERVALS[next] ?? 1)) };
}

/** alle Einträge eines Moduls (mit Unit-Infos), in Lernreihenfolge */
function moduleEntries(db: DB, module: ModuleId) {
  return knowledgeForModule(db, module).units.flatMap((u) => u.entries.map((e) => ({ entry: e, unitId: u.unitId, unitNumber: u.unitNumber, unitTitle: u.unitTitle })));
}

export function cardsOverview(db: DB, u: AuthUser, today = berlinDay()): CardsOverview {
  return {
    modules: MODULES.map((m) => {
      const all = moduleEntries(db, m);
      const ids = new Set(all.map((x) => x.entry.id));
      const rows = db.select().from(cardItems).where(and(eq(cardItems.userId, u.id), eq(cardItems.module, m))).all().filter((r) => ids.has(r.entryId));
      return {
        id: m,
        total: all.length,
        due: rows.filter((r) => r.dueDay <= today).length,
        fresh: all.length - rows.length,
        learning: rows.filter((r) => r.box < MASTERED_BOX).length,
        mastered: rows.filter((r) => r.box >= MASTERED_BOX).length,
      };
    }),
  };
}

/** Fällige Karten zuerst (älteste zuerst), dann neue in Vorlesungsreihenfolge – optional nur eine Unit. */
export function cardSession(db: DB, u: AuthUser, module: ModuleId, unitId?: string, today = berlinDay()): CardSession {
  const all = moduleEntries(db, module).filter((x) => !unitId || x.unitId === unitId);
  if (unitId && !all.length) throw notFound('Für diese Unit gibt es noch keine Karten.');
  const byId = new Map(all.map((x) => [x.entry.id, x]));
  const rows = db.select().from(cardItems).where(and(eq(cardItems.userId, u.id), eq(cardItems.module, module))).all();
  const seen = new Set(rows.map((r) => r.entryId));
  const due = db
    .select()
    .from(cardItems)
    .where(and(eq(cardItems.userId, u.id), eq(cardItems.module, module), lte(cardItems.dueDay, today)))
    .orderBy(asc(cardItems.dueDay), asc(cardItems.box))
    .all()
    .filter((r) => byId.has(r.entryId))
    .slice(0, CARDS.perSession);
  const fresh = all.filter((x) => !seen.has(x.entry.id)).slice(0, Math.max(0, Math.min(CARDS.newPerSession, CARDS.perSession - due.length)));
  return {
    module,
    unitId: unitId ?? null,
    cards: [...due.map((r) => ({ ...byId.get(r.entryId)!, box: r.box })), ...fresh.map((x) => ({ ...x, box: null }))],
    dueLeft: Math.max(0, rows.filter((r) => r.dueDay <= today && byId.has(r.entryId)).length - due.length),
  };
}

export function reviewCard(db: DB, u: AuthUser, entryId: string, known: boolean, today = berlinDay()) {
  const m = /^([a-z]+)-(\d{2})-k\d{2}$/.exec(entryId);
  if (!m) throw badRequest('invalid_card', 'Unbekannte Karte.');
  const module = m[1]!.toUpperCase() as ModuleId;
  if (!MODULES.includes(module)) throw badRequest('invalid_card', 'Unbekannte Karte.');
  const unitId = `${m[1]}-${m[2]}`;
  if (!moduleEntries(db, module).some((x) => x.entry.id === entryId)) throw notFound('Karte nicht gefunden.');
  const prev = db.select().from(cardItems).where(and(eq(cardItems.userId, u.id), eq(cardItems.entryId, entryId))).get();
  const next = nextCard(prev?.box ?? null, known, today);
  db.insert(cardItems)
    .values({ userId: u.id, entryId, unitId, module, box: next.box, dueDay: next.dueDay, reviews: 1, lapses: known ? 0 : 1 })
    .onConflictDoUpdate({
      target: [cardItems.userId, cardItems.entryId],
      set: { box: next.box, dueDay: next.dueDay, reviews: sql`${cardItems.reviews} + 1`, lapses: sql`${cardItems.lapses} + ${known ? 0 : 1}`, updatedAt: Date.now() },
    })
    .run();
  return next;
}

/** fällige Karten über alle Module (für Badge und Wochenrückblick) */
export const dueCards = (db: DB, userId: number, today = berlinDay()) =>
  Number(db.select({ n: sql<number>`count(*)` }).from(cardItems).where(and(eq(cardItems.userId, userId), lte(cardItems.dueDay, today))).get()?.n ?? 0);

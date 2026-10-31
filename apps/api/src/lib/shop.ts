import { and, eq, gte, sql } from 'drizzle-orm';
import { ECONOMY, PETS, SHOP_ITEMS, STARTER_PETS, THEMES } from '@lernquest/shared';
import type { DB } from '../db/index.ts';
import { inventory, purchases, userPets, users } from '../db/schema.ts';
import { badRequest, conflict, notFound } from './http.ts';

/** Kauf als eine Transaktion: Coins werden nur abgebucht, wenn genug da sind (bedingtes UPDATE). */
export function purchase(db: DB, userId: number, itemId: string) {
  const item = SHOP_ITEMS.find((i) => i.id === itemId);
  if (!item) throw notFound('Artikel nicht gefunden');
  return db.transaction((tx) => {
    const u = tx.select().from(users).where(eq(users.id, userId)).get()!;
    if (item.category === 'pet') {
      const petId = item.id.slice(4);
      if (tx.select().from(userPets).where(and(eq(userPets.userId, userId), eq(userPets.petId, petId))).get()) throw conflict('owned', 'Du hast dieses Pet schon.');
    } else if (item.id === 'powerup:streak_freeze') {
      if (u.streakFreezes >= ECONOMY.maxStreakFreezes) throw conflict('max_freezes', `Du kannst höchstens ${ECONOMY.maxStreakFreezes} Streak-Freezes besitzen.`);
    } else if (tx.select().from(inventory).where(and(eq(inventory.userId, userId), eq(inventory.itemId, item.id))).get()) {
      throw conflict('owned', 'Schon in deinem Inventar.');
    }

    const res = tx
      .update(users)
      .set({ coins: sql`${users.coins} - ${item.price}` })
      .where(and(eq(users.id, userId), gte(users.coins, item.price)))
      .run();
    if (res.changes !== 1) throw badRequest('not_enough_coins', 'Nicht genug Coins.');

    tx.insert(purchases).values({ userId, itemId: item.id, price: item.price }).run();
    if (item.category === 'pet') tx.insert(userPets).values({ userId, petId: item.id.slice(4) }).run();
    else if (item.id === 'powerup:streak_freeze') tx.update(users).set({ streakFreezes: sql`${users.streakFreezes} + 1` }).where(eq(users.id, userId)).run();
    else tx.insert(inventory).values({ userId, itemId: item.id }).run();
    return { coins: u.coins - item.price, itemId: item.id };
  });
}

export function addStarterPet(db: DB, userId: number, petId: string | undefined) {
  const id = petId && STARTER_PETS.includes(petId) ? petId : STARTER_PETS[0]!;
  db.insert(userPets).values({ userId, petId: id }).onConflictDoNothing().run();
  db.update(users).set({ activePet: id }).where(eq(users.id, userId)).run();
  return id;
}

export function ownsItem(db: DB, userId: number, itemId: string) {
  return !!db.select().from(inventory).where(and(eq(inventory.userId, userId), eq(inventory.itemId, itemId))).get();
}

/** Einstellungen prüfen: Themes/Rahmen/Pets nur, wenn besessen. */
export function validateSettings(db: DB, userId: number, s: { theme?: string; frame?: string | null; activePet?: string }) {
  if (s.theme && s.theme !== 'default') {
    if (!THEMES[s.theme] || !ownsItem(db, userId, `theme:${s.theme}`)) throw badRequest('not_owned', 'Dieses Theme besitzt du nicht.');
  }
  if (s.frame && !ownsItem(db, userId, `frame:${s.frame}`)) throw badRequest('not_owned', 'Diesen Rahmen besitzt du nicht.');
  if (s.activePet) {
    if (!PETS.some((p) => p.id === s.activePet)) throw badRequest('unknown_pet');
    if (!db.select().from(userPets).where(and(eq(userPets.userId, userId), eq(userPets.petId, s.activePet))).get()) throw badRequest('not_owned', 'Dieses Pet besitzt du nicht.');
  }
}

export function equip(db: DB, userId: number, petId: string, accessory: string | null) {
  const pet = db.select().from(userPets).where(and(eq(userPets.userId, userId), eq(userPets.petId, petId))).get();
  if (!pet) throw badRequest('not_owned', 'Dieses Pet besitzt du nicht.');
  if (accessory && !ownsItem(db, userId, accessory)) throw badRequest('not_owned', 'Dieses Accessoire besitzt du nicht.');
  db.update(userPets).set({ accessory }).where(and(eq(userPets.userId, userId), eq(userPets.petId, petId))).run();
}

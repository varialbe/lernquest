import './env.ts';
import { ROOT } from './env.ts';
import { appendFileSync, existsSync, writeFileSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { asc, eq } from 'drizzle-orm';
import type { Question } from '@lernquest/shared';
import { importContentDir } from './content/import.ts';
import { getDb } from './db/index.ts';
import { invites, levels, questions, units, users } from './db/schema.ts';
import { hashPassword, randomInviteCode, randomPassword } from './lib/auth.ts';
import { completeLevel, completePractice } from './lib/game.ts';
import { addStarterPet, equip, purchase } from './lib/shop.ts';

/**
 * Legt Admin `mateen` und `testuser` an (zufällige Passwörter → CREDENTIALS.local.md) und gibt dem Testuser
 * etwas Fortschritt, Coins, Streak und Pets, damit alle Screens befüllt sind. Idempotent: bestehende Accounts bleiben.
 */
const db = getDb();
importContentDir(db, resolve(ROOT, 'content'));
const credFile = resolve(ROOT, 'CREDENTIALS.local.md');
const lines: string[] = [];

async function ensureUser(username: string, displayName: string, role: 'user' | 'admin') {
  const existing = db.select().from(users).where(eq(users.username, username)).get();
  if (existing) return { user: existing, created: false };
  const password = randomPassword(16);
  const user = db.insert(users).values({ username, displayName, role, passwordHash: await hashPassword(password) }).returning().get();
  lines.push(`- ${role === 'admin' ? 'Admin' : 'Testuser'}: \`${username}\` / \`${password}\``);
  return { user, created: true };
}

const admin = await ensureUser('mateen', 'Mateen', 'admin');
if (admin.created) addStarterPet(db, admin.user.id, 'bit');
const test = await ensureUser('testuser', 'Testi', 'user');

if (test.created) {
  const uid = test.user.id;
  addStarterPet(db, uid, 'pixel');
  db.update(users).set({ coins: 400 }).where(eq(users.id, uid)).run();
  purchase(db, uid, 'pet:lambda');
  purchase(db, uid, 'acc:glasses');
  purchase(db, uid, 'theme:ocean');
  purchase(db, uid, 'frame:gold');
  equip(db, uid, 'pixel', 'acc:glasses');
  db.update(users).set({ frame: 'gold' }).where(eq(users.id, uid)).run();

  // Fortschritt über drei Tage verteilt → Streak 3, Kalender, Liga-XP
  const firstUnit = db.select().from(units).where(eq(units.module, 'DS')).orderBy(asc(units.number)).get();
  if (firstUnit) {
    const lv = db.select().from(levels).where(eq(levels.unitId, firstUnit.id)).orderBy(asc(levels.idx)).all();
    const day = 86_400_000;
    const plays: [number, number][] = [
      [0, 2 * day],
      [1, day],
    ];
    for (const [i, ago] of plays) {
      const level = lv[i];
      if (!level) continue;
      const qs = db.select().from(questions).where(eq(questions.levelId, level.id)).all();
      // ein paar Fehler einbauen, damit „Fehler üben“ befüllt ist
      const answers = qs.map((q, k) => {
        const data = q.data as Question;
        const wrong = data.options.find((o) => !data.correct.includes(o.id))!.id;
        return { questionId: q.id, selected: k % 4 === 1 ? [wrong] : data.correct };
      });
      completeLevel(db, db.select().from(users).where(eq(users.id, uid)).get()!, level.id, answers, Date.now() - ago);
    }
    const u = db.select().from(users).where(eq(users.id, uid)).get()!;
    const wrongOnes = db.select().from(questions).where(eq(questions.levelId, lv[0]!.id)).all().slice(0, 2);
    if (wrongOnes.length) completePractice(db, u, wrongOnes.map((q) => ({ questionId: q.id, selected: (q.data as Question).correct })));
  }
}

if (!db.select().from(invites).get()) {
  const code = randomInviteCode();
  db.insert(invites).values({ code, createdBy: admin.user.id, maxUses: 10, note: 'Freunde (Seed)' }).run();
  lines.push(`- Einladungscode (10×): \`${code}\``);
}

if (lines.length) {
  if (!existsSync(credFile)) writeFileSync(credFile, '# LernQuest – Zugangsdaten (nur lokal, nie committen)\n');
  appendFileSync(credFile, `\n## App (Seed ${new Date().toISOString().slice(0, 10)})\n${lines.join('\n')}\n`);
  chmodSync(credFile, 0o600);
  console.log(`Neue Zugangsdaten in ${credFile} gespeichert.`);
} else console.log('Seed: alles schon vorhanden.');

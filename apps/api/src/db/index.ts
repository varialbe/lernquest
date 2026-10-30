import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.ts';

export type DB = BetterSQLite3Database<typeof schema> & { $client: Database.Database };
export { schema };

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');

/** Öffnet (und migriert) eine SQLite-DB. `:memory:` für Tests. */
export function openDb(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  const db = drizzle(sqlite, { schema }) as DB;
  migrate(db, { migrationsFolder });
  return db;
}

let shared: DB | undefined;
export function getDb(): DB {
  if (!shared) {
    const path = process.env.DATABASE_PATH ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../../../data/lernquest.db');
    shared = openDb(path);
  }
  return shared;
}

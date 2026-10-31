import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const envFile = resolve(ROOT, '.env');
if (existsSync(envFile) && !process.env.VITEST) process.loadEnvFile(envFile);
process.env.TZ ??= 'Europe/Berlin';
process.env.DATABASE_PATH ??= resolve(ROOT, 'data/lernquest.db');

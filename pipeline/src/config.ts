import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const envFile = resolve(ROOT, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
process.env.TZ ??= 'Europe/Berlin';
process.env.DATABASE_PATH ??= resolve(ROOT, 'data/lernquest.db');

const env = (k: string, d: string) => process.env[k]?.trim() || d;

export const config = {
  root: ROOT,
  dataDir: resolve(ROOT, 'data'),
  contentDir: resolve(ROOT, 'content'),
  promptsDir: resolve(ROOT, 'pipeline/prompts'),
  schemaFile: resolve(ROOT, 'pipeline/schemas/unit-output.schema.json'),
  studiumRepo: env('STUDIUM_REPO', resolve(process.env.HOME ?? '~', 'studium')),
  studiumDirs: env('STUDIUM_DIRS', 'DS/01_Vorlesungen,EIP/01_Vorlesungen,ERA/01_Vorlesungen').split(',').map((s) => s.trim()),
  lernquestRepo: env('LERNQUEST_REPO', ROOT),
  regenerateOnModify: env('REGENERATE_ON_MODIFY', 'false') === 'true',
  gitPush: env('GIT_PUSH', 'true') === 'true',
  codexBin: env('CODEX_BIN', 'codex'),
  codexModel: env('CODEX_MODEL', 'gpt-5.6-luna'),
  codexEffort: env('CODEX_EFFORT', 'xhigh'),
  codexReviewEffort: env('CODEX_REVIEW_EFFORT', 'high'),
  codexTimeoutMs: Number(env('CODEX_TIMEOUT_MIN', '30')) * 60_000,
  host: env('PIPELINE_HOST', '127.0.0.1'),
  port: Number(env('PIPELINE_PORT', '3461')),
  token: env('PIPELINE_TOKEN', ''),
  promptVersion: 'v1',
  questionsPerLevel: 11,
  maxAttempts: 3,
};

/** Modul aus Pfad (erster Ordner), z. B. "DS/01_Vorlesungen/x.md" -> "DS" */
export const moduleOf = (path: string) => path.split('/')[0]!.toUpperCase();

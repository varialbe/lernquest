import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.ts';

export type CodexOptions = {
  prompt: string;
  effort: string;
  workDir: string;
  images?: string[];
  label: string;
  log: (msg: string) => void;
};

export type CodexResult = { data: unknown; tokens: number };

/** Codex meldet ein Rate-/Nutzungslimit – kein Retry, Lauf bricht die restlichen Dateien ab. */
export class RateLimitError extends Error {
  constructor(detail: string) {
    super(`Codex-Rate-Limit: ${detail}`);
    this.name = 'RateLimitError';
  }
}
const RATE_LIMIT = /rate[ _-]?limit|usage limit|too many requests|\b429\b|quota exceeded|try again (?:in|at|later)/i;

/** „tokens used\n12,345“ aus der codex-exec-Ausgabe lesen. */
export function parseTokens(output: string): number {
  const m = [...output.matchAll(/tokens used[:\s]*([\d.,]+)/gi)].at(-1);
  return m ? Number(m[1]!.replace(/[.,]/g, '')) : 0;
}

/** Ein nicht-interaktiver `codex exec`-Aufruf (read-only Sandbox, strukturierte Ausgabe). */
function runOnce(opts: CodexOptions, attempt: number): Promise<CodexResult> {
  const outFile = join(opts.workDir, `${opts.label}-out-${attempt}.json`);
  const logFile = join(opts.workDir, `${opts.label}-codex-${attempt}.log`);
  const args = [
    'exec',
    '--skip-git-repo-check',
    '--ephemeral',
    '-s', 'read-only',
    '-C', opts.workDir,
    '-m', config.codexModel,
    '-c', `model_reasoning_effort="${opts.effort}"`,
    '--output-schema', config.schemaFile,
    '-o', outFile,
    ...(opts.images ?? []).flatMap((img) => ['-i', img]),
    '-',
  ];
  writeFileSync(join(opts.workDir, `${opts.label}-prompt.md`), opts.prompt);

  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(config.codexBin, args, { cwd: opts.workDir, stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (d: Buffer) => chunks.push(d));
    child.stderr.on('data', (d: Buffer) => chunks.push(d));
    const timer = setTimeout(() => {
      opts.log(`  ⏱  ${opts.label}: Timeout nach ${config.codexTimeoutMs / 60_000} min – breche ab`);
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 10_000).unref();
    }, config.codexTimeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const output = Buffer.concat(chunks).toString('utf8');
      writeFileSync(logFile, output);
      const secs = Math.round((Date.now() - started) / 1000);
      const tokens = parseTokens(output);
      if (code !== 0) {
        const errLine = output.split('\n').filter((l) => /error|limit/i.test(l)).at(-1)?.trim().slice(0, 300);
        if (RATE_LIMIT.test(output)) return reject(new RateLimitError(errLine ?? `Exit ${code}`));
        return reject(new Error(`codex exec (${opts.label}) Exit ${code} nach ${secs}s${errLine ? `: ${errLine}` : ''} – siehe ${logFile}`));
      }
      if (!existsSync(outFile)) return reject(new Error(`codex exec (${opts.label}) schrieb keine Ausgabe`));
      opts.log(`  ✓ ${opts.label} fertig nach ${secs}s (${tokens.toLocaleString('de-DE')} Tokens)`);
      try {
        resolve({ data: parseJson(readFileSync(outFile, 'utf8')), tokens });
      } catch (e) {
        reject(new Error(`codex exec (${opts.label}) lieferte kein gültiges JSON: ${(e as Error).message}`));
      }
    });
    child.stdin.end(opts.prompt);
  });
}

/** JSON aus der letzten Nachricht ziehen (tolerant gegenüber ```json-Fences). */
export function parseJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
    if (fence) return JSON.parse(fence[1]!);
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error('kein JSON gefunden');
  }
}

/** codex exec mit einem Retry bei Fehler. */
export async function codexJson(opts: CodexOptions): Promise<CodexResult> {
  try {
    return await runOnce(opts, 1);
  } catch (e) {
    if (e instanceof RateLimitError) throw e;
    opts.log(`  ⚠ ${(e as Error).message} – Retry`);
    return runOnce(opts, 2);
  }
}

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

/** Ein nicht-interaktiver `codex exec`-Aufruf (read-only Sandbox, strukturierte Ausgabe). */
function runOnce(opts: CodexOptions, attempt: number): Promise<unknown> {
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
      writeFileSync(logFile, Buffer.concat(chunks));
      const secs = Math.round((Date.now() - started) / 1000);
      if (code !== 0) return reject(new Error(`codex exec (${opts.label}) Exit ${code} nach ${secs}s – siehe ${logFile}`));
      if (!existsSync(outFile)) return reject(new Error(`codex exec (${opts.label}) schrieb keine Ausgabe`));
      opts.log(`  ✓ ${opts.label} fertig nach ${secs}s`);
      try {
        resolve(parseJson(readFileSync(outFile, 'utf8')));
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
export async function codexJson(opts: CodexOptions): Promise<unknown> {
  try {
    return await runOnce(opts, 1);
  } catch (e) {
    opts.log(`  ⚠ ${(e as Error).message} – Retry`);
    return runOnce(opts, 2);
  }
}

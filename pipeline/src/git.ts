import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.ts';

function git(repo: string, args: string[], opts: { allowFail?: boolean } = {}): string {
  try {
    return execFileSync('git', ['-C', repo, '-c', 'core.quotepath=off', ...args], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5 * 60_000,
    });
  } catch (e) {
    if (opts.allowFail) return '';
    const err = e as { stderr?: string; message: string };
    throw new Error(`git ${args.join(' ')} fehlgeschlagen: ${err.stderr || err.message}`);
  }
}

export const sha256File = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
export const studiumPath = (rel: string) => join(config.studiumRepo, rel);

/** Studium-Repo ist read-only: nur fetch + fast-forward, niemals push. */
export function pullStudium(): string {
  git(config.studiumRepo, ['pull', '--ff-only', '--quiet']);
  return headSha();
}
export const headSha = () => git(config.studiumRepo, ['rev-parse', 'HEAD']).trim();
export function commitExists(sha: string): boolean {
  try {
    execFileSync('git', ['-C', config.studiumRepo, 'cat-file', '-e', `${sha}^{commit}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export type Change = { status: 'A' | 'R' | 'M'; path: string; oldPath?: string };

const isLectureFile = (p: string) => {
  const name = p.split('/').pop() ?? '';
  return !name.startsWith('.') && config.studiumDirs.some((d) => p.startsWith(`${d}/`));
};

/** Änderungen in den Vorlesungsordnern zwischen zwei Commits (A, R, M). */
export function diffLectures(from: string, to: string): Change[] {
  const out = git(config.studiumRepo, ['diff', '--name-status', '-z', '-M', '--diff-filter=ARM', `${from}..${to}`, '--', ...config.studiumDirs]);
  const parts = out.split('\0').filter(Boolean);
  const changes: Change[] = [];
  for (let i = 0; i < parts.length; ) {
    const st = parts[i++]!;
    if (st.startsWith('R')) {
      const oldPath = parts[i++]!;
      const path = parts[i++]!;
      if (isLectureFile(path)) changes.push({ status: 'R', path, oldPath });
    } else {
      const path = parts[i++]!;
      if (isLectureFile(path)) changes.push({ status: st[0] as 'A' | 'M', path });
    }
  }
  return changes;
}

/** Alle aktuell vorhandenen Vorlesungsdateien. */
export function listLectureFiles(): string[] {
  return git(config.studiumRepo, ['ls-files', '-z', '--', ...config.studiumDirs]).split('\0').filter(Boolean).filter(isLectureFile);
}

/** Zeitpunkt (unix s), an dem eine Datei (inkl. Umbenennungen) zuerst hinzugefügt wurde. */
export function firstAddedAt(path: string): number {
  const out = git(config.studiumRepo, ['log', '--follow', '--diff-filter=A', '--format=%at', '--', path]).trim().split('\n').filter(Boolean);
  return out.length ? Number(out[out.length - 1]) : Math.floor(Date.now() / 1000);
}

const voNumber = (p: string) => Number(/VO\s*(\d+)/i.exec(p)?.[1] ?? 999);

/** Chronologische Reihenfolge für den Backfill: erstes Hinzufügen, dann VO-Nummer, dann Name. */
export function chronological(paths: string[]): string[] {
  const meta = paths.map((p) => ({ p, at: firstAddedAt(p), vo: voNumber(p) }));
  meta.sort((a, b) => a.at - b.at || a.vo - b.vo || a.p.localeCompare(b.p));
  return meta.map((m) => m.p);
}

// ---------- lernquest-Repo (Content versionieren) ----------
export function commitContent(files: string[], message: string): boolean {
  const repo = config.lernquestRepo;
  git(repo, ['add', '--', ...files]);
  const staged = git(repo, ['diff', '--cached', '--name-only', '--', ...files]).trim();
  if (!staged) return false;
  git(repo, ['commit', '--quiet', '-m', message, '--', ...files]);
  return true;
}

export function pushContent(): string | null {
  if (!config.gitPush) return 'GIT_PUSH=false – nicht gepusht';
  try {
    git(config.lernquestRepo, ['pull', '--rebase', '--autostash', '--quiet']);
    git(config.lernquestRepo, ['push', '--quiet']);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

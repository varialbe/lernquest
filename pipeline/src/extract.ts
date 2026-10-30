import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

export type Extracted = {
  kind: 'markdown' | 'pdf' | 'pptx' | 'image' | 'text';
  /** Text für den Prompt; Seiten als "=== Seite N ===" markiert */
  text: string;
  /** Bilddateien, die an codex -i übergeben werden */
  images: string[];
  pages: number | null;
};

const MAX_CHARS = 150_000;
const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120_000 });

export const SUPPORTED = ['.md', '.markdown', '.txt', '.pdf', '.pptx', '.png', '.jpg', '.jpeg', '.webp'];
export const isSupported = (path: string) => SUPPORTED.includes(extname(path).toLowerCase());

/** Extrahiert Text (und ggf. Bilder) einer Vorlesungsdatei. `workDir` erhält Hilfsbilder. */
export function extract(file: string, workDir: string): Extracted {
  const ext = extname(file).toLowerCase();
  mkdirSync(workDir, { recursive: true });

  if (ext === '.md' || ext === '.markdown' || ext === '.txt') {
    const text = readFileSync(file, 'utf8');
    return { kind: ext === '.txt' ? 'text' : 'markdown', text: text.slice(0, MAX_CHARS), images: [], pages: null };
  }

  if (ext === '.pdf') {
    const info = run('pdfinfo', [file]);
    const pages = Number(/Pages:\s+(\d+)/.exec(info)?.[1] ?? 0);
    const chunks: string[] = [];
    const images: string[] = [];
    for (let p = 1; p <= pages; p++) {
      const t = run('pdftotext', ['-layout', '-f', String(p), '-l', String(p), file, '-']).trimEnd();
      chunks.push(`=== Seite ${p} ===\n${t}`);
      // bildlastige Seiten (kaum Text) zusätzlich als Bild übergeben
      if (t.replace(/\s+/g, '').length < 150 && images.length < 8) {
        const prefix = join(workDir, `page-${p}`);
        run('pdftoppm', ['-f', String(p), '-l', String(p), '-r', '90', '-png', '-singlefile', file, prefix]);
        images.push(`${prefix}.png`);
      }
    }
    return { kind: 'pdf', text: chunks.join('\n\n').slice(0, MAX_CHARS), images, pages };
  }

  if (ext === '.pptx') {
    const script = [
      'import sys, zipfile, re',
      'z = zipfile.ZipFile(sys.argv[1])',
      "names = sorted([n for n in z.namelist() if re.match(r'ppt/slides/slide\\d+\\.xml$', n)], key=lambda n: int(re.findall(r'\\d+', n)[-1]))",
      'for i, n in enumerate(names, 1):',
      "    xml = z.read(n).decode('utf8', 'ignore')",
      "    paras = [''.join(re.findall(r'<a:t>([^<]*)</a:t>', p)) for p in re.findall(r'<a:p>.*?</a:p>', xml, re.S)]",
      "    print(f'=== Seite {i} ===')",
      "    print('\\n'.join(p for p in paras if p.strip()))",
    ].join('\n');
    const text = run('python3', ['-c', script, file]);
    const pages = (text.match(/=== Seite /g) ?? []).length;
    return { kind: 'pptx', text: text.slice(0, MAX_CHARS), images: [], pages };
  }

  if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
    const target = join(workDir, `source${ext}`);
    copyFileSync(file, target);
    return { kind: 'image', text: '(Die Vorlesungsdatei ist ein Bild – siehe angehängtes Bild.)', images: [target], pages: 1 };
  }

  throw new Error(`Nicht unterstütztes Format: ${ext}`);
}


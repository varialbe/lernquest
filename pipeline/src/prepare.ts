import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import sharp from 'sharp';
import { decideImages, linkedNotes, parseNote, renderForPrompt, type Heading, type Vault } from './obsidian.ts';

export type Prepared = {
  /** aufbereiteter Notiztext für den Prompt */
  text: string;
  headings: Heading[];
  /** Bilder (PNG/JPG/WebP), die an codex -i gehen */
  images: string[];
  tags: string[];
  topic: string | null;
  /** aufgelöste verlinkte Notizen (Repo-Pfade) – Kanten im Konzeptgraph */
  links: string[];
  linked: { path: string; title: string; excerpt: string }[];
  /** Hinweise für den Report (ignorierte/fehlende Bilder, unaufgelöste Links) */
  notes: string[];
  stats: { chars: number; mermaid: number; callouts: number; math: number; images: number };
};

const MAX_CHARS = 150_000;

/** Nur Obsidian-Markdown (*.md) gilt als Vorlesungsdatei. */
export const isLectureNote = (path: string) => extname(path).toLowerCase() === '.md' && !path.split('/').some((seg) => seg.startsWith('.'));

export async function prepareNote(vault: Vault, file: string, workDir: string): Promise<Prepared> {
  mkdirSync(workDir, { recursive: true });
  const note = parseNote(readFileSync(join(vault.root, file), 'utf8'));
  const decisions = decideImages(vault, file, note);
  const images: string[] = [];
  const notes: string[] = [];
  for (const [i, d] of decisions.entries()) {
    if (!d.use || !d.path) {
      notes.push(`Bild ignoriert (${d.reason}): ${d.target}`);
      continue;
    }
    const src = join(vault.root, d.path);
    const ext = extname(d.path).toLowerCase();
    const out = join(workDir, `image-${i + 1}${ext === '.svg' || ext === '.gif' || ext === '.bmp' ? '.png' : ext}`);
    try {
      if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) copyFileSync(src, out);
      else await sharp(src, { density: 144 }).flatten({ background: '#ffffff' }).png().toFile(out);
      images.push(out);
    } catch (e) {
      d.use = false;
      notes.push(`Bild ignoriert (nicht lesbar: ${(e as Error).message}): ${d.target}`);
    }
  }
  const { notes: linked, links, unresolved } = linkedNotes(vault, file, note);
  for (const u of unresolved) notes.push(`Wikilink nicht auflösbar: [[${u}]]`);

  const fm = note.frontmatter;
  const tags = Array.isArray(fm.tags) ? fm.tags.map(String) : typeof fm.tags === 'string' ? fm.tags.split(/[,\s]+/).filter(Boolean) : [];
  const text = renderForPrompt(note, decisions).slice(0, MAX_CHARS);
  return {
    text,
    headings: note.headings,
    images,
    tags,
    topic: typeof fm.topic === 'string' ? fm.topic : null,
    links,
    linked,
    notes,
    stats: {
      chars: text.length,
      mermaid: note.mermaid.length,
      callouts: note.callouts.length,
      math: note.math.inline + note.math.block,
      images: images.length,
    },
  };
}

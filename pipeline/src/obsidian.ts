import { readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, normalize } from 'node:path';
import { parse as parseYaml } from 'yaml';

/** Obsidian-Markdown-Parser: Frontmatter, Überschriften, [[Wikilinks]], ![[Embeds]], Bilder, Callouts, Mermaid, LaTeX. */

export type Heading = { level: number; text: string; line: number };
export type WikiLink = { target: string; heading: string | null; alias: string | null; raw: string };
export type Embed = { target: string; alt: string | null; kind: 'image' | 'note' | 'other'; syntax: 'wiki' | 'markdown'; raw: string };
export type Callout = { type: string; title: string | null; line: number };

export type ParsedNote = {
  frontmatter: Record<string, unknown>;
  body: string;
  headings: Heading[];
  wikilinks: WikiLink[];
  embeds: Embed[];
  callouts: Callout[];
  mermaid: string[];
  math: { inline: number; block: number };
};

const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'];
const isImage = (p: string) => IMAGE_EXT.includes(extname(p).toLowerCase());

/** Bereiche in Code-Fences/Inline-Code, damit dort nichts als Link erkannt wird. */
function maskCode(text: string): string {
  return text.replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, ' ')).replace(/`[^`\n]+`/g, (m) => ' '.repeat(m.length));
}

export function parseNote(text: string): ParsedNote {
  let frontmatter: Record<string, unknown> = {};
  let body = text.replace(/^﻿/, '');
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(body);
  if (fm) {
    try {
      const parsed = parseYaml(fm[1]!);
      if (parsed && typeof parsed === 'object') frontmatter = parsed as Record<string, unknown>;
    } catch {
      frontmatter = { _invalid: fm[1] };
    }
    body = body.slice(fm[0].length);
  }

  const masked = maskCode(body);
  const lines = masked.split('\n');
  const headings: Heading[] = [];
  const callouts: Callout[] = [];
  lines.forEach((l, i) => {
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(l);
    if (h) headings.push({ level: h[1]!.length, text: h[2]!.trim(), line: i + 1 });
    const c = /^>\s*\[!([\w-]+)\][+-]?\s*(.*)$/.exec(l);
    if (c) callouts.push({ type: c[1]!.toLowerCase(), title: c[2]!.trim() || null, line: i + 1 });
  });

  const wikilinks: WikiLink[] = [];
  const embeds: Embed[] = [];
  for (const m of masked.matchAll(/(!?)\[\[([^\]|#\n]*)(?:#([^\]|\n]*))?(?:\|([^\]\n]*))?\]\]/g)) {
    const [raw, bang, target, heading, alias] = m;
    const t = target!.trim();
    if (bang) embeds.push({ target: t, alt: alias?.trim() || null, kind: isImage(t) ? 'image' : extname(t) && extname(t) !== '.md' ? 'other' : 'note', syntax: 'wiki', raw: raw! });
    else if (t) wikilinks.push({ target: t, heading: heading?.trim() || null, alias: alias?.trim() || null, raw: raw! });
  }
  for (const m of masked.matchAll(/!\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = decodeURI(m[2]!);
    if (/^https?:/i.test(target)) continue;
    embeds.push({ target, alt: m[1]!.trim() || null, kind: isImage(target) ? 'image' : 'other', syntax: 'markdown', raw: m[0] });
  }

  const mermaid = [...body.matchAll(/```mermaid\s*\n([\s\S]*?)```/g)].map((m) => m[1]!.trimEnd());
  const noCode = maskCode(body);
  const block = (noCode.match(/\$\$[\s\S]+?\$\$/g) ?? []).length;
  const inline = (noCode.replace(/\$\$[\s\S]+?\$\$/g, '').match(/\$[^$\n]+?\$/g) ?? []).length;

  return { frontmatter, body, headings, wikilinks, embeds, callouts, mermaid, math: { inline, block } };
}

// ---------- Auflösung im Vault ----------

export type Vault = { root: string; files: string[] };

/** Obsidian-Linkauflösung: exakter Pfad, relativ zur Notiz, sonst eindeutiger Dateiname im Vault (kürzester Pfad gewinnt). */
export function resolveLink(vault: Vault, fromFile: string, target: string, wantImage: boolean): string | null {
  const withExt = extname(target) ? target : `${target}.md`;
  const candidates = [normalize(join(dirname(fromFile), withExt)), normalize(withExt)].map((p) => p.replace(/\\/g, '/'));
  for (const c of candidates) if (vault.files.includes(c)) return c;
  const name = basename(withExt).toLowerCase();
  const hits = vault.files.filter((f) => basename(f).toLowerCase() === name && isImage(f) === wantImage);
  hits.sort((a, b) => a.split('/').length - b.split('/').length || a.length - b.length);
  return hits[0] ?? null;
}

export type ImageDecision = { path: string | null; target: string; alt: string | null; use: boolean; reason: string };

/**
 * Entscheidet je eingebettetem Bild, ob es inhaltlich wichtig ist:
 * vorhanden im Repo, nicht winzig (Icons) und mit beschreibendem Alt-Text bzw. in einem Abschnitt mit Text.
 */
export function decideImages(vault: Vault, fromFile: string, note: ParsedNote, maxImages = 8): ImageDecision[] {
  const out: ImageDecision[] = [];
  for (const e of note.embeds.filter((x) => x.kind === 'image')) {
    const path = resolveLink(vault, fromFile, e.target, true);
    if (!path) {
      out.push({ path: null, target: e.target, alt: e.alt, use: false, reason: 'Bild fehlt im Studium-Repo' });
      continue;
    }
    const size = statSync(join(vault.root, path)).size;
    const descriptive = (e.alt ?? '').length >= 12 && !/^pasted image/i.test(e.alt ?? '');
    if (size < 3_000) out.push({ path, target: e.target, alt: e.alt, use: false, reason: 'sehr klein (Icon/Deko)' });
    else if (!descriptive && e.syntax === 'markdown') out.push({ path, target: e.target, alt: e.alt, use: false, reason: 'ohne Beschreibung – vermutlich Deko' });
    else if (out.filter((x) => x.use).length >= maxImages) out.push({ path, target: e.target, alt: e.alt, use: false, reason: `Limit von ${maxImages} Bildern erreicht` });
    else out.push({ path, target: e.target, alt: e.alt, use: true, reason: descriptive ? 'beschriftetes Inhaltsbild' : 'eingebettetes Bild' });
  }
  return out;
}

/** Notiz für den Prompt aufbereiten: Bilder durch nummerierte Verweise ersetzen, Wikilinks lesbar machen. */
export function renderForPrompt(note: ParsedNote, images: ImageDecision[]): string {
  let text = note.body;
  let n = 0;
  const used = new Map<string, number>();
  for (const img of images) if (img.use && !used.has(img.target)) used.set(img.target, ++n);
  for (const e of note.embeds) {
    if (e.kind === 'image') {
      const k = used.get(e.target);
      const label = e.alt ? `: ${e.alt}` : '';
      text = text.replace(e.raw, k ? `[Bild ${k} – angehängt${label}]` : `[Bild nicht verfügbar${label}]`);
    } else if (e.kind === 'note') {
      text = text.replace(e.raw, `[Eingebettete Notiz „${e.target}“ – siehe verlinkte Notizen]`);
    }
  }
  for (const l of note.wikilinks) {
    text = text.replace(l.raw, `${l.alias ?? l.target}${l.heading ? ` (→ „${l.target}“ › ${l.heading})` : ` (→ Notiz „${l.target}“)`}`);
  }
  return text;
}

/** Verlinkte (und eingebettete) Notizen auflösen – Konzeptgraph. */
export function linkedNotes(vault: Vault, fromFile: string, note: ParsedNote, maxNotes = 5, maxChars = 6_000) {
  const targets = [...note.wikilinks.map((l) => l.target), ...note.embeds.filter((e) => e.kind === 'note').map((e) => e.target)];
  const seen = new Set<string>();
  const result: { path: string; title: string; excerpt: string }[] = [];
  const unresolved: string[] = [];
  for (const t of targets) {
    const path = resolveLink(vault, fromFile, t, false);
    if (!path) {
      unresolved.push(t);
      continue;
    }
    if (path === fromFile || seen.has(path)) continue;
    seen.add(path);
    if (result.length >= maxNotes) continue;
    const parsed = parseNote(readFileSync(join(vault.root, path), 'utf8'));
    result.push({ path, title: basename(path, '.md'), excerpt: parsed.body.slice(0, maxChars) });
  }
  return { notes: result, links: [...seen], unresolved };
}


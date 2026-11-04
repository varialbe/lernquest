/**
 * Mermaid-Flowcharts: sichtbare Beschriftungen (Knoten, Kanten, Subgraph-Titel) finden und ersetzen,
 * ohne Knoten-IDs, Pfeile oder Struktur anzufassen. Grundlage für die Übersetzung von Diagrammen.
 */

export type MermaidLabel = {
  /** Bereich im Quelltext, der beim Ersetzen getauscht wird (inkl. Anführungszeichen) */
  start: number;
  end: number;
  /** sichtbarer Text ohne Anführungszeichen */
  text: string;
  quoted: boolean;
  /** Subgraph ohne Titel-Klammer: Titel = ID; beim Übersetzen wird `id["Titel"]` daraus */
  bareSubgraphId?: string;
};

const SHAPES: [string, string[]][] = [
  ['(((', [')))']], ['((', ['))']], ['([', ['])']], ['[[', [']]']], ['[(', [')]']], ['{{', ['}}']],
  ['[/', ['/]', '\\]']], ['[\\', ['\\]', '/]']], ['(', [')']], ['[', [']']], ['{', ['}']], ['>', [']']],
];
const ID_CHAR = /[\p{L}\p{N}_]/u;
const SKIP_LINE = /^\s*(%%|classDef\b|class\b|style\b|linkStyle\b|click\b|direction\b|flowchart\b|graph\b|end\s*$|$)/;
const EDGE_TEXT = /^(--|==|-\.)\s+(?![-=.>])([^|\n]*?\S)\s+(-{2,}[>xo]?|={2,}[>xo]?|\.-+[>xo]?)/;

export const isMermaidDocument = (text: string) => /^\s*(flowchart|graph)\b/.test(text);

/** Labels eines Flowcharts in Quelltext-Reihenfolge. */
export function mermaidLabels(code: string): MermaidLabel[] {
  const labels: MermaidLabel[] = [];
  let offset = 0;
  for (const line of code.split('\n')) {
    scanLine(line, offset, labels);
    offset += line.length + 1;
  }
  return labels;
}

function inner(line: string, from: number, closers: string[]): { start: number; end: number; text: string; quoted: boolean; after: number } | null {
  if (line[from] === '"') {
    const q = line.indexOf('"', from + 1);
    if (q < 0) return null;
    const closer = closers.find((c) => line.startsWith(c, q + 1));
    if (!closer) return null;
    return { start: from, end: q + 1, text: line.slice(from + 1, q), quoted: true, after: q + 1 + closer.length };
  }
  let best = -1;
  let closer = '';
  for (const c of closers) {
    const i = line.indexOf(c, from);
    if (i >= 0 && (best < 0 || i < best)) { best = i; closer = c; }
  }
  if (best < 0) return null;
  return { start: from, end: best, text: line.slice(from, best), quoted: false, after: best + closer.length };
}

function scanLine(line: string, offset: number, out: MermaidLabel[]) {
  if (SKIP_LINE.test(line)) return;
  const sub = /^(\s*subgraph\s+)(.*?)\s*$/.exec(line);
  if (sub) {
    const rest = sub[2]!;
    const base = sub[1]!.length;
    const bracket = /^([\p{L}\p{N}_-]+)\s*\[/u.exec(rest);
    if (bracket) {
      const r = inner(line, base + bracket[0].length, [']']);
      if (r) out.push({ start: offset + r.start, end: offset + r.end, text: r.text, quoted: r.quoted });
    } else if (/^"[^"]*"$/.test(rest)) {
      out.push({ start: offset + base, end: offset + base + rest.length, text: rest.slice(1, -1), quoted: true });
    } else if (/^[\p{L}\p{N}_-]+$/u.test(rest)) {
      out.push({ start: offset + base, end: offset + base + rest.length, text: rest, quoted: false, bareSubgraphId: rest });
    }
    return;
  }
  let i = 0;
  while (i < line.length) {
    const ch = line[i]!;
    if (ch === '|') {
      const j = line.indexOf('|', i + 1);
      if (j < 0) return;
      const quoted = line[i + 1] === '"' && line[j - 1] === '"' && j - i > 2;
      out.push({ start: offset + i + 1, end: offset + j, text: quoted ? line.slice(i + 2, j - 1) : line.slice(i + 1, j), quoted });
      i = j + 1;
      continue;
    }
    if (ch === '-' || ch === '=') {
      const m = EDGE_TEXT.exec(line.slice(i));
      if (m && !(i > 0 && (line[i - 1] === '-' || line[i - 1] === '='))) {
        const textStart = i + m[0].indexOf(m[2]!, m[1]!.length);
        const raw = m[2]!;
        const quoted = raw.length > 1 && raw.startsWith('"') && raw.endsWith('"');
        out.push({ start: offset + textStart, end: offset + textStart + raw.length, text: quoted ? raw.slice(1, -1) : raw, quoted });
        i += m[0].length;
        continue;
      }
    }
    if (ID_CHAR.test(ch) && (i === 0 || !ID_CHAR.test(line[i - 1]!))) {
      let j = i;
      while (j < line.length && (ID_CHAR.test(line[j]!) || (line[j] === '-' && ID_CHAR.test(line[j + 1] ?? '') && line[j + 1] !== '-'))) j++;
      const shape = SHAPES.find(([open]) => line.startsWith(open, j));
      if (shape) {
        const r = inner(line, j + shape[0].length, shape[1]);
        if (r) {
          out.push({ start: offset + r.start, end: offset + r.end, text: r.text, quoted: r.quoted });
          i = r.after;
          continue;
        }
      }
      i = j;
      continue;
    }
    i++;
  }
}

/** Nur Labels mit echtem Text (mind. zwei Buchstaben am Stück) werden übersetzt. */
export const translatableLabel = (label: MermaidLabel) => /\p{L}{2,}/u.test(label.text);

const UNSAFE = /["()[\]{}|<>;#]/;
function render(label: MermaidLabel, text: string): string {
  const clean = text.replace(/\s*\n\s*/g, ' ').trim();
  if (label.bareSubgraphId != null) return clean === label.text ? label.text : `${label.bareSubgraphId}["${clean.replace(/"/g, '#quot;')}"]`;
  if (label.quoted || UNSAFE.test(clean)) return `"${clean.replace(/"/g, '#quot;')}"`;
  return clean;
}

/** Übersetzbare Labels durch `texts` ersetzen (gleiche Reihenfolge wie translatableLabel-gefilterte Labels). */
export function replaceMermaidLabels(code: string, texts: string[]): string {
  const labels = mermaidLabels(code).filter(translatableLabel);
  if (labels.length !== texts.length) throw new Error(`expected ${labels.length} mermaid labels, got ${texts.length}`);
  let out = '';
  let cursor = 0;
  labels.forEach((label, i) => {
    out += code.slice(cursor, label.start) + render(label, texts[i]!);
    cursor = label.end;
  });
  return out + code.slice(cursor);
}

/** Struktur ohne Beschriftungen: gleich ⇔ nur Labels unterscheiden sich. */
export function mermaidSkeleton(code: string): string {
  let out = '';
  let cursor = 0;
  for (const label of mermaidLabels(code)) {
    out += code.slice(cursor, label.start) + (label.bareSubgraphId != null ? `${label.bareSubgraphId}[⟨⟩]` : '⟨⟩');
    cursor = label.end;
  }
  return (out + code.slice(cursor)).replace(/\[\s*⟨⟩\s*\]/g, '[⟨⟩]').replace(/[ \t]+$/gm, '');
}

const FENCE = /(`{3,})mermaid[^\n]*\n([\s\S]*?)\1/g;

/** Mermaid-Codeblöcke (```mermaid) in einem Markdown-Text: Position des Codes im Text. */
export function mermaidBlocks(text: string): { start: number; end: number; code: string }[] {
  if (isMermaidDocument(text)) return [{ start: 0, end: text.length, code: text }];
  const blocks: { start: number; end: number; code: string }[] = [];
  for (const m of text.matchAll(FENCE)) {
    const start = m.index! + m[0].indexOf('\n') + 1;
    blocks.push({ start, end: start + m[2]!.length, code: m[2]! });
  }
  return blocks;
}

/** Alle übersetzbaren Diagramm-Labels eines Textfelds (Mermaid-Dokument oder ```mermaid-Blöcke). */
export const textMermaidLabels = (text: string): string[] => mermaidBlocks(text).flatMap((b) => mermaidLabels(b.code).filter(translatableLabel).map((l) => l.text));

/** Labels in allen Diagrammen eines Textfelds ersetzen (Reihenfolge wie textMermaidLabels). */
export function replaceTextMermaidLabels(text: string, texts: string[]): string {
  let out = '';
  let cursor = 0;
  let used = 0;
  for (const block of mermaidBlocks(text)) {
    const count = mermaidLabels(block.code).filter(translatableLabel).length;
    out += text.slice(cursor, block.start) + replaceMermaidLabels(block.code, texts.slice(used, used + count));
    used += count;
    cursor = block.end;
  }
  if (used !== texts.length) throw new Error(`expected ${used} mermaid labels, got ${texts.length}`);
  return out + text.slice(cursor);
}

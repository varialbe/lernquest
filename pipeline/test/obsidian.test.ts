import { describe, expect, it } from 'vitest';
import { parseNote, renderForPrompt, resolveLink } from '../src/obsidian.ts';

const NOTE = `---
tags: [tum, induktion]
topic: Peano
---

# Natürliche Zahlen

> [!info] Kernideen
> - $\\mathbb{N}_0$ ist unendlich

## Induktion
Siehe [[Diskrete Strukturen VO1#Mengen|Mengenlehre]] und [[EIP VO2]].

$$
\\sum_{i=0}^n i = \\frac{n(n+1)}{2}
$$

\`\`\`mermaid
graph TD
  A[Anfang] --> B[Schritt]
\`\`\`

\`\`\`python
x = "[[kein link]]"
\`\`\`

![[Pasted image 2026.png]]
![Venn-Diagramm zweier Mengen](../04_Materialien/venn.png)
`;

describe('obsidian parser', () => {
  const n = parseNote(NOTE);

  it('parses frontmatter', () => {
    expect(n.frontmatter).toEqual({ tags: ['tum', 'induktion'], topic: 'Peano' });
    expect(n.body.startsWith('\n# Natürliche Zahlen')).toBe(true);
  });
  it('finds headings and callouts', () => {
    expect(n.headings.map((h) => [h.level, h.text])).toEqual([
      [1, 'Natürliche Zahlen'],
      [2, 'Induktion'],
    ]);
    expect(n.callouts.map((c) => [c.type, c.title])).toEqual([['info', 'Kernideen']]);
  });
  it('extracts wikilinks but ignores links inside code', () => {
    expect(n.wikilinks.map((l) => [l.target, l.heading, l.alias])).toEqual([
      ['Diskrete Strukturen VO1', 'Mengen', 'Mengenlehre'],
      ['EIP VO2', null, null],
    ]);
  });
  it('extracts wiki and markdown image embeds', () => {
    expect(n.embeds.map((e) => [e.target, e.kind, e.syntax])).toEqual([
      ['Pasted image 2026.png', 'image', 'wiki'],
      ['../04_Materialien/venn.png', 'image', 'markdown'],
    ]);
  });
  it('counts mermaid and math', () => {
    expect(n.mermaid).toHaveLength(1);
    expect(n.mermaid[0]).toContain('A[Anfang] --> B[Schritt]');
    expect(n.math).toEqual({ inline: 1, block: 1 });
  });
  it('renders wikilinks and image placeholders for the prompt', () => {
    const text = renderForPrompt(n, [
      { path: 'DS/04_Materialien/venn.png', target: '../04_Materialien/venn.png', alt: 'Venn-Diagramm zweier Mengen', use: true, reason: '' },
      { path: null, target: 'Pasted image 2026.png', alt: null, use: false, reason: 'fehlt' },
    ]);
    expect(text).toContain('Mengenlehre (→ „Diskrete Strukturen VO1“ › Mengen)');
    expect(text).toContain('[Bild 1 – angehängt: Venn-Diagramm zweier Mengen]');
    expect(text).toContain('[Bild nicht verfügbar]');
    expect(text).toContain('```mermaid');
  });
  it('resolves links like Obsidian', () => {
    const vault = { root: '/', files: ['DS/01_Vorlesungen/Diskrete Strukturen VO1.md', 'DS/04_Materialien/venn.png', 'EIP/01_Vorlesungen/EIP VO2.md'] };
    expect(resolveLink(vault, 'DS/01_Vorlesungen/Diskrete Strukturen VO2.md', 'Diskrete Strukturen VO1', false)).toBe('DS/01_Vorlesungen/Diskrete Strukturen VO1.md');
    expect(resolveLink(vault, 'DS/01_Vorlesungen/x.md', '../04_Materialien/venn.png', true)).toBe('DS/04_Materialien/venn.png');
    expect(resolveLink(vault, 'DS/01_Vorlesungen/x.md', 'EIP VO2', false)).toBe('EIP/01_Vorlesungen/EIP VO2.md');
    expect(resolveLink(vault, 'DS/01_Vorlesungen/x.md', 'gibt es nicht', false)).toBeNull();
  });
});

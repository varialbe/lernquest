import type { Element, Root } from 'hast';
import { toText } from 'hast-util-to-text';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import java from 'highlight.js/lib/languages/java';
import mipsasm from 'highlight.js/lib/languages/mipsasm';
import python from 'highlight.js/lib/languages/python';
import { createLowlight } from 'lowlight';
import { visit } from 'unist-util-visit';

// Nur die Sprachen aus den Mitschriften (rehype-highlight bündelt immer ~37 „common“); RISC-V-Assembler über mipsasm
const lowlight = createLowlight({ bash, c, java, mipsasm, python });
lowlight.registerAlias({ mipsasm: ['asm', 'riscv', 's'], bash: ['sh', 'shell'] });

/** Rehype-Plugin: färbt ```lang-Blöcke ein, unbekannte Sprachen bleiben unverändert. */
export function rehypeHighlightLite() {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element, _i, parent) => {
      if (node.tagName !== 'code' || parent?.type !== 'element' || parent.tagName !== 'pre') return;
      const classes = Array.isArray(node.properties.className) ? node.properties.className.map(String) : [];
      const lang = classes.find((k) => k.startsWith('language-'))?.slice(9);
      if (!lang || !lowlight.registered(lang)) return;
      node.children = lowlight.highlight(lang, toText(node, { whitespace: 'pre' })).children as Element['children'];
      if (!classes.includes('hljs')) node.properties.className = [...classes, 'hljs'];
    });
  };
}

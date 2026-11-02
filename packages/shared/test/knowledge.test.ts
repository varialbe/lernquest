import { describe, expect, it } from 'vitest';
import { normalizeMathDelimiters } from '../src/index.ts';

describe('normalizeMathDelimiters', () => {
  it('turns \\( \\) and \\[ \\] into $ / $$', () => {
    expect(normalizeMathDelimiters('Die Mengen \\(\\mathbb{N}\\) und \\( A \\land B \\) sind …')).toBe('Die Mengen $\\mathbb{N}$ und $A \\land B$ sind …');
    expect(normalizeMathDelimiters('Formel:\n\\[\n x^2 \\geq 0\n\\]\nfertig')).toBe('Formel:\n$$x^2 \\geq 0$$\nfertig');
  });
  it('leaves code and plain $ untouched', () => {
    const code = 'In Java: `s.matches("\\\\(a\\\\)")` und\n```java\nString r = "\\\\(x\\\\)";\n```\nund $x$';
    expect(normalizeMathDelimiters(code)).toBe(code);
    expect(normalizeMathDelimiters('nur $a \\cup b$')).toBe('nur $a \\cup b$');
  });
});

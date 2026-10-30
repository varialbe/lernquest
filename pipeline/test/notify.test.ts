import { describe, expect, it } from 'vitest';
import { parseTokens } from '../src/codex.ts';
import { runMessage } from '../src/notify.ts';
import type { Report } from '../src/run.ts';

const base: Report = {
  runId: 'r1',
  mode: 'run',
  status: 'partial',
  startedAt: '',
  finishedAt: '',
  durationSec: 754,
  studiumHead: 'abcdef1234',
  previousSha: null,
  files: [
    { path: 'DS/01_Vorlesungen/DS VO7.md', status: 'done', unitId: 'ds-07', title: 'Graphen <Bäume>', questions: 44, levels: 4, notes: ['Bild fehlt'] },
    { path: 'ERA/01_Vorlesungen/ERA VO8.md', status: 'failed', error: 'Level 2 hat nur 6 Fragen\nDetails' },
  ],
  totals: { processed: 1, failed: 1, skipped: 0, levels: 4, questions: 44, tokens: 123456 },
  rateLimited: true,
  warnings: [],
};

describe('telegram summary', () => {
  it('formats a partial run with failures, tokens and rate limit', () => {
    const m = runMessage(base);
    expect(m.level).toBe('warn');
    expect(m.title).toContain('⚠️');
    expect(m.html).toContain('Codex-Rate-Limit');
    expect(m.html).toContain('12 min 34 s');
    expect(m.html).toContain('123.456');
    expect(m.html).toContain('Graphen &lt;Bäume&gt;');
    expect(m.html).toContain('ERA VO8.md: Level 2 hat nur 6 Fragen');
    expect(m.html).not.toContain('Details');
  });
  it('sends a short status line when nothing is new', () => {
    const m = runMessage({ ...base, status: 'nothing_new', files: [], rateLimited: false });
    expect(m.title).toBe('✅ LernQuest: nichts Neues');
    expect(m.html.split('\n')).toHaveLength(1);
  });
  it('parses codex token usage', () => {
    expect(parseTokens('codex\nOK\ntokens used\n12,345\n')).toBe(12345);
    expect(parseTokens('nothing')).toBe(0);
  });
});

describe('latex escape repair', async () => {
  const { fixLatexEscapes } = await import('../src/generate.ts');
  it('restores backslashes eaten by JSON escapes inside math', () => {
    expect(fixLatexEscapes('$\frac{1}{2}$')).toBe('$\\frac{1}{2}$');
    expect(fixLatexEscapes('$a \times b$')).toBe('$a \\times b$');
    expect(fixLatexEscapes('$\neg A$ und\nText')).toBe('$\\neg A$ und\nText');
    expect(fixLatexEscapes('```py\n\tx = 1\n```')).toBe('```py\n\tx = 1\n```');
  });
});

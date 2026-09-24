import { describe, expect, it } from 'vitest';
import { buildJobIfSnippets, formatIfSnippetsMarkdown, buildMatrixOutput } from '../src/decision/outputs.js';

describe('matrix output', () => {
  it('builds strategy.matrix include rows', () => {
    expect(JSON.parse(buildMatrixOutput(['lint', 'unit']))).toEqual({
      include: [{ job: 'lint' }, { job: 'unit' }],
    });
  });
});

describe('if snippets', () => {
  it('builds fromJSON conditions and markdown', () => {
    const snippets = buildJobIfSnippets(['unit', 'lint']);
    expect(snippets.unit).toBe("contains(fromJSON(needs.pathfinder.outputs.run_jobs), 'unit')");
    const md = formatIfSnippetsMarkdown(snippets, ['unit']);
    expect(md).toContain('Prefer `fromJSON(run_jobs)`');
    expect(md).toContain('(run)');
    expect(md).toContain('(skip)');
  });
});

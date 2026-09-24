import { describe, expect, it } from 'vitest';
import { buildMatrixOutput } from '../src/decision/outputs.js';

describe('matrix output', () => {
  it('builds strategy.matrix include rows', () => {
    expect(JSON.parse(buildMatrixOutput(['lint', 'unit']))).toEqual({
      include: [{ job: 'lint' }, { job: 'unit' }],
    });
    expect(JSON.parse(buildMatrixOutput([]))).toEqual({ include: [] });
  });
});

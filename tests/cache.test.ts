import { describe, expect, it } from 'vitest';
import { buildCacheKey, fingerprintConfig } from '../src/decision/cache.js';

describe('decision cache keys', () => {
  it('is stable for the same inputs and changes when paths differ', () => {
    const base = {
      sha: 'abcdef1234567890',
      configFingerprint: fingerprintConfig({ jobs: [{ id: 'unit' }] }),
      paths: ['src/a.ts', 'src/b.ts'],
      provider: 'vercel-ai-gateway',
      decisionMode: 'jev',
    };
    const a = buildCacheKey(base);
    const b = buildCacheKey({ ...base, paths: ['src/b.ts', 'src/a.ts'] });
    const c = buildCacheKey({ ...base, paths: ['docs/a.md'] });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a.startsWith('jev-cpath-v1-')).toBe(true);
  });
});

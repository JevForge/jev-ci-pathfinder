import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('jev contract prep', () => {
  it('keeps contract.ts as the adapter import source', () => {
    const factory = readFileSync(join(process.cwd(), 'src/jev/factory.ts'), 'utf8');
    const gateway = readFileSync(join(process.cwd(), 'src/jev/vercel-ai-gateway.ts'), 'utf8');
    const contract = readFileSync(join(process.cwd(), 'src/jev/contract.ts'), 'utf8');
    expect(factory).toContain("from './contract.js'");
    expect(gateway).toContain("from './contract.js'");
    expect(contract).toContain('export interface JevProvider');
    expect(contract).toContain('@jevforge/core');
  });
});

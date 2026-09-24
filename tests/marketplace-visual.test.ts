import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

describe('marketplace visual', () => {
  it('ships an SVG flow diagram referenced by the README', () => {
    const svgPath = join(process.cwd(), 'docs/assets/pathfinder-flow.svg');
    expect(existsSync(svgPath)).toBe(true);
    const svg = readFileSync(svgPath, 'utf8');
    expect(svg).toContain('<svg');
    expect(svg).toContain('JEV CI Pathfinder');
    const readme = readFileSync(join(process.cwd(), 'README.md'), 'utf8');
    expect(readme).toContain('docs/assets/pathfinder-flow.svg');
  });
});

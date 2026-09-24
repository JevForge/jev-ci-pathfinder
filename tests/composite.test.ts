import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';

describe('composite wrapper', () => {
  it('checks out then runs pathfinder and re-exports outputs', () => {
    const doc = YAML.parse(readFileSync(join(process.cwd(), 'composite/action.yml'), 'utf8')) as {
      runs: { using: string; steps: Array<{ uses?: string; id?: string }> };
      outputs: Record<string, { value?: string }>;
    };
    expect(doc.runs.using).toBe('composite');
    expect(doc.runs.steps.some(step => step.uses === 'actions/checkout@v4')).toBe(true);
    expect(doc.runs.steps.some(step => step.id === 'plan' && step.uses === 'JevForge/jev-ci-pathfinder@v0')).toBe(
      true,
    );
    expect(doc.outputs.run_jobs.value).toContain('steps.plan.outputs.run_jobs');
    const readme = readFileSync(join(process.cwd(), 'README.md'), 'utf8');
    expect(readme).toContain('JevForge/jev-ci-pathfinder/composite@v0');
  });
});

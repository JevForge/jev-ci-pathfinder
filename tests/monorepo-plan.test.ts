import { describe, expect, it } from 'vitest';
import { MonorepoPlanSchema } from '../src/schemas/pathfinder.js';
import { parseMonorepoPlan } from '../src/collectors/monorepo.js';

describe('monorepo plan v1', () => {
  it('accepts versioned and legacy plans', () => {
    expect(
      MonorepoPlanSchema.parse({
        plan_version: 1,
        affected_projects: ['web'],
        execution_plan: [{ project: 'web', jobs: ['unit'] }],
      }).plan_version,
    ).toBe(1);
    expect(MonorepoPlanSchema.parse({ affected_projects: ['web'] }).plan_version).toBeUndefined();
    expect(parseMonorepoPlan(JSON.stringify({ plan_version: 1, affected_projects: ['api'] })).affected_projects).toEqual([
      'api',
    ]);
  });

  it('rejects unsupported plan versions', () => {
    expect(MonorepoPlanSchema.safeParse({ plan_version: 2, affected_projects: [] }).success).toBe(false);
  });
});

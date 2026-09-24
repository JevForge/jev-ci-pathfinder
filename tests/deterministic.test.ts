import { describe, expect, it } from 'vitest';
import { executeDeterministic } from '../src/decision/deterministic.js';
import { parseDecisionMode } from '../src/action/settings.js';
import type { JobDefinition } from '../src/schemas/pathfinder.js';

function jobs(): JobDefinition[] {
  return [
    { id: 'lint', paths: [], needs: [], always: true, rerunOnRecentFailure: false, pathHit: false },
    { id: 'unit', paths: ['src/**'], needs: [], always: false, rerunOnRecentFailure: false, pathHit: false },
    {
      id: 'integration',
      paths: ['src/api/**'],
      needs: ['unit'],
      always: false,
      rerunOnRecentFailure: true,
      pathHit: false,
    },
    { id: 'docs', paths: ['docs/**'], needs: [], always: false, rerunOnRecentFailure: false, pathHit: false },
  ];
}

describe('deterministic mode', () => {
  it('parses decision_mode', () => {
    expect(parseDecisionMode(undefined)).toBe('jev');
    expect(parseDecisionMode('deterministic')).toBe('deterministic');
    expect(() => parseDecisionMode('ai')).toThrow(/decision_mode/);
  });

  it('selects path hits, always-on, history, and authoritative monorepo without Jev', () => {
    const result = executeDeterministic({
      provider: 'vercel-ai-gateway',
      jobs: jobs(),
      changedPaths: ['src/api/a.ts'],
      requirePathHits: true,
      history: {
        enabled: true,
        available: true,
        failedJobCounts: { integration: 1 },
        rerunIds: ['integration'],
      },
      monorepo: {
        affectedProjects: ['web'],
        mappedJobIds: ['unit'],
        droppedJobIds: [],
        authoritative: true,
      },
      inventory: { discovered: false, jobIds: [], sources: [], jobs: [] },
      noChangedPaths: false,
    });
    expect(result.decision).toBe('SELECT_JOBS');
    expect(result.provisional).toBe(true);
    expect(result.shouldFail).toBe(false);
    expect(result.runJobs).toEqual(['lint', 'unit', 'integration']);
    expect(result.skipJobs).toEqual(['docs']);
    expect(result.reasonCodes).toContain('DETERMINISTIC_ONLY');
    expect(result.reasonCodes).toContain('PATH_MATCH');
    expect(result.reasonCodes).toContain('ALWAYS_RUN');
    expect(result.confidence).toBe(1);
  });

  it('keeps only always-on jobs when there are no path hits', () => {
    const result = executeDeterministic({
      provider: 'typesafe-native',
      jobs: jobs(),
      changedPaths: ['README.md'],
      requirePathHits: true,
      history: { enabled: false, available: false, failedJobCounts: {}, rerunIds: [] },
      monorepo: { affectedProjects: [], mappedJobIds: [], droppedJobIds: [], authoritative: false },
      inventory: { discovered: false, jobIds: [], sources: [], jobs: [] },
      noChangedPaths: false,
    });
    expect(result.runJobs).toEqual(['lint']);
    expect(result.reasonCodes).toContain('DETERMINISTIC_ONLY');
  });
});

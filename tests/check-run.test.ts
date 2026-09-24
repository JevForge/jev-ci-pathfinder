import { describe, expect, it, vi } from 'vitest';
import {
  buildCheckSummary,
  checkConclusion,
  maybeCreateCheckRun,
} from '../src/github/check-run.js';

describe('check run', () => {
  it('maps conclusions from policy and decision', () => {
    expect(checkConclusion({ shouldFail: true, decision: 'SELECT_JOBS', needsReview: false })).toBe(
      'failure',
    );
    expect(checkConclusion({ shouldFail: false, decision: 'REQUEST_REVIEW', needsReview: true })).toBe(
      'neutral',
    );
    expect(checkConclusion({ shouldFail: false, decision: 'ABSTAIN', needsReview: false })).toBe(
      'neutral',
    );
    expect(checkConclusion({ shouldFail: false, decision: 'SELECT_JOBS', needsReview: false })).toBe(
      'success',
    );
  });

  it('builds a summary table', () => {
    const summary = buildCheckSummary({
      decision: 'SELECT_JOBS',
      runJobs: ['unit'],
      skipJobs: ['docs'],
      provisional: false,
      confidence: 0.9,
      reasonCodes: ['PATH_HIT'],
      summary: 'ok',
      shouldFail: false,
    });
    expect(summary).toContain('| Decision | `SELECT_JOBS` |');
    expect(summary).toContain('`unit`');
  });

  it('creates a check when enabled', async () => {
    const createCheckRun = vi.fn(async () => undefined);
    const status = await maybeCreateCheckRun(true, 'abcdef1', { createCheckRun }, {
      decision: 'SELECT_JOBS',
      runJobs: ['unit'],
      skipJobs: [],
      provisional: false,
      confidence: 1,
      reasonCodes: [],
      summary: 'ok',
      shouldFail: false,
      needsReview: false,
    });
    expect(status).toBe('created');
    expect(createCheckRun).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'JEV CI Pathfinder', conclusion: 'success' }),
    );
  });

  it('skips without sha or when disabled', async () => {
    expect(await maybeCreateCheckRun(false, 'abcdef1', null, {
      decision: 'SELECT_JOBS',
      runJobs: [],
      skipJobs: [],
      provisional: false,
      confidence: 1,
      reasonCodes: [],
      summary: '',
      shouldFail: false,
      needsReview: false,
    })).toBe('skipped');
    expect(await maybeCreateCheckRun(true, null, { createCheckRun: async () => undefined }, {
      decision: 'SELECT_JOBS',
      runJobs: [],
      skipJobs: [],
      provisional: false,
      confidence: 1,
      reasonCodes: [],
      summary: '',
      shouldFail: false,
      needsReview: false,
    })).toBe('skipped');
  });
});

import { describe, expect, it } from 'vitest';
import {
  parseHistoryJobIdMap,
  resolveFailedJobIds,
  fetchActionHistory,
} from '../src/collectors/history.js';

describe('history job ids', () => {
  it('parses history_job_id_map', () => {
    expect(parseHistoryJobIdMap('')).toEqual({});
    expect(parseHistoryJobIdMap('{"Unit tests":"unit","Lint":"lint"}')).toEqual({
      'Unit tests': 'unit',
      Lint: 'lint',
    });
    expect(() => parseHistoryJobIdMap('{')).toThrow(/valid JSON/);
    expect(() => parseHistoryJobIdMap('[]')).toThrow(/object/);
    expect(() => parseHistoryJobIdMap('{"x":"bad id"}')).toThrow(/invalid job id/);
  });

  it('prefers allowlisted job ids and mapped display names', () => {
    const allow = new Set(['unit', 'lint', 'integration']);
    const map = { 'Unit tests': 'unit', Lint: 'lint' };
    expect(
      resolveFailedJobIds(
        [
          { name: 'unit', conclusion: 'failure' },
          { name: 'Unit tests', conclusion: 'failure' },
          { name: 'Deploy Staging', conclusion: 'failure' },
          { name: 'integration', conclusion: 'success' },
          { name: 'Lint', conclusion: 'timed_out' },
        ],
        allow,
        map,
      ),
    ).toEqual(['unit', 'lint']);
  });

  it('maps display names via API history when allowlist is provided', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      if (url.includes('/actions/runs?')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            workflow_runs: [{ id: 11, head_branch: 'main', conclusion: 'failure' }],
          }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          jobs: [
            { name: 'Unit tests', conclusion: 'failure' },
            { name: 'docs', conclusion: 'failure' },
          ],
        }),
      } as Response;
    }) as typeof fetch;

    const history = await fetchActionHistory({
      fetchImpl,
      token: 't',
      owner: 'acme',
      repo: 'app',
      lookback: 5,
      timeoutMs: 5_000,
      allowlist: ['unit', 'lint'],
      nameToId: { 'Unit tests': 'unit' },
    });
    expect(history).toEqual([
      { head_branch: 'main', conclusion: 'failure', failed_jobs: ['unit'] },
    ]);
    expect(calls.some(url => url.includes('/jobs'))).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { formatTelemetryLine } from '../src/telemetry.js';

describe('telemetry', () => {
  it('formats a JSON line without paths or secrets', () => {
    const line = formatTelemetryLine({
      duration_ms: 12,
      provider: 'vercel-ai-gateway',
      provisional: true,
      run_count: 2,
      cache_hit: false,
      decision: 'SELECT_JOBS',
      decision_mode: 'deterministic',
    });
    const parsed = JSON.parse(line) as { jev_ci_pathfinder_telemetry: Record<string, unknown> };
    expect(parsed.jev_ci_pathfinder_telemetry).toEqual({
      duration_ms: 12,
      provider: 'vercel-ai-gateway',
      provisional: true,
      run_count: 2,
      cache_hit: false,
      decision: 'SELECT_JOBS',
      decision_mode: 'deterministic',
    });
    expect(line).not.toMatch(/secret|token|api.?key|\/src\//i);
    expect(Object.keys(parsed.jev_ci_pathfinder_telemetry).sort()).toEqual([
      'cache_hit',
      'decision',
      'decision_mode',
      'duration_ms',
      'provider',
      'provisional',
      'run_count',
    ]);
  });
});

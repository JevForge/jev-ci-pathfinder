import { normalizeRepoPath, parseChangedPathsInput } from '../utils/paths.js';
import { redactSecrets } from '../utils/sanitize.js';
import {
  coalescePolicy,
  loadHistoryFile,
  loadJeConfig,
  loadPathfinderConfig,
} from '../collectors/config.js';
import {
  emptyHistory,
  fetchActionHistory,
  listCompareFiles,
  listPullRequestFiles,
  parseHistoryJobIdMap,
  pathsFromPushPayload,
  safeBranch,
  summarizeHistory,
  type HistorySummary,
} from '../collectors/history.js';
import { buildMonorepoEvidence, discoverProjects, parseMonorepoPlan } from '../collectors/monorepo.js';
import { readCiInventory, parseCiTools } from '../collectors/workspace-ci.js';
import { createJevProvider, credentialEnvName } from '../jev/factory.js';
import { unavailableDecision } from '../jev/normalize.js';
import { executePathfinder } from '../decision/execute.js';
import { executeDeterministic } from '../decision/deterministic.js';
import { buildCacheKey, fingerprintConfig, saveDecisionCache, tryRestoreDecisionCache } from '../decision/cache.js';
import { buildMatrixOutput, buildJobIfSnippets, formatIfSnippetsMarkdown } from '../decision/outputs.js';
import {
  buildPathfinderComment,
  createFetchCommentClient,
  upsertPathfinderComment,
} from '../github/pr-comment.js';
import { join } from 'node:path';
import type { HistoryRun } from '../schemas/pathfinder.js';
import {
  parseBool,
  parseDecisionMode,
  parseLookback,
  parseTimeout,
  parseUnitInterval,
  resolveProviderSettings,
} from './settings.js';

export interface ActionIO {
  inputs: Record<string, string | undefined>;
  env: Record<string, string | undefined>;
  workspace: string;
  eventName: string;
  payload: Record<string, unknown>;
  repo: { owner: string; repo: string };
  fetch: typeof fetch;
  info: (message: string) => void;
  warning: (message: string) => void;
  setOutput: (name: string, value: string) => void;
  setFailed: (message: string) => void;
  summary: (markdown: string) => void | Promise<void>;
}

function input(io: ActionIO, name: string): string {
  return io.inputs[name] ?? '';
}

async function collectChangedPaths(io: ActionIO, timeoutMs: number): Promise<{ paths: string[]; truncated: boolean }> {
  const explicit = input(io, 'changed_paths');
  if (explicit.trim()) {
    const paths = parseChangedPathsInput(explicit);
    return { paths, truncated: paths.length >= 400 };
  }
  const token = input(io, 'token');
  const { owner, repo } = io.repo;
  if ((io.eventName === 'pull_request' || io.eventName === 'pull_request_target') && token && owner && repo) {
    const pull = io.payload.pull_request as { number?: number } | undefined;
    const number = pull?.number ?? (typeof io.payload.number === 'number' ? io.payload.number : 0);
    const raw = await listPullRequestFiles({
      fetchImpl: io.fetch,
      token,
      owner,
      repo,
      pullNumber: number,
      timeoutMs,
    });
    const paths = raw.map(normalizeRepoPath).filter((path): path is string => path != null);
    return { paths: [...new Set(paths)].slice(0, 400), truncated: raw.length >= 400 };
  }
  if (io.eventName === 'push') {
    const fromPayload = pathsFromPushPayload(io.payload);
    let raw = fromPayload.paths;
    let truncated = fromPayload.possiblyTruncated;
    const before = typeof io.payload.before === 'string' ? io.payload.before : '';
    const after = typeof io.payload.after === 'string' ? io.payload.after : '';
    if (fromPayload.possiblyTruncated && token && owner && repo) {
      try {
        const compared = await listCompareFiles({
          fetchImpl: io.fetch,
          token,
          owner,
          repo,
          base: before,
          head: after,
          timeoutMs,
        });
        if (compared.length > 0) {
          raw = compared;
          truncated = compared.length >= 400;
        }
      } catch (error) {
        truncated = true;
        const message = error instanceof Error ? error.message : 'compare failed';
        io.warning(redactSecrets(message));
      }
    }
    const paths = raw.map(normalizeRepoPath).filter((path): path is string => path != null);
    return { paths: [...new Set(paths)].slice(0, 400), truncated };
  }
  return { paths: [], truncated: false };
}

async function collectHistory(
  io: ActionIO,
  enabled: boolean,
  jobs: Parameters<typeof summarizeHistory>[1],
  lookback: number,
  timeoutMs: number,
): Promise<HistorySummary> {
  if (!enabled) return emptyHistory();
  const historyPath = input(io, 'history_path') || '.jev/ci-history.json';
  const fileRuns = loadHistoryFile(io.workspace, historyPath);
  let runs: HistoryRun[] = fileRuns ?? [];
  let available = fileRuns != null;
  const token = input(io, 'token');
  const allowlist = jobs.map(job => job.id);
  const nameToId = parseHistoryJobIdMap(input(io, 'history_job_id_map'));
  if (token && io.repo.owner && io.repo.repo) {
    try {
      const apiRuns = await fetchActionHistory({
        fetchImpl: io.fetch,
        token,
        owner: io.repo.owner,
        repo: io.repo.repo,
        branch: safeBranch(input(io, 'history_branch') || undefined),
        lookback,
        timeoutMs,
        allowlist,
        nameToId,
      });
      runs = [...(fileRuns ?? []), ...apiRuns].slice(0, lookback);
      available = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'history request failed';
      io.warning(redactSecrets(message));
      available = fileRuns != null;
    }
  }
  if (!available) {
    return { enabled: true, available: false, failedJobCounts: {}, rerunIds: [] };
  }
  return summarizeHistory(runs, jobs, lookback, safeBranch(input(io, 'history_branch') || undefined));
}

export async function runAction(io: ActionIO): Promise<void> {
  try {
    await run(io);
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : String(error)).slice(0, 500);
    io.setFailed(
      `[JEV CI Pathfinder] ${message || 'Unexpected failure. Check config_path, secrets, and provider settings.'}`,
    );
  }
}

async function run(io: ActionIO): Promise<void> {
  const workspace = io.workspace;
  const jeConfig = loadJeConfig(workspace, input(io, 'jev_config_path') || '.jev/config.yml');
  const loaded = loadPathfinderConfig(
    workspace,
    input(io, 'config_path') || '.jev/ci-pathfinder.yml',
    input(io, 'job_map'),
  );
  const settings = resolveProviderSettings({
    inputProvider: input(io, 'jev_provider'),
    inputEndpoint: input(io, 'jev_endpoint'),
    inputModel: input(io, 'jev_model'),
    config: jeConfig,
    trustRepoEndpoint: parseBool(input(io, 'trust_repo_jev_endpoint'), false),
  });
  const minConfidence = parseUnitInterval(
    input(io, 'min_confidence'),
    jeConfig.min_confidence ?? 0.7,
  );
  const policy = coalescePolicy(input(io, 'low_confidence_policy'), jeConfig);
  const timeoutMs = parseTimeout(input(io, 'jev_timeout_ms'));
  const requirePathHits = parseBool(input(io, 'require_path_hits'), true);
  const includeHistory = parseBool(input(io, 'include_history'), false);
  const discoverMonorepo = parseBool(input(io, 'discover_monorepo'), true);
  const discoverWorkflows = parseBool(input(io, 'discover_workflows'), true);
  const authoritative = parseBool(input(io, 'monorepo_authoritative'), false);
  const decisionMode = parseDecisionMode(input(io, 'decision_mode'));
  if (!parseBool(input(io, 'dry_run'), true)) {
    io.info('[JEV CI Pathfinder] Never edits workflows. dry_run=false does not enable writes.');
  }

  const changed = await collectChangedPaths(io, timeoutMs);
  const lookback = parseLookback(input(io, 'history_lookback'), loaded.lookback);
  const history = await collectHistory(io, includeHistory, loaded.jobs, lookback, timeoutMs);
  const monorepo = buildMonorepoEvidence({
    changedPaths: changed.paths,
    packages: loaded.packages,
    allowlist: loaded.jobs.map(job => job.id),
    discovered: discoverMonorepo ? discoverProjects(workspace) : [],
    plan: parseMonorepoPlan(input(io, 'monorepo_plan')),
    authoritative,
  });
  const inventory = discoverWorkflows
    ? readCiInventory(
        workspace,
        parseCiTools(input(io, 'ci_tools')),
        input(io, 'workflows_dir') || '.github/workflows',
      )
    : { discovered: false, jobIds: [], sources: [], jobs: [] };

  const cacheEnabled = parseBool(input(io, 'cache_decisions'), false);
  const cacheKey = buildCacheKey({
    sha: io.env.GITHUB_SHA || 'nosha',
    configFingerprint: fingerprintConfig({
      jobs: loaded.jobs,
      packages: loaded.packages,
      lookback: loaded.lookback,
      minConfidence,
      policy,
      requirePathHits,
      authoritative,
    }),
    paths: changed.paths,
    provider: settings.provider,
    decisionMode,
  });
  const cacheDir = join(workspace, '.jev', '.decision-cache');
  let cacheHit = false;
  let result = await tryRestoreDecisionCache({ enabled: cacheEnabled, key: cacheKey, cacheDir });
  if (result) {
    cacheHit = true;
    io.info(`[JEV CI Pathfinder] Restored decision cache (${cacheKey}).`);
  } else {
    result =
      decisionMode === 'deterministic'
        ? executeDeterministic({
            provider: settings.provider,
            jobs: loaded.jobs,
            changedPaths: changed.paths,
            requirePathHits,
            history,
            monorepo,
            inventory,
            noChangedPaths: changed.paths.length === 0,
          })
        : await executePathfinder({
            provider: settings.refusal
              ? {
                  id: settings.provider,
                  async evaluateCiSelection() {
                    return unavailableDecision(settings.provider, settings.refusal!);
                  },
                }
              : createJevProvider(settings.provider, {
                  apiKey: io.env[credentialEnvName(settings.provider)],
                  endpoint: settings.endpoint,
                  model: settings.model,
                  timeoutMs,
                  fetchImpl: io.fetch,
                }),
            jobs: loaded.jobs,
            changedPaths: changed.paths,
            pathsTruncated: changed.truncated,
            minConfidence,
            policy,
            requirePathHits,
            history,
            monorepo,
            inventory,
          });
    if (cacheEnabled) {
      const saved = await saveDecisionCache({ enabled: true, key: cacheKey, cacheDir, result });
      if (saved) io.info(`[JEV CI Pathfinder] Saved decision cache (${cacheKey}).`);
    }
  }

  if (decisionMode === 'deterministic' && !cacheHit) {
    io.info('[JEV CI Pathfinder] decision_mode=deterministic — Jev was not called.');
  }

  io.setOutput('decision', result.decision);
  io.setOutput('run_jobs', JSON.stringify(result.runJobs));
  io.setOutput('skip_jobs', JSON.stringify(result.skipJobs));
  io.setOutput('run_jobs_csv', result.runJobs.join(','));
  io.setOutput('skip_jobs_csv', result.skipJobs.join(','));
  io.setOutput('confidence', String(result.confidence));
  io.setOutput('reason_codes', JSON.stringify(result.reasonCodes));
  io.setOutput('summary', result.summary);
  io.setOutput('provisional', String(result.provisional));
  io.setOutput('needs_review', String(result.needsReview));
  io.setOutput('affected_paths', JSON.stringify(changed.paths));
  io.setOutput('history_applied', JSON.stringify(result.historyApplied));
  io.setOutput('monorepo_projects', JSON.stringify(monorepo.affectedProjects));
  io.setOutput('jev_provider', result.provider);
  io.setOutput('cache_hit', String(cacheHit));
  io.setOutput('matrix', buildMatrixOutput(result.runJobs));
  const ifSnippets = buildJobIfSnippets(loaded.jobs.map(job => job.id));
  io.setOutput('if_snippets', JSON.stringify(ifSnippets));

  await io.summary(
    [
      '## JEV CI Pathfinder',
      '',
      `Decision: \`${result.decision}\``,
      '',
      `Run: ${result.runJobs.join(', ') || '(none)'}`,
      '',
      `Skip: ${result.skipJobs.join(', ') || '(none)'}`,
      '',
      result.summary,
      '',
      formatIfSnippetsMarkdown(ifSnippets, result.runJobs),
    ].join('\n'),
  );

  const commentEnabled = parseBool(input(io, 'comment_on_github'), false);
  if (commentEnabled) {
    const pull =
      io.eventName === 'pull_request' || io.eventName === 'pull_request_target'
        ? (io.payload.pull_request as { number?: number } | undefined)
        : undefined;
    const issueNumber = pull?.number ?? (typeof io.payload.number === 'number' ? io.payload.number : 0);
    const token = input(io, 'token');
    try {
      const client =
        token && io.repo.owner && io.repo.repo && issueNumber > 0
          ? createFetchCommentClient({
              fetchImpl: io.fetch,
              token,
              owner: io.repo.owner,
              repo: io.repo.repo,
              issueNumber,
            })
          : null;
      const body = buildPathfinderComment({
        decision: result.decision,
        runJobs: result.runJobs,
        skipJobs: result.skipJobs,
        provisional: result.provisional,
        confidence: result.confidence,
        reasonCodes: result.reasonCodes,
        summary: result.summary,
      });
      const status = await upsertPathfinderComment(true, client, body);
      io.info(`[JEV CI Pathfinder] PR comment: ${status}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'comment failed';
      io.warning(redactSecrets(message));
    }
  }

  if (result.provisional) io.warning(`[JEV CI Pathfinder] ${result.summary}`);
  if (result.shouldFail) {
    io.setFailed(`[JEV CI Pathfinder] ${result.failureMessage}`);
  }
}

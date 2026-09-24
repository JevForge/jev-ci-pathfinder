import type { HistoryRun, JobDefinition } from '../schemas/pathfinder.js';

export interface HistorySummary {
  enabled: boolean;
  available: boolean;
  failedJobCounts: Record<string, number>;
  rerunIds: string[];
}

export function emptyHistory(): HistorySummary {
  return { enabled: false, available: false, failedJobCounts: {}, rerunIds: [] };
}

const BRANCH_PATTERN = /^[A-Za-z0-9._/-]{1,256}$/;

export function safeBranch(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const branch = value.trim();
  if (!branch || branch.startsWith('-') || branch.includes('..') || !BRANCH_PATTERN.test(branch)) {
    return undefined;
  }
  return branch;
}

export function summarizeHistory(
  runs: HistoryRun[],
  jobs: JobDefinition[],
  lookback: number,
  branch: string | undefined,
): HistorySummary {
  const window = runs
    .filter(run => !branch || run.head_branch === branch)
    .slice(0, lookback);
  const counts: Record<string, number> = {};
  for (const run of window) {
    for (const jobId of run.failed_jobs) {
      counts[jobId] = (counts[jobId] ?? 0) + 1;
    }
  }
  const rerunIds = jobs
    .filter(job => job.rerunOnRecentFailure && (counts[job.id] ?? 0) > 0)
    .map(job => job.id);
  return {
    enabled: true,
    available: true,
    failedJobCounts: counts,
    rerunIds,
  };
}

const SAFE_NAME = /^[A-Za-z0-9_.-]+$/;
const SHA = /^[0-9a-fA-F]{7,40}$/;

export function assertGithubName(value: string, label: string): string {
  if (!SAFE_NAME.test(value)) throw new Error(`Invalid GitHub ${label}`);
  return value;
}

export function assertSha(value: string): string | null {
  if (/^0+$/.test(value)) return null;
  return SHA.test(value) ? value : null;
}

interface GithubRun {
  id?: number;
  head_branch?: string | null;
  conclusion?: string | null;
}

interface GithubJob {
  name?: string;
  conclusion?: string | null;
}

async function githubJson(
  fetchImpl: typeof fetch,
  token: string,
  url: string,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'user-agent': 'jev-ci-pathfinder',
        'x-github-api-version': '2022-11-28',
      },
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, status: response.status, body: null };
    return { ok: true, status: response.status, body: (await response.json()) as unknown };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchActionHistory(input: {
  fetchImpl: typeof fetch;
  token: string;
  owner: string;
  repo: string;
  branch?: string;
  lookback: number;
  timeoutMs: number;
}): Promise<HistoryRun[]> {
  const owner = assertGithubName(input.owner, 'owner');
  const repo = assertGithubName(input.repo, 'repo');
  const lookback = Math.min(20, Math.max(1, input.lookback));
  const branch = safeBranch(input.branch);
  const query = new URLSearchParams({ per_page: String(lookback) });
  if (branch) query.set('branch', branch);
  const runsUrl = `https://api.github.com/repos/${owner}/${repo}/actions/runs?${query.toString()}`;
  const listed = await githubJson(input.fetchImpl, input.token, runsUrl, input.timeoutMs);
  if (!listed.ok) throw new Error(`GitHub Actions history request failed with HTTP ${listed.status}`);
  const runs = (listed.body as { workflow_runs?: GithubRun[] } | null)?.workflow_runs ?? [];
  const history: HistoryRun[] = [];
  for (const run of runs.slice(0, lookback)) {
    if (!run.id || (run.conclusion !== 'failure' && run.conclusion !== 'timed_out')) continue;
    const jobsUrl = `https://api.github.com/repos/${owner}/${repo}/actions/runs/${run.id}/jobs?per_page=100`;
    const jobsResponse = await githubJson(input.fetchImpl, input.token, jobsUrl, input.timeoutMs);
    if (!jobsResponse.ok) continue;
    const jobs = (jobsResponse.body as { jobs?: GithubJob[] } | null)?.jobs ?? [];
    const failed = jobs
      .filter(job => (job.conclusion === 'failure' || job.conclusion === 'timed_out') && typeof job.name === 'string')
      .map(job => job.name as string)
      .filter(name => /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name));
    history.push({
      head_branch: typeof run.head_branch === 'string' ? run.head_branch : undefined,
      conclusion: run.conclusion === 'timed_out' ? 'timed_out' : 'failure',
      failed_jobs: [...new Set(failed)].slice(0, 64),
    });
  }
  return history;
}

export function pathsFromPushPayload(payload: Record<string, unknown>): {
  paths: string[];
  possiblyTruncated: boolean;
} {
  const commits = Array.isArray(payload.commits) ? payload.commits : [];
  const paths: string[] = [];
  for (const commit of commits) {
    if (!commit || typeof commit !== 'object') continue;
    for (const key of ['added', 'modified', 'removed'] as const) {
      const list = (commit as Record<string, unknown>)[key];
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        if (typeof item === 'string') paths.push(item);
      }
    }
  }
  return { paths, possiblyTruncated: commits.length >= 20 };
}

export async function listPullRequestFiles(input: {
  fetchImpl: typeof fetch;
  token: string;
  owner: string;
  repo: string;
  pullNumber: number;
  timeoutMs: number;
}): Promise<string[]> {
  const owner = assertGithubName(input.owner, 'owner');
  const repo = assertGithubName(input.repo, 'repo');
  if (!Number.isInteger(input.pullNumber) || input.pullNumber <= 0) {
    throw new Error('Invalid pull request number');
  }
  const paths: string[] = [];
  for (let page = 1; page <= 4 && paths.length < 400; page += 1) {
    const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${input.pullNumber}/files?per_page=100&page=${page}`;
    const response = await githubJson(input.fetchImpl, input.token, url, input.timeoutMs);
    if (!response.ok) throw new Error(`GitHub pull request files request failed with HTTP ${response.status}`);
    const files = Array.isArray(response.body) ? response.body : [];
    if (files.length === 0) break;
    for (const file of files) {
      if (file && typeof file === 'object' && typeof (file as { filename?: unknown }).filename === 'string') {
        paths.push((file as { filename: string }).filename);
      }
    }
    if (files.length < 100) break;
  }
  return paths.slice(0, 400);
}

export async function listCompareFiles(input: {
  fetchImpl: typeof fetch;
  token: string;
  owner: string;
  repo: string;
  base: string;
  head: string;
  timeoutMs: number;
}): Promise<string[]> {
  const owner = assertGithubName(input.owner, 'owner');
  const repo = assertGithubName(input.repo, 'repo');
  const base = assertSha(input.base);
  const head = assertSha(input.head);
  if (!base || !head) return [];
  const url = `https://api.github.com/repos/${owner}/${repo}/compare/${base}...${head}`;
  const response = await githubJson(input.fetchImpl, input.token, url, input.timeoutMs);
  if (!response.ok) throw new Error(`GitHub compare request failed with HTTP ${response.status}`);
  const files = (response.body as { files?: { filename?: string }[] } | null)?.files ?? [];
  return files.map(file => file.filename).filter((name): name is string => typeof name === 'string').slice(0, 400);
}

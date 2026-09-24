import { assertGithubName, assertSha } from '../collectors/history.js';

export function checkConclusion(input: {
  shouldFail: boolean;
  decision: string;
  needsReview: boolean;
}): 'success' | 'neutral' | 'failure' {
  if (input.shouldFail) return 'failure';
  if (input.needsReview || input.decision === 'REQUEST_REVIEW' || input.decision === 'ABSTAIN') {
    return 'neutral';
  }
  return 'success';
}

export function buildCheckSummary(input: {
  decision: string;
  runJobs: string[];
  skipJobs: string[];
  provisional: boolean;
  confidence: number;
  reasonCodes: string[];
  summary: string;
  shouldFail: boolean;
}): string {
  return [
    '### JEV CI Pathfinder',
    '',
    '| Field | Value |',
    '| --- | --- |',
    `| Decision | \`${input.decision}\` |`,
    `| Provisional | ${input.provisional ? 'yes' : 'no'} |`,
    `| Confidence | ${input.confidence.toFixed(3)} |`,
    `| Policy fail | ${input.shouldFail ? 'yes' : 'no'} |`,
    `| Reason codes | ${input.reasonCodes.map(c => `\`${c}\``).join(', ') || '`(none)`'} |`,
    `| Run | ${input.runJobs.map(id => `\`${id}\``).join(', ') || '`(none)`'} |`,
    `| Skip | ${input.skipJobs.map(id => `\`${id}\``).join(', ') || '`(none)`'} |`,
    '',
    input.summary,
  ].join('\n');
}

export interface CheckRunClient {
  createCheckRun(input: {
    name: string;
    headSha: string;
    conclusion: 'success' | 'neutral' | 'failure';
    title: string;
    summary: string;
  }): Promise<void>;
}

export async function maybeCreateCheckRun(
  enabled: boolean,
  headSha: string | null,
  client: CheckRunClient | null,
  payload: {
    decision: string;
    runJobs: string[];
    skipJobs: string[];
    provisional: boolean;
    confidence: number;
    reasonCodes: string[];
    summary: string;
    shouldFail: boolean;
    needsReview: boolean;
  },
): Promise<'created' | 'skipped'> {
  if (!enabled || !client || !headSha) return 'skipped';
  const conclusion = checkConclusion(payload);
  await client.createCheckRun({
    name: 'JEV CI Pathfinder',
    headSha,
    conclusion,
    title: `${payload.decision}${payload.provisional ? ' (provisional)' : ''}`,
    summary: buildCheckSummary(payload),
  });
  return 'created';
}

export function createFetchCheckRunClient(input: {
  fetchImpl: typeof fetch;
  token: string;
  owner: string;
  repo: string;
}): CheckRunClient {
  const owner = assertGithubName(input.owner, 'owner');
  const repo = assertGithubName(input.repo, 'repo');
  return {
    async createCheckRun(check) {
      const sha = assertSha(check.headSha);
      if (!sha) throw new Error('Invalid head SHA for check run');
      const response = await input.fetchImpl(`https://api.github.com/repos/${owner}/${repo}/checks`, {
        method: 'POST',
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${input.token}`,
          'user-agent': 'jev-ci-pathfinder',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: check.name,
          head_sha: sha,
          status: 'completed',
          conclusion: check.conclusion,
          output: {
            title: check.title,
            summary: check.summary,
          },
        }),
      });
      if (!response.ok) {
        throw new Error(`create check run failed with HTTP ${response.status}`);
      }
    },
  };
}

export function resolveHeadSha(payload: Record<string, unknown>, envSha: string | undefined): string | null {
  const pr = payload.pull_request as { head?: { sha?: string } } | undefined;
  if (pr?.head?.sha && typeof pr.head.sha === 'string') return assertSha(pr.head.sha);
  if (typeof payload.after === 'string') return assertSha(payload.after);
  if (envSha) return assertSha(envSha);
  return null;
}

import { assertGithubName } from '../collectors/history.js';

export const COMMENT_MARKER = '<!-- jev-ci-pathfinder -->';

export function buildPathfinderComment(input: {
  decision: string;
  runJobs: string[];
  skipJobs: string[];
  provisional: boolean;
  confidence: number;
  reasonCodes: string[];
  summary: string;
}): string {
  const runRows =
    input.runJobs.length > 0
      ? input.runJobs.map(id => `| \`${id}\` | run |`).join('\n')
      : '| _(none)_ | run |';
  const skipRows =
    input.skipJobs.length > 0
      ? input.skipJobs.map(id => `| \`${id}\` | skip |`).join('\n')
      : '| _(none)_ | skip |';
  return [
    COMMENT_MARKER,
    '### JEV CI Pathfinder',
    '',
    `- **Decision:** \`${input.decision}\``,
    `- **Provisional:** ${input.provisional ? 'yes' : 'no'}`,
    `- **Confidence:** ${input.confidence.toFixed(3)}`,
    `- **Reason codes:** ${input.reasonCodes.map(c => `\`${c}\``).join(', ') || '`(none)`'}`,
    '',
    '| Job | Action |',
    '| --- | --- |',
    runRows,
    skipRows,
    '',
    input.summary,
  ].join('\n');
}

export interface CommentClient {
  listComments(): Promise<Array<{ id: number; body: string }>>;
  createComment(body: string): Promise<void>;
  updateComment(id: number, body: string): Promise<void>;
}

export async function upsertPathfinderComment(
  enabled: boolean,
  client: CommentClient | null,
  body: string,
): Promise<'posted' | 'updated' | 'skipped'> {
  if (!enabled || !client) return 'skipped';
  const comments = await client.listComments();
  const existing = comments.find(comment => comment.body.includes(COMMENT_MARKER));
  if (existing) {
    await client.updateComment(existing.id, body);
    return 'updated';
  }
  await client.createComment(body);
  return 'posted';
}

async function githubJson(
  fetchImpl: typeof fetch,
  token: string,
  url: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const response = await fetchImpl(url, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'user-agent': 'jev-ci-pathfinder',
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = text;
    }
  }
  return { ok: response.ok, status: response.status, body };
}

export function createFetchCommentClient(input: {
  fetchImpl: typeof fetch;
  token: string;
  owner: string;
  repo: string;
  issueNumber: number;
}): CommentClient {
  const owner = assertGithubName(input.owner, 'owner');
  const repo = assertGithubName(input.repo, 'repo');
  if (!Number.isInteger(input.issueNumber) || input.issueNumber <= 0) {
    throw new Error('Invalid pull request number');
  }
  const base = `https://api.github.com/repos/${owner}/${repo}/issues/${input.issueNumber}/comments`;
  return {
    async listComments() {
      const out: Array<{ id: number; body: string }> = [];
      for (let page = 1; page <= 5; page += 1) {
        const result = await githubJson(
          input.fetchImpl,
          input.token,
          `${base}?per_page=100&page=${page}`,
        );
        if (!result.ok) throw new Error(`list comments failed with HTTP ${result.status}`);
        const batch = Array.isArray(result.body) ? result.body : [];
        if (batch.length === 0) break;
        for (const item of batch) {
          if (
            item &&
            typeof item === 'object' &&
            typeof (item as { id?: unknown }).id === 'number' &&
            typeof (item as { body?: unknown }).body === 'string'
          ) {
            out.push({ id: (item as { id: number }).id, body: (item as { body: string }).body });
          }
        }
        if (batch.length < 100) break;
      }
      return out;
    },
    async createComment(body: string) {
      const result = await githubJson(input.fetchImpl, input.token, base, {
        method: 'POST',
        body: JSON.stringify({ body }),
      });
      if (!result.ok) throw new Error(`create comment failed with HTTP ${result.status}`);
    },
    async updateComment(id: number, body: string) {
      const url = `https://api.github.com/repos/${owner}/${repo}/issues/comments/${id}`;
      const result = await githubJson(input.fetchImpl, input.token, url, {
        method: 'PATCH',
        body: JSON.stringify({ body }),
      });
      if (!result.ok) throw new Error(`update comment failed with HTTP ${result.status}`);
    },
  };
}

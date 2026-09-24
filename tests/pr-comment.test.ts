import { describe, expect, it, vi } from 'vitest';
import {
  COMMENT_MARKER,
  buildPathfinderComment,
  upsertPathfinderComment,
} from '../src/github/pr-comment.js';

describe('PR comment', () => {
  it('builds markdown with marker and run/skip table', () => {
    const body = buildPathfinderComment({
      decision: 'SELECT_JOBS',
      runJobs: ['unit', 'lint'],
      skipJobs: ['docs'],
      provisional: true,
      confidence: 0.81,
      reasonCodes: ['PATH_HIT'],
      summary: 'Selected path hits.',
    });
    expect(body.startsWith(COMMENT_MARKER)).toBe(true);
    expect(body).toContain('| `unit` | run |');
    expect(body).toContain('| `docs` | skip |');
    expect(body).toContain('Provisional:** yes');
  });

  it('updates an existing marked comment', async () => {
    const updateComment = vi.fn(async () => undefined);
    const createComment = vi.fn(async () => undefined);
    const status = await upsertPathfinderComment(
      true,
      {
        listComments: async () => [{ id: 9, body: `${COMMENT_MARKER}\nold` }],
        createComment,
        updateComment,
      },
      `${COMMENT_MARKER}\nnew`,
    );
    expect(status).toBe('updated');
    expect(updateComment).toHaveBeenCalledWith(9, `${COMMENT_MARKER}\nnew`);
    expect(createComment).not.toHaveBeenCalled();
  });

  it('creates when no marker exists', async () => {
    const createComment = vi.fn(async () => undefined);
    const status = await upsertPathfinderComment(
      true,
      {
        listComments: async () => [{ id: 1, body: 'other' }],
        createComment,
        updateComment: async () => undefined,
      },
      `${COMMENT_MARKER}\nnew`,
    );
    expect(status).toBe('posted');
    expect(createComment).toHaveBeenCalled();
  });

  it('skips when disabled', async () => {
    expect(await upsertPathfinderComment(false, null, 'x')).toBe('skipped');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runAction, type ActionIO } from '../src/action/main.js';

function writeConfig(root: string): void {
  mkdirSync(join(root, '.jev'), { recursive: true });
  writeFileSync(
    join(root, '.jev/ci-pathfinder.yml'),
    `jobs:
  - id: unit
    paths: ['src/**']
`,
  );
}

function harness(
  root: string,
  inputs: Record<string, string>,
): ActionIO & { failed: string[]; warnings: string[]; outputs: Record<string, string> } {
  const failed: string[] = [];
  const warnings: string[] = [];
  const outputs: Record<string, string> = {};
  return {
    inputs,
    env: {},
    workspace: root,
    eventName: 'push',
    payload: {},
    repo: { owner: 'o', repo: 'r' },
    fetch: vi.fn(async () => new Response('{}', { status: 500 })) as typeof fetch,
    info: () => undefined,
    warning: message => warnings.push(message),
    setOutput: (name, value) => {
      outputs[name] = value;
    },
    setFailed: message => failed.push(message),
    summary: () => undefined,
    failed,
    warnings,
    outputs,
  };
}

describe('semantic dry_run', () => {
  it('emits outputs but does not setFailed when dry_run=true and policy is fail', async () => {
    const root = mkdtempSync(join(tmpdir(), 'jev-dry-'));
    writeConfig(root);
    const runtime = harness(root, {
      changed_paths: 'src/a.ts',
      decision_mode: 'jev',
      low_confidence_policy: 'fail',
      dry_run: 'true',
      jev_provider: 'vercel-ai-gateway',
    });
    await runAction(runtime);
    expect(runtime.outputs.decision).toBeTruthy();
    expect(runtime.failed).toEqual([]);
    expect(runtime.warnings.some(w => /dry_run=true/.test(w))).toBe(true);
  });

  it('calls setFailed when dry_run=false and policy is fail', async () => {
    const root = mkdtempSync(join(tmpdir(), 'jev-dry-'));
    writeConfig(root);
    const runtime = harness(root, {
      changed_paths: 'src/a.ts',
      decision_mode: 'jev',
      low_confidence_policy: 'fail',
      dry_run: 'false',
      jev_provider: 'vercel-ai-gateway',
    });
    await runAction(runtime);
    expect(runtime.failed.length).toBeGreaterThan(0);
  });
});

import * as core from '@actions/core';
import * as github from '@actions/github';
import { runAction } from './action/main.js';

const names = [
  'config_path',
  'changed_paths',
  'job_map',
  'jev_provider',
  'jev_model',
  'jev_endpoint',
  'jev_timeout_ms',
  'jev_config_path',
  'min_confidence',
  'low_confidence_policy',
  'include_history',
  'history_path',
  'history_lookback',
  'history_branch',
  'monorepo_plan',
  'monorepo_authoritative',
  'discover_monorepo',
  'discover_workflows',
  'workflows_dir',
  'ci_tools',
  'require_path_hits',
  'trust_repo_jev_endpoint',
  'decision_mode',
  'cache_decisions',
  'token',
  'dry_run',
] as const;

void runAction({
  inputs: Object.fromEntries(names.map(name => [name, core.getInput(name)])),
  env: process.env,
  workspace: process.env.GITHUB_WORKSPACE || process.cwd(),
  eventName: github.context.eventName,
  payload: github.context.payload as Record<string, unknown>,
  repo: github.context.repo,
  fetch: globalThis.fetch.bind(globalThis),
  info: message => core.info(message),
  warning: message => core.warning(message),
  setOutput: (name, value) => core.setOutput(name, value),
  setFailed: message => core.setFailed(message),
  summary: async markdown => {
    core.summary.addRaw(markdown);
    await core.summary.write();
  },
});

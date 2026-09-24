import { PathfinderDecisionSchema, type JobDefinition, type PathfinderDecision } from '../schemas/pathfinder.js';
import type { JevProviderId } from '../schemas/enums.js';
import type { HistorySummary } from '../collectors/history.js';
import type { MonorepoEvidence } from '../collectors/monorepo.js';
import { orderReasonCodes } from './policy.js';
import { closeDependencies, annotatePathHits } from './graph.js';
import { matchPath } from '../utils/globs.js';
import { sanitizeSummary } from '../utils/sanitize.js';
import type { ExecutionResult } from './policy.js';
import type { CiInventory } from '../collectors/workflows.js';

/**
 * Build a SELECT_JOBS decision from path hits, always-on jobs, history reruns,
 * and authoritative monorepo mappings — without calling Jev.
 */
export function buildDeterministicDecision(
  provider: JevProviderId,
  jobs: JobDefinition[],
  history: HistorySummary,
  monorepo: MonorepoEvidence,
  requirePathHits: boolean,
): PathfinderDecision {
  const selected = new Set<string>();
  for (const job of jobs) {
    if (job.always) selected.add(job.id);
    if (requirePathHits && job.pathHit) selected.add(job.id);
  }
  for (const id of history.rerunIds) selected.add(id);
  if (monorepo.authoritative) {
    for (const id of monorepo.mappedJobIds) selected.add(id);
  }
  const run_jobs = jobs.map(job => job.id).filter(id => selected.has(id));
  return PathfinderDecisionSchema.parse({
    decision: 'SELECT_JOBS',
    run_jobs,
    confidence: 1,
    reason_codes: orderReasonCodes(['DETERMINISTIC_ONLY', 'CONFIGURED_ALLOWLIST']),
    summary: sanitizeSummary(
      `Deterministic mode selected ${run_jobs.length} allowlisted job(s) without calling Jev.`,
    ),
    provisional: true,
    provider,
  });
}

export function executeDeterministic(input: {
  provider: JevProviderId;
  jobs: JobDefinition[];
  changedPaths: string[];
  requirePathHits: boolean;
  history: HistorySummary;
  monorepo: MonorepoEvidence;
  inventory: CiInventory;
  noChangedPaths: boolean;
}): ExecutionResult {
  const jobs = annotatePathHits(input.jobs, input.changedPaths, matchPath);
  const decision = buildDeterministicDecision(
    input.provider,
    jobs,
    input.history,
    input.monorepo,
    input.requirePathHits,
  );

  const always = jobs.filter(job => job.always).map(job => job.id);
  const pathHits = jobs.filter(job => job.pathHit).map(job => job.id);
  const selected = [
    ...decision.run_jobs,
    ...always,
    ...input.history.rerunIds,
    ...(input.requirePathHits ? pathHits : []),
    ...(input.monorepo.authoritative ? input.monorepo.mappedJobIds : []),
  ];
  const closed = closeDependencies(selected, jobs);
  const orderedIds = jobs.map(job => job.id);
  const runJobs = closed.ids;
  const skipJobs = orderedIds.filter(id => !runJobs.includes(id));
  const runSet = new Set(runJobs);
  const reasons = new Set<string>(['DETERMINISTIC_ONLY', 'CONFIGURED_ALLOWLIST']);
  if (input.noChangedPaths) reasons.add('NO_CHANGED_PATHS');
  if (always.length > 0) reasons.add('ALWAYS_RUN');
  if (closed.added.length > 0) reasons.add('DEPENDENCY_CLOSURE');
  if (input.history.rerunIds.some(id => runSet.has(id))) reasons.add('HISTORY_RERUN');
  if (input.history.enabled && !input.history.available) reasons.add('HISTORY_UNAVAILABLE');
  if (input.monorepo.authoritative && input.monorepo.mappedJobIds.some(id => runSet.has(id))) {
    reasons.add('MONOREPO_AFFECTED');
  }
  if (input.monorepo.droppedJobIds.length > 0) reasons.add('MONOREPO_JOB_DROPPED');
  for (const job of jobs) {
    if (!runSet.has(job.id)) continue;
    if (job.pathHit) reasons.add('PATH_MATCH');
    if (job.paths.length > 0 && !job.pathHit) reasons.add('NO_PATH_MATCH');
  }
  if (input.inventory.discovered) {
    const seen = new Set(input.inventory.jobIds);
    if (runJobs.some(id => seen.has(id))) reasons.add('CI_INVENTORY_MATCH');
    if (runJobs.some(id => !seen.has(id))) reasons.add('CI_JOB_NOT_IN_WORKFLOW');
  }

  return {
    decision: 'SELECT_JOBS',
    runJobs,
    skipJobs,
    confidence: 1,
    reasonCodes: orderReasonCodes(reasons),
    summary: sanitizeSummary(
      `Deterministic mode selected ${runJobs.length} of ${orderedIds.length} allowlisted jobs without calling Jev.`,
    ),
    provisional: true,
    needsReview: false,
    shouldFail: false,
    failureMessage: '',
    historyApplied: input.history.rerunIds.filter(id => runSet.has(id)),
    provider: input.provider,
  };
}

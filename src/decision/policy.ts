import type { Decision, JevProviderId, LowConfidencePolicy, ReasonCode } from '../schemas/enums.js';
import { REASON_CODES } from '../schemas/enums.js';
import type { JobDefinition, PathfinderDecision } from '../schemas/pathfinder.js';
import type { CiInventory } from '../collectors/workflows.js';
import type { HistorySummary } from '../collectors/history.js';
import type { MonorepoEvidence } from '../collectors/monorepo.js';
import { closeDependencies } from './graph.js';
import { sanitizeSummary } from '../utils/sanitize.js';

export interface PolicyInput {
  decision: PathfinderDecision;
  jobs: JobDefinition[];
  minConfidence: number;
  policy: LowConfidencePolicy;
  requirePathHits: boolean;
  noChangedPaths: boolean;
  history: HistorySummary;
  monorepo: MonorepoEvidence;
  inventory: CiInventory;
}

export interface ExecutionResult {
  decision: Decision;
  runJobs: string[];
  skipJobs: string[];
  confidence: number;
  reasonCodes: ReasonCode[];
  summary: string;
  provisional: boolean;
  needsReview: boolean;
  shouldFail: boolean;
  failureMessage: string;
  historyApplied: string[];
  provider: JevProviderId;
}

export function orderReasonCodes(codes: Iterable<string>): ReasonCode[] {
  const present = new Set(codes);
  return REASON_CODES.filter(code => present.has(code));
}

function blockedSelection(input: PolicyInput, unknown: string[]): boolean {
  const decision = input.decision;
  return (
    unknown.length > 0 ||
    decision.provisional ||
    decision.decision !== 'SELECT_JOBS' ||
    decision.confidence < input.minConfidence ||
    decision.reason_codes.includes('JEV_UNAVAILABLE') ||
    decision.reason_codes.includes('SCHEMA_REJECTED')
  );
}

export function applyPolicy(input: PolicyInput): ExecutionResult {
  const orderedIds = input.jobs.map(job => job.id);
  const allow = new Set(orderedIds);
  const always = input.jobs.filter(job => job.always).map(job => job.id);
  const pathHits = input.jobs.filter(job => job.pathHit).map(job => job.id);
  const unknown = input.decision.run_jobs.filter(id => !allow.has(id));
  const blocked = blockedSelection(input, unknown);
  const reasons = new Set<string>(input.decision.reason_codes);
  reasons.add('CONFIGURED_ALLOWLIST');
  if (input.noChangedPaths) reasons.add('NO_CHANGED_PATHS');
  if (input.history.enabled && !input.history.available) reasons.add('HISTORY_UNAVAILABLE');
  if (input.monorepo.droppedJobIds.length > 0) reasons.add('MONOREPO_JOB_DROPPED');

  let decisionOut: Decision = input.decision.decision;
  let provisional = input.decision.provisional;
  let needsReview = false;
  let shouldFail = false;
  let selected: string[];

  if (blocked) {
    provisional = true;
    if (input.decision.decision === 'SELECT_JOBS' && input.decision.confidence < input.minConfidence) {
      reasons.add('LOW_CONFIDENCE');
    }
    if (unknown.length > 0) reasons.add('SCHEMA_REJECTED');
    if (input.policy === 'request-review') {
      decisionOut = 'REQUEST_REVIEW';
      needsReview = true;
      reasons.add('POLICY_REQUEST_REVIEW');
      reasons.add('POLICY_RUN_ALL');
      selected = [...orderedIds];
    } else if (input.policy === 'no-op') {
      decisionOut = input.decision.decision === 'REQUEST_REVIEW' ? 'REQUEST_REVIEW' : 'ABSTAIN';
      reasons.add('POLICY_NO_OP');
      if (decisionOut === 'ABSTAIN') reasons.add('POLICY_ABSTAIN');
      selected = [
        ...always,
        ...input.history.rerunIds,
        ...(input.monorepo.authoritative ? input.monorepo.mappedJobIds : []),
      ];
    } else if (input.policy === 'fail') {
      decisionOut = input.decision.decision === 'REQUEST_REVIEW' ? 'REQUEST_REVIEW' : 'ABSTAIN';
      reasons.add('POLICY_RUN_ALL');
      shouldFail = true;
      selected = [...orderedIds];
    } else {
      decisionOut = input.decision.decision === 'REQUEST_REVIEW' ? 'REQUEST_REVIEW' : 'ABSTAIN';
      reasons.add('POLICY_RUN_ALL');
      selected = [...orderedIds];
    }
  } else {
    selected = [...input.decision.run_jobs, ...always, ...input.history.rerunIds];
    if (input.requirePathHits) selected.push(...pathHits);
    if (input.monorepo.authoritative) selected.push(...input.monorepo.mappedJobIds);
    if (input.history.rerunIds.length > 0) reasons.add('HISTORY_RERUN');
    if (always.length > 0) reasons.add('ALWAYS_RUN');
    if (input.monorepo.authoritative && input.monorepo.mappedJobIds.length > 0) {
      reasons.add('MONOREPO_AFFECTED');
    }
  }

  const closed = closeDependencies(selected, input.jobs);
  if (closed.added.length > 0) reasons.add('DEPENDENCY_CLOSURE');
  const runJobs = closed.ids;
  const skipJobs = orderedIds.filter(id => !runJobs.includes(id));
  const runSet = new Set(runJobs);

  if (input.inventory.discovered) {
    const seen = new Set(input.inventory.jobIds);
    if (runJobs.some(id => seen.has(id))) reasons.add('CI_INVENTORY_MATCH');
    if (runJobs.some(id => !seen.has(id))) reasons.add('CI_JOB_NOT_IN_WORKFLOW');
  }
  for (const job of input.jobs) {
    if (!runSet.has(job.id)) continue;
    if (job.pathHit) reasons.add('PATH_MATCH');
    if (job.paths.length > 0 && !job.pathHit) reasons.add('NO_PATH_MATCH');
  }
  if (input.history.rerunIds.some(id => runSet.has(id))) reasons.add('HISTORY_RERUN');
  if (input.monorepo.authoritative && input.monorepo.mappedJobIds.some(id => runSet.has(id))) {
    reasons.add('MONOREPO_AFFECTED');
  }

  const summary = blocked
    ? sanitizeSummary(
        `Deterministic policy ${input.policy} applied after ${input.decision.provider} returned ${input.decision.decision}. ${input.decision.summary} Run set size ${runJobs.length}.`,
      )
    : sanitizeSummary(
        `Jev (${input.decision.provider}) selected ${runJobs.length} of ${orderedIds.length} allowlisted jobs.`,
      );

  const failureMessage = shouldFail
    ? sanitizeSummary(
        `CI Pathfinder policy fail stopped the job after a non-trusted Jev result. Outputs still list the full allowlist so a continue-on-error consumer does not skip checks by accident.`,
      )
    : '';

  return {
    decision: decisionOut,
    runJobs,
    skipJobs,
    confidence: input.decision.confidence,
    reasonCodes: orderReasonCodes(reasons),
    summary,
    provisional,
    needsReview,
    shouldFail,
    failureMessage,
    historyApplied: input.history.rerunIds.filter(id => runSet.has(id)),
    provider: input.decision.provider,
  };
}

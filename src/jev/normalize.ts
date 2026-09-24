import { PathfinderDecisionSchema, type PathfinderDecision } from '../schemas/pathfinder.js';
import type { JevProviderId, ReasonCode } from '../schemas/enums.js';
import { sanitizeSummary } from '../utils/sanitize.js';
import type { CiEvaluationState } from '../decision/evidence.js';

export class SchemaRejectedError extends Error {
  constructor(message: string) {
    super(`SCHEMA_REJECTED: ${message}`);
    this.name = 'SchemaRejectedError';
  }
}

export function isSchemaRejected(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('SCHEMA_REJECTED');
}

export interface AnswerValue {
  type?: string;
  probability?: number;
  confidence?: number;
}

export interface RawEvaluation {
  provider: JevProviderId;
  modelLabel: string;
  answers: Record<string, AnswerValue | undefined>;
  confidence?: Record<string, number>;
}

function probabilityOf(answer: AnswerValue | undefined, label: string): number {
  if (!answer || answer.type !== 'boolean' || typeof answer.probability !== 'number') {
    throw new SchemaRejectedError(`${label} must be a boolean answer`);
  }
  if (!Number.isFinite(answer.probability) || answer.probability < 0 || answer.probability > 1) {
    throw new SchemaRejectedError(`${label} probability is outside 0..1`);
  }
  return answer.probability;
}

function derivedReasons(state: CiEvaluationState, selected: string[], decision: PathfinderDecision['decision']): ReasonCode[] {
  const codes = new Set<ReasonCode>(['CONFIGURED_ALLOWLIST']);
  if (decision === 'ABSTAIN') codes.add('POLICY_ABSTAIN');
  if (decision === 'REQUEST_REVIEW') codes.add('POLICY_REQUEST_REVIEW');
  const selectedSet = new Set(selected);
  for (const job of state.jobs) {
    if (!selectedSet.has(job.id)) continue;
    if (job.path_hit) codes.add('PATH_MATCH');
    if (job.paths.length > 0 && !job.path_hit) codes.add('NO_PATH_MATCH');
    if (job.in_workflow === true) codes.add('CI_INVENTORY_MATCH');
    if (job.in_workflow === false) codes.add('CI_JOB_NOT_IN_WORKFLOW');
    if (job.recent_failures > 0) codes.add('HISTORY_RERUN');
  }
  if (state.changed_paths.length === 0) codes.add('NO_CHANGED_PATHS');
  if (state.monorepo.affected_projects.length > 0) codes.add('MONOREPO_AFFECTED');
  if (state.monorepo.dropped_count > 0) codes.add('MONOREPO_JOB_DROPPED');
  if (state.history.enabled && !state.history.available) codes.add('HISTORY_UNAVAILABLE');
  return [...codes].slice(0, 16);
}

export function decisionFromEvaluation(
  raw: RawEvaluation,
  state: CiEvaluationState,
  keyToJob: Map<string, string>,
): PathfinderDecision {
  const selected: string[] = [];
  const margins: number[] = [];
  for (const [key, jobId] of keyToJob) {
    const probability = probabilityOf(raw.answers[key], key);
    margins.push(Math.max(probability, 1 - probability));
    if (probability >= 0.5) selected.push(jobId);
  }
  const abstain = probabilityOf(raw.answers.abstain, 'abstain');
  const review = probabilityOf(raw.answers.request_review, 'request_review');
  const providerConfidence = raw.confidence
    ? Object.entries(raw.confidence)
        .filter(([key]) => keyToJob.has(key))
        .map(([, value]) => value)
        .filter(value => typeof value === 'number' && Number.isFinite(value))
    : [];
  const confidence =
    providerConfidence.length > 0
      ? Math.min(1, Math.max(0, providerConfidence.reduce((sum, value) => sum + value, 0) / providerConfidence.length))
      : margins.length > 0
        ? margins.reduce((sum, value) => sum + value, 0) / margins.length
        : 0;

  let decision: PathfinderDecision['decision'] = 'SELECT_JOBS';
  let runJobs = selected;
  if (abstain >= 0.55) {
    decision = 'ABSTAIN';
    runJobs = [];
  } else if (review >= 0.55 && confidence < 0.85) {
    decision = 'REQUEST_REVIEW';
    runJobs = [];
  }

  const summary =
    decision === 'SELECT_JOBS'
      ? `Jev (${raw.provider}, ${raw.modelLabel}) marked ${runJobs.length} allowlisted job(s) to run.`
      : decision === 'ABSTAIN'
        ? `Jev (${raw.provider}, ${raw.modelLabel}) abstained from selecting jobs.`
        : `Jev (${raw.provider}, ${raw.modelLabel}) requested review before skipping jobs.`;

  return PathfinderDecisionSchema.parse({
    decision,
    run_jobs: runJobs,
    confidence,
    reason_codes: derivedReasons(state, runJobs, decision),
    summary: sanitizeSummary(summary),
    provisional: false,
    provider: raw.provider,
  });
}

export function unavailableDecision(
  provider: JevProviderId,
  message: string,
  code: 'JEV_UNAVAILABLE' | 'SCHEMA_REJECTED' = 'JEV_UNAVAILABLE',
): PathfinderDecision {
  return PathfinderDecisionSchema.parse({
    decision: 'ABSTAIN',
    run_jobs: [],
    confidence: 0,
    reason_codes: [code, 'POLICY_ABSTAIN'],
    summary: sanitizeSummary(message),
    provisional: true,
    provider,
  });
}

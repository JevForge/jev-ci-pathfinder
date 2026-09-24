import type { JevProvider } from '../jev/contract.js';
import { isSchemaRejected, unavailableDecision } from '../jev/normalize.js';
import type { LowConfidencePolicy } from '../schemas/enums.js';
import type { JobDefinition } from '../schemas/pathfinder.js';
import type { CiInventory } from '../collectors/workflows.js';
import type { HistorySummary } from '../collectors/history.js';
import type { MonorepoEvidence } from '../collectors/monorepo.js';
import { annotatePathHits } from './graph.js';
import { matchPath } from '../utils/globs.js';
import { buildEvidence, buildJobQuestions } from './evidence.js';
import { applyPolicy, type ExecutionResult } from './policy.js';

export interface ExecuteInput {
  provider: JevProvider;
  jobs: JobDefinition[];
  changedPaths: string[];
  pathsTruncated: boolean;
  minConfidence: number;
  policy: LowConfidencePolicy;
  requirePathHits: boolean;
  history: HistorySummary;
  monorepo: MonorepoEvidence;
  inventory: CiInventory;
}

export async function executePathfinder(input: ExecuteInput): Promise<ExecutionResult> {
  const jobs = annotatePathHits(input.jobs, input.changedPaths, matchPath);
  const history = input.history;
  const monorepo = input.monorepo;
  const inventory = input.inventory;
  const state = buildEvidence({
    jobs,
    changedPaths: input.changedPaths,
    pathsTruncated: input.pathsTruncated,
    history,
    monorepo,
    inventory,
  });
  const { questions, keyToJob } = buildJobQuestions(jobs);
  let decision;
  try {
    decision = await input.provider.evaluateCiSelection({ state, questions, keyToJob });
  } catch (error) {
    if (!isSchemaRejected(error)) throw error;
    const message = error instanceof Error ? error.message : 'SCHEMA_REJECTED';
    decision = unavailableDecision(input.provider.id, message, 'SCHEMA_REJECTED');
  }
  return applyPolicy({
    decision,
    jobs,
    minConfidence: input.minConfidence,
    policy: input.policy,
    requirePathHits: input.requirePathHits,
    noChangedPaths: input.changedPaths.length === 0,
    history,
    monorepo,
    inventory,
  });
}

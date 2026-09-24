/**
 * Local Jev provider contract for Pathfinder.
 *
 * When `@jevforge/core` is published, swap adapters to import `JevProvider`
 * (and related evaluate types) from that package instead of this module.
 * Until then this file is the single source of truth inside this Action.
 */
import type { JevProviderId } from '../schemas/enums.js';
import type { PathfinderDecision } from '../schemas/pathfinder.js';
import type { CiEvaluationState } from '../decision/evidence.js';

export interface EvaluationRequest {
  state: CiEvaluationState;
  questions: Record<string, { type: 'boolean'; instructions: string }>;
  keyToJob: Map<string, string>;
}

export interface JevProvider {
  readonly id: JevProviderId;
  evaluateCiSelection(request: EvaluationRequest): Promise<PathfinderDecision>;
}

export interface JevProviderOptions {
  apiKey?: string;
  endpoint?: string;
  model?: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  evaluateImpl?: (args: {
    model: unknown;
    state: Record<string, unknown>;
    questions: EvaluationRequest['questions'];
    maxRetries?: number;
    abortSignal?: AbortSignal;
    providerOptions?: Record<string, unknown>;
  }) => Promise<{
    answers: Record<string, { type?: string; probability?: number; confidence?: number }>;
    providerMetadata?: { typesafe?: { confidence?: Record<string, number> } };
  }>;
}

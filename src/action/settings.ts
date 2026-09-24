import type { JeConfig } from '../schemas/pathfinder.js';
import type { JevProviderId } from '../schemas/enums.js';
import { coalesceProvider } from '../collectors/config.js';
import { assertModelId, assertPublicHttpsEndpoint } from '../utils/endpoint.js';

export interface ResolvedProvider {
  provider: JevProviderId;
  endpoint?: string;
  model?: string;
  refusal?: string;
}

export function resolveProviderSettings(input: {
  inputProvider?: string;
  inputEndpoint?: string;
  inputModel?: string;
  config: JeConfig;
  trustRepoEndpoint: boolean;
}): ResolvedProvider {
  const provider = coalesceProvider(input.inputProvider, input.config);
  const modelInput = input.inputModel?.trim() || undefined;
  if (modelInput && !assertModelId(modelInput)) {
    throw new Error('jev_model contains unsupported characters');
  }

  if (provider === 'vercel-ai-gateway') {
    return {
      provider,
      model: modelInput || 'typesafe-ai/jev',
    };
  }

  const endpointInput = input.inputEndpoint?.trim() || undefined;
  const endpointConfig = input.config.jev_endpoint?.trim() || undefined;
  const endpoint = endpointInput || endpointConfig;
  if (!endpoint) {
    return { provider, refusal: `jev_endpoint is required for ${provider}` };
  }
  const checked = assertPublicHttpsEndpoint(endpoint);
  if (!checked.ok) return { provider, refusal: checked.reason };
  if (!endpointInput && endpointConfig && !input.trustRepoEndpoint) {
    return {
      provider,
      refusal:
        'Refusing to send Jev credentials to an endpoint taken from repository config. Set jev_endpoint as an action input or set trust_repo_jev_endpoint to true.',
    };
  }
  const model = modelInput || input.config.jev_model;
  if (!model || !assertModelId(model)) {
    return { provider, refusal: `jev_model is required for ${provider}` };
  }
  return { provider, endpoint: checked.url, model };
}

export function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value.trim() === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error('Expected a boolean input');
}

export function parseUnitInterval(value: string | undefined, fallback: number): number {
  if (value == null || value.trim() === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) {
    throw new Error('min_confidence must be between 0 and 1');
  }
  return number;
}

export function parseTimeout(value: string | undefined): number {
  if (value == null || value.trim() === '') return 45_000;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1_000 || number > 120_000) {
    throw new Error('jev_timeout_ms must be an integer from 1000 to 120000');
  }
  return number;
}

export function parseLookback(value: string | undefined, fallback: number): number {
  if (value == null || value.trim() === '') return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 20) {
    throw new Error('history_lookback must be an integer from 1 to 20');
  }
  return number;
}

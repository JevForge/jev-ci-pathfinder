import type { JevProviderId } from '../schemas/enums.js';
import type { JevProvider, JevProviderOptions } from './contract.js';
import { decisionFromEvaluation, isSchemaRejected, unavailableDecision, type AnswerValue } from './normalize.js';
import { assertPublicHttpsEndpoint } from '../utils/endpoint.js';

export async function postTypedEvaluation(
  provider: JevProviderId,
  options: JevProviderOptions,
  requestBody: unknown,
): Promise<{ answers: Record<string, AnswerValue | undefined>; confidence?: Record<string, number> } | { unavailable: string }> {
  if (!options.apiKey) {
    const secret = provider === 'typesafe-native' ? 'TYPESAFE_API_KEY' : 'JEV_CUSTOM_API_KEY';
    return { unavailable: `${secret} is required for ${provider}` };
  }
  if (!options.endpoint) return { unavailable: `jev_endpoint is required for ${provider}` };
  if (!options.model) return { unavailable: `jev_model is required for ${provider}` };
  const endpoint = assertPublicHttpsEndpoint(options.endpoint);
  if (!endpoint.ok) return { unavailable: endpoint.reason };

  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetchImpl(endpoint.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    if (!response.ok) {
      return { unavailable: `${provider} HTTP ${response.status}` };
    }
    const body = (await response.json()) as {
      answers?: Record<string, AnswerValue | undefined>;
      confidence?: Record<string, number>;
    };
    if (!body.answers || typeof body.answers !== 'object') {
      throw new Error('SCHEMA_REJECTED: missing answers object');
    }
    return { answers: body.answers, confidence: body.confidence };
  } catch (error) {
    if (isSchemaRejected(error)) throw error;
    const message = error instanceof Error ? error.message : String(error);
    return { unavailable: `${provider} error: ${message}` };
  } finally {
    clearTimeout(timer);
  }
}

export function createHttpProvider(provider: JevProviderId, options: JevProviderOptions): JevProvider {
  return {
    id: provider,
    async evaluateCiSelection(request) {
      try {
        const posted = await postTypedEvaluation(provider, options, {
          model: options.model,
          state: request.state,
          questions: request.questions,
        });
        if ('unavailable' in posted) return unavailableDecision(provider, posted.unavailable);
        return decisionFromEvaluation(
          {
            provider,
            modelLabel: options.model ?? provider,
            answers: posted.answers,
            confidence: posted.confidence,
          },
          request.state,
          request.keyToJob,
        );
      } catch (error) {
        if (isSchemaRejected(error)) throw error;
        const message = error instanceof Error ? error.message : String(error);
        return unavailableDecision(provider, `${provider} error: ${message}`);
      }
    },
  };
}

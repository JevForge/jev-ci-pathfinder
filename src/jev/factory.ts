import type { JevProviderId } from '../schemas/enums.js';
import { createCustomCompatibleProvider } from './custom-compatible.js';
import { createTypesafeNativeProvider } from './typesafe-native.js';
import type { JevProvider, JevProviderOptions } from './contract.js';
import { createVercelAiGatewayProvider } from './vercel-ai-gateway.js';

export function createJevProvider(id: JevProviderId, options: JevProviderOptions): JevProvider {
  switch (id) {
    case 'vercel-ai-gateway':
      return createVercelAiGatewayProvider(options);
    case 'typesafe-native':
      return createTypesafeNativeProvider(options);
    case 'custom-compatible':
      return createCustomCompatibleProvider(options);
    default:
      throw new Error(`Unsupported jev_provider: ${String(id)}`);
  }
}

export function credentialEnvName(provider: JevProviderId): string {
  switch (provider) {
    case 'vercel-ai-gateway':
      return 'AI_GATEWAY_API_KEY';
    case 'typesafe-native':
      return 'TYPESAFE_API_KEY';
    case 'custom-compatible':
      return 'JEV_CUSTOM_API_KEY';
  }
}

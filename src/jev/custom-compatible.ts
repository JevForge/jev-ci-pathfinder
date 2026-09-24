import { createHttpProvider } from './http-evaluate.js';
import type { JevProvider, JevProviderOptions } from './types.js';

export function createCustomCompatibleProvider(options: JevProviderOptions): JevProvider {
  return createHttpProvider('custom-compatible', options);
}

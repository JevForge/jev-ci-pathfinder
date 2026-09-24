import { createHttpProvider } from './http-evaluate.js';
import type { JevProvider, JevProviderOptions } from './contract.js';

export function createCustomCompatibleProvider(options: JevProviderOptions): JevProvider {
  return createHttpProvider('custom-compatible', options);
}

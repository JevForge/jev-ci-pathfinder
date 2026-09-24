import { createHttpProvider } from './http-evaluate.js';
import type { JevProvider, JevProviderOptions } from './contract.js';

export function createTypesafeNativeProvider(options: JevProviderOptions): JevProvider {
  return createHttpProvider('typesafe-native', options);
}

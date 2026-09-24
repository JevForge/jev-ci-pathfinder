import { createHttpProvider } from './http-evaluate.js';
import type { JevProvider, JevProviderOptions } from './types.js';

export function createTypesafeNativeProvider(options: JevProviderOptions): JevProvider {
  return createHttpProvider('typesafe-native', options);
}

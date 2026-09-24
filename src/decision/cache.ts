import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { restoreCache, saveCache } from '@actions/cache';
import { z } from 'zod';
import type { ExecutionResult } from '../decision/policy.js';
import {
  REASON_CODES,
  DECISIONS,
  JEV_PROVIDERS,
  type ReasonCode,
  type Decision,
  type JevProviderId,
} from '../schemas/enums.js';

const CachedResultSchema = z.object({
  decision: z.enum(DECISIONS),
  runJobs: z.array(z.string()),
  skipJobs: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  reasonCodes: z.array(z.enum(REASON_CODES)),
  summary: z.string(),
  provisional: z.boolean(),
  needsReview: z.boolean(),
  shouldFail: z.boolean(),
  failureMessage: z.string(),
  historyApplied: z.array(z.string()),
  provider: z.enum(JEV_PROVIDERS),
});

export function buildCacheKey(parts: {
  sha: string;
  configFingerprint: string;
  paths: string[];
  provider: string;
  decisionMode: string;
}): string {
  const hash = createHash('sha256')
    .update(
      JSON.stringify({
        config: parts.configFingerprint,
        paths: [...parts.paths].sort(),
        provider: parts.provider,
        mode: parts.decisionMode,
      }),
    )
    .digest('hex')
    .slice(0, 24);
  const sha = parts.sha.replace(/[^a-fA-F0-9]/g, '').slice(0, 40) || 'nosha';
  return `jev-cpath-v1-${sha}-${hash}`;
}

export function fingerprintConfig(raw: unknown): string {
  return createHash('sha256').update(JSON.stringify(raw)).digest('hex').slice(0, 32);
}

const FILE = 'decision.json';

export async function tryRestoreDecisionCache(input: {
  enabled: boolean;
  key: string;
  cacheDir: string;
}): Promise<ExecutionResult | null> {
  if (!input.enabled) return null;
  mkdirSync(input.cacheDir, { recursive: true });
  const file = join(input.cacheDir, FILE);
  try {
    const hit = await restoreCache([input.cacheDir], input.key);
    if (!hit || !existsSync(file)) return null;
    const parsed = CachedResultSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
    return {
      decision: parsed.decision as Decision,
      runJobs: parsed.runJobs,
      skipJobs: parsed.skipJobs,
      confidence: parsed.confidence,
      reasonCodes: parsed.reasonCodes as ReasonCode[],
      summary: parsed.summary,
      provisional: parsed.provisional,
      needsReview: parsed.needsReview,
      shouldFail: parsed.shouldFail,
      failureMessage: parsed.failureMessage,
      historyApplied: parsed.historyApplied,
      provider: parsed.provider as JevProviderId,
    };
  } catch {
    return null;
  }
}

export async function saveDecisionCache(input: {
  enabled: boolean;
  key: string;
  cacheDir: string;
  result: ExecutionResult;
}): Promise<boolean> {
  if (!input.enabled) return false;
  mkdirSync(input.cacheDir, { recursive: true });
  const file = join(input.cacheDir, FILE);
  const payload = CachedResultSchema.parse(input.result);
  writeFileSync(file, JSON.stringify(payload));
  try {
    await saveCache([input.cacheDir], input.key);
    return true;
  } catch {
    return false;
  }
}

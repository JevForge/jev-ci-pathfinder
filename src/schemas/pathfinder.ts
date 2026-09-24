import { z } from 'zod';
import {
  DECISIONS,
  JEV_PROVIDERS,
  JOB_ID_PATTERN,
  LOW_CONFIDENCE_POLICIES,
  REASON_CODES,
} from './enums.js';

export const JobIdSchema = z.string().regex(JOB_ID_PATTERN);

export const JobConfigSchema = z.object({
  id: JobIdSchema,
  paths: z.array(z.string().min(1).max(256)).max(50).default([]),
  needs: z.array(JobIdSchema).max(32).default([]),
  always: z.boolean().default(false),
  rerun_on_recent_failure: z.boolean().default(false),
});

export type JobConfig = z.infer<typeof JobConfigSchema>;

export const PackageMapSchema = z.object({
  name: z.string().regex(/^[A-Za-z0-9_@./-]{1,128}$/),
  paths: z.array(z.string().min(1).max(256)).min(1).max(50),
  jobs: z.array(JobIdSchema).min(1).max(32),
});

export type PackageMap = z.infer<typeof PackageMapSchema>;

export const PathfinderConfigSchema = z.object({
  version: z.literal(1).default(1),
  jobs: z.array(JobConfigSchema).min(1).max(64),
  history: z
    .object({
      lookback: z.number().int().min(1).max(20).optional(),
    })
    .optional(),
  monorepo: z
    .object({
      packages: z.array(PackageMapSchema).max(200).default([]),
    })
    .optional(),
});

export type PathfinderConfig = z.infer<typeof PathfinderConfigSchema>;

export const MonorepoPlanSchema = z
  .object({
    plan_version: z.literal(1).optional(),
    affected_projects: z.array(z.string().min(1).max(128)).max(200).default([]),
    execution_plan: z
      .array(
        z.object({
          project: z.string().min(1).max(128),
          jobs: z.array(z.string().min(1).max(80)).max(50),
        }),
      )
      .max(200)
      .optional(),
  })
  .superRefine((value, ctx) => {
    // Accept legacy plans without plan_version. Reject unknown future versions explicitly.
    if (value.plan_version !== undefined && value.plan_version !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Unsupported monorepo plan_version',
        path: ['plan_version'],
      });
    }
  });

export type MonorepoPlan = z.infer<typeof MonorepoPlanSchema>;

export function isVersionedMonorepoPlan(plan: MonorepoPlan): boolean {
  return plan.plan_version === 1;
}
export const HistoryRunSchema = z.object({
  head_branch: z.string().min(1).max(256).optional(),
  conclusion: z
    .enum(['success', 'failure', 'cancelled', 'skipped', 'timed_out', 'unknown'])
    .optional(),
  failed_jobs: z.array(JobIdSchema).max(64).default([]),
});

export type HistoryRun = z.infer<typeof HistoryRunSchema>;

export const HistoryFileSchema = z.object({
  runs: z.array(HistoryRunSchema).max(50),
});

export const JeConfigSchema = z.object({
  jev_provider: z.enum(JEV_PROVIDERS).optional(),
  jev_endpoint: z.string().url().optional(),
  jev_model: z.string().min(1).max(128).optional(),
  min_confidence: z.number().min(0).max(1).optional(),
  low_confidence_policy: z.enum(LOW_CONFIDENCE_POLICIES).optional(),
});

export type JeConfig = z.infer<typeof JeConfigSchema>;

export const PathfinderDecisionSchema = z
  .object({
    decision: z.enum(DECISIONS),
    run_jobs: z.array(JobIdSchema).max(64),
    confidence: z.number().min(0).max(1),
    reason_codes: z.array(z.enum(REASON_CODES)).min(1).max(16),
    summary: z.string().max(500),
    provisional: z.boolean(),
    provider: z.enum(JEV_PROVIDERS),
  })
  .superRefine((value, ctx) => {
    if (new Set(value.run_jobs).size !== value.run_jobs.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'run_jobs must be unique',
        path: ['run_jobs'],
      });
    }
    if (value.decision !== 'SELECT_JOBS' && value.run_jobs.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Only SELECT_JOBS may list run_jobs',
        path: ['run_jobs'],
      });
    }
  });

export type PathfinderDecision = z.infer<typeof PathfinderDecisionSchema>;

export interface JobDefinition {
  id: string;
  paths: string[];
  needs: string[];
  always: boolean;
  rerunOnRecentFailure: boolean;
  pathHit: boolean;
}

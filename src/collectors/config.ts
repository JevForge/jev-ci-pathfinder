import { readFileSync, existsSync, statSync } from 'node:fs';
import YAML from 'yaml';
import { ZodError } from 'zod';
import {
  HistoryFileSchema,
  JeConfigSchema,
  JobConfigSchema,
  PathfinderConfigSchema,
  type HistoryRun,
  type JeConfig,
  type JobDefinition,
  type PackageMap,
} from '../schemas/pathfinder.js';
import { JEV_PROVIDERS, LOW_CONFIDENCE_POLICIES, type JevProviderId, type LowConfidencePolicy } from '../schemas/enums.js';
import { assertSafeGlob } from '../utils/globs.js';
import { resolveInside } from '../utils/paths.js';
import { z } from 'zod';

const MAX_FILE_BYTES = 256_000;

export function readBounded(workspace: string, relativePath: string): string | null {
  const full = resolveInside(workspace, relativePath);
  if (!existsSync(full)) return null;
  const size = statSync(full).size;
  if (size > MAX_FILE_BYTES) {
    throw new Error(`File exceeds ${MAX_FILE_BYTES} bytes: ${relativePath}`);
  }
  return readFileSync(full, 'utf8');
}

function formatZod(error: ZodError): string {
  return error.issues.map(issue => `${issue.path.join('.') || 'config'}: ${issue.message}`).join('; ');
}

export function loadJeConfig(workspace: string, relativePath = '.jev/config.yml'): JeConfig {
  const raw = readBounded(workspace, relativePath);
  if (raw == null) return {};
  let parsed: unknown;
  try {
    parsed = YAML.parse(raw) ?? {};
  } catch {
    throw new Error(`Invalid YAML in ${relativePath}`);
  }
  const result = JeConfigSchema.safeParse(parsed);
  if (!result.success) throw new Error(`Invalid ${relativePath}: ${formatZod(result.error)}`);
  return result.data;
}

export interface LoadedPathfinderConfig {
  jobs: JobDefinition[];
  lookback: number;
  packages: PackageMap[];
}

function toDefinitions(jobs: z.infer<typeof JobConfigSchema>[]): JobDefinition[] {
  const ids = jobs.map(job => job.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error('Job ids must be unique');
  }
  const known = new Set(ids);
  for (const job of jobs) {
    for (const glob of job.paths) assertSafeGlob(glob);
    for (const need of job.needs) {
      if (need === job.id) throw new Error(`Job ${job.id} cannot depend on itself`);
      if (!known.has(need)) throw new Error(`Job ${job.id} needs unknown job ${need}`);
    }
  }
  for (const job of jobs) {
    job.paths.forEach(assertSafeGlob);
  }
  assertAcyclic(jobs.map(job => ({ id: job.id, needs: job.needs })));
  return jobs.map(job => ({
    id: job.id,
    paths: job.paths,
    needs: job.needs,
    always: job.always,
    rerunOnRecentFailure: job.rerun_on_recent_failure,
    pathHit: false,
  }));
}

export function assertAcyclic(jobs: { id: string; needs: string[] }[]): void {
  const needs = new Map(jobs.map(job => [job.id, job.needs]));
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (id: string) => {
    const mark = state.get(id);
    if (mark === 'visiting') throw new Error(`Job dependency cycle includes ${id}`);
    if (mark === 'done') return;
    state.set(id, 'visiting');
    for (const need of needs.get(id) ?? []) visit(need);
    state.set(id, 'done');
  };
  for (const job of jobs) visit(job.id);
}

export function loadPathfinderConfig(
  workspace: string,
  configPath: string,
  jobMapJson: string,
): LoadedPathfinderConfig {
  const raw = readBounded(workspace, configPath);
  let fileJobs: unknown;
  let lookback = 10;
  let packages: PackageMap[] = [];
  if (raw != null) {
    let parsed: unknown;
    try {
      parsed = YAML.parse(raw) ?? {};
    } catch {
      throw new Error(`Invalid YAML in ${configPath}`);
    }
    const result = PathfinderConfigSchema.safeParse(parsed);
    if (!result.success) throw new Error(`Invalid ${configPath}: ${formatZod(result.error)}`);
    fileJobs = result.data.jobs;
    lookback = result.data.history?.lookback ?? 10;
    packages = result.data.monorepo?.packages ?? [];
    for (const pkg of packages) {
      for (const glob of pkg.paths) assertSafeGlob(glob);
    }
  }

  let jobsSource: unknown = fileJobs;
  if (jobMapJson.trim()) {
    try {
      jobsSource = JSON.parse(jobMapJson) as unknown;
    } catch {
      throw new Error('job_map is not valid JSON');
    }
    const parsedJobs = z.array(JobConfigSchema).min(1).max(64).safeParse(jobsSource);
    if (!parsedJobs.success) throw new Error(`Invalid job_map: ${formatZod(parsedJobs.error)}`);
    jobsSource = parsedJobs.data;
  }

  if (!jobsSource) {
    throw new Error(`Missing pathfinder config at ${configPath}`);
  }
  const jobs = Array.isArray(jobsSource)
    ? toDefinitions(z.array(JobConfigSchema).min(1).max(64).parse(jobsSource))
    : toDefinitions(PathfinderConfigSchema.parse({ jobs: jobsSource }).jobs);

  const packageJobs = new Set(jobs.map(job => job.id));
  for (const pkg of packages) {
    for (const jobId of pkg.jobs) {
      if (!packageJobs.has(jobId)) {
        throw new Error(`Monorepo package ${pkg.name} maps unknown job ${jobId}`);
      }
    }
  }
  return { jobs, lookback, packages };
}

export function loadHistoryFile(workspace: string, relativePath: string): HistoryRun[] | null {
  const raw = readBounded(workspace, relativePath);
  if (raw == null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`Invalid JSON in ${relativePath}`);
  }
  const result = HistoryFileSchema.safeParse(parsed);
  if (!result.success) throw new Error(`Invalid ${relativePath}: ${formatZod(result.error)}`);
  return result.data.runs;
}

export function coalesceProvider(input: string | undefined, config: JeConfig): JevProviderId {
  const value = (input?.trim() || config.jev_provider || 'vercel-ai-gateway') as JevProviderId;
  if (!JEV_PROVIDERS.includes(value)) throw new Error(`Unsupported jev_provider: ${value}`);
  return value;
}

export function coalescePolicy(input: string | undefined, config: JeConfig): LowConfidencePolicy {
  const value = (input?.trim() || config.low_confidence_policy || 'warn') as LowConfidencePolicy;
  if (!LOW_CONFIDENCE_POLICIES.includes(value)) {
    throw new Error(`Unsupported low_confidence_policy: ${value}`);
  }
  return value;
}

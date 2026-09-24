import { basename } from 'node:path';
import YAML from 'yaml';
import { JOB_ID_PATTERN, type CiTool } from '../schemas/enums.js';

export interface CiJobSeen {
  tool: CiTool;
  source: string;
  jobId: string;
  needs: string[];
}

function asJobId(value: unknown): string | null {
  return typeof value === 'string' && JOB_ID_PATTERN.test(value) ? value : null;
}

function needsOf(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  const needs = (value as { needs?: unknown }).needs;
  if (typeof needs === 'string') {
    const id = asJobId(needs);
    return id ? [id] : [];
  }
  if (!Array.isArray(needs)) return [];
  return needs.map(asJobId).filter((id): id is string => id != null);
}

export function parseGithubWorkflow(filename: string, content: string): CiJobSeen[] {
  let doc: unknown;
  try {
    doc = YAML.parse(content);
  } catch {
    return [];
  }
  if (!doc || typeof doc !== 'object') return [];
  const jobs = (doc as { jobs?: unknown }).jobs;
  if (!jobs || typeof jobs !== 'object') return [];
  const source = basename(filename);
  const seen: CiJobSeen[] = [];
  for (const [id, value] of Object.entries(jobs)) {
    if (!JOB_ID_PATTERN.test(id)) continue;
    seen.push({ tool: 'github-actions', source, jobId: id, needs: needsOf(value) });
  }
  return seen;
}

export function parseCircleCi(content: string): CiJobSeen[] {
  let doc: unknown;
  try {
    doc = YAML.parse(content);
  } catch {
    return [];
  }
  if (!doc || typeof doc !== 'object') return [];
  const seen = new Map<string, CiJobSeen>();
  const jobs = (doc as { jobs?: unknown }).jobs;
  if (jobs && typeof jobs === 'object') {
    for (const id of Object.keys(jobs)) {
      if (!JOB_ID_PATTERN.test(id)) continue;
      seen.set(id, { tool: 'circleci', source: '.circleci/config.yml', jobId: id, needs: [] });
    }
  }
  const workflows = (doc as { workflows?: unknown }).workflows;
  if (workflows && typeof workflows === 'object') {
    for (const [name, workflow] of Object.entries(workflows)) {
      if (name === 'version' || !workflow || typeof workflow !== 'object') continue;
      const list = (workflow as { jobs?: unknown }).jobs;
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        if (typeof item === 'string') {
          const id = asJobId(item);
          if (!id) continue;
          if (!seen.has(id)) {
            seen.set(id, { tool: 'circleci', source: '.circleci/config.yml', jobId: id, needs: [] });
          }
          continue;
        }
        if (!item || typeof item !== 'object') continue;
        const entry = Object.entries(item)[0];
        if (!entry) continue;
        const [rawId, cfg] = entry;
        const id = asJobId(rawId);
        if (!id) continue;
        const requires =
          cfg && typeof cfg === 'object' && Array.isArray((cfg as { requires?: unknown }).requires)
            ? ((cfg as { requires: unknown[] }).requires.map(asJobId).filter((job): job is string => job != null))
            : [];
        const previous = seen.get(id);
        seen.set(id, {
          tool: 'circleci',
          source: '.circleci/config.yml',
          jobId: id,
          needs: requires.length ? requires : (previous?.needs ?? []),
        });
      }
    }
  }
  return [...seen.values()];
}

const STAGE_PATTERN = /stage\s*\(\s*(['"])([A-Za-z][A-Za-z0-9_-]{0,63})\1\s*\)/g;

export function parseJenkinsfile(content: string): CiJobSeen[] {
  const seen = new Map<string, CiJobSeen>();
  for (const match of content.matchAll(STAGE_PATTERN)) {
    const id = match[2];
    if (!id || !JOB_ID_PATTERN.test(id) || seen.has(id)) continue;
    seen.set(id, { tool: 'jenkins', source: 'Jenkinsfile', jobId: id, needs: [] });
  }
  return [...seen.values()];
}

export interface CiInventory {
  discovered: boolean;
  jobIds: string[];
  sources: string[];
  jobs: CiJobSeen[];
}

export function emptyInventory(): CiInventory {
  return { discovered: false, jobIds: [], sources: [], jobs: [] };
}

export function inventoryFromJobs(jobs: CiJobSeen[]): CiInventory {
  if (jobs.length === 0) return emptyInventory();
  return {
    discovered: true,
    jobIds: [...new Set(jobs.map(job => job.jobId))],
    sources: [...new Set(jobs.map(job => `${job.tool}:${job.source}`))],
    jobs,
  };
}
